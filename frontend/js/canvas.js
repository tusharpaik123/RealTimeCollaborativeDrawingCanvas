// Handles all local drawing logic and rendering on a HiDPI-aware <canvas>.
// Also manages in-progress remote drawings for incremental rendering.
class CanvasManager {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d', { 
      willReadFrequently: false,
      alpha: false 
    });
    
    this.isDrawing = false;
    this.currentTool = 'brush';
    this.currentColor = '#3b82f6';
    this.currentWidth = 5;
    
    this.currentOperation = null;
    this.pointBuffer = [];
    this.lastBatchTime = 0;
    // Batch outgoing points roughly at 60fps to reduce network chatter
    this.batchInterval = 16;
    this.pendingPoints = [];
    
    this.remoteOperations = new Map();
    
    this.remoteCursors = new Map();

    this._savedImageData = null;
    this._shapeStart = null;
    
    // Initialize size and listeners
    this.resizeCanvas();
    this.setupEventListeners();
    
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  setupEventListeners() {
    // Mouse/touch event translation keeps input unified across devices
    window.addEventListener('resize', () => this.resizeCanvas());
    
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDrawing) {
        this.draw(e);
      }
      this.updateCursor(e);
    }, { passive: true });
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseleave', () => this.stopDrawing());
    
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
    }, { passive: false });
    
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
    }, { passive: false });
    
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.canvas.dispatchEvent(new MouseEvent('mouseup'));
    }, { passive: false });
  }

  resizeCanvas() {
    // Make canvas crisp on HiDPI screens by scaling backing store by devicePixelRatio
    const container = this.canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;
    
    let imageData = null;
    if (this.canvas.width && this.canvas.height) {
      try {
        imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      } catch (e) {
        imageData = null;
      }
    }
    
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = cssWidth + 'px';
    this.canvas.style.height = cssHeight + 'px';
    
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Only restore image when sizes match exactly to avoid distortion
    if (imageData && imageData.width === this.canvas.width && imageData.height === this.canvas.height) {
      try {
        this.ctx.putImageData(imageData, 0, 0);
      } catch (e) {
      }
    }

    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  getCanvasCoordinates(e) {
    // Convert client coordinates to CSS pixel coordinates within canvas box
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top)
    };
  }

  startDrawing(e) {
    this.isDrawing = true;
    const { x, y } = this.getCanvasCoordinates(e);
    
    if (this.currentTool === 'line' || this.currentTool === 'rect' || this.currentTool === 'circle') {
      // For shapes we preview on mousemove and finalize on mouseup
      try {
        this._savedImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      } catch (err) {
        this._savedImageData = null;
      }
      this._shapeStart = { x, y };

      this.currentOperation = {
        id: null,
        tool: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        points: [{ x, y }]
      };

      if (this.onDrawStart) {
        this.onDrawStart({
          x, y,
          color: this.currentOperation.color,
          width: this.currentOperation.width,
          tool: this.currentOperation.tool
        });
      }

      this.pendingPoints = [];
      return;
    }

    const toolIsEraser = this.currentTool === 'eraser';
    this.currentOperation = {
      id: null,
      tool: this.currentTool,
      color: toolIsEraser ? '#ffffff' : this.currentColor,
      width: this.currentWidth,
      points: [{ x, y }]
    };
    
    this.drawPoint(x, y, this.currentOperation.color, this.currentOperation.width);
    
    this.pointBuffer = [];
    this.pendingPoints = [];
    this.lastBatchTime = Date.now();
    
    if (this.onDrawStart) {
      this.onDrawStart({
        x, y,
        color: this.currentOperation.color,
        width: this.currentOperation.width,
        tool: this.currentOperation.tool
      });
    }
  }

  setOperationId(operationId) {
    if (this.currentOperation) {
      this.currentOperation.id = operationId;
      
      if (this.pendingPoints.length > 0 && this.onDrawMove) {
        this.onDrawMove({
          operationId: operationId,
          points: [...this.pendingPoints]
        });
        this.pendingPoints = [];
      }
    }
  }

  draw(e) {
    if (!this.isDrawing) return;
    
    const { x, y } = this.getCanvasCoordinates(e);

    if (this.currentTool === 'line' || this.currentTool === 'rect' || this.currentTool === 'circle') {
      if (this._savedImageData) {
        try {
          this.ctx.putImageData(this._savedImageData, 0, 0);
        } catch (err) {
        }
      } else {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, rect.width, rect.height);
      }

      this.drawShapePreview(this._shapeStart.x, this._shapeStart.y, x, y, this.currentTool, this.currentColor, this.currentWidth);
      return;
    }

    if (!this.currentOperation || !this.currentOperation.points) return;

    const lastPoint = this.currentOperation.points[this.currentOperation.points.length - 1];
    const dx = x - lastPoint.x;
    const dy = y - lastPoint.y;
    const distance = Math.sqrt(dx*dx + dy*dy);
    if (distance < 1) return;

    this.currentOperation.points.push({ x, y });
    
    this.drawLine(lastPoint, { x, y }, this.currentOperation.color, this.currentOperation.width);
    
    this.pointBuffer.push({ x, y });
    
    // Send point batches at most ~60fps for efficiency
    const now = Date.now();
    if (now - this.lastBatchTime >= this.batchInterval && this.pointBuffer.length > 0) {
      if (this.currentOperation.id) {
        if (this.onDrawMove) {
          this.onDrawMove({
            operationId: this.currentOperation.id,
            points: [...this.pointBuffer]
          });
        }
        this.pointBuffer = [];
      } else {
        this.pendingPoints.push(...this.pointBuffer);
        this.pointBuffer = [];
      }
      this.lastBatchTime = now;
    }
  }

  stopDrawing() {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;

    if (this.currentTool === 'line' || this.currentTool === 'rect' || this.currentTool === 'circle') {
      // Finalize a shape using the last previewed coordinates
      const final = this._shapeLast || this._shapeStart;
      const finalPoint = { x: final.x, y: final.y };
      if (this.currentOperation && this.currentOperation.points) {
        this.currentOperation.points.push(finalPoint);
      }

      const opForDraw = {
        id: this.currentOperation.id || `local-${Date.now()}`,
        userId: this.currentOperation.userId,
        username: this.currentOperation.username,
        type: this.currentOperation.tool,
        color: this.currentOperation.color,
        width: this.currentOperation.width,
        points: [...(this.currentOperation.points || [])]
      };
      if (this._savedImageData) {
        try { this.ctx.putImageData(this._savedImageData, 0, 0); } catch (e) {}
      }
      this.drawOperation(opForDraw);

      if (this.currentOperation.id) {
        // Server already issued id → send final point and end
        if (this.onDrawMove) {
          this.onDrawMove({
            operationId: this.currentOperation.id,
            points: [finalPoint]
          });
        }
        if (this.onDrawEnd) {
          this.onDrawEnd({ operationId: this.currentOperation.id });
        }
      } else {
        // Wait briefly for operation id before sending finalization
        this.pendingPoints = [finalPoint];

        const checkForId = setInterval(() => {
          if (this.currentOperation && this.currentOperation.id) {
            clearInterval(checkForId);
            
            if (this.pendingPoints.length > 0 && this.onDrawMove) {
              this.onDrawMove({
                operationId: this.currentOperation.id,
                points: [...this.pendingPoints]
              });
            }
            
            if (this.onDrawEnd) {
              this.onDrawEnd({
                operationId: this.currentOperation.id
              });
            }
          }
        }, 10);

        setTimeout(() => clearInterval(checkForId), 1000);
      }

      this._savedImageData = null;
      this._shapeStart = null;
      this._shapeLast = null;
      this.currentOperation = null;
      this.pendingPoints = [];
      return;
    }

    // Flush any unsent points after freehand ends
    const remainingPoints = [...this.pointBuffer, ...this.pendingPoints];
    
    if (this.currentOperation && this.currentOperation.id) {
      if (remainingPoints.length > 0 && this.onDrawMove) {
        this.onDrawMove({
          operationId: this.currentOperation.id,
          points: remainingPoints
        });
      }
      
      if (this.onDrawEnd) {
        this.onDrawEnd({
          operationId: this.currentOperation.id
        });
      }
    } else {
      this.pendingPoints = remainingPoints;
      
      const checkForId = setInterval(() => {
        if (this.currentOperation && this.currentOperation.id) {
          clearInterval(checkForId);
          
          if (this.pendingPoints.length > 0 && this.onDrawMove) {
            this.onDrawMove({
              operationId: this.currentOperation.id,
              points: [...this.pendingPoints]
            });
          }
          
          if (this.onDrawEnd) {
            this.onDrawEnd({
              operationId: this.currentOperation.id
            });
          }
        }
      }, 10);
      
      setTimeout(() => clearInterval(checkForId), 1000);
    }
    
    this.pointBuffer = [];
    this.pendingPoints = [];
    this.currentOperation = null;
  }

  drawPoint(x, y, color = null, width = null) {
    const pointColor = color || (this.currentTool === 'eraser' ? '#ffffff' : this.currentColor);
    const pointWidth = width || this.currentWidth;
    
    this.ctx.fillStyle = pointColor;
    this.ctx.beginPath();
    this.ctx.arc(x, y, pointWidth / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawLine(from, to, color = null, width = null) {
    const lineColor = color || (this.currentTool === 'eraser' ? '#ffffff' : this.currentColor);
    const lineWidth = width || this.currentWidth;
    
    this.ctx.strokeStyle = lineColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
  }

  // Local-only shape preview (does not mutate the authoritative state)
  drawShapePreview(x1, y1, x2, y2, tool, color, width) {
    this._shapeLast = { x: x2, y: y2 };
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.fillStyle = color;

    if (tool === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(x1, y1, width/2, 0, Math.PI*2); this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(x2, y2, width/2, 0, Math.PI*2); this.ctx.fill();
    } else if (tool === 'rect') {
      const w = x2 - x1;
      const h = y2 - y1;
      this.ctx.beginPath();
      this.ctx.rect(x1, y1, w, h);
      this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.arc(x1, y1, Math.max(2, width/2), 0, Math.PI*2); this.ctx.fill();
    } else if (tool === 'circle') {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const r = Math.sqrt(dx*dx + dy*dy);
      this.ctx.beginPath();
      this.ctx.arc(x1, y1, r, 0, Math.PI*2);
      this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.arc(x1, y1, Math.max(2, width/2), 0, Math.PI*2); this.ctx.fill();
    }
  }

  // Draws a finalized operation (local or remote) onto the canvas
  drawOperation(operation) {
    if (!operation || !operation.points || operation.points.length === 0) return;
    
    const type = operation.type || operation.tool || 'brush';
    const color = (type === 'eraser') ? '#ffffff' : operation.color;
    const width = operation.width;

    if (type === 'brush' || type === 'eraser') {
      const pts = operation.points;
      const first = pts[0];
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(first.x, first.y, width / 2, 0, Math.PI * 2);
      this.ctx.fill();

      if (pts.length > 1) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width;
        this.ctx.beginPath();
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i-1];
          const b = pts[i];
          const xc = (a.x + b.x) / 2;
          const yc = (a.y + b.y) / 2;
          this.ctx.quadraticCurveTo(a.x, a.y, xc, yc);
        }
        const last = pts[pts.length - 1];
        this.ctx.lineTo(last.x, last.y);
        this.ctx.stroke();
      }
      return;
    }

    if (type === 'line') {
      if (operation.points.length < 2) return;
      const p0 = operation.points[0];
      const p1 = operation.points[1];
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      this.ctx.moveTo(p0.x, p0.y);
      this.ctx.lineTo(p1.x, p1.y);
      this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.arc(p0.x, p0.y, width/2, 0, Math.PI*2); this.ctx.fillStyle = color; this.ctx.fill();
      this.ctx.beginPath(); this.ctx.arc(p1.x, p1.y, width/2, 0, Math.PI*2); this.ctx.fill();
      return;
    }

    if (type === 'rect' || type === 'rectangle') {
      if (operation.points.length < 2) return;
      const p0 = operation.points[0];
      const p1 = operation.points[1];
      const w = p1.x - p0.x;
      const h = p1.y - p0.y;
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      this.ctx.rect(p0.x, p0.y, w, h);
      this.ctx.stroke();
      return;
    }

    if (type === 'circle') {
      if (operation.points.length < 2) return;
      const p0 = operation.points[0];
      const p1 = operation.points[1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const r = Math.sqrt(dx*dx + dy*dy);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      this.ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2);
      this.ctx.stroke();
      return;
    }

    const pts = operation.points;
    if (pts.length) {
      const first = pts[0];
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(first.x, first.y, width / 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  // Incrementally draws only the newest segments of a remote brush stroke
  drawRemoteOperationIncremental(operationId, operation) {
    if (!operation || !operation.points || operation.points.length === 0) return;
    
    const type = operation.type || operation.tool || 'brush';
    if (type === 'line' || type === 'rect' || type === 'rectangle' || type === 'circle') {
      if (operation.points.length >= 2) {
        this.drawOperation(operation);
      }
      return;
    }

    let tracking = this.remoteOperations.get(operationId);
    
    if (!tracking) {
      tracking = { lastDrawnIndex: -1 };
      this.remoteOperations.set(operationId, tracking);
    }
    
    const color = operation.type === 'eraser' ? '#ffffff' : operation.color;
    const width = operation.width;
    
    if (tracking.lastDrawnIndex === -1 && operation.points.length > 0) {
      const firstPoint = operation.points[0];
      this.ctx.beginPath();
      this.ctx.arc(firstPoint.x, firstPoint.y, width / 2, 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.fill();
      tracking.lastDrawnIndex = 0;
    }
    
    if (operation.points.length > tracking.lastDrawnIndex + 1) {
      this.ctx.beginPath();
      this.ctx.moveTo(
        operation.points[tracking.lastDrawnIndex].x,
        operation.points[tracking.lastDrawnIndex].y
      );
      
      for (let i = tracking.lastDrawnIndex + 1; i < operation.points.length; i++) {
        this.ctx.lineTo(operation.points[i].x, operation.points[i].y);
      }
      
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = width;
      this.ctx.stroke();
      tracking.lastDrawnIndex = operation.points.length - 1;
    }
  }

  // Stop tracking a remote operation once it is completed
  finalizeRemoteOperation(operationId) {
    this.remoteOperations.delete(operationId);
  }

  clear() {
    // Reset canvas to solid white (not transparent) for consistent visuals
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.remoteOperations.clear();
  }

  redrawOperations(operations) {
    // Full repaint using authoritative list of operations
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    operations.forEach(op => this.drawOperation(op));
  }

  setTool(tool) {
    this.currentTool = tool;
  }

  setColor(color) {
    this.currentColor = color;
  }

  setWidth(width) {
    this.currentWidth = width;
  }

  updateCursor(e) {
    if (!this.onCursorMove) return;
    
    const { x, y } = this.getCanvasCoordinates(e);
    this.onCursorMove({ x, y });
  }

  showRemoteCursor(userId, username, color, x, y) {
    let cursor = this.remoteCursors.get(userId);
    
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'remote-cursor';
      cursor.innerHTML = `
        <div class="cursor-dot" style="background-color: ${color}"></div>
        <div class="cursor-label">${username}</div>
      `;
      document.getElementById('canvasOverlay').appendChild(cursor);
      this.remoteCursors.set(userId, cursor);
    }
    
    const rect = this.canvas.getBoundingClientRect();
    cursor.style.left = `${rect.left + x}px`;
    cursor.style.top = `${rect.top + y}px`;
    cursor.style.display = 'block';
    
    clearTimeout(cursor.hideTimeout);
    cursor.hideTimeout = setTimeout(() => {
      cursor.style.display = 'none';
    }, 3000);
  }

  hideRemoteCursor(userId) {
    const cursor = this.remoteCursors.get(userId);
    if (cursor) {
      cursor.remove();
      this.remoteCursors.delete(userId);
    }
  }

  hideAllRemoteCursors() {
    this.remoteCursors.forEach(cursor => cursor.remove());
    this.remoteCursors.clear();
  }
}

window.CanvasManager = CanvasManager;
