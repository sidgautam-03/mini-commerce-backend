const mongoose = require('mongoose');

const ShoppingCartitemSchema = new mongoose.Schema(

    {
        product: {

            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
        },

        quantity: {

            type: Number,
            required: true,
            min: [1, 'Quantity must be at least 1'],
            default: 1,
        },
    },
    
    {_id: false}
);

const ShoppingCartSchema = new mongoose.Schema(

    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        items: [ShoppingCartSchema],
    },

    {timestamps: true}
);

module.exports = mongoose.model('Cart',ShoppingCartitemSchema);