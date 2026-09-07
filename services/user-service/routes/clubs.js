const express = require('express')
const router = express.Router();

module.exports = (pool) => {
    router.get('/', async(req, res) => {
        try{
            const result = await pool.query('SELECT id, name, description, created_at FROM clubs ORDER BY name ASC');
            return res.status(200).json({clubs : result.rows});
        }catch(err){
            console.error('[USER SERVICE] Get clubs error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })
    return router;
}