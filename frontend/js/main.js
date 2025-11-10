// Entry point that wires Canvas, UI, and WebSocket together.
// SERVER_URL should point to your Socket.IO backend.
const SERVER_URL = 'https://realtimecollaborativedrawingcanvas.onrender.com';

class CollaborativeCanvas {
  constructor() {
    // App composition: create subsystems and connect them
    console.log('🎨 Initializing Collaborative Canvas...');

    this.canvas = new CanvasManager();
    this.websocket = new WebSocketManager();
    this.ui = null;

    this.setupCanvasWebSocketIntegration();
    this.websocket.connect(SERVER_URL);
    this.setupWebSocketHandlers();
  }

  setupCanvasWebSocketIntegration() {
    // Canvas → WebSocket: forward local drawing lifecycle to server
    this.canvas.onDrawStart = (data) => {
      this.websocket.sendDrawStart({
        x: data.x,
        y: data.y,
        color: data.color || this.canvas.currentColor,
        width: data.width || this.canvas.currentWidth,
        tool: data.tool || this.canvas.currentTool
      });
    };

    // Stream batched points while drawing
    this.canvas.onDrawMove = (data) => {
      this.websocket.sendDrawMove(data);
    };

    // Finalize operation on release
    this.canvas.onDrawEnd = (data) => {
      this.websocket.sendDrawEnd(data);
    };

    // Lightweight cursor streaming for presence
    this.canvas.onCursorMove = (data) => {
      this.websocket.sendCursorMove(data.x, data.y);
    };
  }

  setupWebSocketHandlers() {
    this.websocket.onOperationStarted = (operationId) => {
      console.log('✅ Operation started:', operationId);
      this.canvas.setOperationId(operationId);
    };

    // Authoritative room state from server after joining/reconnecting
    this.websocket.onRoomState = (data) => {
      console.log('📦 Room state received:', data);

      if (!this.ui) {
        this.ui = new UIManager(this.canvas, this.websocket);
      }

      this.canvas.redrawOperations(data.operations || []);
      this.ui.updateUsersList(data.users || []);
    };

    // Server is the source of truth for operations (undo/redo/clear)
    this.websocket.onOperationsUpdated = (operations) => {
      console.log('🔁 Received operations-updated:', operations);
      this.websocket.operations = operations || [];
      this.canvas.redrawOperations(this.websocket.operations);
    };

    this.websocket.onUserJoined = (user) => {
      console.log('👋 User joined:', user);
      if (this.ui) this.ui.addUser(user);
    };

    this.websocket.onUserLeft = (data) => {
      console.log('🚪 User left:', data);
      if (this.ui) this.ui.removeUser(data.userId, data.username);
      this.canvas.hideRemoteCursor(data.userId);
    };

    // Start incremental rendering for an in-progress remote operation
    this.websocket.onRemoteDrawStart = (data) => {
      console.log('🎨 Remote draw start:', data);
      const operation = this.websocket.remoteOperations.get(data.operationId);
      
      if (operation && operation.points && operation.points.length > 0) {
        this.canvas.drawRemoteOperationIncremental(data.operationId, operation);
      }
    };

    // On new points from a remote user, draw only the delta
    this.websocket.onRemoteDrawMove = (data) => {
      const operation = this.websocket.remoteOperations.get(data.operationId);
      
      if (!operation) {
        console.warn('⚠️ Operation not found:', data.operationId);
        return;
      }

      this.canvas.drawRemoteOperationIncremental(data.operationId, operation);
    };

    // Finish and stop tracking remote operation
    this.websocket.onRemoteDrawEnd = (data) => {
      console.log('🖌️ Remote drawing ended:', data.operationId);
      
      this.canvas.finalizeRemoteOperation(data.operationId);
    };

    // Presence: show remote user cursor with name/color
    this.websocket.onRemoteCursor = (data) => {
      this.canvas.showRemoteCursor(
        data.userId,
        data.username,
        data.color,
        data.x,
        data.y
      );
    };

    this.websocket.onCanvasCleared = () => {
      console.log('🧹 Canvas cleared');
      this.canvas.clear();
    };

    this.websocket.onDisconnect = () => {
      console.warn('⚠️ Disconnected from server');
      this.canvas.hideAllRemoteCursors();
      
      if (this.ui) {
        this.ui.showNotification('Disconnected from server. Reconnecting...', 'warning');
      }
    };

    this.websocket.onReconnect = () => {
      console.log('✅ Reconnected to server');
      
      if (this.ui) {
        this.ui.showNotification('Reconnected to server', 'success');
      }
    };

    // Show user-friendly errors
    this.websocket.onError = (error) => {
      console.error('❌ WebSocket error:', error);
      
      if (this.ui) {
        this.ui.showError(error.message || 'An unexpected error occurred');
      }
    };
  }

  start() {
    // Defer UI initialization until socket is connected
    console.log('🚀 Starting Collaborative Canvas...');

    const checkConnection = setInterval(() => {
      if (this.websocket.isConnected) {
        clearInterval(checkConnection);

        if (!this.ui) {
          this.ui = new UIManager(this.canvas, this.websocket);
        }

        this.ui.setupWelcomeModal((username, room) => {
          console.log(`📍 Joining room "${room}" as "${username}"`);
          this.websocket.joinRoom(username, room);
        });
      }
    }, 100);

    setTimeout(() => {
      if (!this.websocket.isConnected) {
        clearInterval(checkConnection);
        console.error('❌ Connection timeout');
        alert('Failed to connect to server. Please check if the server is running.');
      }
    }, 5000);
  }
}

// Bootstrap after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new CollaborativeCanvas();
  app.start();
});
