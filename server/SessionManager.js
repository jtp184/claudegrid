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
          session.pendingPermissions.clear();
          session.lastActivity = Date.now();
          // Clear dimmed state when activity resumes
          const wasDimmed = session.isDimmed;
          session.isDimmed = false;
          stateChange = { type: 'state', state: States.THINKING, undim: wasDimmed };
        }
        break;

      case 'PreToolUse':
        if (session) {
          session.lastActivity = Date.now();
          const toolUseId = event.tool_use_id;
          if (toolUseId) {
            session.activeTools.set(toolUseId, {
              tool_name: event.tool_name,
              startTime: Date.now()
            });
          }
          stateChange = {
            type: 'tool_start',
            tool_use_id: toolUseId,
            tool_name: event.tool_name
          };
        }
        break;

      case 'PostToolUse':
        if (session) {
          session.lastActivity = Date.now();
          const success = !event.tool_use_blocked;
          const toolUseId = event.tool_use_id;

          // Remove completed tool from active tools
          if (toolUseId) {
            session.activeTools.delete(toolUseId);
          }

          // Remove this tool from pending permissions (if it was waiting for permission)
          if (toolUseId) {
            session.pendingPermissions.delete(toolUseId);
          }

          // Only allow state change if no more permissions pending
          if (session.pendingPermissions.size === 0) {
            session.state = success ? States.YES : States.NO;
            // Auto-revert to NEUTRAL if no more active tools, else THINKING
            const revertState = session.activeTools.size === 0 ? States.NEUTRAL : States.THINKING;
            stateChange = {
              type: 'tool_end',
              tool_use_id: toolUseId,
              state: session.state,
              autoRevert: success ? revertState : null,
              revertDelay: success ? 1500 : null
            };
          } else {
            // Still permissions pending, just signal tool end
            stateChange = {
              type: 'tool_end',
              tool_use_id: toolUseId
            };
          }
        }
        break;

      case 'Stop':
      case 'SubagentStop':
        if (session) {
          session.state = States.NEUTRAL;
          session.pendingPermissions.clear();
          session.activeTools.clear();
          session.lastActivity = Date.now();
          stateChange = { type: 'state', state: States.NEUTRAL, clearTools: true };
        }
        break;

      case 'SessionEnd':
        if (session) {
          session.state = States.ENDING;
          session.pendingPermissions.clear();
          stateChange = { type: 'end', state: States.ENDING };
          // Remove session after animation
          setTimeout(() => this.removeSession(session_id), 2000);
        }
        break;

      case 'Notification':
        if (session) {
          session.lastActivity = Date.now();
          // Check if this is an idle_prompt notification - dim instead of switching to NO
          const notificationType = event.notification_type || event.type;
          if (notificationType === 'idle_prompt') {
            session.isDimmed = true;
            stateChange = { type: 'dim', dimmed: true };
          } else {
            session.state = States.NO;
            const notificationId = event.notification_id || `notification_${Date.now()}`;
            session.pendingPermissions.add(notificationId);
            stateChange = { type: 'state', state: States.NO };
          }
        }
        break;

      case 'PermissionRequest':
        if (session) {
          session.state = States.NO;
          const permissionToolId = event.tool_use_id || `permission_${Date.now()}`;
          session.pendingPermissions.add(permissionToolId);
          session.lastActivity = Date.now();
          stateChange = { type: 'state', state: States.NO };
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
      pendingPermissions: new Set(),
      isDimmed: false,
      activeTools: new Map(),
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

    // Helper to serialize session with activeTools as array
    const serializeSession = (session) => {
      const { activeTools, ...rest } = session;
      return {
        ...rest,
        activeTools: Array.from(activeTools.entries()).map(([id, data]) => ({
          tool_use_id: id,
          ...data
        }))
      };
    };

    for (const session of this.sessions.values()) {
      if (!session.parent_id) {
        const node = { ...serializeSession(session), subagents: [] };
        roots.push(node);
        tree.set(session.id, node);
      }
    }

    for (const session of this.sessions.values()) {
      if (session.parent_id) {
        const parent = tree.get(session.parent_id);
        if (parent) {
          parent.subagents.push({ ...serializeSession(session), subagents: [] });
        } else {
          // Parent doesn't exist, treat as root
          roots.push({ ...serializeSession(session), subagents: [] });
        }
      }
    }

    return roots;
  }
}

module.exports = { SessionManager, States };
