const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const OrderCommand = require('../models/OrderCommand');
const { publishOrderPlaced, publishOrderDelivered } = require('../messaging/rabbitmq');
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

// Same identity source as POST / below: the gateway's authMiddleware has
// already verified this JWT's signature before proxying the request here, so
// a plain decode (no re-verification) is enough to read the subject claim.
const getUserIdFromAuthHeader = (req) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.decode(token);
    return decoded?.sub || null;
};

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
            // user-service's GET /profile/:userId now requires this to match
            // :userId (see requireAuthForProfileAccess in api-gateway) - safe
            // to set here because this service-to-service call always fetches
            // the checking-out user's own profile, never anyone else's.
            'x-user-id': userId,
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
                clubId: item.clubId,
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
            // student_email and item_name are both denormalized from data the
            // handler already has in hand (the caller's own JWT, and the
            // catalog item already fetched above) so order-history views can
            // show who ordered what without a cross-service lookup on every read.
            const result = await pool.query(`
INSERT INTO orders(user_id, catalog_item_id, club_id, selected_size, quantity, status, idempotency_key, student_email, item_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
`, [
                orderCommand.userId,
                orderCommand.catalogItemId,
                orderCommand.clubId,
                orderCommand.selectedSize,
                orderCommand.quantity,
                orderCommand.status,
                orderCommand.idempotencyKey,
                decoded.email,
                item.name
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

    // "My orders" — scoped to the caller via the verified JWT, never a query param.
    router.get('/', async (req, res) => {
        const userId = getUserIdFromAuthHeader(req);
        if (!userId) {
            return res.status(401).json({
                error: 'Authorization token required'
            })
        }

        try {
            const result = await pool.query(
                `SELECT id, catalog_item_id, item_name, selected_size, quantity, status, created_at
                 FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
                [userId]
            );

            return res.status(200).json({ orders: result.rows });
        } catch (err) {
            console.error('[ORDER SERVICE] Get orders error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    // Club Admin's/Super Admin's view of a club's orders. Registered before
    // GET /:id — both are single-segment paths, and Express matches whichever
    // is registered first, so this literal route must come before the generic
    // '/:id' pattern or a request to '/club' would be swallowed by it (id='club').
    router.get('/club', async (req, res) => {
        // Trusted, gateway-derived headers (see injectClubId) — never taken
        // from the request directly.
        const role = req.headers['x-user-role'];
        let clubId;

        if (role === 'CLUB_ADMIN') {
            // Club Admins are locked to their own club — any clubId in the
            // query string is ignored in favor of this header-derived value.
            clubId = req.headers['x-club-id'];

            if (!clubId) {
                return res.status(403).json({
                    error: 'Club ID not found. Only club admins are allowed to view club orders'
                })
            }
        } else if (role === 'SUPER_ADMIN') {
            // Super Admins aren't tied to one club, so they must name the target club.
            clubId = req.query.clubId;

            if (!clubId) {
                return res.status(400).json({
                    error: 'clubId query parameter is required when viewing as Super Admin'
                })
            }
        } else {
            return res.status(403).json({
                error: 'Only club admins or super admins are allowed to view club orders'
            })
        }

        try {
            const result = await pool.query(
                `SELECT id, user_id, student_email, catalog_item_id, item_name, selected_size, quantity, status, created_at
                 FROM orders WHERE club_id = $1 ORDER BY created_at DESC`,
                [clubId]
            );

            return res.status(200).json({ orders: result.rows });
        } catch (err) {
            if (err.code === '22P02') {
                return res.status(400).json({ error: 'Invalid club id' });
            }
            console.error('[ORDER SERVICE] Get club orders error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    // Internal, service-to-service only (protected by internalAuthMiddleware in
    // index.js, same as every other route on this service) — used by
    // Notification Service to find who to notify about a delivery-slot change.
    router.get('/by-item/:catalogItemId/users', async (req, res) => {
        const { catalogItemId } = req.params;

        try {
            const result = await pool.query(
                'SELECT DISTINCT user_id FROM orders WHERE catalog_item_id = $1',
                [catalogItemId]
            );

            return res.status(200).json({
                userIds: result.rows.map(row => row.user_id)
            });
        } catch (err) {
            console.error('[ORDER SERVICE] by-item users lookup error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    // Single order detail — a caller may only view their own order.
    router.get('/:id', async (req, res) => {
        const userId = getUserIdFromAuthHeader(req);
        if (!userId) {
            return res.status(401).json({
                error: 'Authorization token required'
            })
        }

        const { id } = req.params;

        try {
            const result = await pool.query(
                `SELECT id, user_id, catalog_item_id, selected_size, quantity, status, created_at
                 FROM orders WHERE id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = result.rows[0];

            if (order.user_id !== userId) {
                return res.status(403).json({ error: 'You are not authorized to view this order' });
            }

            return res.status(200).json({ order });
        } catch (err) {
            if (err.code === '22P02') {
                // Postgres: invalid input syntax for type uuid
                return res.status(400).json({ error: 'Invalid order id' });
            }
            console.error('[ORDER SERVICE] Get order by id error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    // Marks an order DELIVERED. Club Admin may only touch their own club's
    // orders; Super Admin bypasses that check — same ownership pattern as
    // catalog-service's PUT /:itemId/delivery-slot.
    router.patch('/:orderId/status', async (req, res) => {
        const { orderId } = req.params;
        const { status } = req.body;

        // Trusted, gateway-derived headers (see injectClubId) — never taken
        // from the request directly.
        const role = req.headers['x-user-role'];
        const clubId = req.headers['x-club-id'];

        if (role !== 'CLUB_ADMIN' && role !== 'SUPER_ADMIN') {
            return res.status(403).json({
                error: 'Only club admins or super admins are allowed to update order status'
            })
        }

        // Only DELIVERED is reachable through this endpoint for now — order
        // cancellation was explicitly deferred, and every other status is set
        // internally by the checkout flow itself, never by an admin action.
        if (status !== 'DELIVERED') {
            return res.status(400).json({
                error: 'status must be DELIVERED'
            })
        }

        try {
            const orderResult = await pool.query(
                `SELECT id, user_id, catalog_item_id, club_id, selected_size, quantity, status
                 FROM orders WHERE id = $1`,
                [orderId]
            );

            if (orderResult.rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderResult.rows[0];

            if (role === 'CLUB_ADMIN' && order.club_id !== clubId) {
                return res.status(403).json({
                    error: 'You can only update orders for your own club'
                })
            }

            if (order.status !== 'COMMITTED') {
                return res.status(400).json({
                    error: `Order cannot be marked DELIVERED from its current status: ${order.status}`
                })
            }

            const updateResult = await pool.query(
                `UPDATE orders SET status = 'DELIVERED' WHERE id = $1
                 RETURNING id, user_id, catalog_item_id, club_id, selected_size, quantity, status, created_at`,
                [orderId]
            );

            const updatedOrder = updateResult.rows[0];

            // Best-effort item name lookup for a friendlier notification message
            // — a catalog-service hiccup here must not undo a status update that
            // already succeeded in Postgres, so this is non-fatal.
            let itemName = updatedOrder.catalog_item_id;
            try {
                const itemResponse = await axios.get(
                    `http://localhost:${process.env.CATALOG_SERVICE_PORT || 3002}/${updatedOrder.catalog_item_id}`,
                    { headers: { 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY } }
                );
                itemName = itemResponse.data.item.name;
            } catch (err) {
                console.error('[ORDER SERVICE] Failed to fetch item name for delivery notification:', err.message);
            }

            // Fire-and-forget, same convention as publishOrderPlaced in POST / above.
            publishOrderDelivered({ ...updatedOrder, itemName })
                .catch(err => {
                    console.error('[ORDER SERVICE] Failed to publish OrderDelivered event:', err.message);
                });

            return res.status(200).json({
                message: 'Order marked as delivered',
                order: updatedOrder
            });
        } catch (err) {
            if (err.code === '22P02') {
                return res.status(400).json({ error: 'Invalid order id' });
            }
            console.error('[ORDER SERVICE] Update order status error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    return router;
}
