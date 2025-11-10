import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import RoomManager from './roomManager.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const httpServer = createServer(app);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO setup
const io = new Server(httpServer, {
  cors: corsOptions,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Initialize room manager
const roomManager = new RoomManager();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: roomManager.getRoomCount(),
    connections: io.engine.clientsCount
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`New connection: ${socket.id}`);
  
  let currentRoom = null;
  let currentUser = null;

  // Handle user joining a room
  socket.on('join-room', (data) => {
    try {
      const { username, room = 'default' } = data;
      
      // Leave previous room if exists
      if (currentRoom) {
        roomManager.removeUser(currentRoom, socket.id);
        socket.leave(currentRoom);
      }

      // Join new room
      currentRoom = room;
      socket.join(room);
      
      // Add user to room (this assigns the display/cursor color)
      currentUser = roomManager.addUser(room, socket.id, username || `User${socket.id.slice(0, 4)}`);
      
      // Send current state to joining user
      const roomState = roomManager.getRoomState(room);
      socket.emit('room-state', {
        user: currentUser,
        operations: roomState.operations,
        users: roomState.users
      });

      // Notify others in room (they'll get the user's assigned color via user object / cursor events)
      socket.to(room).emit('user-joined', currentUser);
      
      logger.info(`User ${currentUser.username} joined room ${room}`);
    } catch (error) {
      logger.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle drawing start
  socket.on('draw-start', (data) => {
    try {
      if (!currentRoom) return;

      // Start operation (uses data.color which is the drawer's chosen drawing color)
      const operation = roomManager.startOperation(currentRoom, socket.id, data);
      
      // Send operation ID back to the sender so they can use it
      socket.emit('operation-started', {
        operationId: operation.operationId
      });
      
      // Broadcast to others: important — use data.color (the user's chosen drawing color) for strokes,
      // not the user's assigned display/cursor color.
      socket.to(currentRoom).emit('remote-draw-start', {
        userId: socket.id,
        username: currentUser.username,
        color: data.color,
        width: data.width,
        tool: data.tool,
        operationId: operation.operationId,
        x: data.x,
        y: data.y
      });
    } catch (error) {
      logger.error('Error in draw-start:', error);
    }
  });

  // Handle drawing move
  socket.on('draw-move', (data) => {
    try {
      if (!currentRoom) return;

      roomManager.addPoints(currentRoom, data.operationId, data.points);
      socket.to(currentRoom).emit('remote-draw-move', {
        userId: socket.id,
        operationId: data.operationId,
        points: data.points
      });
    } catch (error) {
      logger.error('Error in draw-move:', error);
    }
  });

  // Handle drawing end
  socket.on('draw-end', (data) => {
    try {
      if (!currentRoom) return;

      roomManager.endOperation(currentRoom, data.operationId);
      socket.to(currentRoom).emit('remote-draw-end', {
        userId: socket.id,
        operationId: data.operationId
      });

      // After finalizing an operation, broadcast updated operations to all clients in the room
      // so their authoritative canvas state stays consistent.
      const roomState = roomManager.getRoomState(currentRoom);
      io.to(currentRoom).emit('operations-updated', {
        operations: roomState.operations
      });
    } catch (error) {
      logger.error('Error in draw-end:', error);
    }
  });

  // Handle undo
  socket.on('undo', () => {
    try {
      if (!currentRoom) return;

      const undoneOperation = roomManager.undo(currentRoom);
      if (undoneOperation) {
        // Broadcast authoritative operations list to all clients in room
        const roomState = roomManager.getRoomState(currentRoom);
        io.to(currentRoom).emit('operations-updated', {
          operations: roomState.operations
        });
      }
    } catch (error) {
      logger.error('Error in undo:', error);
    }
  });

  // Handle redo
  socket.on('redo', () => {
    try {
      if (!currentRoom) return;

      const redoneOperation = roomManager.redo(currentRoom);
      if (redoneOperation) {
        const roomState = roomManager.getRoomState(currentRoom);
        io.to(currentRoom).emit('operations-updated', {
          operations: roomState.operations
        });
      }
    } catch (error) {
      logger.error('Error in redo:', error);
    }
  });

  // Handle cursor movement
  socket.on('cursor-move', (data) => {
    try {
      if (!currentRoom || !currentUser) return;

      // Broadcast cursor using the user's assigned display color (from roomManager)
      socket.to(currentRoom).emit('remote-cursor', {
        userId: socket.id,
        username: currentUser.username,
        color: currentUser.color,
        x: data.x,
        y: data.y
      });
    } catch (error) {
      logger.error('Error in cursor-move:', error);
    }
  });

  // Handle clear canvas
  socket.on('clear-canvas', () => {
    try {
      if (!currentRoom) return;

      roomManager.clearCanvas(currentRoom);

      // Broadcast cleared canvas and updated operations list
      io.to(currentRoom).emit('canvas-cleared', {
        userId: socket.id
      });

      io.to(currentRoom).emit('operations-updated', {
        operations: []
      });
    } catch (error) {
      logger.error('Error in clear-canvas:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    try {
      if (currentRoom && currentUser) {
        roomManager.removeUser(currentRoom, socket.id);
        socket.to(currentRoom).emit('user-left', {
          userId: socket.id,
          username: currentUser.username
        });
        logger.info(`User ${currentUser.username} left room ${currentRoom}`);
      }
    } catch (error) {
      logger.error('Error in disconnect:', error);
    }
  });
});

// Start server
const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
