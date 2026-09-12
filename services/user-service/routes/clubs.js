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

    // Creates a new club and assigns an existing user (identified by email) as
    // its Club Admin — reuses the same users.club_id -> clubs.id relationship
    // (and FK) that PUT /:userId/role already uses to represent "this user
    // administers this club"; no new relationship is introduced.
    //
    // Done as one transaction: a club should never end up with no admin, and a
    // user should never be pointed at a club that didn't actually get created.
    //
    // Only reachable via the API Gateway's SUPER_ADMIN-gated proxy route (see
    // requireSuperAdminForClubCreate in api-gateway) — this service trusts the
    // gateway to have already enforced that, same as PUT /:userId/role.
    router.post('/', async (req, res) => {
        const { name, description, admin_email } = req.body;

        if (!name || !admin_email) {
            return res.status(400).json({
                error: 'name and admin_email are required'
            })
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT id, role, club_id FROM users WHERE email = $1',
                [admin_email]
            );

            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    error: 'No user found with that admin_email'
                })
            }

            const targetUser = userResult.rows[0];

            if (targetUser.role === 'SUPER_ADMIN') {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Cannot assign a SUPER_ADMIN as a Club Admin'
                })
            }

            // Same rule PUT /:userId/role enforces: a user already assigned to
            // a club must be demoted first, rather than silently reassigned.
            if (targetUser.club_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'User is already assigned to a club and cannot be made admin of a new one. Demote them (e.g. to STUDENT) first.'
                })
            }

            const clubResult = await client.query(
                `INSERT INTO clubs(name, description) VALUES ($1, $2)
                 RETURNING id, name, description, created_at`,
                [name, description || null]
            );

            const club = clubResult.rows[0];

            const adminResult = await client.query(
                `UPDATE users SET role = 'CLUB_ADMIN', club_id = $1
                 WHERE id = $2
                 RETURNING id, email, full_name, role, club_id`,
                [club.id, targetUser.id]
            );

            await client.query('COMMIT');

            return res.status(201).json({
                message: 'Club created and admin assigned successfully',
                club,
                admin: adminResult.rows[0]
            })
        } catch (err) {
            await client.query('ROLLBACK');

            if (err.code === '23505') {
                return res.status(409).json({
                    error: 'A club with that name already exists'
                })
            }

            console.error('[USER SERVICE] Create club error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        } finally {
            client.release();
        }
    })

    return router;
}