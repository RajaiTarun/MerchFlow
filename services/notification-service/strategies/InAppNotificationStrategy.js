const NotificationStrategy = require('./NotificationStrategy');

// Concrete strategy — persists the notification as a row in the `notifications` table.
class InAppNotificationStrategy extends NotificationStrategy {
    constructor(pool) {
        super();
        this.pool = pool;
    }

    async execute(payload) {
        const { userId, orderId, type, message, metadata } = payload;

        const result = await this.pool.query(
            `INSERT INTO notifications(user_id, order_id, type, message, metadata)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [userId, orderId, type, message, metadata ? JSON.stringify(metadata) : null]
        );

        return result.rows[0];
    }
}

module.exports = InAppNotificationStrategy;
