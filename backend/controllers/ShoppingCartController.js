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
const getCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    await sendCart(res, cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/cart (protected)
const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    const qty = Number(quantity);
    if (!productId || !Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: 'Provide a valid productId and a quantity of at least 1' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
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
      return res.status(400).json({
        message: `Cannot add more items. Only ${product.stock} items in stock.`,
      });
    }

    if (itemIndex > -1) {
      cart.items[itemIndex].quantity = requestedQty;
    } else {
      cart.items.push({ product: productId, quantity: qty });
    }

    await cart.save();
    await sendCart(res, cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/cart/:productId (protected)
// body: { "quantity": 3 } -> quantity ko seedha 3 set karta hai
const updateCartItemQuantity = async (req, res) => {
  try {
    const { productId } = req.params;
    const qty = Number(req.body.quantity);

    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: 'Quantity must be a whole number of at least 1' });
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.product.toString() === productId
    );
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not in cart' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (qty > product.stock) {
      return res.status(400).json({
        message: `Cannot set quantity. Only ${product.stock} items in stock.`,
      });
    }

    cart.items[itemIndex].quantity = qty;

    await cart.save();
    await sendCart(res, cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/cart/:productId (protected)
const removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.product.toString() === productId
    );
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not in cart' });
    }

    cart.items.splice(itemIndex, 1);

    await cart.save();
    await sendCart(res, cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/cart (protected)
const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    cart.items = [];

    await cart.save();
    await sendCart(res, cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItemQuantity,
  removeFromCart,
  clearCart,
} = require('../controllers/ShoppingCartController');