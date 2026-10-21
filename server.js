const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const cors = require('cors');
const dotev = require('dotev');
const connectDB = require('./config/db');

dotev.config();
 connectDB();

 // CORS and Body Parser Middleware

 const app = express();
 const server = http.createServer(app);

 // Initialize Socket.IO

 const io = new Server(server, {

    cors: {

        origin: '*',
        methods:['GET' , 'POST'],
    },
 });

 // Pass 'io' instance to root via the middleware 
 
 app.use((req,res,next) => {
    req.io = io;
    next();

 });

 // Socket.IO Connection handler

 io.on('connection', (socket) => {

    console.log('Client connected: ${socket.id}');

    socket.on('disconnect', () => {

        console.log('Client disconnected: ${socket.id}');
    });
 });

 // Health check route

 app.get('health',(req,res) => {
    res.status(200).json({status: 'OK', message: 'Server is healthy' });
 });

 const Port = process.env.PORT || 5000;
 server.listen(PORT, () => {

    console.log('Server running on port ${PORT}');
 });
