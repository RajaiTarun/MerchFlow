const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const redis = require('../cache/valkey');
const Item = require('../models/Item');
const InventoryCompensation = require('../models/InventoryCompensation');
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
    try {
        const { quantity = 1 } = req.body;
        if (!Number.isInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                error: 'quantity must be a positive integer'
            });
        }
        // findOneAndUpdate is atomic — checks stock > quantity AND decrements in one DB round trip
        const updated = await Item.findOneAndUpdate(
            { _id: req.params.id, stock: { $gte: quantity } }, // guard: only if stock remains
            { $inc: { stock: -quantity } },
            { new: true }  // return the document AFTER the update
        );
        if (!updated) {
            // stock was already 0 when we tried to decrement
            return res.status(409).json({ error: 'OUT_OF_STOCK' });
        }
        return res.status(200).json({ item: updated });
    } catch (err) {
        console.error('[CATALOG SERVICE] Stock decrement error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;