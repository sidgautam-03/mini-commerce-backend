const asyncHandler = require('express-async-handler');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

const productFields = 'name price image stock description category';

const calculateTotals = (items) => {
  const subtotal = items.reduce((acc, item) => {
    const price = item.product ? item.product.price : 0;
    return acc + price * item.quantity;
  }, 0);

  return {
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(subtotal.toFixed(2)),
  };
};

// helper: cart ko populate karke totals ke saath response bhejta hai
const sendCart = async (res, cart, status = 200) => {
  await cart.populate({ path: 'items.product', select: productFields });
  const totals = calculateTotals(cart.items);

  return res.status(status).json({
    _id: cart._id,
    items: cart.items,
    subtotal: totals.subtotal,
    totalAmount: totals.total,
  });
};

// GET /api/cart (protected)
const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    cart = await Cart.create({ user: req.user._id, items: [] });
  }

  await sendCart(res, cart);
});

// POST /api/cart (protected)
const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  const qty = Number(quantity);
  if (!productId || !Number.isInteger(qty) || qty < 1) {
    res.status(400);
    throw new Error('Provide a valid productId and a quantity of at least 1');
  }

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  const itemIndex = cart.items.findIndex(
    (item) => item.product.toString() === productId
  );

  const currentQtyInCart = itemIndex > -1 ? cart.items[itemIndex].quantity : 0;
  const requestedQty = currentQtyInCart + qty;

  if (requestedQty > product.stock) {
    res.status(400);
    throw new Error(`Cannot add more items. Only ${product.stock} items in stock.`);
  }

  if (itemIndex > -1) {
    cart.items[itemIndex].quantity = requestedQty;
  } else {
    cart.items.push({ product: productId, quantity: qty });
  }

  await cart.save();
  await sendCart(res, cart);
});

// PUT /api/cart/:productId (protected)
// body: { "quantity": 3 } -> quantity ko seedha 3 set karta hai
const updateCartItemQuantity = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const qty = Number(req.body.quantity);

  if (!Number.isInteger(qty) || qty < 1) {
    res.status(400);
    throw new Error('Quantity must be a whole number of at least 1');
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error('Cart not found');
  }

  const itemIndex = cart.items.findIndex(
    (item) => item.product.toString() === productId
  );
  if (itemIndex === -1) {
    res.status(404);
    throw new Error('Item not in cart');
  }

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  if (qty > product.stock) {
    res.status(400);
    throw new Error(`Cannot set quantity. Only ${product.stock} items in stock.`);
  }

  cart.items[itemIndex].quantity = qty;

  await cart.save();
  await sendCart(res, cart);
});

// DELETE /api/cart/:productId (protected)
const removeFromCart = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error('Cart not found');
  }

  const itemIndex = cart.items.findIndex(
    (item) => item.product.toString() === productId
  );
  if (itemIndex === -1) {
    res.status(404);
    throw new Error('Item not in cart');
  }

  cart.items.splice(itemIndex, 1);

  await cart.save();
  await sendCart(res, cart);
});

// DELETE /api/cart (protected)
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error('Cart not found');
  }

  cart.items = [];

  await cart.save();
  await sendCart(res, cart);
});

module.exports = {
  getCart,
  addToCart,
  updateCartItemQuantity,
  removeFromCart,
  clearCart,
};