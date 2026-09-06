const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Same bcrypt configuration as user-service/routes/auth.js
const SALT_ROUNDS = 12;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const seedSuperAdmin = async () => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const fullName = process.env.SUPER_ADMIN_FULL_NAME || 'Super Admin';

    if (!email || !password) {
        console.error(
            '❌ Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars before running this script. ' +
            'Do not commit these values — pass them inline, e.g.:\n' +
            '   SUPER_ADMIN_EMAIL=admin@students.iiit.ac.in SUPER_ADMIN_PASSWORD=\'...\' node db/seedSuperAdmin.js'
        );
        process.exit(1);
    }

    try {
        const existing = await pool.query(
            `SELECT id, email FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1`
        );

        if (existing.rows.length > 0) {
            console.log(`ℹ️  A Super Admin already exists (${existing.rows[0].email}). Skipping — not overwriting.`);
            return;
        }

        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const id = uuidv4();

        const result = await pool.query(
            `INSERT INTO users(id, email, password_hash, full_name, role, club_id, created_at)
             VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', NULL, NOW())
             RETURNING id, email, full_name, role`,
            [id, email, password_hash, fullName]
        );

        console.log('✅ Super Admin created:', result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            console.error('❌ A user with that email already exists. Choose a different SUPER_ADMIN_EMAIL or promote the existing user manually.');
        } else {
            console.error('❌ Failed to seed Super Admin:', err.message);
        }
    } finally {
        await pool.end();
    }
};

seedSuperAdmin();
