const express = require('express');
const router = express.Router();
const {
  createOrder,
  verifyPayment,
  getMyOrders,
  getOrderById,
} = require('../controllers/OrderController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, createOrder);
router.post('/verify-payment', protect, verifyPayment);
router.get('/my', protect, getMyOrders);
router.get('/:id', protect, getOrderById);

module.exports = router;