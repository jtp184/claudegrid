// Visual states for Bit
const States = {
  NEUTRAL: 'neutral',
  THINKING: 'thinking',
  YES: 'yes',
  NO: 'no',
  ENDING: 'ending'
};

class SessionManager {
  constructor() {
    // Map of session_id -> session state
    this.sessions = new Map();
    // Map of parent_session_id -> Set of child session_ids (subagents)
    this.subagents = new Map();
  }

  handleEvent(event) {
    const { session_id, hook_event_name, parent_session_id } = event;

    if (!session_id) {
      return null;
    }

    let session = this.sessions.get(session_id);
    let stateChange = null;

    switch (hook_event_name) {
      case 'SessionStart':
        session = this.createSession(session_id, parent_session_id);
        stateChange = { type: 'create', state: States.NEUTRAL };
        break;

      case 'UserPromptSubmit':
        if (session) {
          session.state = States.THINKING;
          session.lastActivity = Date.now();
          stateChange = { type: 'state', state: States.THINKING };
        }
        break;

      case 'PreToolUse':
        if (session) {
          session.lastActivity = Date.now();
          // Pulse effect, stay in current state
          stateChange = { type: 'pulse' };
        }
        break;

      case 'PostToolUse':
        if (session) {
          session.lastActivity = Date.now();
          const success = !event.tool_use_blocked;
          session.state = success ? States.YES : States.NO;
          stateChange = {
            type: 'state',
            state: session.state,
            autoRevert: success ? States.THINKING : null,
            revertDelay: success ? 1500 : null
          };
        }
        break;

      case 'Stop':
      case 'SubagentStop':
        if (session) {
          session.state = States.NEUTRAL;
          session.lastActivity = Date.now();
          stateChange = { type: 'state', state: States.NEUTRAL };
        }
        break;

      case 'SessionEnd':
        if (session) {
          session.state = States.ENDING;
          stateChange = { type: 'end', state: States.ENDING };
          // Remove session after animation
          setTimeout(() => this.removeSession(session_id), 2000);
        }
        break;

      default:
        // Unknown event, just update activity
        if (session) {
          session.lastActivity = Date.now();
        }
    }

    return stateChange ? { session_id, ...stateChange, event } : null;
  }

  createSession(session_id, parent_session_id = null) {
    const session = {
      id: session_id,
      parent_id: parent_session_id,
      state: States.NEUTRAL,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(session_id, session);

    // Track subagent relationship
    if (parent_session_id) {
      if (!this.subagents.has(parent_session_id)) {
        this.subagents.set(parent_session_id, new Set());
      }
      this.subagents.get(parent_session_id).add(session_id);
    }

    return session;
  }

  removeSession(session_id) {
    const session = this.sessions.get(session_id);
    if (!session) return;

    // Remove from parent's subagent list
    if (session.parent_id) {
      const siblings = this.subagents.get(session.parent_id);
      if (siblings) {
        siblings.delete(session_id);
        if (siblings.size === 0) {
          this.subagents.delete(session.parent_id);
        }
      }
    }

    // Remove any subagents of this session
    const children = this.subagents.get(session_id);
    if (children) {
      for (const childId of children) {
        this.sessions.delete(childId);
      }
      this.subagents.delete(session_id);
    }

    this.sessions.delete(session_id);
  }

  getSession(session_id) {
    return this.sessions.get(session_id);
  }

  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  getSubagents(session_id) {
    const children = this.subagents.get(session_id);
    return children ? Array.from(children) : [];
  }

  getSessionTree() {
    // Return sessions organized by parent/child relationships
    const roots = [];
    const tree = new Map();

    for (const session of this.sessions.values()) {
      if (!session.parent_id) {
        const node = { ...session, subagents: [] };
        roots.push(node);
        tree.set(session.id, node);
      }
    }

    for (const session of this.sessions.values()) {
      if (session.parent_id) {
        const parent = tree.get(session.parent_id);
        if (parent) {
          parent.subagents.push({ ...session, subagents: [] });
        } else {
          // Parent doesn't exist, treat as root
          roots.push({ ...session, subagents: [] });
        }
      }
    }

    return roots;
  }
}

module.exports = { SessionManager, States };
