const path = require('path')
const { Pool } = require('pg')
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') })

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
})

const runMigration = async () => {
    const query = `
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(20)
    NOT NULL DEFAULT 'STUDENT' CHECK(role in ('STUDENT', 'CLUB_ADMIN', 'SUPER_ADMIN')),
    ADD COLUMN IF NOT EXISTS club_id UUID DEFAULT NULL`;

    try {
        await pool.query(query);
        console.log('migration 2 complete');
    } catch (err) {
        console.error('migratin 2 failed : ', err.message);
    } finally {
        await pool.end();
    }
}

runMigration();