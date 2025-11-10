// Manages Socket.IO connection, reconnection, and event routing.
// Emits drawing/cursor/control events and exposes callbacks for the app to hook into.
const io = window.io;

class WebSocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.currentUser = null;
    this.currentRoom = null;
    this.currentUsername = null;
    this.operations = [];
    this.remoteOperations = new Map();
    
    this.lastCursorSend = 0;
    this.cursorThrottle = 33; // 30fps
    
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect(serverUrl = 'https://realtimecollaborativedrawingcanvas.onrender.com') {
    // Create Socket.IO client; enable reconnection with backoff
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Connection lifecycle
    this.socket.on('connect', () => {
      console.log('✅ Connected to server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
      
      // Rejoin room if we were in one
      if (this.currentRoom && this.currentUsername) {
        console.log('🔄 Rejoining room after reconnection...');
        this.joinRoom(this.currentUsername, this.currentRoom);
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('⚠️ Disconnected from server:', reason);
      this.isConnected = false;
      this.updateConnectionStatus(false);
      
      if (this.onDisconnect) {
        this.onDisconnect();
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts`);
      
      if (this.onReconnect) {
        this.onReconnect();
      }
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}...`);
      this.reconnectAttempts = attemptNumber;
    });

    this.socket.on('reconnect_failed', () => {
      console.error('❌ Reconnection failed');
      this.updateConnectionStatus(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error.message);
      this.updateConnectionStatus(false);
    });

    // Room state and membership
    this.socket.on('room-state', (data) => {
      console.log('📦 Received room state:', data);
      this.currentUser = data.user;
      this.operations = data.operations || [];
      
      if (this.onRoomState) {
        this.onRoomState(data);
      }
    });

    this.socket.on('user-joined', (user) => {
      console.log('👋 User joined:', user);
      if (this.onUserJoined) {
        this.onUserJoined(user);
      }
    });

    this.socket.on('user-left', (data) => {
      console.log('🚪 User left:', data);
      if (this.onUserLeft) {
        this.onUserLeft(data);
      }
    });

    // Drawing lifecycle (authoritative state lives on the server)
    this.socket.on('operation-started', (data) => {
      console.log('✅ Operation started:', data.operationId);
      if (this.onOperationStarted) {
        this.onOperationStarted(data.operationId);
      }
    });

    this.socket.on('remote-draw-start', (data) => {
      console.log('🎨 Remote draw start:', data);
      
      this.remoteOperations.set(data.operationId, {
        id: data.operationId,
        userId: data.userId,
        username: data.username,
        type: data.tool,
        color: data.color,
        width: data.width,
        points: [{ x: data.x, y: data.y }]
      });
      
      if (this.onRemoteDrawStart) {
        this.onRemoteDrawStart(data);
      }
    });

    this.socket.on('remote-draw-move', (data) => {
      // Add points to remote operation incrementally
      const operation = this.remoteOperations.get(data.operationId);
      if (operation) {
        operation.points.push(...data.points);
        
        if (this.onRemoteDrawMove) {
          this.onRemoteDrawMove(data);
        }
      }
    });

    this.socket.on('remote-draw-end', (data) => {
      console.log('🖌️ Remote draw end:', data);
      
      // Finalize remote operation: move it into operations list
      const operation = this.remoteOperations.get(data.operationId);
      if (operation) {
        this.operations.push(operation);
        this.remoteOperations.delete(data.operationId);
      }
      
      if (this.onRemoteDrawEnd) {
        this.onRemoteDrawEnd(data);
      }
    });

    // Authoritative operations update (used for undo/redo/clear/finalize)
    this.socket.on('operations-updated', (data) => {
      console.log('🔁 Operations updated (authoritative):', data);
      this.operations = data.operations || [];
      
      if (this.onOperationsUpdated) {
        this.onOperationsUpdated(this.operations);
      }
    });

    this.socket.on('operation-undone', (data) => {
      console.log('↩️ Operation undone:', data);
      if (this.onOperationUndone) this.onOperationUndone(data);
    });

    this.socket.on('operation-redone', (data) => {
      console.log('↪️ Operation redone:', data);
      if (this.onOperationRedone) this.onOperationRedone(data);
    });

    // Cursor updates for real-time presence
    this.socket.on('remote-cursor', (data) => {
      if (this.onRemoteCursor) {
        this.onRemoteCursor(data);
      }
    });

    // Global clear
    this.socket.on('canvas-cleared', (data) => {
      console.log('🧹 Canvas cleared:', data);
      this.operations = [];
      this.remoteOperations.clear();
      
      if (this.onCanvasCleared) {
        this.onCanvasCleared(data);
      }
    });

    // Error reporting
    this.socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
      if (this.onError) {
        this.onError(error);
      }
    });
  }

  joinRoom(username, room = 'default') {
    if (!this.socket) {
      console.error('❌ Socket not initialized');
      return;
    }

    this.currentUsername = username;
    this.currentRoom = room;
    
    this.socket.emit('join-room', { username, room });
  }

  sendDrawStart(data) {
    if (!this.isConnected) {
      console.warn('⚠️ Not connected, cannot send draw-start');
      return;
    }
    this.socket.emit('draw-start', data);
  }

  sendDrawMove(data) {
    if (!this.isConnected) {
      console.warn('⚠️ Not connected, cannot send draw-move');
      return;
    }
    this.socket.emit('draw-move', data);
  }

  sendDrawEnd(data) {
    if (!this.isConnected) {
      console.warn('⚠️ Not connected, cannot send draw-end');
      return;
    }
    this.socket.emit('draw-end', data);
  }

  sendUndo() {
    if (!this.isConnected) {
      console.warn('⚠️ Not connected, cannot send undo');
      return;
    }
    this.socket.emit('undo');
  }

  sendRedo() {
    if (!this.isConnected) {
      console.warn('⚠️ Not connected, cannot send redo');
      return;
    }
    this.socket.emit('redo');
  }

  sendCursorMove(x, y) {
    if (!this.isConnected) return;
    
    // Throttle cursor emits to avoid flooding the server
    const now = Date.now();
    if (now - this.lastCursorSend >= this.cursorThrottle) {
      this.socket.emit('cursor-move', { x, y });
      this.lastCursorSend = now;
    }
  }

  sendClearCanvas() {
    if (!this.isConnected) {
      console.warn('⚠️ Not connected, cannot clear canvas');
      return;
    }
    this.socket.emit('clear-canvas');
  }

  updateConnectionStatus(connected) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (statusDot && statusText) {
      if (connected) {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
      } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        
        if (this.reconnectAttempts > 0) {
          statusText.textContent = `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
        } else {
          statusText.textContent = 'Disconnected';
        }
      }
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

window.WebSocketManager = WebSocketManager;
