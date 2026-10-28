import rateLimit from 'express-rate-limit';

// Auth routes ke liye strict limiter (Brute-force prevention)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 10, // 15 min mein max 10 requests allowed
  standardHeaders: true, // `RateLimit-*` headers send karega
  legacyHeaders: false, // `X-RateLimit-*` disable karega
  message: {
    status: 429,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});

// General API limiter
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 100, // 1 min mein 100 requests
  standardHeaders: true,
  legacyHeaders: false,
});