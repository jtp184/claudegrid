import { SessionGrid } from './SessionGrid.js';
import { EventLog } from './EventLog.js';
import { AudioManager } from './AudioManager.js';

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

    this.sessionGrid = new SessionGrid(this.canvas);
    this.debouncer = new SimpleDebouncer((event) => this.sessionGrid.handleEvent(event));
    this.eventLog = new EventLog(this.logContainer);
    this.audioManager = new AudioManager();

    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;

    this.setupEventListeners();
    this.connect();
    this.startRenderLoop();
  }

  setupEventListeners() {
    this.soundToggle.addEventListener('click', async () => {
      const mode = this.audioManager.toggle();
      const modeLabels = { off: 'OFF', response: 'RESPONSE ONLY', on: 'ON' };
      this.soundToggle.textContent = `SOUND: ${modeLabels[mode]}`;
      this.soundToggle.classList.toggle('active', mode !== 'off');

      if (mode !== 'off') {
        // Initialize audio on first enable (requires user gesture)
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
        // Initialize with existing sessions (empty in simplified model)
        this.sessionGrid.initFromSessions(data.sessions || []);
        this.updateSessionCount();
        break;

      case 'event':
        this.handleEvent(data);
        break;
    }
  }

  handleEvent(eventData) {
    // Route visualization through debouncer
    this.debouncer.enqueue(eventData);

    // Log event immediately (doesn't affect animations)
    this.eventLog.addEntry(eventData);

    // Play sound immediately (feedback should be instant)
    this.playEventSound(eventData);

    // Update UI
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
    if (count === 0) {
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
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ClaudeGridApp();
});
