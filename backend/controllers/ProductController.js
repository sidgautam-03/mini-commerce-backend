const Product = require('../models/Product');

// GET /api/products?keyword=&category=&sortBy=&order=
const getProducts = async (req, res) => {
  try {
    const { keyword, category, sortBy, order } = req.query;

    const query = {};

    // search by name (case-insensitive)
    if (keyword) {
      query.name = { $regex: keyword, $options: 'i' };
    }

    // filter by category
    if (category) {
      query.category = category.toLowerCase();
    }

    // sorting: newest first by default
    let sortOptions = { createdAt: -1 };

    const allowedSortFields = ['price', 'name', 'createdAt'];
    if (sortBy && allowedSortFields.includes(sortBy)) {
      const sortOrder = order === 'asc' ? 1 : -1;
      sortOptions = { [sortBy]: sortOrder };
    }

    const products = await Product.find(query).sort(sortOptions);
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/products/:id
const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json(product);
  } catch (error) {
    res.status(400).json({ message: 'Invalid product ID format' });
  }
};

// POST /api/products (admin only)
const createProduct = async (req, res) => {
  try {
    const { name, price, description, image, category, stock } = req.body;

    if (
      !name ||
      price === undefined ||
      !description ||
      !image ||
      !category ||
      stock === undefined
    ) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    const product = new Product({
      name,
      price,
      description,
      image,
      category,
      stock,
    });

    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/products/:id (admin only)
const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const { name, price, description, image, category, stock } = req.body;

    // sirf wahi fields update hongi jo request mein aayi hain
    if (name !== undefined) product.name = name;
    if (price !== undefined) product.price = price;
    if (description !== undefined) product.description = description;
    if (image !== undefined) product.image = image;
    if (category !== undefined) product.category = category;
    if (stock !== undefined) product.stock = stock;

    const updatedProduct = await product.save();
    res.status(200).json(updatedProduct);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// DELETE /api/products/:id (admin only)
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await product.deleteOne();
    res.status(200).json({ message: 'Product removed' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};