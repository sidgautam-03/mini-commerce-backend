const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
    {
        product: {

            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true,

        },

        name: {type: String, required: true},
        price: {type: Number, required: true},
        quantity: {type: Number, required: true},
        image: {type: String, required: true }
    },

    {_id: false}
);

const orderSchema = new mongoose.Schema(

    {
        user: {

            type: mongoose.Schema.Types.ObjectId,
            ref:'User',
            required: true,
        },

        items: [orderItemsSchema],
        
    }
)