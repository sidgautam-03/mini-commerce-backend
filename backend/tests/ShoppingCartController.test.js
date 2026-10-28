import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCart,
  addToCart,
  updateCartItemQuantity,
  removeFromCart,
  clearCart,
} from '../controllers/ShoppingCartController.js';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';

// Cart is used as a constructor (new Cart) and for statics (findOne, create)
vi.mock('../models/Cart.js', () => {
  const CartMock = vi.fn();
  CartMock.findOne = vi.fn();
  CartMock.create = vi.fn();
  return { default: CartMock };
});

vi.mock('../models/Product.js', () => ({
  default: { findById: vi.fn() },
}));

// ---------- helpers ----------
const POPULATE_ARGS = {
  path: 'items.product',
  select: 'name price image stock description category',
};

// cart line whose product behaves like a populated doc (has toString like an ObjectId)
const makeItem = (id, quantity, price = 100) => ({
  product: { _id: id, name: `Product ${id}`, price, toString: () => id },
  quantity,
});

// catalog lets populate() turn raw product ids (pushed by addToCart) into docs
const makeCart = (items = [], catalog = {}) => {
  const cart = {
    _id: 'cart1',
    items,
    save: vi.fn().mockResolvedValue(true),
  };
  cart.populate = vi.fn().mockImplementation(async () => {
    cart.items = cart.items.map((item) =>
      typeof item.product === 'string' && catalog[item.product]
        ? { ...item, product: catalog[item.product] }
        : item
    );
  });
  return cart;
};

const makeProduct = (overrides = {}) => ({ _id: 'p1', name: 'Keyboard', price: 500, stock: 10, ...overrides });

const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides = {}) => ({ user: { _id: 'user1' }, body: {}, params: {}, ...overrides });

// runs a controller like express would (asyncHandler forwards errors to next)
const run = async (handler, req) => {
  const res = makeRes();
  const next = vi.fn();
  await handler(req, res, next);
  return { res, next };
};

const expectError = ({ res, next }, status, message) => {
  expect(res.status).toHaveBeenCalledWith(status);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message }));
  expect(res.json).not.toHaveBeenCalled();
};

