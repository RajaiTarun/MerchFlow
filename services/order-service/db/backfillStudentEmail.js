const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

// One-time script: orders placed before migrate7.js added student_email have
// none. This looks up each distinct user_id's email in user-service and
// backfills every matching order. Safe to re-run — it only ever touches rows
// where student_email IS NULL.
//
// GET /profile/:userId now requires the caller's x-user-id to match :userId
// (the profile IDOR fix) — this script sets it to the same id it's requesting,
// same as the live checkout flow in routes/orders.js does, since we're only
// ever asking for a user's own email here.
const runBackfill = async () => {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT user_id FROM orders WHERE student_email IS NULL`
        );

        console.log(`Found ${rows.length} distinct user(s) needing backfill`);

        for (const { user_id } of rows) {
            try {
                const response = await axios.get(
                    `${USER_SERVICE_URL}/profile/${user_id}`,
                    {
                        headers: {
                            'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY,
                            'x-user-id': user_id
                        }
                    }
                );

                const email = response.data.user.email;

                const result = await pool.query(
                    `UPDATE orders SET student_email = $1 WHERE user_id = $2 AND student_email IS NULL`,
                    [email, user_id]
                );

                console.log(`✅ user_id=${user_id} -> student_email=${email} (${result.rowCount} order(s) updated)`);
            } catch (err) {
                console.error(`❌ Failed to backfill user_id=${user_id}:`, err.message);
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
