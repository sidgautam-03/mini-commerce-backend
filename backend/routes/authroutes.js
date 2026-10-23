const express = require('express');
const router = express.Router();

const {
  registerUser,
  loginUser,
  getUserProfile,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const {
  validate,
  registerRules,
  loginRules,
} = require('../middleware/validatorMiddleware');

router.post('/register', registerRules, validate, registerUser);
router.post('/login', loginRules, validate, loginUser);
router.get('/profile', protect, getUserProfile);

module.exports = router;