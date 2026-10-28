import express from 'express';
import {
  registerUser,
  loginUser,
  getUserProfile,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import {
  validate,
  registerRules,
  loginRules,
} from '../middleware/validatorMiddleware.js';

const router = express.Router();

router.post('/register', registerRules, validate, registerUser);
router.post('/login', loginRules, validate, loginUser);
router.get('/profile', protect, getUserProfile);

export default router;