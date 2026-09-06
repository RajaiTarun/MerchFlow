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

        await client.query(`
            CREATE TABLE IF NOT EXISTS clubs(
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        console.log('✅ clubs table ready');

        // Backfill: any users.club_id that doesn't yet have a matching clubs row
        // (e.g. the pre-existing CLUB_ADMIN test account) needs one before the
        // FK constraint can be added without breaking existing data.
        const orphaned = await client.query(`
            SELECT DISTINCT club_id
            FROM users
            WHERE club_id IS NOT NULL
              AND club_id NOT IN (SELECT id FROM clubs)
        `);

        for (const row of orphaned.rows) {
            await client.query(
                `INSERT INTO clubs(id, name, description) VALUES ($1, $2, $3)`,
                [
                    row.club_id,
                    `Legacy Club ${row.club_id.slice(0, 8)}`,
                    'Backfilled during clubs table migration for a pre-existing club_id.'
                ]
            );
            console.log(`✅ Backfilled clubs row for orphaned club_id ${row.club_id}`);
        }

        await client.query(`
            ALTER TABLE users
                DROP CONSTRAINT IF EXISTS users_club_id_fkey;
        `);

        await client.query(`
            ALTER TABLE users
                ADD CONSTRAINT users_club_id_fkey
                FOREIGN KEY (club_id) REFERENCES clubs(id);
        `);
        console.log('✅ users.club_id → clubs.id foreign key added');

        await client.query('COMMIT');
        console.log('✅ Migration 3 complete: clubs table + FK established');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 3 failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
};

runMigration();
