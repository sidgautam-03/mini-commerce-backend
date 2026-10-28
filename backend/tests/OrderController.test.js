import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ---------- mock credentials (generated at runtime, never a real key) ----------
const MOCK_KEY_ID = 'rzp_test_MOCKKEYID123';
const MOCK_KEY_SECRET = crypto.randomBytes(16).toString('hex');

const mocks = vi.hoisted(() => ({ rzpOrdersCreate: vi.fn() }));

vi.mock('razorpay', () => ({
  default: vi.fn(function () {
    return { orders: { create: mocks.rzpOrdersCreate } };
  }),
}));

vi.mock('../models/Order.js', () => ({
  default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() },
}));

vi.mock('../models/Cart.js', () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock('../models/Product.js', () => ({
  default: { updateOne: vi.fn(), find: vi.fn() },
}));

// The controller builds the Razorpay instance at import time (from env vars),
// so each scenario re-imports it with the env it needs.
const loadController = async ({ withRazorpay = true } = {}) => {
  if (withRazorpay) {
    process.env.RAZORPAY_KEY_ID = MOCK_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = MOCK_KEY_SECRET;
  } else {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  }

  vi.resetModules();
  return {
    controller: await import('../controllers/OrderController.js'),
    Order: (await import('../models/Order.js')).default,
    Cart: (await import('../models/Cart.js')).default,
    Product: (await import('../models/Product.js')).default,
  };
};

// ---------- helpers ----------
const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validAddress = {
  fullName: 'Test User',
  phone: '9999999999',
  street: '12 MG Road',
  city: 'Ahmedabad',
  postalCode: '380001',
};

const makeProduct = (overrides = {}) => ({
  _id: 'prod1',
  name: 'Keyboard',
  image: 'kb.png',
  price: 500,
  stock: 10,
  ...overrides,
});

const makeCart = (items) => ({ items, save: vi.fn().mockResolvedValue(true) });

const mockCartLookup = (Cart, cart) => {
  Cart.findOne.mockReturnValue({ populate: vi.fn().mockResolvedValue(cart) });
};

const mockStockLookup = (Product, rows = [{ _id: 'prod1', stock: 8 }]) => {
  Product.find.mockReturnValue({ select: vi.fn().mockResolvedValue(rows) });
};

const makeReq = (overrides = {}) => ({
  user: { _id: 'user1', role: 'user' },
  body: {},
  params: {},
  io: { emit: vi.fn() },
  ...overrides,
});

const signFor = (razorpayOrderId, razorpayPaymentId) =>
  crypto
    .createHmac('sha256', MOCK_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

// =====================================================================
describe('orderController', () => {
  let controller, Order, Cart, Product;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ controller, Order, Cart, Product } = await loadController({ withRazorpay: true }));
    Product.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockStockLookup(Product);
  });

  // -------------------------------------------------------------------
  describe('createOrder', () => {
    describe('validation', () => {
      it('returns 400 when shipping address is missing', async () => {
        const res = mockRes();
        await controller.createOrder(makeReq({ body: {} }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Complete shipping address is required' });
      });

      it.each(['street', 'city', 'postalCode'])('returns 400 when %s is missing', async (field) => {
        const address = { ...validAddress };
        delete address[field];
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: address } }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(Cart.findOne).not.toHaveBeenCalled();
      });

      it('returns 400 for an invalid payment method', async () => {
        const res = mockRes();
        await controller.createOrder(
          makeReq({ body: { shippingAddress: validAddress, paymentMethod: 'BITCOIN' } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Invalid payment method' });
      });

      it('returns 400 when the cart does not exist', async () => {
        mockCartLookup(Cart, null);
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Your cart is empty' });
      });

      it('returns 400 when the cart is empty', async () => {
        mockCartLookup(Cart, makeCart([]));
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Your cart is empty' });
      });

      it('returns 404 when a product in the cart no longer exists', async () => {
        mockCartLookup(Cart, makeCart([{ product: null, quantity: 1 }]));
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ message: 'One or more products no longer exist' });
      });

      it('returns 400 when stock is insufficient', async () => {
        mockCartLookup(Cart, makeCart([{ product: makeProduct({ stock: 2 }), quantity: 5 }]));
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          message: 'Insufficient stock for "Keyboard". Only 2 available.',
        });
        expect(Product.updateOne).not.toHaveBeenCalled();
      });
    });

    describe('atomic stock reduction', () => {
      it('returns 409 and rolls back earlier items when a later item fails', async () => {
        const p1 = makeProduct({ _id: 'prod1', name: 'Keyboard' });
        const p2 = makeProduct({ _id: 'prod2', name: 'Mouse' });
        mockCartLookup(
          Cart,
          makeCart([
            { product: p1, quantity: 2 },
            { product: p2, quantity: 3 },
          ])
        );

        Product.updateOne
          .mockResolvedValueOnce({ modifiedCount: 1 })
          .mockResolvedValueOnce({ modifiedCount: 0 })
          .mockResolvedValue({ modifiedCount: 1 });

        const res = mockRes();
        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          message: '"Mouse" just went out of stock. Please review your cart.',
        });
        expect(Product.updateOne).toHaveBeenCalledTimes(3);
        expect(Product.updateOne).toHaveBeenNthCalledWith(
          1,
          { _id: 'prod1', stock: { $gte: 2 } },
          { $inc: { stock: -2 } }
        );
        expect(Product.updateOne).toHaveBeenNthCalledWith(3, { _id: 'prod1' }, { $inc: { stock: 2 } });
        expect(Order.create).not.toHaveBeenCalled();
      });
    });

    describe('DIRECT payment', () => {
      const setup = () => {
        const cart = makeCart([{ product: makeProduct(), quantity: 2 }]);
        mockCartLookup(Cart, cart);
        Order.create.mockImplementation(async (data) => ({ _id: 'order1', ...data }));
        return cart;
      };

      it('creates a processing order, clears the cart and broadcasts stock', async () => {
        const cart = setup();
        const req = makeReq({ body: { shippingAddress: validAddress, paymentMethod: 'DIRECT' } });
        const res = mockRes();

        await controller.createOrder(req, res);

        expect(Order.create).toHaveBeenCalledWith(
          expect.objectContaining({
            user: 'user1',
            paymentMethod: 'DIRECT',
            totalAmount: 1000,
            isPaid: false,
            status: 'processing',
            shippingAddress: validAddress,
            orderItems: [
              { product: 'prod1', name: 'Keyboard', image: 'kb.png', price: 500, quantity: 2 },
            ],
          })
        );
        expect(cart.items).toEqual([]);
        expect(cart.save).toHaveBeenCalled();
        expect(req.io.emit).toHaveBeenCalledWith('stockUpdated', [{ productId: 'prod1', stock: 8 }]);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ order: expect.objectContaining({ _id: 'order1' }) });
        expect(mocks.rzpOrdersCreate).not.toHaveBeenCalled();
      });

      it('defaults to DIRECT when paymentMethod is not provided', async () => {
        setup();
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(Order.create).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'DIRECT' }));
        expect(res.status).toHaveBeenCalledWith(201);
      });

      it('works when req.io is not available', async () => {
        setup();
        const res = mockRes();

        await controller.createOrder(
          makeReq({ io: undefined, body: { shippingAddress: validAddress } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(201);
        expect(Product.find).not.toHaveBeenCalled();
      });

      it('calculates the total across multiple items with 2-decimal rounding', async () => {
        mockCartLookup(
          Cart,
          makeCart([
            { product: makeProduct({ _id: 'a', price: 10.1 }), quantity: 3 },
            { product: makeProduct({ _id: 'b', price: 0.2 }), quantity: 1 },
          ])
        );
        Order.create.mockImplementation(async (data) => ({ _id: 'order1', ...data }));

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), mockRes());

        expect(Order.create).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 30.5 }));
      });
    });

    describe('RAZORPAY payment', () => {
      it('creates a pending order and returns razorpay details (cart NOT cleared yet)', async () => {
        const cart = makeCart([{ product: makeProduct(), quantity: 2 }]);
        mockCartLookup(Cart, cart);
        mocks.rzpOrdersCreate.mockResolvedValue({ id: 'order_rzp_1', amount: 100000, currency: 'INR' });
        Order.create.mockImplementation(async (data) => ({ _id: 'order1', ...data }));

        const req = makeReq({ body: { shippingAddress: validAddress, paymentMethod: 'RAZORPAY' } });
        const res = mockRes();

        await controller.createOrder(req, res);

        expect(mocks.rzpOrdersCreate).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 100000, currency: 'INR' })
        );
        expect(Order.create).toHaveBeenCalledWith(
          expect.objectContaining({
            paymentMethod: 'RAZORPAY',
            isPaid: false,
            status: 'pending',
            paymentResult: { razorpayOrderId: 'order_rzp_1' },
          })
        );
        expect(cart.save).not.toHaveBeenCalled();
        expect(req.io.emit).toHaveBeenCalledWith('stockUpdated', expect.any(Array));
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
          order: expect.objectContaining({ _id: 'order1' }),
          razorpay: { keyId: MOCK_KEY_ID, orderId: 'order_rzp_1', amount: 100000, currency: 'INR' },
        });
      });

      it('falls back to a DIRECT order when Razorpay keys are not configured', async () => {
        ({ controller, Order, Cart, Product } = await loadController({ withRazorpay: false }));
        Product.updateOne.mockResolvedValue({ modifiedCount: 1 });
        mockStockLookup(Product);
        mockCartLookup(Cart, makeCart([{ product: makeProduct(), quantity: 1 }]));
        Order.create.mockImplementation(async (data) => ({ _id: 'order1', ...data }));
        const res = mockRes();

        await controller.createOrder(
          makeReq({ body: { shippingAddress: validAddress, paymentMethod: 'RAZORPAY' } }),
          res
        );

        expect(mocks.rzpOrdersCreate).not.toHaveBeenCalled();
        expect(Order.create).toHaveBeenCalledWith(
          expect.objectContaining({ paymentMethod: 'DIRECT', status: 'processing' })
        );
        expect(res.status).toHaveBeenCalledWith(201);
      });
    });

    describe('error handling', () => {
      it('returns 500 and restores stock if the order could not be saved', async () => {
        mockCartLookup(Cart, makeCart([{ product: makeProduct(), quantity: 2 }]));
        Order.create.mockRejectedValue(new Error('DB down'));
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ message: 'DB down' });
        expect(Product.updateOne).toHaveBeenLastCalledWith({ _id: 'prod1' }, { $inc: { stock: 2 } });
      });

      it('returns 500 and restores stock if Razorpay order creation fails', async () => {
        mockCartLookup(Cart, makeCart([{ product: makeProduct(), quantity: 2 }]));
        mocks.rzpOrdersCreate.mockRejectedValue(new Error('Razorpay down'));
        const res = mockRes();

        await controller.createOrder(
          makeReq({ body: { shippingAddress: validAddress, paymentMethod: 'RAZORPAY' } }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ message: 'Razorpay down' });
        expect(Product.updateOne).toHaveBeenLastCalledWith({ _id: 'prod1' }, { $inc: { stock: 2 } });
      });

      it('does NOT restore stock if the order was already saved (cart.save fails)', async () => {
        const cart = makeCart([{ product: makeProduct(), quantity: 2 }]);
        cart.save.mockRejectedValue(new Error('cart save failed'));
        mockCartLookup(Cart, cart);
        Order.create.mockImplementation(async (data) => ({ _id: 'order1', ...data }));
        const res = mockRes();

        await controller.createOrder(makeReq({ body: { shippingAddress: validAddress } }), res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(Product.updateOne).toHaveBeenCalledTimes(1); // only the reduce, no rollback
      });
    });
  });

  // -------------------------------------------------------------------
  describe('verifyPayment', () => {
    const baseBody = {
      orderId: 'order1',
      razorpayOrderId: 'order_rzp_1',
      razorpayPaymentId: 'pay_1',
    };

    const makePendingOrder = (overrides = {}) => ({
      _id: 'order1',
      user: 'user1',
      isPaid: false,
      status: 'pending',
      orderItems: [{ product: 'prod1', quantity: 2 }],
      paymentResult: { razorpayOrderId: 'order_rzp_1' },
      save: vi.fn().mockResolvedValue(true),
      ...overrides,
    });

    it('returns 400 when Razorpay is not configured', async () => {
      ({ controller } = await loadController({ withRazorpay: false }));
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: 'x' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Razorpay is not configured' });
    });

    it.each(['orderId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature'])(
      'returns 400 when %s is missing',
      async (field) => {
        const body = { ...baseBody, razorpaySignature: 'sig' };
        delete body[field];
        const res = mockRes();

        await controller.verifyPayment(makeReq({ body }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Missing payment details' });
      }
    );

    it('returns 404 when the order does not exist', async () => {
      Order.findById.mockResolvedValue(null);
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: 'sig' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order not found' });
    });

    it('returns 404 when the order belongs to another user', async () => {
      Order.findById.mockResolvedValue(makePendingOrder({ user: 'someone-else' }));
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: 'sig' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when the order is already paid', async () => {
      Order.findById.mockResolvedValue(makePendingOrder({ isPaid: true }));
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: 'sig' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order is already paid' });
    });

    it('returns 400 when the Razorpay order id does not match', async () => {
      Order.findById.mockResolvedValue(makePendingOrder({ paymentResult: { razorpayOrderId: 'different' } }));
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: 'sig' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Razorpay order mismatch' });
    });

    it('cancels the order, restores stock and broadcasts when the signature is invalid', async () => {
      const order = makePendingOrder();
      Order.findById.mockResolvedValue(order);
      const req = makeReq({ body: { ...baseBody, razorpaySignature: 'invalid-signature' } });
      const res = mockRes();

      await controller.verifyPayment(req, res);

      expect(Product.updateOne).toHaveBeenCalledWith({ _id: 'prod1' }, { $inc: { stock: 2 } });
      expect(order.status).toBe('cancelled');
      expect(order.save).toHaveBeenCalled();
      expect(req.io.emit).toHaveBeenCalledWith('stockUpdated', expect.any(Array));
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Payment verification failed' });
    });

    it('cancels the order when the signature has the right length but wrong value', async () => {
      const order = makePendingOrder();
      Order.findById.mockResolvedValue(order);
      const good = signFor('order_rzp_1', 'pay_1');
      const tampered = good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a');
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: tampered } }), res);

      expect(order.status).toBe('cancelled');
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('marks the order paid and clears the cart on a valid signature', async () => {
      const order = makePendingOrder();
      Order.findById.mockResolvedValue(order);
      Cart.findOneAndUpdate.mockResolvedValue({});
      const res = mockRes();

      await controller.verifyPayment(
        makeReq({ body: { ...baseBody, razorpaySignature: signFor('order_rzp_1', 'pay_1') } }),
        res
      );

      expect(order.isPaid).toBe(true);
      expect(order.status).toBe('processing');
      expect(order.paidAt).toEqual(expect.any(Number));
      expect(order.paymentResult).toEqual({ razorpayOrderId: 'order_rzp_1', razorpayPaymentId: 'pay_1' });
      expect(order.save).toHaveBeenCalled();
      expect(Cart.findOneAndUpdate).toHaveBeenCalledWith({ user: 'user1' }, { items: [] });
      expect(Product.updateOne).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ order });
    });

    it('returns 500 on unexpected errors', async () => {
      Order.findById.mockRejectedValue(new Error('boom'));
      const res = mockRes();

      await controller.verifyPayment(makeReq({ body: { ...baseBody, razorpaySignature: 'sig' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'boom' });
    });
  });

  // -------------------------------------------------------------------
  describe('getMyOrders', () => {
    it("returns the user's orders sorted newest first", async () => {
      const orders = [{ _id: 'o2' }, { _id: 'o1' }];
      const sort = vi.fn().mockResolvedValue(orders);
      Order.find.mockReturnValue({ sort });
      const res = mockRes();

      await controller.getMyOrders(makeReq(), res);

      expect(Order.find).toHaveBeenCalledWith({ user: 'user1' });
      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(orders);
    });

    it('returns 500 when the query fails', async () => {
      Order.find.mockReturnValue({ sort: vi.fn().mockRejectedValue(new Error('query failed')) });
      const res = mockRes();

      await controller.getMyOrders(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'query failed' });
    });
  });

  // -------------------------------------------------------------------
  describe('getOrderById', () => {
    const order = { _id: 'order1', user: 'user1' };

    it('returns 404 when the order is not found', async () => {
      Order.findById.mockResolvedValue(null);
      const res = mockRes();

      await controller.getOrderById(makeReq({ params: { id: 'order1' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order not found' });
    });

    it('lets the owner view their order', async () => {
      Order.findById.mockResolvedValue(order);
      const res = mockRes();

      await controller.getOrderById(makeReq({ params: { id: 'order1' } }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(order);
    });

    it("lets an admin view anyone's order", async () => {
      Order.findById.mockResolvedValue(order);
      const res = mockRes();

      await controller.getOrderById(
        makeReq({ user: { _id: 'admin1', role: 'admin' }, params: { id: 'order1' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 403 for a non-owner, non-admin user', async () => {
      Order.findById.mockResolvedValue(order);
      const res = mockRes();

      await controller.getOrderById(
        makeReq({ user: { _id: 'user2', role: 'user' }, params: { id: 'order1' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not allowed to view this order' });
    });

    it('returns 400 for an invalid order id (query throws)', async () => {
      Order.findById.mockRejectedValue(new Error('Cast to ObjectId failed'));
      const res = mockRes();

      await controller.getOrderById(makeReq({ params: { id: 'not-an-id' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid order ID format' });
    });
  });
});