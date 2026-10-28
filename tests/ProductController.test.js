/**
 * Unit tests for controllers/productController.js
 *
 * Place at <server-root>/tests/productController.test.js
 * (adjust the relative paths if your folder layout is different).
 *
 * Run:  npx jest productController
 */
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const Product = require('../models/Product');

// Product is used as a constructor (new Product) and for statics (find, findById)
jest.mock('../models/Product', () => {
  const ProductMock = jest.fn();
  ProductMock.find = jest.fn();
  ProductMock.findById = jest.fn();
  return ProductMock;
});

// ---------- helpers ----------
const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  name: 'Keyboard',
  price: 500,
  description: 'Mechanical keyboard',
  image: 'kb.png',
  category: 'electronics',
  stock: 10,
};

// Product.find(query).sort(sortOptions) chain
const mockFindChain = (result = []) => {
  const sort = jest.fn().mockResolvedValue(result);
  Product.find.mockReturnValue({ sort });
  return sort;
};

// an existing product document with mutable fields and save/deleteOne
const makeDoc = (overrides = {}) => {
  const doc = {
    _id: 'p1',
    name: 'Old name',
    price: 100,
    description: 'Old description',
    image: 'old.png',
    category: 'books',
    stock: 5,
    deleteOne: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  doc.save = jest.fn().mockImplementation(async () => doc);
  return doc;
};

// =====================================================================
describe('productController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------
  describe('getProducts', () => {
    it('returns all products, newest first, when no filters are given', async () => {
      const products = [{ _id: 'p1' }, { _id: 'p2' }];
      const sort = mockFindChain(products);
      const res = makeRes();

      await getProducts({ query: {} }, res);

      expect(Product.find).toHaveBeenCalledWith({});
      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(products);
    });

    it('filters by keyword using a case-insensitive regex on name', async () => {
      mockFindChain();

      await getProducts({ query: { keyword: 'key' } }, makeRes());

      expect(Product.find).toHaveBeenCalledWith({ name: { $regex: 'key', $options: 'i' } });
    });

    it('lower-cases the category filter', async () => {
      mockFindChain();

      await getProducts({ query: { category: 'ELECTRONICS' } }, makeRes());

      expect(Product.find).toHaveBeenCalledWith({ category: 'electronics' });
    });

    it('combines keyword and category filters', async () => {
      mockFindChain();

      await getProducts({ query: { keyword: 'key', category: 'Electronics' } }, makeRes());

      expect(Product.find).toHaveBeenCalledWith({
        name: { $regex: 'key', $options: 'i' },
        category: 'electronics',
      });
    });

    it.each([
      ['price', 'asc', { price: 1 }],
      ['price', 'desc', { price: -1 }],
      ['name', 'asc', { name: 1 }],
      ['createdAt', 'asc', { createdAt: 1 }],
    ])('sorts by %s %s', async (sortBy, order, expected) => {
      const sort = mockFindChain();

      await getProducts({ query: { sortBy, order } }, makeRes());

      expect(sort).toHaveBeenCalledWith(expected);
    });

    it('defaults to descending when order is missing or not "asc"', async () => {
      const sort = mockFindChain();

      await getProducts({ query: { sortBy: 'price' } }, makeRes());
      expect(sort).toHaveBeenLastCalledWith({ price: -1 });

      await getProducts({ query: { sortBy: 'price', order: 'whatever' } }, makeRes());
      expect(sort).toHaveBeenLastCalledWith({ price: -1 });
    });

    it('ignores a sortBy field that is not whitelisted', async () => {
      const sort = mockFindChain();

      await getProducts({ query: { sortBy: 'stock', order: 'asc' } }, makeRes());

      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('ignores order when sortBy is not provided', async () => {
      const sort = mockFindChain();

      await getProducts({ query: { order: 'asc' } }, makeRes());

      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('returns 500 when the database query fails', async () => {
      Product.find.mockReturnValue({ sort: jest.fn().mockRejectedValue(new Error('DB down')) });
      const res = makeRes();

      await getProducts({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'DB down' });
    });

    it('returns 500 when category is repeated in the URL (array has no toLowerCase)', async () => {
      // GET /api/products?category=a&category=b  ->  req.query.category is an array.
      // Documents current behavior; validate/coerce category in the controller to make this a 400.
      const res = makeRes();

      await getProducts({ query: { category: ['a', 'b'] } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(Product.find).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  describe('getProductById', () => {
    it('returns the product when found', async () => {
      const product = { _id: 'p1', name: 'Keyboard' };
      Product.findById.mockResolvedValue(product);
      const res = makeRes();

      await getProductById({ params: { id: 'p1' } }, res);

      expect(Product.findById).toHaveBeenCalledWith('p1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(product);
    });

    it('returns 404 when the product does not exist', async () => {
      Product.findById.mockResolvedValue(null);
      const res = makeRes();

      await getProductById({ params: { id: 'p1' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Product not found' });
    });

    it('returns 400 for an invalid ID format (query throws)', async () => {
      Product.findById.mockRejectedValue(new Error('Cast to ObjectId failed'));
      const res = makeRes();

      await getProductById({ params: { id: 'not-an-id' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid product ID format' });
    });
  });

  // -------------------------------------------------------------------
  describe('createProduct', () => {
    let mockSave;

    beforeEach(() => {
      mockSave = jest.fn();
      Product.mockImplementation((data) => ({ ...data, save: mockSave }));
    });

    it.each(['name', 'price', 'description', 'image', 'category', 'stock'])(
      'returns 400 when %s is missing',
      async (field) => {
        const body = { ...validBody };
        delete body[field];
        const res = makeRes();

        await createProduct({ body }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Please provide all required fields' });
        expect(Product).not.toHaveBeenCalled();
      }
    );

    it('returns 400 when a text field is an empty string', async () => {
      const res = makeRes();

      await createProduct({ body: { ...validBody, name: '' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('accepts price 0 and stock 0 (they are valid values, not "missing")', async () => {
      mockSave.mockResolvedValue({ _id: 'p1', ...validBody, price: 0, stock: 0 });
      const res = makeRes();

      await createProduct({ body: { ...validBody, price: 0, stock: 0 } }, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('creates the product and returns 201', async () => {
      const saved = { _id: 'p1', ...validBody };
      mockSave.mockResolvedValue(saved);
      const res = makeRes();

      await createProduct({ body: validBody }, res);

      expect(Product).toHaveBeenCalledWith(validBody);
      expect(mockSave).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(saved);
    });

    it('only passes whitelisted fields to the model (extra fields are dropped)', async () => {
      mockSave.mockResolvedValue({});

      await createProduct({ body: { ...validBody, _id: 'hacked', isFeatured: true } }, makeRes());

      expect(Product).toHaveBeenCalledWith(validBody);
    });

    it('returns 500 when saving fails', async () => {
      mockSave.mockRejectedValue(new Error('validation failed'));
      const res = makeRes();

      await createProduct({ body: validBody }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'validation failed' });
    });
  });

  // -------------------------------------------------------------------
  describe('updateProduct', () => {
    it('returns 404 when the product does not exist', async () => {
      Product.findById.mockResolvedValue(null);
      const res = makeRes();

      await updateProduct({ params: { id: 'p1' }, body: { name: 'New' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Product not found' });
    });

    it('updates all fields that are provided and returns 200', async () => {
      const doc = makeDoc();
      Product.findById.mockResolvedValue(doc);
      const res = makeRes();

      await updateProduct({ params: { id: 'p1' }, body: validBody }, res);

      expect(doc).toMatchObject(validBody);
      expect(doc.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(doc);
    });

    it('updates only the fields present in the request (partial update)', async () => {
      const doc = makeDoc();
      Product.findById.mockResolvedValue(doc);

      await updateProduct({ params: { id: 'p1' }, body: { price: 250 } }, makeRes());

      expect(doc.price).toBe(250);
      expect(doc.name).toBe('Old name');
      expect(doc.description).toBe('Old description');
      expect(doc.image).toBe('old.png');
      expect(doc.category).toBe('books');
      expect(doc.stock).toBe(5);
    });

    it('applies falsy-but-valid values like price 0 and stock 0', async () => {
      const doc = makeDoc();
      Product.findById.mockResolvedValue(doc);

      await updateProduct({ params: { id: 'p1' }, body: { price: 0, stock: 0 } }, makeRes());

      expect(doc.price).toBe(0);
      expect(doc.stock).toBe(0);
    });

    it('ignores fields that are not updatable', async () => {
      const doc = makeDoc();
      Product.findById.mockResolvedValue(doc);

      await updateProduct(
        { params: { id: 'p1' }, body: { _id: 'hacked', isFeatured: true } },
        makeRes()
      );

      expect(doc._id).toBe('p1');
      expect(doc.isFeatured).toBeUndefined();
    });

    it('still saves and returns 200 for an empty body', async () => {
      const doc = makeDoc();
      Product.findById.mockResolvedValue(doc);
      const res = makeRes();

      await updateProduct({ params: { id: 'p1' }, body: {} }, res);

      expect(doc.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 when saving fails (e.g. validation error)', async () => {
      const doc = makeDoc();
      doc.save.mockRejectedValue(new Error('price must be positive'));
      Product.findById.mockResolvedValue(doc);
      const res = makeRes();

      await updateProduct({ params: { id: 'p1' }, body: { price: -5 } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'price must be positive' });
    });

    it('returns 400 for an invalid ID format (findById throws)', async () => {
      Product.findById.mockRejectedValue(new Error('Cast to ObjectId failed'));
      const res = makeRes();

      await updateProduct({ params: { id: 'bad' }, body: {} }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Cast to ObjectId failed' });
    });
  });

  // -------------------------------------------------------------------
  describe('deleteProduct', () => {
    it('returns 404 when the product does not exist', async () => {
      Product.findById.mockResolvedValue(null);
      const res = makeRes();

      await deleteProduct({ params: { id: 'p1' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Product not found' });
    });

    it('deletes the product and returns 200', async () => {
      const doc = makeDoc();
      Product.findById.mockResolvedValue(doc);
      const res = makeRes();

      await deleteProduct({ params: { id: 'p1' } }, res);

      expect(doc.deleteOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Product removed' });
    });

    it('returns 400 when deletion fails', async () => {
      const doc = makeDoc();
      doc.deleteOne.mockRejectedValue(new Error('delete failed'));
      Product.findById.mockResolvedValue(doc);
      const res = makeRes();

      await deleteProduct({ params: { id: 'p1' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'delete failed' });
    });

    it('returns 400 for an invalid ID format (findById throws)', async () => {
      Product.findById.mockRejectedValue(new Error('Cast to ObjectId failed'));
      const res = makeRes();

      await deleteProduct({ params: { id: 'bad' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});