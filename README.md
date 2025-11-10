Real-Time Collaborative Drawing Canvas

A real-time collaborative whiteboard built using Socket.IO, Node.js, and HTML5 Canvas that allows multiple users to draw together seamlessly on the same canvas — all in real-time.

🔗 Live Demo: https://realtimecollaborativedrawingcanvas-1.onrender.com

Features

-> Real-time drawing synchronization across multiple users

-> Smooth brush strokes and color selection

-> Canvas clear/reset option

-> Tracks multiple users connected simultaneously

-> Lightweight and responsive UI

-> Built with Socket.IO for instant communication

File Structure
```
RealTimeCollaborativeDrawingCanvas/
│
├── public/
│   ├── index.html         # Main HTML structure for the app
│   ├── style.css          # Styling for the canvas and controls
│   ├── script.js          # Client-side JS (handles drawing + socket events)
│
├── server.js              # Express + Socket.IO backend setup
│
├── package.json           # Node.js dependencies and scripts
│
├── README.md             
│
└── .gitignore             
```
---
Tech Stack

**Frontend:**

HTML5 Canvas

CSS3

JavaScript (Vanilla)

**Backend:**

Node.js

Express.js

Socket.IO

---
