const { registerUser, loginUser } = require('../controllers/authController');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// external cheezein mock: na asli DB, na asli hashing, na asli token
jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
}));
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
}));

describe('Auth Controller', () => {
  let req, res, next;

  beforeEach(() => {
    jest.resetAllMocks();

    req = { body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();

    jwt.sign.mockReturnValue('mock_token');
  });

  // helper: asyncHandler error ko next(err) mein bhejta hai
  const expectError = (status, message) => {
    expect(res.status).toHaveBeenCalledWith(status);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe(message);
  };

  // ---------------- registerUser ----------------
  describe('registerUser()', () => {
    test('400 if any required field is missing', async () => {
      req.body = { email: 'test@example.com', password: 'password123' }; // name nahi

      await registerUser(req, res, next);

      expectError(400, 'Please provide all required fields');
      expect(User.findOne).not.toHaveBeenCalled();
    });

    test('400 if password is shorter than 6 characters', async () => {
      req.body = { name: 'John Doe', email: 'john@example.com', password: '123' };

      await registerUser(req, res, next);

      expectError(400, 'Password must be at least 6 characters');
      expect(User.create).not.toHaveBeenCalled();
    });

    test('400 if user already exists', async () => {
      req.body = {
        name: 'John Doe',
        email: 'existing@example.com',
        password: 'password123',
      };
      User.findOne.mockResolvedValue({ _id: '123', email: 'existing@example.com' });

      await registerUser(req, res, next);

      expect(User.findOne).toHaveBeenCalledWith({ email: 'existing@example.com' });
      expectError(400, 'User already exists');
      expect(User.create).not.toHaveBeenCalled();
    });

    test('hashes password, creates user and returns 201 with token', async () => {
      req.body = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'securePassword123',
      };

      User.findOne.mockResolvedValue(null); // user abhi nahi hai
      bcrypt.hash.mockResolvedValue('hashed_secret_password');
      User.create.mockResolvedValue({
        _id: 'usr_999',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'customer',
      });

      await registerUser(req, res, next);

      expect(bcrypt.hash).toHaveBeenCalledWith('securePassword123', 10);
      expect(User.create).toHaveBeenCalledWith({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'hashed_secret_password',
        role: 'customer',
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        _id: 'usr_999',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'customer',
        token: 'mock_token',
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('never sends the password back in the response', async () => {
      req.body = { name: 'Jane', email: 'jane@example.com', password: 'secret123' };
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashed');
      User.create.mockResolvedValue({
        _id: 'u1',
        name: 'Jane',
        email: 'jane@example.com',
        role: 'customer',
        password: 'hashed',
      });

      await registerUser(req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body).not.toHaveProperty('password');
    });
  });

  // ---------------- loginUser ----------------
  describe('loginUser()', () => {
    // login mein findOne(...).select('+password') chain hota hai
    const mockFindOneWith = (user) => {
      const select = jest.fn().mockResolvedValue(user);
      User.findOne.mockReturnValue({ select });
      return select;
    };

    test('400 if email or password is missing', async () => {
      req.body = { email: 'test@example.com' };

      await loginUser(req, res, next);

      expectError(400, 'Please provide email and password');
      expect(User.findOne).not.toHaveBeenCalled();
    });

    test('401 if user does not exist', async () => {
      req.body = { email: 'nobody@example.com', password: 'password123' };
      mockFindOneWith(null);

      await loginUser(req, res, next);

      expectError(401, 'Invalid email or password');
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    test('401 if password is wrong', async () => {
      req.body = { email: 'jane@example.com', password: 'wrongpass' };
      mockFindOneWith({ _id: 'u1', email: 'jane@example.com', password: 'hashed' });
      bcrypt.compare.mockResolvedValue(false);

      await loginUser(req, res, next);

      expect(bcrypt.compare).toHaveBeenCalledWith('wrongpass', 'hashed');
      expectError(401, 'Invalid email or password');
    });

    test('200 with user data and token on valid credentials', async () => {
      req.body = { email: 'jane@example.com', password: 'securePassword123' };
      const select = mockFindOneWith({
        _id: 'u1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'customer',
        password: 'hashed',
      });
      bcrypt.compare.mockResolvedValue(true);

      await loginUser(req, res, next);

      expect(User.findOne).toHaveBeenCalledWith({ email: 'jane@example.com' });
      expect(select).toHaveBeenCalledWith('+password'); // password select:false hai
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        _id: 'u1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'customer',
        token: 'mock_token',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});s