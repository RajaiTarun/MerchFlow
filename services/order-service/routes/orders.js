const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const OrderCommand = require('../models/OrderCommand');
const { publishOrderPlaced } = require('../messaging/rabbitmq');
const compensateInventory = require('../utils/compensateInventory');
const IDEMPOTENCY_TTL = 86400;
const LOCK_TTL_MS = 15000;
const LOCK_PREFIX = 'lock:item:';

const LUA_RELEASE_LOCK = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
return redis.call("DEL", KEYS[1])
else
return 0
end
`;

// lock helper functions
const acquireLock = async (redis, lockKey, ttlMs) => {
    const token = crypto.randomUUID();
    console.log(
        `[LOCK] SET NX START key=${lockKey} token=${token}`
    );
    const result = await redis.set(lockKey, token, 'NX', 'PX', ttlMs);
    console.log(
        `[LOCK] SET NX RESULT key=${lockKey}: ${result}`
    );
    if (result === 'OK') {
        // we are returning token when we able to acquire lock
        return token;
    }
    // returning null if someone already holds the lock
    return null;
}

const releaseLock = async (redis, lockKey, token) => {
    try {
        console.log(
            `[LOCK] RELEASE START key=${lockKey} token=${token}`
        );
        const result = await redis.eval(LUA_RELEASE_LOCK, 1, lockKey, token);
        console.log(
            `[LOCK] RELEASE RESULT key=${lockKey}: ${result}`
        );
    } catch (err) {
        // Non-fatal — lock will auto-expire via PX TTL anyway
        console.error('[ORDER SERVICE] Failed to release lock:', err.message);
    }
}

module.exports = (pool, redis) => {
    router.post('/', async (req, res) => {
        const {
            catalogItemId,
            quantity = 1,
            selectedSize,
            mockCardNumber,
        } = req.body;

        if (!catalogItemId) {
            return res.status(400).json({
                error: 'catalogItemId is required'
            })
        }

        if (!Number.isInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                error: 'quantity must be a positive integer'
            });
        }

        // lets get userId from JWT
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Authorization token required'
            })
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.decode(token);
        const userId = decoded.sub;
        const internalHeaders = {
            'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY,
            'Content-Type': 'application/json'
        }

        const lockKey = `${LOCK_PREFIX}${catalogItemId}`
        let lockToken = null;
        let inventoryReserved = false;

        // let's check if the idempotency key is present or not
        const idempotencyKey = req.headers['idempotency-key'];
        if (!idempotencyKey) {
            return res.status(400).json({
                error: 'Idempotency-Key header is needed. Generate a UUID and include it with every checkout request'
            })
        }

        const valkeyKey = `idempotency:order:${idempotencyKey}`;
        const clearIdempotencyKey = async () => {
            try {
                console.log(
                    `[IDEMPOTENCY] DELETE START key=${valkeyKey}`
                );
                const deleted = await redis.del(valkeyKey);
                console.log(
                    `[IDEMPOTENCY] DELETE RESULT key=${valkeyKey}: ${deleted}`
                );
            } catch (err) {
                console.error(
                    '[ORDER SERVICE] Failed to delete idempotency key:',
                    err.message
                );
            }
        };

        // let's check if this idempotency key is present in the valkey already or not
        try {
            console.log(
                `[IDEMPOTENCY] GET key=${valkeyKey}`
            );
            const existing = await redis.get(valkeyKey);
            console.log(
                `[IDEMPOTENCY] GET result key=${valkeyKey}:`,
                existing
            );
            if (existing) {
                const parsed = JSON.parse(existing);
                if (parsed.status === 'SUCCESS') {
                    // Duplicate request — return the cached order response immediately
                    console.log(`[ORDER SERVICE] Idempotency hit (SUCCESS): ${idempotencyKey}`);
                    return res.status(200).json({
                        message: 'Order already placed (idempotent response)',
                        ...parsed.response
                    });
                }

                if (parsed.status === 'PROCESSING') {
                    // Another request with same key is already in flight
                    console.log(`[ORDER SERVICE] Idempotency hit (PROCESSING): ${idempotencyKey}`);
                    return res.status(409).json({
                        error: 'A checkout with this Idempotency-Key is already being processed. Please wait.'
                    });
                }
            }
        } catch (err) {
            console.error(
                '[ORDER SERVICE] Valkey unavailable for idempotency check:',
                err.message
            );

            return res.status(503).json({
                error: 'Checkout temporarily unavailable. Please try again.'
            });
        }

        // as the idemp key is not present in valkey, we are setting it
        try {
            console.log(
                `[IDEMPOTENCY] SET PROCESSING key=${valkeyKey}`
            );

            const acquired = await redis.set(
                valkeyKey,
                JSON.stringify({ status: 'PROCESSING' }),
                'EX',
                IDEMPOTENCY_TTL,
                'NX'
            );

            console.log(
                `[IDEMPOTENCY] SET result key=${valkeyKey}: ${acquired}`
            );

            // handling the race condition using 'NX'
            if (acquired === null) {
                // Someone else acquired this idempotency key
                const existing = await redis.get(valkeyKey);

                if (existing) {
                    const parsed = JSON.parse(existing);

                    if (parsed.status === 'SUCCESS') {
                        console.log(`[ORDER SERVICE] Idempotency hit (SUCCESS): ${idempotencyKey}`);

                        return res.status(200).json({
                            message: 'Order already placed (idempotent response)',
                            ...parsed.response
                        });
                    }

                    if (parsed.status === 'PROCESSING') {
                        console.log(`[ORDER SERVICE] Idempotency hit (PROCESSING): ${idempotencyKey}`);

                        return res.status(409).json({
                            error: 'A checkout with this Idempotency-Key is already being processed. Please wait.'
                        });
                    }
                }
            }
        } catch (err) {
            console.error(
                '[ORDER SERVICE] Failed to acquire idempotency key:',
                err.message
            );

            return res.status(503).json({
                error: 'Checkout temporarily unavailable. Please try again.'
            });
        }

        try {
            const userResponse = await axios.get(`http://localhost:${process.env.USER_SERVICE_PORT || 3001}/profile/${userId}`, {
                headers: internalHeaders
            });

            const preferredSize = userResponse.data.user.preferred_size;
            // if (!preferredSize) {
            // await clearIdempotencyKey();
            // return res.status(400).json({
            // error: 'No preferred size saved. Please update profile with preferred size before checkout'
            // })
            // }

            // now lets check the available sizes
            const catalogResponse = await axios.get(`http://localhost:${process.env.CATALOG_SERVICE_PORT || 3002}/${catalogItemId}`, {
                headers: internalHeaders
            });

            const item = catalogResponse.data.item;
            const availableSizes = item.availableSizes || [];

            // ── Size resolution ───────────────────────────────────────────
            // If the frontend sent a manual selectedSize (after showing the size picker),
            // use that. Otherwise fall back to the user's saved preferredSize.
            let resolvedSize = null;

            if (availableSizes.length === 0) {
                resolvedSize = null;
            }
            else if (selectedSize) {
                // Frontend override — validate it is actually available
                if (availableSizes.length > 0 && !availableSizes.includes(selectedSize)) {
                    await clearIdempotencyKey();
                    return res.status(400).json({
                        error: 'SELECTED_SIZE_UNAVAILABLE',
                        selectedSize,
                        availableSizes
                    });
                }
                resolvedSize = selectedSize;
            } else {
                if (!preferredSize) {
                    await clearIdempotencyKey();

                    return res.status(400).json({
                        error: 'NO_PREFERRED_SIZE',
                        availableSizes
                    });
                }
                // No override — check if profile's preferred size is available
                if (availableSizes.length > 0 && !availableSizes.includes(preferredSize)) {
                    await clearIdempotencyKey();
                    // Signal to frontend: show size picker with the available options
                    return res.status(400).json({
                        error: 'PREFERRED_SIZE_UNAVAILABLE',
                        preferredSize,
                        availableSizes // frontend renders these as selectable buttons
                    });
                }

                resolvedSize = preferredSize;
            }

            // now let's build the order command
            const orderCommand = new OrderCommand({
                userId,
                catalogItemId,
                selectedSize: resolvedSize, // resolvedSize = frontend pick OR auto-injected preferred size
                quantity,
                idempotencyKey
            });

            lockToken = await acquireLock(redis, lockKey, LOCK_TTL_MS);
            if (!lockToken) {
                // we didnt acquire the lock, so the request terminates here
                await clearIdempotencyKey();
                console.log(
                    `[ORDER SERVICE] Lock contention on item: ${catalogItemId}`
                );

                return res
                    .status(409)
                    .set('Retry-After', '1')
                    .json({
                        error: 'LOCK_CONTENTION_DETECTED'
                    });
            }

            // we acquired the lock, so now let's move forward
            console.log(
                `[ORDER SERVICE] Lock acquired for item: ${catalogItemId}`
            );

            // so now let's decrement the stock
            const stockResponse = await axios.patch(
                `http://localhost:${process.env.CATALOG_SERVICE_PORT || 3002}/${catalogItemId}/stock`,
                { quantity, reservationId: idempotencyKey }, {
                headers: internalHeaders
            }
            )

            // Inventory reservation succeeded
            inventoryReserved = true;

            const updatedItem = stockResponse.data.item;
            console.log(
                `[ORDER SERVICE] Stock decremented. Remaining: ${updatedItem.stock}`
            );
            // we have successfully decremented the stock so now lets save the order in postgresql


            // ── AC1: Payment Evaluation ──
            if (mockCardNumber === '4242') {
                orderCommand.status = 'COMMITTED';
                console.log(`[ORDER SERVICE] Payment successful for order ${idempotencyKey}`);
            } else {
                // We will handle failures in AC2/AC3. For AC1, we just assume success path if 4242.
                // If it fails, for now we can just throw to trigger the catch block.
                throw new Error('PAYMENT_FAILED');
            }

            // saving this order record in PostgreSQL
            const result = await pool.query(`
INSERT INTO orders(user_id, catalog_item_id, selected_size, quantity, status, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
`, [
                orderCommand.userId,
                orderCommand.catalogItemId,
                orderCommand.selectedSize,
                orderCommand.quantity,
                orderCommand.status,
                orderCommand.idempotencyKey
            ]);

            // ── AC1: Commit Reservation in Catalog ──
            await axios.patch(
                `http://localhost:${process.env.CATALOG_SERVICE_PORT || 3002}/${catalogItemId}/reservation/commit`,
                { reservationId: idempotencyKey },
                { headers: internalHeaders }
            );
            console.log(`[ORDER SERVICE] Catalog reservation committed for ${idempotencyKey}`);

            const orderResponse = {
                message: 'Order placed successfully',
                order: result.rows[0]
            };

            const orderEvent = {
                ...result.rows[0],
                studentEmail: decoded.email,
                itemName: item.name
            }

            // we are now doing fire and forget instead of awaiting on the response of event published or not
            publishOrderPlaced(orderEvent)
                .catch(err => {
                    console.error(
                        '[ORDER SERVICE] Failed to publish OrderPlaced event:',
                        err.message
                    );
                });

            // ── ORD-402: Step 4 — Mark key as SUCCESS and cache the response ─
            try {
                await redis.set(
                    valkeyKey,
                    JSON.stringify({ status: 'SUCCESS', response: orderResponse }),
                    'EX',
                    IDEMPOTENCY_TTL,
                );
                console.log(`[ORDER SERVICE] Idempotency key marked SUCCESS: ${idempotencyKey}`);
            } catch (err) {
                console.error('[ORDER SERVICE] Failed to update SUCCESS state in Valkey:', err.message);
                // Non-fatal — order was committed to DB, just couldn't update cache
            }

            return res.status(201).json(orderResponse);
        } catch (err) {

            // ── AC2 / AC3: Compensate inventory if it was already reserved ──
            if (inventoryReserved) {
                const compensationResult = await compensateInventory({
                    catalogItemId,
                    reservationId: idempotencyKey,
                    internalHeaders
                });

                if (!compensationResult.success) {
                    console.error(
                        `[ORDER SERVICE] CRITICAL: Inventory compensation failed after retries: reservation=${idempotencyKey}`
                    );
                }
            }

            // Remove PROCESSING state from Valkey
            try {
                await redis.del(valkeyKey);
            } catch (redisErr) {
                console.error(
                    '[ORDER SERVICE] Failed to delete PROCESSING key on error:',
                    redisErr.message
                );
            }

            // Handle out-of-stock response
            if (
                err.response?.status === 409 &&
                err.response?.data?.error === 'OUT_OF_STOCK'
            ) {
                return res.status(409).json({
                    error: 'OUT_OF_STOCK'
                });
            }

            // Payment failure
            if (err.message === 'PAYMENT_FAILED') {
                return res.status(400).json({
                    error: 'PAYMENT_FAILED'
                });
            }

            // Handle downstream service errors
            if (err.response) {
                return res.status(err.response.status).json({
                    error: `Downstream error: ${err.response.data?.error || 'Unknown error'}`
                });
            }

            console.error(
                '[ORDER SERVICE] Checkout error:',
                err.message
            );

            return res.status(500).json({
                error: 'Internal server error'
            });
        } finally {
            if (lockToken) {
                await releaseLock(redis, lockKey, lockToken);
                console.log(
                    `[ORDER SERVICE] Lock released for item: ${catalogItemId}`
                );
            }
        }

    })
    return router;
}