// =====================================================================
describe('cartController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  describe('getCart', () => {
    it('returns the existing cart with items and totals', async () => {
      const cart = makeCart([makeItem('p1', 2, 500), makeItem('p2', 1, 250)]);
      Cart.findOne.mockResolvedValue(cart);

      const { res, next } = await run(getCart, makeReq());

      expect(Cart.findOne).toHaveBeenCalledWith({ user: 'user1' });
      expect(Cart.create).not.toHaveBeenCalled();
      expect(cart.populate).toHaveBeenCalledWith(POPULATE_ARGS);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        _id: 'cart1',
        items: cart.items,
        subtotal: 1250,
        totalAmount: 1250,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('creates an empty cart when the user has none', async () => {
      Cart.findOne.mockResolvedValue(null);
      Cart.create.mockResolvedValue(makeCart([]));

      const { res } = await run(getCart, makeReq());

      expect(Cart.create).toHaveBeenCalledWith({ user: 'user1', items: [] });
      expect(res.json).toHaveBeenCalledWith({ _id: 'cart1', items: [], subtotal: 0, totalAmount: 0 });
    });

    it('treats a deleted product (null) as price 0 instead of crashing', async () => {
      Cart.findOne.mockResolvedValue(makeCart([{ product: null, quantity: 3 }, makeItem('p2', 2, 100)]));

      const { res } = await run(getCart, makeReq());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 200, totalAmount: 200 }));
    });

    it('rounds totals to 2 decimals (floating point safe)', async () => {
      Cart.findOne.mockResolvedValue(makeCart([makeItem('p1', 3, 0.1)])); // 0.30000000000000004

      const { res } = await run(getCart, makeReq());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 0.3, totalAmount: 0.3 }));
    });

    it('forwards database errors to next()', async () => {
      Cart.findOne.mockRejectedValue(new Error('DB down'));

      const { res, next } = await run(getCart, makeReq());

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'DB down' }));
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  describe('addToCart', () => {
    describe('input validation', () => {
      it.each([
        ['missing productId', { quantity: 1 }],
        ['quantity 0', { productId: 'p1', quantity: 0 }],
        ['negative quantity', { productId: 'p1', quantity: -2 }],
        ['decimal quantity', { productId: 'p1', quantity: 1.5 }],
        ['non-numeric quantity', { productId: 'p1', quantity: 'abc' }],
      ])('returns 400 for %s', async (_label, body) => {
        const result = await run(addToCart, makeReq({ body }));

        expectError(result, 400, 'Provide a valid productId and a quantity of at least 1');
        expect(Product.findById).not.toHaveBeenCalled();
      });

      it('accepts a numeric string quantity like "2"', async () => {
        Product.findById.mockResolvedValue(makeProduct());
        const cart = makeCart([], { p1: makeProduct() });
        Cart.findOne.mockResolvedValue(cart);

        const { res } = await run(addToCart, makeReq({ body: { productId: 'p1', quantity: '2' } }));

        expect(cart.items[0].quantity).toBe(2);
        expect(res.status).toHaveBeenCalledWith(200);
      });
    });

    it('returns 404 when the product does not exist', async () => {
      Product.findById.mockResolvedValue(null);

      const result = await run(addToCart, makeReq({ body: { productId: 'p1' } }));

      expectError(result, 404, 'Product not found');
      expect(Cart.findOne).not.toHaveBeenCalled();
    });

    it('creates a new cart when the user has none, defaulting quantity to 1', async () => {
      const product = makeProduct();
      Product.findById.mockResolvedValue(product);
      Cart.findOne.mockResolvedValue(null);
      const newCart = makeCart([], { p1: product });
      Cart.mockImplementation(function () {
        return newCart;
      });

      const { res } = await run(addToCart, makeReq({ body: { productId: 'p1' } }));

      expect(Cart).toHaveBeenCalledWith({ user: 'user1', items: [] });
      expect(newCart.items).toHaveLength(1);
      expect(newCart.items[0].quantity).toBe(1);
      expect(newCart.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 500, totalAmount: 500 }));
    });

    it('pushes a new line item when the product is not yet in the cart', async () => {
      const product = makeProduct({ _id: 'p2', price: 200 });
      Product.findById.mockResolvedValue(product);
      const cart = makeCart([makeItem('p1', 1, 500)], { p2: product });
      Cart.findOne.mockResolvedValue(cart);

      const { res } = await run(addToCart, makeReq({ body: { productId: 'p2', quantity: 3 } }));

      expect(cart.items).toHaveLength(2);
      expect(cart.items[1].quantity).toBe(3);
      expect(cart.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 1100 }));
    });

    it('increases quantity (no duplicate line) when the product is already in the cart', async () => {
      Product.findById.mockResolvedValue(makeProduct({ stock: 10 }));
      const cart = makeCart([makeItem('p1', 2, 500)]);
      Cart.findOne.mockResolvedValue(cart);

      const { res } = await run(addToCart, makeReq({ body: { productId: 'p1', quantity: 3 } }));

      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(5);
      expect(cart.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('allows reaching exactly the available stock', async () => {
      Product.findById.mockResolvedValue(makeProduct({ stock: 5 }));
      const cart = makeCart([makeItem('p1', 2, 500)]);
      Cart.findOne.mockResolvedValue(cart);

      const { res } = await run(addToCart, makeReq({ body: { productId: 'p1', quantity: 3 } }));

      expect(cart.items[0].quantity).toBe(5);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 when existing cart quantity + requested exceeds stock', async () => {
      Product.findById.mockResolvedValue(makeProduct({ stock: 5 }));
      const cart = makeCart([makeItem('p1', 4, 500)]);
      Cart.findOne.mockResolvedValue(cart);

      const result = await run(addToCart, makeReq({ body: { productId: 'p1', quantity: 2 } }));

      expectError(result, 400, 'Cannot add more items. Only 5 items in stock.');
      expect(cart.items[0].quantity).toBe(4);
      expect(cart.save).not.toHaveBeenCalled();
    });

    it('returns 400 when a single request exceeds stock on an empty cart', async () => {
      Product.findById.mockResolvedValue(makeProduct({ stock: 2 }));
      Cart.findOne.mockResolvedValue(makeCart([]));

      const result = await run(addToCart, makeReq({ body: { productId: 'p1', quantity: 3 } }));

      expectError(result, 400, 'Cannot add more items. Only 2 items in stock.');
    });

    it('forwards a malformed productId (CastError) to next() and saves nothing', async () => {
      // errorMiddleware turns CastError into a 400 for the client.
      const castError = new Error('Cast to ObjectId failed');
      castError.name = 'CastError';
      Product.findById.mockRejectedValue(castError);

      const { res, next } = await run(addToCart, makeReq({ body: { productId: 'not-an-id' } }));

      expect(next).toHaveBeenCalledWith(castError);
      expect(res.json).not.toHaveBeenCalled();
      expect(Cart.findOne).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  describe('updateCartItemQuantity', () => {
    const req = (quantity, productId = 'p1') => makeReq({ params: { productId }, body: { quantity } });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['decimal', 2.5],
      ['non-numeric', 'abc'],
      ['undefined', undefined],
    ])('returns 400 for %s quantity', async (_label, quantity) => {
      const result = await run(updateCartItemQuantity, req(quantity));

      expectError(result, 400, 'Quantity must be a whole number of at least 1');
      expect(Cart.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when the cart does not exist', async () => {
      Cart.findOne.mockResolvedValue(null);

      expectError(await run(updateCartItemQuantity, req(2)), 404, 'Cart not found');
    });

    it('returns 404 when the item is not in the cart', async () => {
      Cart.findOne.mockResolvedValue(makeCart([makeItem('p9', 1)]));

      expectError(await run(updateCartItemQuantity, req(2)), 404, 'Item not in cart');
      expect(Product.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when the product no longer exists', async () => {
      Cart.findOne.mockResolvedValue(makeCart([makeItem('p1', 1)]));
      Product.findById.mockResolvedValue(null);

      expectError(await run(updateCartItemQuantity, req(2)), 404, 'Product not found');
    });

    it('returns 400 when the new quantity exceeds stock', async () => {
      const cart = makeCart([makeItem('p1', 1)]);
      Cart.findOne.mockResolvedValue(cart);
      Product.findById.mockResolvedValue(makeProduct({ stock: 3 }));

      expectError(await run(updateCartItemQuantity, req(4)), 400, 'Cannot set quantity. Only 3 items in stock.');
      expect(cart.items[0].quantity).toBe(1);
      expect(cart.save).not.toHaveBeenCalled();
    });

    it('SETS the quantity (not additive) and returns updated totals', async () => {
      const cart = makeCart([makeItem('p1', 5, 500)]);
      Cart.findOne.mockResolvedValue(cart);
      Product.findById.mockResolvedValue(makeProduct({ stock: 10 }));

      const { res } = await run(updateCartItemQuantity, req(2));

      expect(cart.items[0].quantity).toBe(2);
      expect(cart.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 1000, totalAmount: 1000 }));
    });

    it('allows setting quantity exactly equal to stock', async () => {
      const cart = makeCart([makeItem('p1', 1, 500)]);
      Cart.findOne.mockResolvedValue(cart);
      Product.findById.mockResolvedValue(makeProduct({ stock: 4 }));

      const { res } = await run(updateCartItemQuantity, req(4));

      expect(cart.items[0].quantity).toBe(4);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // -------------------------------------------------------------------
  describe('removeFromCart', () => {
    const req = (productId = 'p1') => makeReq({ params: { productId } });

    it('returns 404 when the cart does not exist', async () => {
      Cart.findOne.mockResolvedValue(null);

      expectError(await run(removeFromCart, req()), 404, 'Cart not found');
    });

    it('returns 404 when the item is not in the cart', async () => {
      const cart = makeCart([makeItem('p2', 1)]);
      Cart.findOne.mockResolvedValue(cart);

      expectError(await run(removeFromCart, req('p1')), 404, 'Item not in cart');
      expect(cart.save).not.toHaveBeenCalled();
    });

    it('removes only the requested item and returns recalculated totals', async () => {
      const cart = makeCart([makeItem('p1', 2, 500), makeItem('p2', 1, 250)]);
      Cart.findOne.mockResolvedValue(cart);

      const { res } = await run(removeFromCart, req('p1'));

      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].product._id).toBe('p2');
      expect(cart.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 250, totalAmount: 250 }));
    });
  });

  // -------------------------------------------------------------------
  describe('clearCart', () => {
    it('returns 404 when the cart does not exist', async () => {
      Cart.findOne.mockResolvedValue(null);

      expectError(await run(clearCart, makeReq()), 404, 'Cart not found');
    });

    it('empties the cart and returns zero totals', async () => {
      const cart = makeCart([makeItem('p1', 2, 500), makeItem('p2', 1, 250)]);
      Cart.findOne.mockResolvedValue(cart);

      const { res } = await run(clearCart, makeReq());

      expect(cart.items).toEqual([]);
      expect(cart.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ _id: 'cart1', items: [], subtotal: 0, totalAmount: 0 });
    });

    it('forwards save errors to next()', async () => {
      const cart = makeCart([makeItem('p1', 1)]);
      cart.save.mockRejectedValue(new Error('save failed'));
      Cart.findOne.mockResolvedValue(cart);

      const { res, next } = await run(clearCart, makeReq());

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'save failed' }));
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});