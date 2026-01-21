import { SessionGrid } from './SessionGrid.js';
import { EventLog } from './EventLog.js';
import { AudioManager } from './AudioManager.js';
import { SessionAPI } from './SessionAPI.js';

/**
 * SimpleDebouncer - Debounces events per session
 * SessionStart/SessionEnd bypass debounce (immediate)
 * All other events debounce 75ms, taking the latest
 */
class SimpleDebouncer {
  constructor(handler, delay = 75) {
    this.pending = new Map();
    this.handler = handler;
    this.delay = delay;
  }

  enqueue(event) {
    const { session_id, hook_event_name } = event;

    // Immediate: bypass debounce
    if (['SessionStart', 'SessionEnd'].includes(hook_event_name)) {
      this.flush(session_id);
      this.handler(event);
      return;
    }

    // Debounce: take latest
    const existing = this.pending.get(session_id);
    if (existing) clearTimeout(existing.timeout);

    this.pending.set(session_id, {
      event,
      timeout: setTimeout(() => {
        this.pending.delete(session_id);
        this.handler(event);
      }, this.delay)
    });
  }

  flush(sessionId) {
    const e = this.pending.get(sessionId);
    if (e) {
      clearTimeout(e.timeout);
      this.pending.delete(sessionId);
    }
  }
}

class ClaudeGridApp {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.logContainer = document.getElementById('log-entries');
    this.connectionStatus = document.getElementById('connection-status');
    this.sessionCount = document.getElementById('session-count');
    this.emptyState = document.getElementById('empty-state');
    this.soundToggle = document.getElementById('sound-toggle');
    this.volumeSlider = document.getElementById('volume-slider');
    this.clearLogBtn = document.getElementById('clear-log');
    this.logToggle = document.getElementById('log-toggle');
    this.controlsToggle = document.getElementById('controls-toggle');
    this.eventLogPanel = document.getElementById('event-log');
    this.controlsPanel = document.getElementById('controls');

    // Session control elements
    this.sessionPanel = document.getElementById('session-panel');
    this.sessionList = document.getElementById('session-list');
    this.newSessionBtn = document.getElementById('new-session-btn');
    this.sessionPanelToggle = document.getElementById('session-panel-toggle');
    this.promptBar = document.getElementById('prompt-bar');
    this.promptInput = document.getElementById('prompt-input');
    this.promptSendBtn = document.getElementById('prompt-send');
    this.sessionSelector = document.getElementById('session-selector');
    this.cancelBtn = document.getElementById('cancel-btn');

    // Modal elements
    this.createSessionModal = document.getElementById('create-session-modal');
    this.sessionNameInput = document.getElementById('session-name');
    this.sessionDirInput = document.getElementById('session-directory');
    this.createSessionConfirm = document.getElementById('create-session-confirm');
    this.createSessionCancel = document.getElementById('create-session-cancel');

    this.permissionModal = document.getElementById('permission-modal');
    this.permissionText = document.getElementById('permission-text');
    this.permissionOptions = document.getElementById('permission-options');

    this.sessionGrid = new SessionGrid(this.canvas, {
      getSessionName: (claudeSessionId) => this.getSessionNameByClaudeId(claudeSessionId),
      onBitClick: (claudeSessionId) => this.selectSessionByClaudeId(claudeSessionId)
    });
    this.debouncer = new SimpleDebouncer((event) => this.sessionGrid.handleEvent(event));
    this.eventLog = new EventLog(this.logContainer);
    this.audioManager = new AudioManager();
    this.sessionAPI = new SessionAPI();

    // Managed sessions
    this.managedSessions = [];
    this.selectedSessionId = null;

    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;

