// EventLog - Activity sidebar
export class EventLog {
  constructor(containerElement) {
    this.container = containerElement;
    this.maxEntries = 100;
    this.entries = [];
  }

  addEntry(event) {
    const entry = this.createEntry(event);
    this.entries.unshift(entry);

    // Trim old entries
    while (this.entries.length > this.maxEntries) {
      const old = this.entries.pop();
      if (old.element.parentNode) {
        old.element.remove();
      }
    }

    // Add to DOM at top
    this.container.insertBefore(entry.element, this.container.firstChild);
  }

  createEntry(event) {
    const { session_id, hook_event_name, tool_name, tool_use_blocked } = event;
    const hookEvent = hook_event_name || event.type || 'Unknown';

    const el = document.createElement('div');
    el.className = `log-entry ${this.getEntryClass(hookEvent, event)}`;

    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const sessionShort = session_id ? session_id.slice(0, 8) : 'unknown';

    let details = '';
    if (tool_name) {
      details = `Tool: ${tool_name}`;
    }
    if (tool_use_blocked) {
      details += ' [BLOCKED]';
    }

    el.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-event">${this.formatEventName(hookEvent)}</span>
      <span class="log-session">${sessionShort}...</span>
      ${details ? `<div class="log-details">${details}</div>` : ''}
    `;

    return { element: el, event };
  }

  getEntryClass(hookEvent, event) {
    switch (hookEvent) {
      case 'SessionStart':
        return 'session-start';
      case 'SessionEnd':
        return 'session-end';
      case 'UserPromptSubmit':
        return 'user-prompt';
      case 'PreToolUse':
      case 'PostToolUse':
        if (event?.tool_use_blocked) {
          return 'tool-blocked';
        }
        return 'tool-use';
      case 'Stop':
      case 'SubagentStop':
        return 'stop';
      default:
        return '';
    }
  }

  formatEventName(eventName) {
    // Add spaces before capitals and uppercase
    return eventName
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .toUpperCase();
  }

  clear() {
    this.entries = [];
    this.container.innerHTML = '';
  }
}
