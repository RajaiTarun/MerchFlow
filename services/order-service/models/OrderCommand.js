// Command Pattern — encapsulates all data needed to execute a checkout as a single object.
// status can be overridden at construction time:
//   'PLACED'        → initial default (pre-payment)
//   'COMMITTED'     → payment succeeded, order persisted
//   'CANCELLED'     → order cancelled post-commit
//   'PAYMENT_FAILED'→ payment rejected (order not inserted into DB)

const VALID_STATUSES = ['PLACED', 'COMMITTED', 'CANCELLED', 'PAYMENT_FAILED'];

class OrderCommand {
    constructor({ userId, catalogItemId, selectedSize, quantity = 1, status = 'PLACED', idempotencyKey }) {
        if (!userId) throw new Error('userId is required');
        if (!catalogItemId) throw new Error('catalogItemId is required');
        if (quantity < 1) throw new Error('quantity must be at least 1');
        if (!idempotencyKey) throw new Error('idempotencyKey is required');
        if (!VALID_STATUSES.includes(status)) {
            throw new Error(`Invalid status: ${status}. Must be one of ${VALID_STATUSES.join(', ')}`);
        }

        this.userId = userId;
        this.catalogItemId = catalogItemId;
        this.selectedSize = selectedSize;
        this.quantity = quantity;
        this.status = status;          // set by caller based on payment outcome
        this.idempotencyKey = idempotencyKey; // durable checkout identity — persisted to DB
        this.createdAt = new Date().toISOString();
    }
}

module.exports = OrderCommand;
