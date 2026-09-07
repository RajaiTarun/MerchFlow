const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const runMigration = async () => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Nullable — existing orders (placed before this migration) won't have
        // a club_id yet; db/backfillClubId.js fills those in separately.
        await client.query(`
            ALTER TABLE orders
                ADD COLUMN IF NOT EXISTS club_id UUID;
        `);
        console.log('✅ Column club_id added');

        await client.query(`
            CREATE INDEX IF NOT EXISTS orders_club_id_idx ON orders(club_id);
        `);
        console.log('✅ Index on club_id created');

        await client.query('COMMIT');
        console.log('✅ Migration 6 complete: club_id column + index added to orders');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 6 failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
};

runMigration();
