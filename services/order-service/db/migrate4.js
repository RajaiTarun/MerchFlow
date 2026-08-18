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

        // Step 1: Add idempotency_key column (nullable so existing rows are unaffected)
        await client.query(`
            ALTER TABLE orders
                ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
        `);

        console.log('✅ Column idempotency_key added');

        // Step 2: Safety check — verify no existing non-null duplicates before adding UNIQUE
        // (Shouldn't be any since this is a new column, but defensive practice)
        const dupeCheck = await client.query(`
            SELECT idempotency_key, COUNT(*)
            FROM orders
            WHERE idempotency_key IS NOT NULL
            GROUP BY idempotency_key
            HAVING COUNT(*) > 1;
        `);

        if (dupeCheck.rows.length > 0) {
            throw new Error(
                `Cannot add UNIQUE index — duplicate idempotency_key values found: ` +
                JSON.stringify(dupeCheck.rows)
            );
        }

        // Step 3: Partial unique index — only enforces uniqueness on non-NULL values.
        // This allows older orders (without an idempotency key) to coexist safely.
        // New orders always get an idempotency key, so duplicates are prevented.
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_unique
                ON orders(idempotency_key)
                WHERE idempotency_key IS NOT NULL;
        `);

        console.log('✅ Partial UNIQUE index on idempotency_key created');

        await client.query('COMMIT');
        console.log('✅ Migration 4 complete: idempotency_key column + unique index added to orders');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 4 failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
};

runMigration();
