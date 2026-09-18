const NotificationStrategy = require('./NotificationStrategy');

const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 3;

// Concrete strategy — persists the notification as a row in the `notifications` table.
class InAppNotificationStrategy extends NotificationStrategy {
    constructor(pool) {
        super();
        this.pool = pool;
    }

    async execute(payload) {
        const { userId, orderId, type, message, metadata } = payload;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const result = await this.pool.query(
                    `INSERT INTO notifications(user_id, order_id, type, message, metadata)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING *`,
                    [userId, orderId, type, message, metadata ? JSON.stringify(metadata) : null]
                );

                return result.rows[0];
            } catch (err) {
                console.error(
                    `[NOTIFICATION SERVICE] DB write attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
                    err.code || err.message || err
                );

                if (attempt === MAX_ATTEMPTS) {
                    // Give up — the outer RabbitMQ consumer (index.js) still won't
                    // ack this message, so it stays queued and gets redelivered on
                    // the next reconnect, same as before this retry existed. This
                    // just resolves most transient blips within the same delivery
                    // attempt instead of needing a full service restart to retry.
                    throw err;
                }

                // Same 100ms/200ms backoff as order-service/utils/compensateInventory.js
                await sleep(attempt * 100);
            }
        }
    }
}

module.exports = InAppNotificationStrategy;
