const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const redis = require('../cache/valkey');
const Item = require('../models/Item');
const InventoryCompensation = require('../models/InventoryCompensation');
const InventoryReservation = require('../models/InventoryReservation');
const MerchandiseFactory = require('../factories/MerchandiseFactory');
const PAGE_SIZE = 10;
const CACHE_KEY = 'catalog:feed:page:1';
const CACHE_TTL = 60; // seconds

router.post('/', async (req, res) => {
    const { type, ...rest } = req.body;
    const clubId = req.headers['x-club-id'];

    if (!clubId) {
        return res.status(403).json({
            error: 'Club ID not found. Only club admins are allowed to publish items'
        })
    }

    if (!type || !rest.name || rest.price === undefined) {
        return res.status(400).json({
            error: 'type, name and price are required'
        })
    }

    try {
        const domainItem = MerchandiseFactory.createItem(type, { ...rest, clubId });

        const item = new Item(domainItem.toData());
        await item.save();

        return res.status(201).json({
            message: 'Item published successfully',
            item
        })
    } catch (err) {
        if (err.message.startsWith('Unknown item type') || err.message.startsWith('APPAREL')) {
            return res.status(400).json({
                error: err.message
            })
        }
        console.error('[CATALOG SERVICE] Create item error:', err.message);
        return res.status(500).json({
            error: 'Internal server error'
        })
    }
})

router.get('/', async (req, res) => {
    const { cursor, type, clubId } = req.query;
    // becuase we dont have cursor for first page
    const isFirstPage = !cursor;

    if (isFirstPage) {
        // let's see if it exists in cache
        try {
            const cached = await redis.get(CACHE_KEY);
            if (cached) {
                // we have the first page in cache, so let's return from cache itself
                console.log('[CATALOG SERVICE] cache hit : serving page 1 from valkey');
                return res.status(200).json(JSON.parse(cached));
            }

            console.log('[CATALOG SERVICE] Cache miss: querying MongoDB');
        } catch (err) {
            // valkey is down and so we query to mongo db
            console.error('[CATALOG SERVICE] Valkey unavailable, querying MongoDB:', err.message);
        }
    }

    try {
        const filter = {};
        if (cursor) {
            filter._id = { $lt: cursor }
        }

        if (type) {
            filter.type = type.toUpperCase();
        }

        if (clubId) {
            filter.clubId = clubId;
        }

        const items = await Item.find(filter).sort({ _id: -1 }).limit(PAGE_SIZE + 1);
        // limit (PAGE_SIZE + 1) because if we get PAGE_SIZE + 1 elements this means that there are more items and we will have next page
        const hasNextPage = items.length > PAGE_SIZE;
        const pageItems = hasNextPage ? items.slice(0, PAGE_SIZE) : items;

        const nextCursor = hasNextPage ? pageItems[pageItems.length - 1]._id.toString() : null

        const responsePayload = {
            count: pageItems.length,
            nextCursor,
            items: pageItems
        }

        if (isFirstPage) {
            try {
                await redis.set(CACHE_KEY, JSON.stringify(responsePayload), 'EX', CACHE_TTL);
                console.log('[CATALOG SERVICE] Page 1 cached in Valkey for 60s')
            } catch (err) {
                // Non-fatal — cache population failure should not fail the request
                console.error('[CATALOG SERVICE] Failed to populate Valkey cache:', err.message);
            }
        }

        return res.status(200).json(responsePayload);
    } catch (err) {
        console.error('[CATALOG SERVICE] Get items error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
})

router.get('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) {
            return res.status(404).json({
                error: 'Item not found'
            })
        }
        return res.status(200).json({ item });
    } catch (err) {
        console.error('[CATALOG SERVICE] Get item error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
})

// this patch route is created to atomically decrement the stock count by 1 and this will be called by order service
router.patch('/:id/stock', async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { quantity = 1, reservationId } = req.body;

        if (!Number.isInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                error: 'quantity must be a positive integer'
            });
        }

        if (!reservationId) {
            return res.status(400).json({
                error: 'reservationId is required'
            });
        }

        let result;

        await session.withTransaction(async () => {

            // 1. Check whether this reservation already exists.
            const existingReservation =
                await InventoryReservation.findOne({
                    reservationId
                }).session(session);

            if (existingReservation) {
                const item = await Item.findById(req.params.id).session(session);
                result = {
                    alreadyReserved: true,
                    reservation: existingReservation,
                    item: item
                };

                return;
            }

            // 2. Reservation does not exist.
            //    Atomically decrement stock.
            const updated = await Item.findOneAndUpdate(
                {
                    _id: req.params.id,
                    stock: { $gte: quantity }
                },
                {
                    $inc: { stock: -quantity }
                },
                {
                    new: true,
                    session
                }
            );

            if (!updated) {
                throw new Error('OUT_OF_STOCK');
            }

            // 3. Record the reservation in the same transaction.
            const reservation = await InventoryReservation.create(
                [{
                    reservationId,
                    itemId: req.params.id,
                    quantity,
                    status: 'RESERVED'
                }],
                {
                    session
                }
            );

            result = {
                alreadyReserved: false,
                item: updated,
                reservation: reservation[0]
            };
        });

        // Existing reservation:
        // No additional stock should be deducted.
        if (result.alreadyReserved) {
            console.log(
                `[CATALOG SERVICE] Reservation already exists: ${reservationId}`
            );

            return res.status(200).json({
                message: 'Reservation already exists',
                alreadyReserved: true,
                reservation: result.reservation,
                item: result.item
            });
        }

        console.log(
            `[CATALOG SERVICE] Reservation created: ${reservationId}, ` +
            `item=${req.params.id}, quantity=${quantity}, ` +
            `remainingStock=${result.item.stock}`
        );

        return res.status(200).json({
            message: 'Inventory reserved successfully',
            alreadyReserved: false,
            item: result.item,
            reservation: result.reservation
        });

    } catch (err) {

        if (err.message === 'OUT_OF_STOCK') {
            return res.status(409).json({
                error: 'OUT_OF_STOCK'
            });
        }

        // Two concurrent requests with the same reservationId
        // may both initially see no reservation.
        //
        // The unique MongoDB index on reservationId guarantees
        // that only one reservation can ultimately be created.
        if (err.code === 11000) {
            console.log(
                `[CATALOG SERVICE] Duplicate reservation prevented by unique index: ${req.body.reservationId}`
            );
            const item = await Item.findById(req.params.id);
            return res.status(200).json({
                message: 'Reservation already exists',
                alreadyReserved: true,
                item: item
            });
        }

        console.error(
            '[CATALOG SERVICE] Stock reservation error:',
            err.message
        );

        return res.status(500).json({
            error: 'Internal server error'
        });

    } finally {
        await session.endSession();
    }
});

