const path = require('path')
const { Pool } = require('pg')
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
})

const runMigration = async () => {
    const query = `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20), ADD COLUMN IF NOT EXISTS hostel_block VARCHAR(100), ADD COLUMN IF NOT EXISTS preferred_size VARCHAR(5) CHECK (preferred_size IN ('S', 'M', 'L', 'XL', 'XXL'))`;

    try {
        await pool.query(query);
        console.log('Migration complete : profile columns added to database')
    } catch (err) {
        console.error('Migration failed : ', err);
    } finally {
        await pool.end();
    }
}

runMigration();