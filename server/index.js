const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { SessionManager } = require('./SessionManager.js');

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sessionManager = new SessionManager();

  // Middleware
  app.use(express.json());

  // Serve static files from client directory
  const clientPath = path.join(__dirname, '..', 'client');
  app.use(express.static(clientPath));

  // WebSocket clients
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WebSocket client connected (total: ${clients.size})`);

    // Send current session state to new client
    const sessions = sessionManager.getSessionTree();
    ws.send(JSON.stringify({
      messageType: 'init',
      sessions
    }));

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WebSocket client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      clients.delete(ws);
    });
  });

  // Broadcast to all connected clients
  function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  // API endpoint for hooks
  app.post('/api/events', (req, res) => {
    const event = req.body;

    // Process event and get state change
    const stateChange = sessionManager.handleEvent(event);

    if (stateChange) {
      // Broadcast to all WebSocket clients
      broadcast({
        messageType: 'event',
        ...stateChange
      });
    }

    res.status(200).json({ ok: true });
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      sessions: sessionManager.getAllSessions().length,
      clients: clients.size
    });
  });

  // Get all sessions
  app.get('/api/sessions', (req, res) => {
    res.json({
      sessions: sessionManager.getSessionTree()
    });
  });

  return server;
}

module.exports = { createServer };
