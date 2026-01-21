const tmux = require('./tmux');
const { SessionState } = require('./SessionStore');

// Permission prompt patterns to detect
const PERMISSION_PATTERNS = [
  /Do you want to proceed\?/i,
  /Allow this action\?/i,
  /Do you want to allow/i,
  /Approve this/i,
  /\[y\/n\]/i,
  /\(y\/n\)/i
];

// Option extraction pattern (numbered options like "1. Yes", "2. No")
const OPTION_PATTERN = /^\s*(\d+)\.\s*(.+)$/gm;

let pollInterval = null;
let sessionStore = null;
let onPermissionPrompt = null;

// Track which sessions we've already sent permission prompts for
const sentPrompts = new Map();

/**
 * Start polling sessions for permission prompts
 */
function start(store, callback) {
  sessionStore = store;
  onPermissionPrompt = callback;

  // Poll every second for sessions in 'waiting' or 'idle' state
  pollInterval = setInterval(pollSessions, 1000);
  console.log('Permission detector started');
}

/**
 * Stop polling
 */
function stop() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  console.log('Permission detector stopped');
}

/**
 * Poll all sessions for permission prompts
 */
async function pollSessions() {
  if (!sessionStore) return;

  const sessions = sessionStore.getAll();

  for (const session of sessions) {
    // Skip offline sessions
    if (session.state === SessionState.OFFLINE) {
      sentPrompts.delete(session.id);
      continue;
    }

    // Only check sessions that might have permission prompts
    // (idle or waiting - working sessions are actively processing)
    if (session.state !== SessionState.IDLE && session.state !== SessionState.WAITING) {
      continue;
    }

    try {
      await checkSessionForPermission(session);
    } catch (err) {
      // Ignore errors (session might have ended)
    }
  }
}

/**
 * Check a single session for permission prompts
 */
async function checkSessionForPermission(session) {
  // Capture last 30 lines of tmux output
  const output = await tmux.capturePane(session.tmuxSession, 30);

  // Check if output contains a permission prompt
  const hasPrompt = PERMISSION_PATTERNS.some(pattern => pattern.test(output));

  if (!hasPrompt) {
    // Clear any previous prompt tracking
    sentPrompts.delete(session.id);
    return;
  }

  // Check if we already sent this prompt (use hash of last 10 lines)
  const promptHash = hashString(output.split('\n').slice(-10).join('\n'));
  if (sentPrompts.get(session.id) === promptHash) {
    return; // Already sent this prompt
  }

  // Extract options if present
  const options = extractOptions(output);

  // Update session state to waiting
  sessionStore.setState(session.id, SessionState.WAITING);

  // Mark as sent
  sentPrompts.set(session.id, promptHash);

  // Notify callback
  if (onPermissionPrompt) {
    onPermissionPrompt(session.id, {
      text: extractPromptText(output),
      options
    });
  }
}

/**
 * Extract numbered options from output
 */
function extractOptions(output) {
  const options = [];
  const lines = output.split('\n');

  // Look for numbered options in the last 15 lines
  for (const line of lines.slice(-15)) {
    const match = line.match(/^\s*(\d+)\.\s*(.+)$/);
    if (match) {
      options.push({
        number: match[1],
        label: match[2].trim()
      });
    }
  }

  // If no numbered options found, provide default y/n
  if (options.length === 0) {
    return [
      { number: 'y', label: 'Yes' },
      { number: 'n', label: 'No' }
    ];
  }

  return options;
}

/**
 * Extract the permission prompt text
 */
function extractPromptText(output) {
  const lines = output.split('\n');

  // Find the line containing the permission prompt
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (PERMISSION_PATTERNS.some(pattern => pattern.test(line))) {
      // Return this line and a few before it for context
      const start = Math.max(0, i - 3);
      return lines.slice(start, i + 1).join('\n').trim();
    }
  }

  // Fallback: return last few non-empty lines
  return lines.filter(l => l.trim()).slice(-5).join('\n');
}

/**
 * Simple string hash for comparing prompts
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

module.exports = { start, stop };
