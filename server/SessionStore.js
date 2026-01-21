const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Session states
const SessionState = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  OFFLINE: 'offline'
};

class SessionStore {
  constructor(dataDir = null) {
    // Determine home directory with fallbacks
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    this.dataDir = dataDir || path.join(home, '.claudegrid', 'data');
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.sessions = new Map();
    // Observed sessions: hook events only, no tmux backing (ephemeral, not persisted)
    this.observedSessions = new Map();
    this.load();
  }

  // Ensure data directory exists
  ensureDataDir() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error(`Failed to create data directory ${this.dataDir}:`, err.message);
        // Fall back to /tmp if we can't create the preferred directory
        this.dataDir = path.join('/tmp', 'claudegrid-data');
        fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o755 });
        this.sessionsFile = path.join(this.dataDir, 'sessions.json');
        console.log(`Using fallback data directory: ${this.dataDir}`);
      }
    }
  }

  // Load sessions from disk
  load() {
    this.ensureDataDir();
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
        for (const session of data) {
          // Mark all sessions as offline on startup - health check will update
          session.state = SessionState.OFFLINE;
          this.sessions.set(session.id, session);
        }
        console.log(`Loaded ${this.sessions.size} sessions from disk`);
      }
    } catch (err) {
      console.error('Error loading sessions:', err.message);
    }
  }

  // Save sessions to disk
  save() {
    this.ensureDataDir();
    try {
      const data = Array.from(this.sessions.values());
      fs.writeFileSync(this.sessionsFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error saving sessions:', err.message);
    }
  }

  // Generate unique session ID
  generateId() {
    return crypto.randomBytes(4).toString('hex');
  }

  // Create a new session
  create({ name, directory, tmuxSession }) {
    const id = this.generateId();
    const session = {
      id,
      name: name || `Session ${id}`,
      directory: directory || process.cwd(),
      tmuxSession,
      state: SessionState.IDLE,
      claudeSessionId: null,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };
    this.sessions.set(id, session);
    this.save();
    return session;
  }

  // Get session by ID
  get(id) {
    return this.sessions.get(id) || null;
  }

  // Get all sessions (excludes offline managed sessions, includes observed)
  getAll() {
    const managed = Array.from(this.sessions.values())
      .filter(s => s.state !== SessionState.OFFLINE);
    const observed = Array.from(this.observedSessions.values());
    return [...managed, ...observed];
  }

  // Get all managed sessions (including offline, for internal use)
  getAllManaged() {
    return Array.from(this.sessions.values());
  }

  // Update session
  update(id, updates) {
    const session = this.sessions.get(id);
    if (!session) return null;

    Object.assign(session, updates, { lastActivity: new Date().toISOString() });
    this.sessions.set(id, session);
    this.save();
    return session;
  }

  // Update session state
  setState(id, state) {
    return this.update(id, { state });
  }

  // Link Claude session ID to managed session
  linkClaudeSession(claudeSessionId, managedSessionId) {
    const session = this.sessions.get(managedSessionId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
      this.save();
      return session;
    }
    return null;
  }

  // Find session by tmux session name
  findByTmuxSession(tmuxSession) {
    for (const session of this.sessions.values()) {
      if (session.tmuxSession === tmuxSession) {
        return session;
      }
    }
    return null;
  }

  // Find session by Claude session ID (checks both managed and observed)
  findByClaudeSessionId(claudeSessionId) {
    // Check managed sessions first
    for (const session of this.sessions.values()) {
      if (session.claudeSessionId === claudeSessionId) {
        return session;
      }
    }
    // Check observed sessions
    return this.observedSessions.get(claudeSessionId) || null;
  }

  // Find managed session by directory that doesn't have a claudeSessionId yet (for auto-linking)
  findUnlinkedByDirectory(directory) {
    for (const session of this.sessions.values()) {
      if (session.directory === directory && !session.claudeSessionId) {
        return session;
      }
    }
    return null;
  }

  // Create or update an observed session (hook events only, no tmux)
  upsertObserved(claudeSessionId, updates = {}) {
    let session = this.observedSessions.get(claudeSessionId);
    if (!session) {
      session = {
        id: claudeSessionId.slice(0, 8),
        claudeSessionId,
        name: `Observed ${claudeSessionId.slice(0, 8)}`,
        directory: updates.cwd || null,
        tmuxSession: null,
        state: SessionState.WORKING,
        observed: true, // Flag to distinguish from managed sessions
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      this.observedSessions.set(claudeSessionId, session);
    }
    Object.assign(session, updates, { lastActivity: new Date().toISOString() });
    return session;
  }

  // Remove an observed session
  removeObserved(claudeSessionId) {
    return this.observedSessions.delete(claudeSessionId);
  }

  // Get observed session by claudeSessionId
  getObserved(claudeSessionId) {
    return this.observedSessions.get(claudeSessionId) || null;
  }

  // Delete session
  delete(id) {
    const deleted = this.sessions.delete(id);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  // Mark sessions with given tmux names as online (idle), others as offline
  updateHealthStatus(activeTmuxSessions) {
    const activeSet = new Set(activeTmuxSessions);
    let changed = false;

    for (const session of this.sessions.values()) {
      const isActive = activeSet.has(session.tmuxSession);
      const wasOffline = session.state === SessionState.OFFLINE;
      const wasActive = session.state !== SessionState.OFFLINE;

      if (isActive && wasOffline) {
        session.state = SessionState.IDLE;
        changed = true;
      } else if (!isActive && wasActive) {
        session.state = SessionState.OFFLINE;
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }

    return changed;
  }
}

module.exports = { SessionStore, SessionState };
