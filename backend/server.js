// ---------- imports ----------
// dotenv sabse pehle load hona chahiye, warna controllers ke import-time env reads (Razorpay keys) undefined rahenge
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { apiLimiter, authLimiter } from './middleware/rateLimiter.js';


// config
import connectDB from './config/db.js';

// middleware
import { notFound, errorHandler } from './middleware/errorMiddleware.js';

// routes
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes from './routes/CartRoutes.js';
import orderRoutes from './routes/orderRoutes.js';

// ---------- setup ----------
connectDB();

const app = express();
const server = http.createServer(app);


// Socket.io

is.on("connection", (client) => {})

// ---------- CORS options (Express aur Socket.IO dono ke liye ek hi) ----------
// .env mein CLIENT_URL=http://localhost:3000 (React ka address)
// Alag-alag origins ho toh comma se alag karo: http://localhost:3000,http://localhost:5173
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// ---------- global middleware ----------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // sirf tab jab CSP se kuch toot raha ho
  })
);
app.use(cors(corsOptions));
app.use(express.json());
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

// ---------- Socket.IO ----------
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// har HTTP request handler mein req.io milega
app.use((req, res, next) => {
  req.io = io;
  next();
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ---------- health check (error middleware se PEHLE) ----------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is healthy' });
});

// ---------- API routes ----------
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);

// ---------- centralized error handling (hamesha sabse last) ----------
app.use(notFound);     // unmapped routes ko 404 deta hai
app.use(errorHandler); // asyncHandler se aaye saare errors yahan pakde jaate hain

// ---------- start ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});