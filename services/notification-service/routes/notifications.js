const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Same pattern as order-service: the gateway's authMiddleware has already
// verified this JWT's signature before proxying the request here, so a plain
// decode (no re-verification) is enough to read the subject claim.
const getUserIdFromAuthHeader = (req) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.decode(token);
    return decoded?.sub || null;
};

module.exports = (pool) => {
    router.get('/', async (req, res) => {
        const userId = getUserIdFromAuthHeader(req);
        if (!userId) {
            return res.status(401).json({
                error: 'Authorization token required'
            })
        }

        try {
            const result = await pool.query(
                `SELECT id, order_id, type, message, metadata, is_read, created_at
                 FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
                [userId]
            );

            return res.status(200).json({ notifications: result.rows });
        } catch (err) {
            console.error('[NOTIFICATION SERVICE] Get notifications error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    router.patch('/:id/read', async (req, res) => {
        const userId = getUserIdFromAuthHeader(req);
        if (!userId) {
            return res.status(401).json({
                error: 'Authorization token required'
            })
        }

        const { id } = req.params;

        try {
            // Ownership is enforced right in the WHERE clause — a notification
            // that exists but belongs to someone else looks identical (404) to
            // one that doesn't exist at all, so we never confirm its existence.
            const result = await pool.query(
                `UPDATE notifications SET is_read = TRUE
                 WHERE id = $1 AND user_id = $2
                 RETURNING id, order_id, type, message, metadata, is_read, created_at`,
                [id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Notification not found' });
            }

            return res.status(200).json({
                message: 'Notification marked as read',
                notification: result.rows[0]
            });
        } catch (err) {
            if (err.code === '22P02') {
                // Postgres: invalid input syntax for type uuid
                return res.status(400).json({ error: 'Invalid notification id' });
            }
            console.error('[NOTIFICATION SERVICE] Mark notification read error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    return router;
};
