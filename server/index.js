const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { SessionStore, SessionState } = require('./SessionStore');
const tmux = require('./tmux');

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Initialize session store
  const sessionStore = new SessionStore();

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // Serve static files from client directory
  const clientPath = path.join(__dirname, '..', 'client');
  app.use(express.static(clientPath));

  // WebSocket clients
  const clients = new Set();

  // Broadcast to all connected clients
  function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  // Broadcast session list update
  function broadcastSessions() {
    broadcast({
      type: 'sessions',
      sessions: sessionStore.getAll()
    });
  }

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WebSocket client connected (total: ${clients.size})`);

    // Send init with current sessions
    ws.send(JSON.stringify({
      messageType: 'init',
      sessions: sessionStore.getAll()
    }));

    // Handle incoming messages from client
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleClientMessage(ws, message);
      } catch (err) {
        console.error('Error handling WebSocket message:', err.message);
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WebSocket client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      clients.delete(ws);
    });
  });

  // Handle bidirectional WebSocket messages
  async function handleClientMessage(ws, message) {
    const { type, sessionId, prompt, response } = message;

    switch (type) {
      case 'get_sessions':
        ws.send(JSON.stringify({
          type: 'sessions',
          sessions: sessionStore.getAll()
        }));
        break;

      case 'send_prompt':
        if (!sessionId || !prompt) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing sessionId or prompt' }));
          return;
        }
        try {
          const session = sessionStore.get(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
            return;
          }
          await tmux.sendToTmuxSafe(session.tmuxSession, prompt);
          sessionStore.setState(sessionId, SessionState.WORKING);
          broadcastSessions();
          ws.send(JSON.stringify({ type: 'prompt_sent', sessionId }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
        break;

      case 'cancel':
        if (!sessionId) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing sessionId' }));
          return;
        }
        try {
          const session = sessionStore.get(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
            return;
          }
          await tmux.sendCancel(session.tmuxSession);
          ws.send(JSON.stringify({ type: 'cancelled', sessionId }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
        break;

      case 'permission_response':
        if (!sessionId || !response) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing sessionId or response' }));
          return;
        }
        try {
          const session = sessionStore.get(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
            return;
          }
          await tmux.sendKeys(session.tmuxSession, response);
          sessionStore.setState(sessionId, SessionState.WORKING);
          broadcastSessions();
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  // ===== REST API ENDPOINTS =====

  // Create new session
  app.post('/api/sessions', async (req, res) => {
    try {
      const { name, directory, continueSession } = req.body;

      // Validate directory if provided
      let validDir = process.cwd();
      if (directory) {
        validDir = tmux.validateDirectoryPath(directory);
      }

      // Generate tmux session name
      const shortId = require('crypto').randomBytes(4).toString('hex');
      const tmuxSession = `claudegrid-${shortId}`;

      // Store in session manager FIRST (before tmux starts Claude)
      // This prevents race condition where hook events arrive before session exists
      const session = sessionStore.create({
        name: name || `Session ${shortId}`,
        directory: validDir,
        tmuxSession
      });
      console.log(`[Create] Managed session ${session.id.slice(0,8)} created with directory: ${validDir}`);

      try {
        // Create tmux session with Claude
        await tmux.createSession(tmuxSession, validDir, { continueSession });
      } catch (tmuxErr) {
        // If tmux creation fails, clean up the managed session
        sessionStore.delete(session.id);
        throw tmuxErr;
      }

      // Broadcast update
      broadcastSessions();

      res.json({ ok: true, session });
    } catch (err) {
      console.error('Error creating session:', err.message);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // List all sessions
  app.get('/api/sessions', (req, res) => {
    res.json({ ok: true, sessions: sessionStore.getAll() });
  });

  // Get single session
  app.get('/api/sessions/:id', (req, res) => {
    const session = sessionStore.get(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    res.json({ ok: true, session });
  });

  // Send prompt to session
  app.post('/api/sessions/:id/prompt', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ ok: false, error: 'Missing prompt' });
      }

      await tmux.sendToTmuxSafe(session.tmuxSession, prompt);
      sessionStore.setState(session.id, SessionState.WORKING);
      broadcastSessions();

      res.json({ ok: true });
    } catch (err) {
      console.error('Error sending prompt:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Cancel session (Ctrl+C)
  app.post('/api/sessions/:id/cancel', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      await tmux.sendCancel(session.tmuxSession);
      res.json({ ok: true });
    } catch (err) {
      console.error('Error cancelling session:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Delete session
  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      // Kill tmux session
      await tmux.killSession(session.tmuxSession);

      // Also remove any observed session with the same claudeSessionId or directory
      if (session.claudeSessionId) {
        sessionStore.removeObserved(session.claudeSessionId);
      } else if (session.directory) {
        // If no claudeSessionId was linked, try to find and remove by directory
        const observed = sessionStore.findObservedByDirectory(session.directory);
        if (observed) {
          sessionStore.removeObserved(observed.claudeSessionId);
        }
      }

      // Broadcast SessionEnd event so client can despawn the Bit
      if (session.claudeSessionId) {
        broadcast({
          messageType: 'event',
          session_id: session.claudeSessionId,
          hook_event_name: 'SessionEnd'
        });
      }

      // Remove from store
      sessionStore.delete(session.id);
      broadcastSessions();

      res.json({ ok: true });
    } catch (err) {
      console.error('Error deleting session:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Restart offline session
  app.post('/api/sessions/:id/restart', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      if (session.state !== SessionState.OFFLINE) {
        return res.status(400).json({ ok: false, error: 'Session is not offline' });
      }

      // Create new tmux session with same name
      await tmux.createSession(session.tmuxSession, session.directory, {
        continueSession: true
      });

      sessionStore.setState(session.id, SessionState.IDLE);
      broadcastSessions();

      res.json({ ok: true, session: sessionStore.get(session.id) });
    } catch (err) {
      console.error('Error restarting session:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Rename session
  app.patch('/api/sessions/:id', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      const { name } = req.body;
      if (name) {
        sessionStore.update(session.id, { name });
        broadcastSessions();
      }

      res.json({ ok: true, session: sessionStore.get(session.id) });
    } catch (err) {
      console.error('Error updating session:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Link Claude session ID to managed session
  app.post('/api/sessions/:id/link', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      const { claudeSessionId } = req.body;
      if (!claudeSessionId) {
        return res.status(400).json({ ok: false, error: 'Missing claudeSessionId' });
      }

      sessionStore.linkClaudeSession(claudeSessionId, session.id);
      broadcastSessions();

      res.json({ ok: true });
    } catch (err) {
      console.error('Error linking session:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Send permission response
  app.post('/api/sessions/:id/permission', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      const { response } = req.body;
      if (!response) {
        return res.status(400).json({ ok: false, error: 'Missing response' });
      }

      await tmux.sendKeys(session.tmuxSession, response);
      sessionStore.setState(session.id, SessionState.WORKING);
      broadcastSessions();

      res.json({ ok: true });
    } catch (err) {
      console.error('Error sending permission response:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Get tmux output for session
  app.get('/api/sessions/:id/output', async (req, res) => {
    try {
      const session = sessionStore.get(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }

      const lines = parseInt(req.query.lines) || 100;
      const output = await tmux.capturePane(session.tmuxSession, lines);

      res.json({ ok: true, output });
    } catch (err) {
      console.error('Error getting output:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===== EVENT HANDLING =====

  // API endpoint for hooks - pass through raw events
  app.post('/api/events', (req, res) => {
    const event = req.body;

    // Update session state based on events
    if (event.session_id) {
      let session = sessionStore.findByClaudeSessionId(event.session_id);
      const hookEvent = event.hook_event_name;

      // Debug: log linking attempts
      console.log(`[Event] ${hookEvent} session_id=${event.session_id.slice(0,8)} cwd=${event.cwd || 'none'} found=${session ? (session.observed ? 'observed' : 'managed') : 'none'}`);

      // Try to auto-link to an unlinked managed session by directory
      // Do this even if we found an observed session - prefer managed sessions
      if (event.cwd) {
        const managedSession = sessionStore.findUnlinkedByDirectory(event.cwd);
        console.log(`[Event] findUnlinkedByDirectory(${event.cwd}) => ${managedSession ? managedSession.id.slice(0,8) : 'none'}`);
        if (managedSession) {
          // Link this claude session to the managed session
          console.log(`[Event] Linking claude session ${event.session_id.slice(0,8)} to managed session ${managedSession.id.slice(0,8)}`);
          sessionStore.linkClaudeSession(event.session_id, managedSession.id);
          // If there was an observed session, remove it (we're taking over)
          if (session && session.observed) {
            console.log(`[Event] Removing observed session ${event.session_id.slice(0,8)}`);
            sessionStore.removeObserved(event.session_id);
          }
          session = managedSession;
        }
      }

      if (session && !session.observed) {
        // Managed session - update state
        if (hookEvent === 'SessionStart') {
          sessionStore.setState(session.id, SessionState.IDLE);
        } else if (hookEvent === 'SessionEnd') {
          sessionStore.setState(session.id, SessionState.OFFLINE);
        } else if (hookEvent === 'Stop' || hookEvent === 'SubagentStop') {
          sessionStore.setState(session.id, SessionState.IDLE);
        } else if (['PreToolUse', 'PostToolUse', 'UserPromptSubmit'].includes(hookEvent)) {
          sessionStore.setState(session.id, SessionState.WORKING);
        }
        broadcastSessions();
      } else {
        // Observed session (existing or new)
        if (hookEvent === 'SessionEnd') {
          // Remove observed session when it ends
          sessionStore.removeObserved(event.session_id);
          broadcastSessions();
        } else {
          // Upsert observed session with state based on event
          let state = SessionState.WORKING;
          if (hookEvent === 'SessionStart' || hookEvent === 'Stop' || hookEvent === 'SubagentStop') {
            state = SessionState.IDLE;
          }
          sessionStore.upsertObserved(event.session_id, {
            state,
            cwd: event.cwd || null
          });
          broadcastSessions();
        }
      }
    }

    broadcast({ messageType: 'event', ...event });
    res.status(200).json({ ok: true });
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', clients: clients.size, sessions: sessionStore.getAll().length });
  });

  // ===== HEALTH CHECK POLLING =====

  // Poll tmux sessions every 5 seconds
  async function healthCheck() {
    try {
      const activeSessions = await tmux.listSessions();
      const changed = sessionStore.updateHealthStatus(activeSessions);
      if (changed) {
        broadcastSessions();
      }
    } catch (err) {
      console.error('Health check error:', err.message);
    }
  }

  // Start health check polling
  setInterval(healthCheck, 5000);
  // Run immediately on startup
  healthCheck();

  // ===== PERMISSION DETECTION =====
  // Import and start permission detector
  let permissionDetector;
  try {
    permissionDetector = require('./permissionDetector');
    permissionDetector.start(sessionStore, (sessionId, options) => {
      broadcast({
        type: 'permission_prompt',
        sessionId,
        options
      });
    });
  } catch (err) {
    console.log('Permission detector not loaded:', err.message);
  }

  return server;
}

module.exports = { createServer };
