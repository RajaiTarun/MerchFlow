const mongoose = require('mongoose');

// Persists a record of every successfully applied Saga compensation.
// The unique index on reservationId is the database-level guarantee that
// the same reservation can never increment stock more than once — even if
// the /rollback endpoint is called concurrently from multiple retries.
const compensationSchema = new mongoose.Schema({
    reservationId: {
        type: String,
        required: true,
        unique: true      // ← MongoDB enforces idempotency at the index level
    },
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    }
}, { timestamps: true });

const InventoryCompensation = mongoose.model('InventoryCompensation', compensationSchema);

module.exports = InventoryCompensation;