const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Razorpay tabhi chalu hoga jab dono keys .env mein hon
let razorpayInstance = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ---------- helpers ----------

// Atomic reduction: stock tabhi ghatega jab stock >= quantity ho.
// Ye ek hi MongoDB operation hai, isliye do users ek saath order karein
// toh bhi stock negative nahi ho sakta (race condition nahi).
const reduceStock = async (items) => {
  const reduced = [];

  for (const item of items) {
    const result = await Product.updateOne(
      { _id: item.product._id, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } }
    );

    if (result.modifiedCount === 0) {
      // is item ka stock kam pad gaya, pehle ghataye hue items wapas karo
      await restoreStock(reduced);
      return { ok: false, failedItem: item.product.name };
    }

    reduced.push({ product: item.product._id, quantity: item.quantity });
  }

  return { ok: true, reduced };
};

// Rollback: stock wapas jodta hai
const restoreStock = async (items) => {
  for (const item of items) {
    await Product.updateOne(
      { _id: item.product },
      { $inc: { stock: item.quantity } }
    );
  }
};

// Socket.IO se sabhi connected clients ko naya stock bhejta hai
const broadcastStock = async (io, productIds) => {
  if (!io) return;

  const products = await Product.find({ _id: { $in: productIds } }).select('_id stock');

  io.emit(
    'stockUpdated',
    products.map((p) => ({ productId: p._id, stock: p.stock }))
  );
};

// ---------- controllers ----------

// POST /api/orders (protected)
// body: { shippingAddress: { street, city, postalCode }, paymentMethod: 'DIRECT' | 'RAZORPAY' }
const createOrder = async (req, res) => {
  let reservedItems = []; // catch mein rollback ke liye
  let orderSaved = false;

  try {
    const { shippingAddress, paymentMethod = 'DIRECT' } = req.body;

    if (
      !shippingAddress ||
      !shippingAddress.street ||
      !shippingAddress.city ||
      !shippingAddress.postalCode
    ) {
      return res.status(400).json({ message: 'Complete shipping address is required' });
    }

    if (!['DIRECT', 'RAZORPAY'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Invalid payment method' });
    }

    // 1. Cart laao, products ke saath
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Your cart is empty' });
    }

    // 2. Real-time stock re-validation (DB se abhi ka stock)
    for (const item of cart.items) {
      if (!item.product) {
        return res
          .status(404)
          .json({ message: 'One or more products no longer exist' });
      }

      if (item.product.stock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for "${item.product.name}". Only ${item.product.stock} available.`,
        });
      }
    }

    // 3. Atomic inventory reduction
    const stockResult = await reduceStock(cart.items);
    if (!stockResult.ok) {
      return res.status(409).json({
        message: `"${stockResult.failedItem}" just went out of stock. Please review your cart.`,
      });
    }
    reservedItems = stockResult.reduced;

    // 4. Order items ka snapshot (price, name us waqt ka)
    const orderItems = cart.items.map((item) => ({
      product: item.product._id,
      name: item.product.name,
      image: item.product.image,
      price: item.product.price,
      quantity: item.quantity,
    }));

    const totalAmount = Number(
      orderItems.reduce((acc, i) => acc + i.price * i.quantity, 0).toFixed(2)
    );

    const useRazorpay = paymentMethod === 'RAZORPAY' && razorpayInstance;

    // 5A. Razorpay flow: order banao, payment verify hone tak pending
    if (useRazorpay) {
      const rzpOrder = await razorpayInstance.orders.create({
        amount: Math.round(totalAmount * 100), // paise mein
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`,
      });

      const order = await Order.create({
        user: req.user._id,
        orderItems,
        shippingAddress,
        paymentMethod: 'RAZORPAY',
        totalAmount,
        isPaid: false,
        status: 'pending',
        paymentResult: { razorpayOrderId: rzpOrder.id },
      });
      orderSaved = true;

      await broadcastStock(req.io, reservedItems.map((i) => i.product));

      return res.status(201).json({
        order,
        razorpay: {
          keyId: process.env.RAZORPAY_KEY_ID,
          orderId: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
        },
      });
    }

    // 5B. Direct order (Razorpay skip hua ya configured nahi hai)
    const order = await Order.create({
      user: req.user._id,
      orderItems,
      shippingAddress,
      paymentMethod: 'DIRECT',
      totalAmount,
      isPaid: false,
      status: 'processing',
    });
    orderSaved = true;

    cart.items = [];
    await cart.save();

    await broadcastStock(req.io, reservedItems.map((i) => i.product));

    res.status(201).json({ order });
  } catch (error) {
    // order save nahi hua toh jo stock ghataya tha wapas karo
    if (!orderSaved && reservedItems.length > 0) {
      await restoreStock(reservedItems);
    }
    res.status(500).json({ message: error.message });
  }
};

// POST /api/orders/verify-payment (protected)
// body: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
const verifyPayment = async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(400).json({ message: 'Razorpay is not configured' });
    }

    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ message: 'Missing payment details' });
    }

    const order = await Order.findById(orderId);

    if (!order || order.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.isPaid) {
      return res.status(400).json({ message: 'Order is already paid' });
    }

    if (order.paymentResult?.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ message: 'Razorpay order mismatch' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const valid =
      expectedSignature.length === razorpaySignature.length &&
      crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(razorpaySignature)
      );

    if (!valid) {
      // payment fail: stock wapas, order cancel
      await restoreStock(order.orderItems);
      order.status = 'cancelled';
      await order.save();
      await broadcastStock(req.io, order.orderItems.map((i) => i.product));

      return res.status(400).json({ message: 'Payment verification failed' });
    }

    order.isPaid = true;
    order.paidAt = Date.now();
    order.status = 'processing';
    order.paymentResult = { razorpayOrderId, razorpayPaymentId };
    await order.save();

    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });

    res.status(200).json({ order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/orders/my (protected)
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/orders/:id (protected, owner ya admin)
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const isOwner = order.user.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed to view this order' });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(400).json({ message: 'Invalid order ID format' });
  }
};

module.exports = { createOrder, verifyPayment, getMyOrders, getOrderById };