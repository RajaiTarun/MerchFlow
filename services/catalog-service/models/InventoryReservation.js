const mongoose = require('mongoose');

const inventoryReservationSchema = new mongoose.Schema(
    {
        reservationId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },

        quantity: {
            type: Number,
            required: true,
            min: 1
        },

        status: {
            type: String,
            enum: ['RESERVED', 'COMMITTED', 'COMPENSATED'],
            default: 'RESERVED'
        }
    },
    {
        timestamps: true
    }
);

const InventoryReservation = mongoose.model(
    'InventoryReservation',
    inventoryReservationSchema
);

module.exports = InventoryReservation;