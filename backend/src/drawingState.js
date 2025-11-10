import { logger } from './utils/logger.js';

class DrawingState {
  constructor() {
    this.operations = []; // All operations (active and undone)
    this.currentIndex = -1; // Index of last active operation
    this.activeOperations = new Map(); // operationId -> operation (for in-progress operations)
  }

  // Start a new operation
  startOperation(data) {
    const operationId = `op-${data.userId}-${Date.now()}`;
    
    const operation = {
      id: operationId,
      userId: data.userId,
      username: data.username,
      type: data.tool,
      color: data.color,
      width: data.width,
      points: [{ x: data.x, y: data.y }],
      timestamp: Date.now(),
      status: 'in-progress'
    };
    
    this.activeOperations.set(operationId, operation);
    
    return {
      operationId,
      x: data.x,
      y: data.y,
      color: data.color,
      width: data.width,
      tool: data.tool
    };
  }

  // Add points to an operation
  addPoints(operationId, points) {
    // First check active operations
    let operation = this.activeOperations.get(operationId);
    
    // If not in active operations, check if it was recently finalized
    if (!operation) {
      // Look for the operation in the completed operations array
      operation = this.operations.find(op => op.id === operationId);
      
      if (operation && operation.status === 'active') {
        // Operation was already finalized, but we can still add late-arriving points
        logger.debug(`Adding late points to finalized operation ${operationId}`);
        operation.points.push(...points);
        return;
      }
      
      logger.warn(`Operation ${operationId} not found in active operations`);
      return;
    }
    
    operation.points.push(...points);
  }

  // End an operation (finalize it)
  endOperation(operationId) {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      // Check if it's already been finalized
      const existingOp = this.operations.find(op => op.id === operationId);
      if (existingOp) {
        logger.debug(`Operation ${operationId} already finalized`);
        return;
      }
      
      logger.warn(`Operation ${operationId} not found`);
      return;
    }
    
    operation.status = 'active';
    
    // Remove any undone operations after current index
    this.operations = this.operations.slice(0, this.currentIndex + 1);
    
    // Add the new operation
    this.operations.push(operation);
    this.currentIndex++;
    
    // Remove from active operations
    this.activeOperations.delete(operationId);
    
    logger.debug(`Operation ${operationId} completed. Total operations: ${this.operations.length}`);
  }

  // Undo the last active operation
  undo() {
    if (this.currentIndex < 0) {
      logger.debug('Nothing to undo');
      return null;
    }
    
    // Find the last active operation
    while (this.currentIndex >= 0) {
      const operation = this.operations[this.currentIndex];
      if (operation.status === 'active') {
        operation.status = 'undone';
        this.currentIndex--;
        logger.debug(`Undone operation ${operation.id}`);
        return operation;
      }
      this.currentIndex--;
    }
    
    return null;
  }

  // Redo the next undone operation
  redo() {
    if (this.currentIndex >= this.operations.length - 1) {
      logger.debug('Nothing to redo');
      return null;
    }
    
    // Find the next undone operation
    for (let i = this.currentIndex + 1; i < this.operations.length; i++) {
      const operation = this.operations[i];
      if (operation.status === 'undone') {
        operation.status = 'active';
        this.currentIndex = i;
        logger.debug(`Redone operation ${operation.id}`);
        return operation;
      }
    }
    
    return null;
  }

  // Get all active operations
  getActiveOperations() {
    return this.operations
      .filter(op => op.status === 'active')
      .map(op => ({
        id: op.id,
        userId: op.userId,
        username: op.username,
        type: op.type,
        color: op.color,
        width: op.width,
        points: op.points,
        timestamp: op.timestamp
      }));
  }

  // Clear all operations
  clear() {
    this.operations = [];
    this.currentIndex = -1;
    this.activeOperations.clear();
    logger.debug('Canvas cleared');
  }

  // Get operation count
  getOperationCount() {
    return this.operations.length;
  }

  // Get active operation count
  getActiveOperationCount() {
    return this.operations.filter(op => op.status === 'active').length;
  }
}

export default DrawingState;