router.patch('/:id/rollback', async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { reservationId } = req.body;

        if (!reservationId) {
            return res.status(400).json({
                error: 'reservationId is required'
            });
        }

        let result;

        await session.withTransaction(async () => {

            // 1. Find the reservation to know what we are rolling back
            const reservation = await InventoryReservation.findOne({
                reservationId
            }).session(session);

            if (!reservation) {
                throw new Error('RESERVATION_NOT_FOUND');
            }

            // 2. Check whether this reservation has already been compensated.
            const existingCompensation =
                await InventoryCompensation.findOne({
                    reservationId
                }).session(session);

            if (existingCompensation) {
                result = {
                    alreadyCompensated: true,
                    itemId: existingCompensation.itemId,
                    quantity: existingCompensation.quantity
                };

                return;
            }

            // 3. Restore the reserved inventory using reservation data.
            const updated = await Item.findOneAndUpdate(
                { _id: reservation.itemId },
                { $inc: { stock: reservation.quantity } },
                {
                    new: true,
                    session
                }
            );

            if (!updated) {
                throw new Error('ITEM_NOT_FOUND');
            }

            // 4. Mark the reservation as compensated
            reservation.status = 'COMPENSATED';
            await reservation.save({ session });

            // 5. Record the compensation in the SAME transaction.
            await InventoryCompensation.create(
                [{
                    reservationId,
                    itemId: reservation.itemId,
                    quantity: reservation.quantity
                }],
                { session }
            );

            result = {
                alreadyCompensated: false,
                item: updated,
                reservation
            };
        });

        // Duplicate compensation:
        // transaction committed without modifying stock.
        if (result.alreadyCompensated) {
            console.log(
                `[CATALOG SERVICE] Compensation already applied: reservation=${reservationId}`
            );

            return res.status(200).json({
                message: 'Compensation already applied',
                alreadyCompensated: true
            });
        }

        console.log(
            `[CATALOG SERVICE] Compensation applied: +${result.reservation.quantity} stock for item ${result.reservation.itemId}. New stock: ${result.item.stock}`
        );

        return res.status(200).json({
            message: 'Compensation applied',
            alreadyCompensated: false,
            item: result.item
        });

    } catch (err) {

        if (err.message === 'RESERVATION_NOT_FOUND') {
            return res.status(404).json({
                error: 'Reservation not found'
            });
        }

        if (err.message === 'ITEM_NOT_FOUND') {
            return res.status(404).json({
                error: 'Item not found'
            });
        }

        // This can happen if two compensation requests for the same
        // reservationId race each other and both initially see no record.
        //
        // MongoDB's unique reservationId index is the final protection.
        if (err.code === 11000) {
            console.log(
                `[CATALOG SERVICE] Duplicate compensation prevented by unique index: reservation=${req.body.reservationId}`
            );

            return res.status(200).json({
                message: 'Compensation already applied',
                alreadyCompensated: true
            });
        }

        console.error(
            '[CATALOG SERVICE] Rollback error:',
            err.message
        );

        return res.status(500).json({
            error: 'Internal server error'
        });

    } finally {
        await session.endSession();
    }
});

router.patch('/:id/reservation/commit', async (req, res) => {
    try {
        const { reservationId } = req.body;
        if (!reservationId) {
            return res.status(400).json({ error: 'reservationId is required' });
        }

        const reservation = await InventoryReservation.findOneAndUpdate(
            { reservationId },
            { $set: { status: 'COMMITTED' } },
            { new: true }
        );

        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        console.log(`[CATALOG SERVICE] Reservation ${reservationId} committed.`);
        return res.status(200).json({ message: 'Reservation committed', reservation });
    } catch (err) {
        console.error('[CATALOG SERVICE] Reservation commit error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;