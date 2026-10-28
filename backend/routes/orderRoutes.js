import express from 'express';
import {
  createOrder,
  verifyPayment,
  getMyOrders,
  getOrderById,
} from '../controllers/OrderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, createOrder);
router.post('/verify-payment', protect, verifyPayment);
router.get('/my', protect, getMyOrders);
router.get('/:id', protect, getOrderById);

export default router;