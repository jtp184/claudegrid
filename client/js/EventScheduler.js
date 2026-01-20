/**
 * EventScheduler - Priority-based event scheduling for smooth animations
 *
 * Buffers events and processes them at a controlled rate, with priority handling
 * so important events (session create/end) remain instant while rapid events
 * (state changes, pulses) are coalesced and smoothed.
 */

// Priority levels
export const Priority = {
  IMMEDIATE: 0,  // Bypass queue, process instantly (create, end)
  HIGH: 1,       // Queue, process quickly (tool_start, tool_end)
  NORMAL: 2,     // Queue, coalesce within window (state)
  LOW: 3         // Coalesce, can be dropped if backlogged (pulse, dim)
};

// Event type to priority mapping
const EventPriority = {
  create: Priority.IMMEDIATE,
  end: Priority.IMMEDIATE,
  tool_start: Priority.HIGH,
  tool_end: Priority.HIGH,
  state: Priority.NORMAL,
  pulse: Priority.LOW,
  dim: Priority.LOW
};

// Timing parameters (ms)
const Config = {
  minEventInterval: 80,      // Min time between events per session (~4-5 per morph)
  stateCoalesceWindow: 100,  // Rapid state changes take the latest
  pulseCoalesceWindow: 150,  // Multiple pulses combine
  maxQueueAge: 2000,         // Drop events older than this
  processingInterval: 16     // ~60fps processing rate
};

/**
 * Per-session queue entry
 */
class SessionQueue {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.events = [];           // Queued events
    this.lastProcessTime = 0;   // When we last processed an event for this session
    this.pendingState = null;   // Coalesced state event
    this.pendingStateTime = 0;  // When state coalescing started
    this.pendingPulse = null;   // Coalesced pulse event
    this.pendingPulseTime = 0;  // When pulse coalescing started
  }

  /**
   * Add an event to this session's queue with coalescing
   */
  enqueue(eventData, priority) {
    const now = performance.now();

    // Handle coalescing for state events
    if (eventData.type === 'state') {
      if (this.pendingState && (now - this.pendingStateTime) < Config.stateCoalesceWindow) {
        // Replace pending state with newer one
        this.pendingState = eventData;
      } else {
        // Start new coalescing window
        this.pendingState = eventData;
        this.pendingStateTime = now;
      }
      return;
    }

    // Handle coalescing for pulse events
    if (eventData.type === 'pulse') {
      if (this.pendingPulse && (now - this.pendingPulseTime) < Config.pulseCoalesceWindow) {
        // Combine pulses - keep the latest but note we're combining
        this.pendingPulse._combinedCount = (this.pendingPulse._combinedCount || 1) + 1;
      } else {
        // Start new coalescing window
        this.pendingPulse = { ...eventData, _combinedCount: 1 };
        this.pendingPulseTime = now;
      }
      return;
    }

    // Handle coalescing for dim events - just keep the latest
    if (eventData.type === 'dim') {
      // Remove any existing dim event in the queue
      this.events = this.events.filter(e => e.data.type !== 'dim');
    }

    // Add to queue with timestamp and priority
    this.events.push({
      data: eventData,
      priority,
      timestamp: now
    });

    // Sort by priority (lower number = higher priority)
    this.events.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the next event to process, respecting timing constraints
   */
  dequeue(now) {
    // Check if enough time has passed since last event
    if ((now - this.lastProcessTime) < Config.minEventInterval) {
      return null;
    }

    // Check for matured coalesced state
    if (this.pendingState && (now - this.pendingStateTime) >= Config.stateCoalesceWindow) {
      const event = this.pendingState;
      this.pendingState = null;
      this.lastProcessTime = now;
      return event;
    }

    // Check for matured coalesced pulse
    if (this.pendingPulse && (now - this.pendingPulseTime) >= Config.pulseCoalesceWindow) {
      const event = this.pendingPulse;
      this.pendingPulse = null;
      this.lastProcessTime = now;
      return event;
    }

    // Get next queued event
    if (this.events.length > 0) {
      const entry = this.events.shift();

      // Skip events that are too old
      if ((now - entry.timestamp) > Config.maxQueueAge) {
        return this.dequeue(now); // Try next event
      }

      this.lastProcessTime = now;
      return entry.data;
    }

    return null;
  }

  /**
   * Check if there are pending events
   */
  hasPending() {
    return this.events.length > 0 || this.pendingState !== null || this.pendingPulse !== null;
  }

  /**
   * Clear all pending events (e.g., when session ends)
   */
  clear() {
    this.events = [];
    this.pendingState = null;
    this.pendingPulse = null;
  }
}

export class EventScheduler {
  constructor(sessionGrid) {
    this.sessionGrid = sessionGrid;
    this.sessionQueues = new Map();  // session_id -> SessionQueue
    this.isProcessing = false;
    this.animationFrameId = null;

    // Start the processing loop
    this.startProcessing();
  }

  /**
   * Enqueue an event for processing
   */
  enqueue(eventData) {
    const { session_id, type } = eventData;
    const priority = EventPriority[type] ?? Priority.NORMAL;

    // IMMEDIATE priority events bypass the queue entirely
    if (priority === Priority.IMMEDIATE) {
      this.processEvent(eventData);
      return;
    }

    // Get or create session queue
    if (!this.sessionQueues.has(session_id)) {
      this.sessionQueues.set(session_id, new SessionQueue(session_id));
    }

    const queue = this.sessionQueues.get(session_id);
    queue.enqueue(eventData, priority);
  }

  /**
   * Process a single event through the session grid
   */
  processEvent(eventData) {
    this.sessionGrid.handleEvent(eventData);
  }

  /**
   * Start the frame-based processing loop
   */
  startProcessing() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.processLoop();
  }

  /**
   * Stop the processing loop
   */
  stopProcessing() {
    this.isProcessing = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Main processing loop - runs each frame
   */
  processLoop() {
    if (!this.isProcessing) return;

    const now = performance.now();

    // Process one event per session per frame (if ready)
    for (const [sessionId, queue] of this.sessionQueues) {
      const event = queue.dequeue(now);
      if (event) {
        this.processEvent(event);
      }

      // Clean up empty queues for ended sessions
      if (!queue.hasPending() && !this.sessionGrid.getSession(sessionId)) {
        this.sessionQueues.delete(sessionId);
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.processLoop());
  }

  /**
   * Clear queue for a specific session (called when session ends)
   */
  clearSession(sessionId) {
    const queue = this.sessionQueues.get(sessionId);
    if (queue) {
      queue.clear();
      this.sessionQueues.delete(sessionId);
    }
  }

  /**
   * Check if a session has pending events
   */
  hasPendingEvents(sessionId) {
    const queue = this.sessionQueues.get(sessionId);
    return queue ? queue.hasPending() : false;
  }

  /**
   * Get animation state for a session (for animation-aware scheduling)
   */
  getAnimationState(sessionId) {
    const bit = this.sessionGrid.getSession(sessionId);
    if (!bit) return null;

    return {
      morphProgress: bit.morphProgress,
      isAnimating: bit.morphProgress < 1,
      pulseIntensity: bit.pulseIntensity
    };
  }
}
