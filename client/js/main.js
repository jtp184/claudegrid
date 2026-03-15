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
    this.emptyState = document.getElementById('empty-state');

    // Status badge (combined connection + session count)
    this.statusBadge = document.getElementById('status-badge');

    // Sound button
    this.soundBtn = document.getElementById('sound-btn');
    this.soundRing = this.soundBtn.querySelector('.sound-ring');
    this.soundIcon = this.soundBtn.querySelector('.sound-icon');

    // Event log
    this.logToggle = document.getElementById('log-toggle');
    this.eventLogPanel = document.getElementById('event-log');

    // Conversation panel
    this.conversationPanel = document.getElementById('conversation-panel');
    this.conversationToggle = document.getElementById('conversation-toggle');
    this.conversationOutput = document.getElementById('conversation-output');
    this.outputPollInterval = null;
    this._refreshTimeout = null;

    // Session control elements
    this.sessionPanel = document.getElementById('session-panel');
    this.sessionList = document.getElementById('session-list');
    this.newSessionBtn = document.getElementById('new-session-btn');
    this.sessionPanelToggle = document.getElementById('session-panel-toggle');
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

    // Skip permissions checkbox
    this.skipPermissionsCheckbox = document.getElementById('skip-permissions');

    // Managed sessions
    this.managedSessions = [];
    this.selectedSessionId = null;

    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;

    // Initialize sound button visual state
    this.updateSoundButtonState();

    this.setupEventListeners();
    this.connect();
    this.startRenderLoop();
  }

  updateSoundButtonState() {
    const modeIcons = { off: '\u2716', response: '\u26A0', on: '\u266A' };
    const modeTitles = {
      off: 'Sound: Off\nClick to enable response sounds',
      response: 'Sound: Response Only\nPlays on session start, permissions, and stop\nScroll to adjust volume',
      on: 'Sound: All Events\nPlays on every hook event\nScroll to adjust volume'
    };
    this.soundIcon.textContent = modeIcons[this.audioManager.mode];
    this.soundBtn.title = modeTitles[this.audioManager.mode];
    this.soundRing.style.setProperty('--volume', Math.round(this.audioManager.volume * 100));
    this.soundBtn.classList.toggle('off', this.audioManager.mode === 'off');
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

    // Sound button: click cycles mode
    this.soundBtn.addEventListener('click', async () => {
      const mode = this.audioManager.toggle();
      this.updateSoundButtonState();
      if (mode !== 'off') {
        await this.audioManager.init();
      }
    });

    // Sound button: scroll adjusts volume
    this.soundBtn.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const newVol = Math.max(0, Math.min(1, this.audioManager.volume + delta));
      this.audioManager.setVolume(newVol);
      this.soundRing.style.setProperty('--volume', Math.round(newVol * 100));
    }, { passive: false });

    // Event log toggle
    this.logToggle.addEventListener('click', () => {
      const isCollapsed = this.eventLogPanel.classList.toggle('collapsed');
      document.body.classList.toggle('log-collapsed', isCollapsed);
      this.logToggle.textContent = isCollapsed ? '>' : '<';
      setTimeout(() => this.sessionGrid.onResize(), 300);
    });

    // Conversation panel toggle
    this.conversationToggle.addEventListener('click', () => {
      const isCollapsed = this.conversationPanel.classList.toggle('collapsed');
      document.body.classList.toggle('conversation-collapsed', isCollapsed);
      this.conversationToggle.innerHTML = isCollapsed ? '&#8743;' : '&#8744;';
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
      if (this.selectedSessionId) {
        this.startOutputPolling();
      } else {
        this.stopOutputPolling();
        this.conversationOutput.textContent = '';
      }
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
      this.statusBadge.className = 'status-badge connected';
      this.updateSessionCount();
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.statusBadge.textContent = '\u2715';
      this.statusBadge.className = 'status-badge disconnected';
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

    // Refresh conversation output if event is for the selected session
    if (eventData.session_id && this.selectedSessionId) {
      const selectedSession = this.managedSessions.find(s => s.id === this.selectedSessionId);
      if (selectedSession && selectedSession.claudeSessionId === eventData.session_id) {
        this.refreshConversationOutput();
      }
    }
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

    // Only update text if connected — show just the number
    if (this.statusBadge.classList.contains('connected')) {
      this.statusBadge.textContent = count;
    }

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

  // ===== CONVERSATION OUTPUT =====

  startOutputPolling() {
    this.stopOutputPolling();
    if (!this.selectedSessionId) return;

    const poll = async () => {
      if (!this.selectedSessionId) return;
      const session = this.managedSessions.find(s => s.id === this.selectedSessionId && !s.observed);
      if (!session) return;

      try {
        const result = await this.sessionAPI.getOutput(this.selectedSessionId, 200);
        if (result.output !== undefined) {
          const wasAtBottom = this.conversationOutput.scrollHeight - this.conversationOutput.scrollTop <= this.conversationOutput.clientHeight + 20;
          this.conversationOutput.textContent = result.output;
          if (wasAtBottom) {
            this.conversationOutput.scrollTop = this.conversationOutput.scrollHeight;
          }
        }
      } catch (err) {
        // Silently fail -- session may be offline
      }
    };

    poll();
    this.outputPollInterval = setInterval(poll, 3000);
  }

  stopOutputPolling() {
    if (this.outputPollInterval) {
      clearInterval(this.outputPollInterval);
      this.outputPollInterval = null;
    }
  }

  refreshConversationOutput() {
    if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
    this._refreshTimeout = setTimeout(async () => {
      if (!this.selectedSessionId) return;
      try {
        const result = await this.sessionAPI.getOutput(this.selectedSessionId, 200);
        if (result.output !== undefined) {
          const wasAtBottom = this.conversationOutput.scrollHeight - this.conversationOutput.scrollTop <= this.conversationOutput.clientHeight + 20;
          this.conversationOutput.textContent = result.output;
          if (wasAtBottom) {
            this.conversationOutput.scrollTop = this.conversationOutput.scrollHeight;
          }
        }
      } catch (err) { /* ignore */ }
    }, 500);
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

    // Stop polling if no valid session
    if (!this.selectedSessionId) {
      this.stopOutputPolling();
      this.conversationOutput.textContent = '';
    }
  }

  selectSession(id) {
    this.selectedSessionId = id;
    if (this.sessionSelector) {
      this.sessionSelector.value = id;
    }
    this.updatePromptBarState();
    this.startOutputPolling();

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
    const skipPermissions = this.skipPermissionsCheckbox ? this.skipPermissionsCheckbox.checked : true;

    // Loading state
    const btn = this.createSessionConfirm;
    const originalText = btn.textContent;
    btn.textContent = 'CREATING...';
    btn.disabled = true;

    try {
      const result = await this.sessionAPI.createSession({ name, directory, skipPermissions });
      this.hideCreateSessionModal();
      // Session list will be updated via WebSocket
      if (result.session) {
        this.selectSession(result.session.id);
      }
    } catch (err) {
      console.error('Error creating session:', err);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
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
    }
  }

  async deleteSession(id) {
    if (!confirm('Delete this session?')) return;

    try {
      await this.sessionAPI.deleteSession(id);
      if (this.selectedSessionId === id) {
        this.selectedSessionId = null;
        this.stopOutputPolling();
        this.conversationOutput.textContent = '';
        this.updatePromptBarState();
      }
    } catch (err) {
      console.error('Error deleting session:', err);
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
    // Check if this is an observed session (no tmux, can't interact)
    const observedSession = this.managedSessions.find(s => s.claudeSessionId === claudeSessionId && s.observed);
    if (observedSession) {
      // Play a short error beep to indicate this bit isn't interactive
      this.audioManager.playErrorBeep();
      return;
    }

    // Find managed session with matching claudeSessionId
    const session = this.managedSessions.find(s => s.claudeSessionId === claudeSessionId && !s.observed);
    if (session && session.state !== 'offline') {
      this.selectSession(session.id);
      // Open the conversation panel
      if (this.conversationPanel.classList.contains('collapsed')) {
        this.conversationPanel.classList.remove('collapsed');
        document.body.classList.remove('conversation-collapsed');
        this.conversationToggle.innerHTML = '&#8744;';
        setTimeout(() => this.sessionGrid.onResize(), 300);
      }
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
