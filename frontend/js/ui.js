// Handles toolbar interactions, keyboard shortcuts, users list, and notifications.
class UIManager {
  constructor(canvas, websocket) {
    this.canvas = canvas;
    this.websocket = websocket;
    this.users = new Map();
    
    this.setupToolListeners();
    this.setupActionListeners();
    this.setupKeyboardShortcuts();
    this.createNotificationContainer();
  }

  createNotificationContainer() {
    // Ensure a single container exists for transient notifications
    if (!document.getElementById('notificationContainer')) {
      const container = document.createElement('div');
      container.id = 'notificationContainer';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
  }

  setupToolListeners() {
    // Tool selection updates active state and current tool
    const toolButtons = document.querySelectorAll('.tool-btn');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const tool = btn.dataset.tool;
        this.canvas.setTool(tool);
        this.showNotification(`Switched to ${tool}`, 'info', 1000);
      });
    });

    const colorPicker = document.getElementById('colorPicker');
    colorPicker.addEventListener('input', (e) => {
      this.canvas.setColor(e.target.value);
    });

    const colorButtons = document.querySelectorAll('.color-btn');
    colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        this.canvas.setColor(color);
        colorPicker.value = color;
      });
    });

    const widthSlider = document.getElementById('widthSlider');
    const widthValue = document.getElementById('widthValue');
    widthSlider.addEventListener('input', (e) => {
      const width = parseInt(e.target.value);
      this.canvas.setWidth(width);
      widthValue.textContent = width;
    });
  }

  setupActionListeners() {
    // Undo/Redo/Clear actions send commands to server
    document.getElementById('undoBtn').addEventListener('click', () => {
      this.websocket.sendUndo();
    });

    document.getElementById('redoBtn').addEventListener('click', () => {
      this.websocket.sendRedo();
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      if (confirm('Clear canvas for all users? This cannot be undone.')) {
        this.websocket.sendClearCanvas();
        this.showNotification('Canvas cleared', 'success');
      }
    });
  }

  setupKeyboardShortcuts() {
    // Global shortcuts (ignored while typing in inputs)
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.websocket.sendUndo();
      }
      
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') || 
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        this.websocket.sendRedo();
      }
      
      // Common tool quick keys
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        document.querySelector('[data-tool="brush"]').click();
      }
      
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        document.querySelector('[data-tool="eraser"]').click();
      }
    });
  }

  showWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    modal.classList.remove('hidden');
  }

  hideWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    modal.classList.add('hidden');
  }

  setupWelcomeModal(onJoin) {
    // Captures username and optional room, sanitizes, updates UI and URL
    this.showWelcomeModal();
    
    const joinBtn = document.getElementById('joinBtn');
    const usernameInput = document.getElementById('usernameInput');
    const roomInput = document.getElementById('roomInput');
    
    // Auto-fill room from URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      roomInput.value = roomFromUrl;
    }
    
    usernameInput.focus();
    
    const handleJoin = () => {
      const username = usernameInput.value.trim();
      const room = roomInput.value.trim() || 'default';
      
      if (!username) {
        alert('Please enter your name');
        usernameInput.focus();
        return;
      }
      
      // Sanitize inputs
      const sanitizedUsername = username.substring(0, 20);
      const sanitizedRoom = room.substring(0, 30).replace(/[^a-zA-Z0-9-_]/g, '');
      
      this.hideWelcomeModal();
      onJoin(sanitizedUsername, sanitizedRoom);
      
      // Update UI
      document.getElementById('roomName').textContent = sanitizedRoom;
      
      // Update URL
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('room', sanitizedRoom);
      window.history.pushState({}, '', newUrl);
    };

    joinBtn.addEventListener('click', handleJoin);

    [usernameInput, roomInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleJoin();
        }
      });
    });
  }

  updateUsersList(users) {
    // Shows other users in the room (excludes the current user)
    const usersList = document.getElementById('usersList');
    const userCount = document.getElementById('userCount');
    
    users.forEach(user => {
      this.users.set(user.id, user);
    });
    
    const otherUsers = users.filter(u => u.id !== this.websocket.currentUser?.id);
    
    userCount.textContent = otherUsers.length;
    
    if (otherUsers.length === 0) {
      usersList.innerHTML = '<div class="no-users">No other users online</div>';
    } else {
      usersList.innerHTML = otherUsers.map(user => `
        <div class="user-item">
          <div class="user-color" style="background-color: ${user.color}"></div>
          <div class="user-name">${this.escapeHtml(user.username)}</div>
        </div>
      `).join('');
    }
  }

  addUser(user) {
    this.users.set(user.id, user);
    
    const users = Array.from(this.users.values());
    this.updateUsersList(users);
    
    this.showNotification(`${this.escapeHtml(user.username)} joined`, 'info');
  }

  removeUser(userId, username) {
    this.users.delete(userId);
    
    const users = Array.from(this.users.values());
    this.updateUsersList(users);
    
    this.canvas.hideRemoteCursor(userId);
    
    this.showNotification(`${this.escapeHtml(username)} left`, 'info');
  }

  showNotification(message, type = 'info', duration = 3000) {
    // Lightweight toast with click-to-dismiss and auto-dismiss
    const container = document.getElementById('notificationContainer');
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
      background: ${this.getNotificationColor(type)};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 14px;
      font-weight: 500;
      pointer-events: auto;
      cursor: pointer;
      animation: slideIn 0.3s ease-out;
      max-width: 300px;
      word-wrap: break-word;
    `;
    
    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    
    notification.innerHTML = `${icons[type] || ''} ${this.escapeHtml(message)}`;
    
    notification.addEventListener('click', () => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    });
    
    container.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
      }
    }, duration);
    
    if (!document.getElementById('notificationStyles')) {
      // Inject animation keyframes once
      const style = document.createElement('style');
      style.id = 'notificationStyles';
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(400px);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  getNotificationColor(type) {
    const colors = {
      info: '#3b82f6',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444'
    };
    return colors[type] || colors.info;
  }

  showError(message) {
    this.showNotification(message, 'error', 5000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

window.UIManager = UIManager;