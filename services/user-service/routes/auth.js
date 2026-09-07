const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const router = express.Router();
const StudentProfileBuilder = require('../models/StudentProfileBuilder');

// we are importing Pool, but we will use the pool from index.js only cause we have already pooled the connections there and by using dependency injection principle we don't have to create the pool everytime but we inject the pool from index itself

const DOMAIN_REGEX = /^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$/;
const SALT_ROUNDS = 12;
const VALID_ROLES = ['STUDENT', 'CLUB_ADMIN', 'SUPER_ADMIN'];

module.exports = (pool) => {
    router.post('/register', async (req, res) => {
        const { email, password, full_name } = req.body;

        // 1. if the user has not entered email or password
        if (!email || !password) {
            return res.status(400).json({
                error: "Email and Password are required"
            })
        }

        // 2. if the user is not a iiit student
        if (!DOMAIN_REGEX.test(email)) {
            return res.status(403).json({
                error: "Registration is restricted only to iiit students"
            })
        }

        // now we insert the user in db
        try {
            const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

            const id = uuidv4();
            const query = `
            INSERT INTO users(id, email, password_hash, full_name, created_at) VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, email, full_name, created_at
            `;
            const values = [id, email, password_hash, full_name || null];
            const result = await pool.query(query, values);

            return res.status(201).json({
                message: 'User regsitered successfully',
                user: result.rows[0]
            })
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({
                    error: 'email already exists'
                })
            }

            console.error('[USER SERVICE] registration error');
            return res.status(500).json({
                error: 'internal server error'
            })
        }
    })

    router.put('/profile', async (req, res) => {
        // Trusted, gateway-derived identity from the verified JWT (see
        // requireAuthForProfileMutation in api-gateway) — never taken from the
        // request body, so a caller can't edit another user's profile.
        const user_id = req.headers['x-user-id'];
        const { full_name, phone, hostel_block, preferred_size } = req.body;

        if (!user_id) {
            return res.status(401).json({
                error: 'user_id is required'
            })
        }

        try {
            const builder = new StudentProfileBuilder();

            if (full_name) builder.setName(full_name);
            if (phone) builder.setPhone(phone);
            if (hostel_block) builder.setHostelBlock(hostel_block);
            if (preferred_size) builder.setPrefferedSize(preferred_size);

            const profile = builder.build();

            if (Object.keys(profile).length === 0) {
                return res.status(400).json({
                    error: 'No profile fields provided'
                })
            }

            // now we are building dynamic sql

            const fields = Object.keys(profile);
            const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');

            const values = [...Object.values(profile), user_id];

            const query = `
            UPDATE users
            SET ${setClause}
            WHERE id = $${fields.length + 1}
            RETURNING id, email, full_name, phone, hostel_block, preferred_size`;

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                })
            }

            return res.status(200).json({
                message: 'Profile updated successfully',
                user: result.rows[0]
            })
        } catch (err) {
            // Catches the error thrown by builder.setPreferredSize() for invalid sizes
            if (err.message.startsWith('Invalid size')) {
                return res.status(400).json({ error: err.message });
            }
            console.error('[USER SERVICE] Profile update error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    router.put('/size', async (req, res) => {
        // Trusted, gateway-derived identity from the verified JWT — see PUT /profile above.
        const user_id = req.headers['x-user-id'];
        const { preferred_size } = req.body;
        if (!user_id) {
            return res.status(401).json({
                error: 'user_id is required'
            })
        }
        if (!preferred_size) {
            return res.status(400).json({
                error: 'preferred_size is required'
            })
        }

        try {
            const profile = new StudentProfileBuilder().setPrefferedSize(preferred_size).build();

            const query = `
            UPDATE users
            SET preferred_size = $1
            WHERE id = $2 RETURNING id, email, preferred_size`;

            const result = await pool.query(query, [profile.preferred_size, user_id]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'user not found'
                })
            }

            return res.status(200).json({
                message: 'preferred size updated',
                user: result.rows[0]
            })

        } catch (err) {
            if (err.message.startsWith('Invalid size')) {
                return res.status(400).json({
                    error: err.message
                })
            }

            console.error('[USER SERVICE] Size update error : ', err.message);

            return res.status(500).json({
                error: 'Internal server error'
            })
        }
    })

    router.post('/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                error: "email and password are needed for login"
            })
        }

        try {
            const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

            if (result.rows.length === 0) {
                return res.status(401).json({
                    error: 'invalid credentials'
                })
            }

            const user = result.rows[0];

            // now lets compare the hashed password and the password that user entered

            const isMatch = await bcrypt.compare(password, user.password_hash);

            if (!isMatch) {
                return res.status(401).json({
                    error: 'invalid credentials'
                })
            }

            // now we create the jwt
            const token = jwt.sign({
                sub: user.id,
                email: user.email,
                role: user.role,
                clubId: user.club_id
            },
                process.env.JWT_SECRET,
                { expiresIn: '1h' })

            return res.status(200).json({
                message: 'login successful',
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    full_name: user.full_name
                }
            })
        } catch (err) {
            console.error('[USER SERVICE] login error : ', err.message);
            return res.status(500).json({
                error: 'internal server error'
            })
        }
    })

    router.get('/profile/:userId', async (req, res) => {
        const { userId } = req.params;
        try {
            const result = await pool.query('SELECT id, email, full_name, phone, hostel_block, preferred_size FROM users WHERE id = $1', [userId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                })
            }

            return res.status(200).json({ user: result.rows[0] })
        } catch (err) {
            console.error('[USER SERVICE] Get profile error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    // Promotes an existing user to a new role (e.g. STUDENT -> CLUB_ADMIN).
    // Only reachable via the API Gateway's SUPER_ADMIN-gated proxy route —
    // this service trusts the gateway to have already enforced that.
    router.put('/:userId/role', async (req, res) => {
        const { userId } = req.params;
        const { role, club_id } = req.body;

        if (!role || !VALID_ROLES.includes(role)) {
            return res.status(400).json({
                error: `role must be one of: ${VALID_ROLES.join(', ')}`
            })
        }

        if (role === 'CLUB_ADMIN' && !club_id) {
            return res.status(400).json({
                error: 'club_id is required when promoting to CLUB_ADMIN'
            })
        }

        try {
            if (role === 'CLUB_ADMIN') {
                const club = await pool.query('SELECT id FROM clubs WHERE id = $1', [club_id]);

                if (club.rows.length === 0) {
                    return res.status(400).json({
                        error: 'club_id does not reference an existing club'
                    })
                }
            }

            // Only CLUB_ADMIN carries a club_id — every other role clears it.
            const resolvedClubId = role === 'CLUB_ADMIN' ? club_id : null;

            const result = await pool.query(
                `UPDATE users
                 SET role = $1, club_id = $2
                 WHERE id = $3
                 RETURNING id, email, full_name, role, club_id`,
                [role, resolvedClubId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                })
            }

            return res.status(200).json({
                message: 'User promoted to club admin successfully',
                user: result.rows[0]
            })
        } catch (err) {
            console.error('[USER SERVICE] Role update error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    })

    return router;
}