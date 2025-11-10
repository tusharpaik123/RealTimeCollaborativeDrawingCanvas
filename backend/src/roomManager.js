import DrawingState from './drawingState.js';
import { logger } from './utils/logger.js';

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> { drawingState, users }
    this.userColors = [
      '#3b82f6', // blue
      '#ef4444', // red
      '#10b981', // green
      '#f59e0b', // amber
      '#8b5cf6', // violet
      '#ec4899', // pink
      '#14b8a6', // teal
      '#f97316', // orange
    ];
  }

  // Get or create a room
  getRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        drawingState: new DrawingState(),
        users: new Map(), // userId -> user data
        colorIndex: 0
      });
      logger.info(`Created new room: ${roomId}`);
    }
    return this.rooms.get(roomId);
  }

  // Add user to room
  addUser(roomId, userId, username) {
    const room = this.getRoom(roomId);
    
    // Assign color to user
    const color = this.userColors[room.colorIndex % this.userColors.length];
    room.colorIndex++;
    
    const user = {
      id: userId,
      username,
      color,
      joinedAt: Date.now()
    };
    
    room.users.set(userId, user);
    logger.info(`User ${username} (${userId}) added to room ${roomId}`);
    
    return user;
  }

  // Remove user from room
  removeUser(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.users.delete(userId);
    
    // Clean up empty rooms
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
      logger.info(`Room ${roomId} deleted (no users)`);
    }
  }

  // Get room state
  getRoomState(roomId) {
    const room = this.getRoom(roomId);
    return {
      operations: room.drawingState.getActiveOperations(),
      users: Array.from(room.users.values())
    };
  }

  // Start a new drawing operation
  startOperation(roomId, userId, data) {
    const room = this.getRoom(roomId);
    const user = room.users.get(userId);
    
    const operation = room.drawingState.startOperation({
      userId,
      username: user.username,
      x: data.x,
      y: data.y,
      color: data.color,
      width: data.width,
      tool: data.tool
    });
    
    return operation;
  }

  // Add points to an operation
  addPoints(roomId, operationId, points) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.drawingState.addPoints(operationId, points);
  }

  // End an operation
  endOperation(roomId, operationId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.drawingState.endOperation(operationId);
  }

  // Undo last operation
  undo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    return room.drawingState.undo();
  }

  // Redo last undone operation
  redo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    return room.drawingState.redo();
  }

  // Clear canvas
  clearCanvas(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.drawingState.clear();
  }

  // Get room count
  getRoomCount() {
    return this.rooms.size;
  }

  // Get user count in room
  getUserCount(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.users.size : 0;
  }
}

export default RoomManager;