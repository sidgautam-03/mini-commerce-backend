import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { registerUser, loginUser, getUserProfile } from '../controllers/authController.js';
import User from '../models/User.js';

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}));

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn() },
}));

vi.mock('../models/User.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn(), create: vi.fn() },
}));

// ---------- helpers ----------
const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

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

const validUser = { name: 'Test User', email: 'test@example.com', password: 'secret123' };

const dbUser = {
  _id: 'user1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'customer',
  password: 'hashed-password',
};

// =====================================================================
describe('authController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-not-real';
    jwt.sign.mockReturnValue('mock.jwt.token');
  });

  // -------------------------------------------------------------------
  describe('registerUser', () => {
    it.each(['name', 'email', 'password'])('returns 400 when %s is missing', async (field) => {
      const body = { ...validUser };
      delete body[field];

      expectError(await run(registerUser, { body }), 400, 'Please provide all required fields');
      expect(User.findOne).not.toHaveBeenCalled();
    });

    it('returns 400 when the password is shorter than 6 characters', async () => {
      const result = await run(registerUser, { body: { ...validUser, password: '12345' } });

      expectError(result, 400, 'Password must be at least 6 characters');
      expect(User.findOne).not.toHaveBeenCalled();
    });

    it('returns 400 when the user already exists', async () => {
      User.findOne.mockResolvedValue(dbUser);

      expectError(await run(registerUser, { body: validUser }), 400, 'User already exists');
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(User.create).not.toHaveBeenCalled();
    });

    it('hashes the password, creates a customer and returns 201 with a token', async () => {
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashed-password');
      User.create.mockResolvedValue(dbUser);

      const { res, next } = await run(registerUser, { body: validUser });

      expect(User.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
      expect(User.create).toHaveBeenCalledWith({
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashed-password', // never the plain text
        role: 'customer',
      });
      expect(jwt.sign).toHaveBeenCalledWith({ id: 'user1' }, 'test-secret-not-real', { expiresIn: '7d' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        _id: 'user1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'customer',
        token: 'mock.jwt.token',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('does not leak the password hash in the response', async () => {
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashed-password');
      User.create.mockResolvedValue(dbUser);

      const { res } = await run(registerUser, { body: validUser });

      expect(res.json.mock.calls[0][0]).not.toHaveProperty('password');
    });

    it('forwards database errors to next()', async () => {
      User.findOne.mockRejectedValue(new Error('DB down'));

      const { next } = await run(registerUser, { body: validUser });

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'DB down' }));
    });
  });

  // -------------------------------------------------------------------
  describe('loginUser', () => {
    const mockUserLookup = (user) => {
      User.findOne.mockReturnValue({ select: vi.fn().mockResolvedValue(user) });
    };

    it.each(['email', 'password'])('returns 400 when %s is missing', async (field) => {
      const body = { email: 'test@example.com', password: 'secret123' };
      delete body[field];

      expectError(await run(loginUser, { body }), 400, 'Please provide email and password');
      expect(User.findOne).not.toHaveBeenCalled();
    });

    it('returns 200 with user data and a token for valid credentials', async () => {
      mockUserLookup(dbUser);
      bcrypt.compare.mockResolvedValue(true);

      const { res } = await run(loginUser, { body: { email: 'test@example.com', password: 'secret123' } });

      expect(User.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(bcrypt.compare).toHaveBeenCalledWith('secret123', 'hashed-password');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        _id: 'user1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'customer',
        token: 'mock.jwt.token',
      });
    });

    it('returns 401 when the password is wrong', async () => {
      mockUserLookup(dbUser);
      bcrypt.compare.mockResolvedValue(false);

      const result = await run(loginUser, { body: { email: 'test@example.com', password: 'wrong' } });

      expectError(result, 401, 'Invalid email or password');
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('returns 401 (same message) when the user does not exist', async () => {
      mockUserLookup(null);

      const result = await run(loginUser, { body: { email: 'nobody@example.com', password: 'secret123' } });

      expectError(result, 401, 'Invalid email or password');
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  describe('getUserProfile', () => {
    it('returns 404 when the user no longer exists', async () => {
      User.findById.mockResolvedValue(null);

      expectError(await run(getUserProfile, { user: { _id: 'user1' } }), 404, 'User not found');
    });

    it('returns the profile without password or token', async () => {
      User.findById.mockResolvedValue(dbUser);

      const { res } = await run(getUserProfile, { user: { _id: 'user1' } });

      expect(User.findById).toHaveBeenCalledWith('user1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        _id: 'user1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'customer',
      });
    });
  });
});