    this.setupEventListeners();
    this.connect();
    this.startRenderLoop();
  }

  setupEventListeners() {
    // Initialize audio on first user interaction (required by browser autoplay policy)
    const initAudioOnce = async () => {
      if (this.audioManager.mode !== 'off') {
        await this.audioManager.init();
      }
      document.removeEventListener('click', initAudioOnce);
      document.removeEventListener('keydown', initAudioOnce);
    };
    document.addEventListener('click', initAudioOnce);
    document.addEventListener('keydown', initAudioOnce);

    this.soundToggle.addEventListener('click', async () => {
      const mode = this.audioManager.toggle();
      const modeLabels = { off: 'OFF', response: 'RESPONSE ONLY', on: 'ON' };
      this.soundToggle.textContent = `SOUND: ${modeLabels[mode]}`;
      this.soundToggle.classList.toggle('active', mode !== 'off');

      if (mode !== 'off') {
        // Initialize audio on enable (requires user gesture)
        await this.audioManager.init();
      }
    });

    this.volumeSlider.addEventListener('input', () => {
      const volume = this.volumeSlider.value / 100;
      this.audioManager.setVolume(volume);
    });

    this.clearLogBtn.addEventListener('click', () => {
      this.eventLog.clear();
    });

    this.logToggle.addEventListener('click', () => {
      const isCollapsed = this.eventLogPanel.classList.toggle('collapsed');
      document.body.classList.toggle('log-collapsed', isCollapsed);
      this.logToggle.textContent = isCollapsed ? '>' : '<';
      // Trigger resize after CSS transition completes (300ms)
      setTimeout(() => this.sessionGrid.onResize(), 300);
    });

    this.controlsToggle.addEventListener('click', () => {
      const isCollapsed = this.controlsPanel.classList.toggle('collapsed');
      document.body.classList.toggle('controls-collapsed', isCollapsed);
      this.controlsToggle.textContent = isCollapsed ? '^' : 'v';
      // Trigger resize after CSS transition completes (300ms)
      setTimeout(() => this.sessionGrid.onResize(), 300);
    });

    // Session panel toggle
    this.sessionPanelToggle?.addEventListener('click', () => {
      const isCollapsed = this.sessionPanel.classList.toggle('collapsed');
      document.body.classList.toggle('session-panel-collapsed', isCollapsed);
      this.sessionPanelToggle.textContent = isCollapsed ? '<' : '>';
      setTimeout(() => this.sessionGrid.onResize(), 300);
    });

    // New session button
    this.newSessionBtn?.addEventListener('click', () => {
      this.showCreateSessionModal();
    });

    // Create session modal
    this.createSessionConfirm?.addEventListener('click', () => {
      this.createSession();
    });

    this.createSessionCancel?.addEventListener('click', () => {
      this.hideCreateSessionModal();
    });

    // Prompt bar
    this.promptSendBtn?.addEventListener('click', () => {
      this.sendPrompt();
    });

    this.promptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendPrompt();
      }
    });

    // Cancel button
    this.cancelBtn?.addEventListener('click', () => {
      this.cancelCurrentSession();
    });

    // Session selector
    this.sessionSelector?.addEventListener('change', () => {
      this.selectedSessionId = this.sessionSelector.value || null;
      this.updatePromptBarState();
    });

    // Close modals on backdrop click
    this.createSessionModal?.addEventListener('click', (e) => {
      if (e.target === this.createSessionModal) {
        this.hideCreateSessionModal();
      }
    });

    this.permissionModal?.addEventListener('click', (e) => {
      if (e.target === this.permissionModal) {
        // Don't allow closing permission modal by clicking backdrop
      }
    });
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.connectionStatus.textContent = 'CONNECTED';
      this.connectionStatus.className = 'connected';
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.connectionStatus.textContent = 'DISCONNECTED';
      this.connectionStatus.className = 'disconnected';
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => this.connect(), delay);
  }

  handleMessage(data) {
    const msgType = data.messageType || data.type;
    switch (msgType) {
      case 'init':
        // Initialize with existing sessions
        this.sessionGrid.initFromSessions(data.sessions || []);
        this.updateManagedSessions(data.sessions || []);
        this.updateSessionCount();
        break;

      case 'event':
        this.handleEvent(data);
        break;

      case 'sessions':
        // Session list update
        this.updateManagedSessions(data.sessions || []);
        break;

      case 'permission_prompt':
        // Permission prompt from a session
        this.showPermissionModal(data.sessionId, data.options);
        break;

      case 'error':
        console.error('Server error:', data.error);
        break;

      case 'prompt_sent':
        console.log('Prompt sent to session:', data.sessionId);
        break;

      case 'cancelled':
        console.log('Session cancelled:', data.sessionId);
        break;

      case 'pong':
        // Ping response
        break;
    }
  }

  handleEvent(eventData) {
    try {
      // Route visualization through debouncer
      this.debouncer.enqueue(eventData);

      // Log event immediately (doesn't affect animations)
      this.eventLog.addEntry(eventData);

      // Play sound immediately (feedback should be instant)
      this.playEventSound(eventData);
    } catch (err) {
      console.error('Error processing event:', err);
    }

    // Always update UI (even if event processing failed)
    this.updateSessionCount();
  }

  playEventSound(eventData) {
    const hookEvent = eventData.hook_event_name;

    if (hookEvent === 'PostToolUse') {
      const success = !eventData.tool_use_blocked;
      this.audioManager.play(success ? 'PostToolUse_success' : 'PostToolUse_failure');
    } else if (hookEvent) {
      this.audioManager.play(hookEvent);
    }
  }

  updateSessionCount() {
    const count = this.sessionGrid.getSessionCount();
    this.sessionCount.textContent = `${count} SESSION${count !== 1 ? 'S' : ''}`;

    // Show/hide empty state
    if (count === 0 && this.managedSessions.length === 0) {
      this.emptyState.classList.remove('hidden');
    } else {
      this.emptyState.classList.add('hidden');
    }
  }

  startRenderLoop() {
    const animate = () => {
      requestAnimationFrame(animate);
      this.sessionGrid.update();
    };
    animate();
  }

  // ===== SESSION MANAGEMENT =====

  updateManagedSessions(sessions) {
    this.managedSessions = sessions;
    this.renderSessionList();
    this.updateSessionSelector();
    this.updatePromptBarState();
  }

  renderSessionList() {
    if (!this.sessionList) return;

    this.sessionList.innerHTML = '';

    // Separate sessions: managed (with tmux) vs observed (hook-only)
    const managedSessions = this.managedSessions.filter(s => !s.observed);
    const observedSessions = this.managedSessions.filter(s => s.observed);

    if (managedSessions.length === 0 && observedSessions.length === 0) {
      this.sessionList.innerHTML = '<div class="no-sessions">No sessions</div>';
      return;
    }

    // Render managed sessions (with tmux - can send data)
    if (managedSessions.length > 0) {
      const managedSection = document.createElement('div');
      managedSection.className = 'session-section managed-section';
      managedSection.innerHTML = `<div class="session-section-header"><span class="section-icon">▶</span> MANAGED</div>`;

      for (const session of managedSessions) {
        managedSection.appendChild(this.createSessionItem(session));
      }
      this.sessionList.appendChild(managedSection);
    }

    // Render observed sessions (hook-only - can't send data)
    if (observedSessions.length > 0) {
      const observedSection = document.createElement('div');
      observedSection.className = 'session-section observed-section';
      observedSection.innerHTML = `<div class="session-section-header"><span class="section-icon">◉</span> OBSERVED</div>`;

      for (const session of observedSessions) {
        observedSection.appendChild(this.createSessionItem(session));
      }
      this.sessionList.appendChild(observedSection);
    }
  }

  createSessionItem(session) {
    const item = document.createElement('div');
    item.className = `session-item state-${session.state}${session.observed ? ' observed' : ''}`;
    item.dataset.id = session.id;

    const stateColors = {
      idle: '#44ff88',
      working: '#ffdd44',
      waiting: '#ff8844',
      offline: '#666688'
    };

    const isObserved = session.observed;

    if (isObserved) {
      // Observed session - no actions, just display
      item.innerHTML = `
        <div class="session-info">
          <span class="session-state" style="color: ${stateColors[session.state] || '#446688'}">●</span>
          <span class="session-name">${this.escapeHtml(session.name)} <span class="session-id">(${this.escapeHtml(session.id.slice(0, 8))})</span></span>
        </div>
        ${session.directory ? `<div class="session-dir">${this.escapeHtml(this.truncatePath(session.directory))}</div>` : ''}
      `;
    } else {
      // Managed session - full actions
      item.innerHTML = `
        <div class="session-info">
          <span class="session-state" style="color: ${stateColors[session.state] || '#446688'}">●</span>
          <span class="session-name">${this.escapeHtml(session.name)} <span class="session-id">(${this.escapeHtml(session.id.slice(0, 8))})</span></span>
        </div>
        <div class="session-dir">${this.escapeHtml(this.truncatePath(session.directory))}</div>
        <div class="session-actions">
          <button class="action-btn delete-btn" title="Delete session">×</button>
        </div>
      `;

      // Action button handlers (managed sessions only)
      const deleteBtn = item.querySelector('.delete-btn');

      deleteBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSession(session.id);
      });

      // Select session on click (managed only - can send prompts)
      item.addEventListener('click', () => {
        this.selectSession(session.id);
      });
    }

    return item;
  }

  updateSessionSelector() {
    if (!this.sessionSelector) return;

    const currentValue = this.sessionSelector.value;
    this.sessionSelector.innerHTML = '<option value="">Select session...</option>';

    // Only show managed sessions (not observed) in the selector
    for (const session of this.managedSessions) {
      if (!session.observed && session.state !== 'offline') {
        const option = document.createElement('option');
        option.value = session.id;
        option.textContent = `${session.name} (${session.state})`;
        this.sessionSelector.appendChild(option);
      }
    }

    // Restore selection if still valid (must be managed and not offline)
    const validSession = this.managedSessions.find(s => s.id === currentValue && !s.observed && s.state !== 'offline');
    if (currentValue && validSession) {
      this.sessionSelector.value = currentValue;
      this.selectedSessionId = currentValue;
    } else {
      this.selectedSessionId = null;
    }
  }

  updatePromptBarState() {
    if (!this.promptInput || !this.promptSendBtn) return;

    const hasSelection = !!this.selectedSessionId;
    const session = this.managedSessions.find(s => s.id === this.selectedSessionId);
    const canSend = hasSelection && session && session.state !== 'offline';

    this.promptInput.disabled = !canSend;
    this.promptSendBtn.disabled = !canSend;
    this.cancelBtn.disabled = !canSend;

    if (canSend) {
      this.promptInput.placeholder = `Send prompt to ${session.name}...`;
    } else if (hasSelection) {
      this.promptInput.placeholder = 'Session is offline';
    } else {
      this.promptInput.placeholder = 'Select a session first...';
    }
  }

  selectSession(id) {
    this.selectedSessionId = id;
    if (this.sessionSelector) {
      this.sessionSelector.value = id;
    }
    this.updatePromptBarState();

    // Highlight selected in list
    document.querySelectorAll('.session-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.id === id);
    });
  }

  // ===== SESSION ACTIONS =====

  showCreateSessionModal() {
    if (!this.createSessionModal) return;
    this.sessionNameInput.value = '';
    this.sessionDirInput.value = '';
    this.createSessionModal.classList.add('visible');
    this.sessionNameInput.focus();
  }

  hideCreateSessionModal() {
    if (!this.createSessionModal) return;
    this.createSessionModal.classList.remove('visible');
  }

  async createSession() {
    const name = this.sessionNameInput.value.trim();
    const directory = this.sessionDirInput.value.trim();

    try {
      const result = await this.sessionAPI.createSession({ name, directory });
      this.hideCreateSessionModal();
      // Session list will be updated via WebSocket
      if (result.session) {
        this.selectSession(result.session.id);
      }
    } catch (err) {
      console.error('Error creating session:', err);
      alert('Failed to create session: ' + err.message);
    }
  }

  async sendPrompt() {
    if (!this.selectedSessionId || !this.promptInput) return;

    const prompt = this.promptInput.value.trim();
    if (!prompt) return;

    try {
      await this.sessionAPI.sendPrompt(this.selectedSessionId, prompt);
      this.promptInput.value = '';
    } catch (err) {
      console.error('Error sending prompt:', err);
      alert('Failed to send prompt: ' + err.message);
    }
  }

  async cancelCurrentSession() {
    if (!this.selectedSessionId) return;

    try {
      await this.sessionAPI.cancelSession(this.selectedSessionId);
    } catch (err) {
      console.error('Error cancelling session:', err);
    }
  }

  async cancelSession(id) {
    try {
      await this.sessionAPI.cancelSession(id);
    } catch (err) {
      console.error('Error cancelling session:', err);
    }
  }

  async restartSession(id) {
    try {
      await this.sessionAPI.restartSession(id);
    } catch (err) {
      console.error('Error restarting session:', err);
      alert('Failed to restart session: ' + err.message);
    }
  }

  async deleteSession(id) {
    if (!confirm('Delete this session?')) return;

    try {
      await this.sessionAPI.deleteSession(id);
      if (this.selectedSessionId === id) {
        this.selectedSessionId = null;
        this.updatePromptBarState();
      }
    } catch (err) {
      console.error('Error deleting session:', err);
      alert('Failed to delete session: ' + err.message);
    }
  }

  // ===== PERMISSION HANDLING =====

  showPermissionModal(sessionId, options) {
    if (!this.permissionModal) return;

    const session = this.managedSessions.find(s => s.id === sessionId);
    const sessionName = session ? session.name : sessionId;

    this.permissionText.textContent = `${sessionName} is requesting permission:`;
    if (options.text) {
      this.permissionText.textContent += '\n\n' + options.text;
    }

    this.permissionOptions.innerHTML = '';

    for (const opt of options.options || []) {
      const btn = document.createElement('button');
      btn.className = 'btn permission-btn';
      btn.textContent = `${opt.number}. ${opt.label}`;
      btn.addEventListener('click', () => {
        this.sendPermissionResponse(sessionId, opt.number);
      });
      this.permissionOptions.appendChild(btn);
    }

    this.permissionModal.dataset.sessionId = sessionId;
    this.permissionModal.classList.add('visible');
  }

  hidePermissionModal() {
    if (!this.permissionModal) return;
    this.permissionModal.classList.remove('visible');
  }

  async sendPermissionResponse(sessionId, response) {
    try {
      await this.sessionAPI.sendPermission(sessionId, response);
      this.hidePermissionModal();
    } catch (err) {
      console.error('Error sending permission response:', err);
    }
  }

  // ===== BIT INTERACTION =====

  getSessionNameByClaudeId(claudeSessionId) {
    // Find managed session with matching claudeSessionId and return user-supplied name
    const session = this.managedSessions.find(s => s.claudeSessionId === claudeSessionId);
    if (session && session.name && !session.observed) {
      return session.name;
    }
    return null;
  }

  selectSessionByClaudeId(claudeSessionId) {
    // Find managed session with matching claudeSessionId
    const session = this.managedSessions.find(s => s.claudeSessionId === claudeSessionId && !s.observed);
    if (session && session.state !== 'offline') {
      this.selectSession(session.id);
      // Focus prompt input
      if (this.promptInput) {
        this.promptInput.focus();
      }
    }
  }

  // ===== UTILITIES =====

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  truncatePath(path, maxLen = 30) {
    if (!path || path.length <= maxLen) return path;
    return '...' + path.slice(-(maxLen - 3));
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ClaudeGridApp();
});
