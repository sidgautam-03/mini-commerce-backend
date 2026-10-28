import express from 'express';
import {
  getCart,
  addToCart,
  updateCartItemQuantity,
  removeFromCart,
  clearCart,
} from '../controllers/ShoppingCartController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getCart);
router.post('/', protect, addToCart);
router.delete('/', protect, clearCart);
router.put('/:productId', protect, updateCartItemQuantity);
router.delete('/:productId', protect, removeFromCart);

export default router;