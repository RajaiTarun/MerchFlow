const mongoose = require('mongoose');

// though MongoDB is schema less, but we still define a structure of the common fields and allow the rest extra item specific field using strict : false

const itemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        required: true,
        enum: ['APPAREL', 'MUG', 'ACCESSORY']
    },
    description: {
        type: String,
        default: ''
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    clubId: {
        type: String,
        required: true
    },
    stock: {
        type: Number,
        default: 0,
        min: 0
    },
    availableSizes: {
        type: [String],
        default: []
        // for mugs, accessories, etc we keep it empty and for apparels we can fill it
    },
    deliverySlot: {
        date: { type: String },
        startTime: { type: String },
        endTime: { type: String }
    }
},
    {
        strict: false, // basically this allows us to add extra fields than the ones mentioned above
        timestamps: true // mongoose itself adds createdAt, updatedAt stamps
    }
);

const Item = mongoose.model('Item', itemSchema);
module.exports = Item;