const mongoose = require('mongoose');

// 1. pehle item ka schema
const cartItemSchema = new mongoose.Schema(
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
  { _id: false }
);

// 2. phir cart ka schema, jo upar wale ko use karta hai
const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // ek user ka ek hi cart
    },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

// 3. last mein model export
module.exports = mongoose.model('Cart', cartSchema);