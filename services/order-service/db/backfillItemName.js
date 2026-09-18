const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3002';

// One-time script: orders placed before migrate8.js added item_name have
// none. This looks up each distinct catalog_item_id's name in catalog-service
// and backfills every matching order. Safe to re-run — it only ever touches
// rows where item_name IS NULL. Same pattern as backfillClubId.js, which
// already looks up the same catalog items for a different field.
const runBackfill = async () => {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT catalog_item_id FROM orders WHERE item_name IS NULL`
        );

        console.log(`Found ${rows.length} distinct catalog item(s) needing backfill`);

        for (const { catalog_item_id } of rows) {
            try {
                const response = await axios.get(
                    `${CATALOG_SERVICE_URL}/${catalog_item_id}`,
                    { headers: { 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY } }
                );

                const itemName = response.data.item.name;

                const result = await pool.query(
                    `UPDATE orders SET item_name = $1 WHERE catalog_item_id = $2 AND item_name IS NULL`,
                    [itemName, catalog_item_id]
                );

                console.log(`✅ catalog_item_id=${catalog_item_id} -> item_name=${itemName} (${result.rowCount} order(s) updated)`);
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
