import { SessionGrid } from './SessionGrid.js';
import { EventLog } from './EventLog.js';
import { AudioManager } from './AudioManager.js';

class ClaudeGridApp {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.logContainer = document.getElementById('log-entries');
    this.connectionStatus = document.getElementById('connection-status');
    this.sessionCount = document.getElementById('session-count');
    this.emptyState = document.getElementById('empty-state');
    this.soundToggle = document.getElementById('sound-toggle');
    this.clearLogBtn = document.getElementById('clear-log');

    this.sessionGrid = new SessionGrid(this.canvas);
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
      const enabled = this.audioManager.toggle();
      this.soundToggle.textContent = `SOUND: ${enabled ? 'ON' : 'OFF'}`;
      this.soundToggle.classList.toggle('active', enabled);

      if (enabled) {
        // Initialize audio on first enable (requires user gesture)
        await this.audioManager.init();
      }
    });

    this.clearLogBtn.addEventListener('click', () => {
      this.eventLog.clear();
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
        this.updateSessionCount();
        break;

      case 'event':
        this.handleEvent(data);
        break;
    }
  }

  handleEvent(eventData) {
    // Update visualization
    this.sessionGrid.handleEvent(eventData);

    // Log event
    this.eventLog.addEntry(eventData);

    // Play sound
    this.playEventSound(eventData);

    // Update UI
    this.updateSessionCount();
  }

  playEventSound(eventData) {
    const { event } = eventData;
    const hookEvent = event?.hook_event_name;

    if (hookEvent === 'PostToolUse') {
      const success = !event.tool_use_blocked;
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
