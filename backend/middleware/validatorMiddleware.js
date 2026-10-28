import { body, validationResult } from 'express-validator';

// Rules ke baad chalta hai: errors ho toh 400 ke saath errorHandler ko bhejta hai
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return next();
  }

  res.status(400);
  const message = errors
    .array()
    .map((e) => e.msg)
    .join(', ');

  next(new Error(message));
};

// ---------- POST /api/auth/register ----------
const registerRules = [
  body('name')
    .isString().withMessage('Name must be text').bail()
    .trim()
    .notEmpty().withMessage('Name is required'),

  body('email')
    .isString().withMessage('Email must be text').bail()
    .trim()
    .notEmpty().withMessage('Email is required').bail()
    .isEmail().withMessage('Please provide a valid email address')
    .toLowerCase(),

  body('password')
    .isString().withMessage('Password must be text').bail()
    .notEmpty().withMessage('Password is required').bail()
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .isLength({ max: 72 }).withMessage('Password must be at most 72 characters'),
];

// ---------- POST /api/auth/login ----------
const loginRules = [
  body('email')
    .isString().withMessage('Email must be text').bail()
    .trim()
    .notEmpty().withMessage('Email is required').bail()
    .isEmail().withMessage('Please provide a valid email address')
    .toLowerCase(),

  body('password')
    .isString().withMessage('Password must be text').bail()
    .notEmpty().withMessage('Password is required'),
];

export { validate, registerRules, loginRules };