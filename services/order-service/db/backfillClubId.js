const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CATALOG_SERVICE_HOST = process.env.CATALOG_SERVICE_HOST || 'localhost';
const CATALOG_SERVICE_URL = `http://${CATALOG_SERVICE_HOST}:${process.env.CATALOG_SERVICE_PORT || 3002}`;

// One-time script: orders placed before migrate6.js added club_id have none.
// This looks up each distinct catalog_item_id's clubId in catalog-service and
// backfills every matching order. Safe to re-run — it only ever touches rows
// where club_id IS NULL.
const runBackfill = async () => {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT catalog_item_id FROM orders WHERE club_id IS NULL`
        );

        console.log(`Found ${rows.length} distinct catalog item(s) needing backfill`);

        for (const { catalog_item_id } of rows) {
            try {
                const response = await axios.get(
                    `${CATALOG_SERVICE_URL}/${catalog_item_id}`,
                    { headers: { 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY } }
                );

                const clubId = response.data.item.clubId;

                const result = await pool.query(
                    `UPDATE orders SET club_id = $1 WHERE catalog_item_id = $2 AND club_id IS NULL`,
                    [clubId, catalog_item_id]
                );

                console.log(`✅ catalog_item_id=${catalog_item_id} -> club_id=${clubId} (${result.rowCount} order(s) updated)`);
            } catch (err) {
                console.error(`❌ Failed to backfill catalog_item_id=${catalog_item_id}:`, err.message);
            }
        }

        console.log('✅ Backfill complete');
    } catch (err) {
        console.error('❌ Backfill failed:', err.message);
    } finally {
        await pool.end();
    }
};

runBackfill();
