const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Validate tmux session name (security)
const TMUX_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

function validateTmuxName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid tmux session name');
  }
  if (!TMUX_NAME_REGEX.test(name)) {
    throw new Error('Tmux session name contains invalid characters');
  }
  if (name.length > 64) {
    throw new Error('Tmux session name too long');
  }
  return name;
}

// Validate directory path (prevent traversal)
function validateDirectoryPath(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('Invalid directory path');
  }

  // Resolve to absolute path
  const resolved = path.resolve(dirPath);

  // Check for directory traversal attempts
  if (dirPath.includes('..')) {
    throw new Error('Directory traversal not allowed');
  }

  // Check if directory exists
  if (!fs.existsSync(resolved)) {
    throw new Error('Directory does not exist');
  }

  // Check if it's actually a directory
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('Path is not a directory');
  }

  return resolved;
}

// Execute tmux command safely using execFile
function tmuxExec(args) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// List all tmux sessions
async function listSessions() {
  try {
    const output = await tmuxExec(['list-sessions', '-F', '#{session_name}']);
    return output.split('\n').filter(Boolean);
  } catch (err) {
    // No sessions/server exist - these are all valid "empty" states
    const msg = err.message.toLowerCase();
    if (msg.includes('no server running') ||
        msg.includes('no sessions') ||
        msg.includes('no such file or directory') ||
        msg.includes('connection refused') ||
        msg.includes('error connecting')) {
      return [];
    }
    throw err;
  }
}

// Check if tmux session exists
async function sessionExists(sessionName) {
  const sessions = await listSessions();
  return sessions.includes(sessionName);
}

// Create a new tmux session and run Claude Code
async function createSession(sessionName, directory, options = {}) {
  const validName = validateTmuxName(sessionName);
  const validDir = validateDirectoryPath(directory);

  // Check if session already exists
  if (await sessionExists(validName)) {
    throw new Error(`Tmux session '${validName}' already exists`);
  }

  // Find claude binary - check common locations
  const claudePaths = [
    process.env.HOME + '/.local/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ];
  let claudeBin = 'claude';  // fallback to PATH
  for (const p of claudePaths) {
    if (require('fs').existsSync(p)) {
      claudeBin = p;
      break;
    }
  }

  // Build claude command arguments
  const claudeArgs = ['--dangerously-skip-permissions'];
  if (options.continueSession) {
    claudeArgs.push('--continue');
  }

  // Create new tmux session in background running bash without profile
  // (profile can cause issues in minimal systemd environment)
  // Then send the claude command to it
  await tmuxExec([
    'new-session',
    '-d',                    // Detached
    '-s', validName,         // Session name
    '-c', validDir,          // Working directory
    '-x', '200',             // Width
    '-y', '50',              // Height
    'bash --norc --noprofile'  // Shell command (passed as single string to tmux)
  ]);

  // Wait for shell to fully initialize
  await new Promise(resolve => setTimeout(resolve, 300));

  // Now send the claude command to the session
  const claudeCmd = `${claudeBin} ${claudeArgs.join(' ')}`;
  await sendToTmuxSafe(validName, claudeCmd);

  return validName;
}

// Send text to tmux session safely (temp file + buffer approach)
async function sendToTmuxSafe(sessionName, text) {
  const validName = validateTmuxName(sessionName);

  // Check session exists
  if (!(await sessionExists(validName))) {
    throw new Error(`Tmux session '${validName}' not found`);
  }

  // Generate random temp file name
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const tempFile = path.join(os.tmpdir(), `claudegrid-prompt-${randomSuffix}.txt`);

  try {
    // Step 1: Write prompt to temp file
    fs.writeFileSync(tempFile, text, 'utf8');

    // Step 2: Load into tmux paste buffer
    await tmuxExec(['load-buffer', tempFile]);

    // Step 3: Paste buffer into session (target the first window's first pane)
    await tmuxExec(['paste-buffer', '-t', `${validName}:0.0`]);

    // Step 4: Wait a bit then send Enter
    await new Promise(resolve => setTimeout(resolve, 100));
    await tmuxExec(['send-keys', '-t', `${validName}:0.0`, 'Enter']);

  } finally {
    // Step 5: Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Send keys directly to tmux session (for simple inputs like "1", "y", etc.)
async function sendKeys(sessionName, keys) {
  const validName = validateTmuxName(sessionName);

  if (!(await sessionExists(validName))) {
    throw new Error(`Tmux session '${validName}' not found`);
  }

  await tmuxExec(['send-keys', '-t', validName, keys]);
}

// Send Ctrl+C to cancel current operation
async function sendCancel(sessionName) {
  const validName = validateTmuxName(sessionName);

  if (!(await sessionExists(validName))) {
    throw new Error(`Tmux session '${validName}' not found`);
  }

  await tmuxExec(['send-keys', '-t', validName, 'C-c']);
}

// Kill a tmux session
async function killSession(sessionName) {
  const validName = validateTmuxName(sessionName);

  if (!(await sessionExists(validName))) {
    return false; // Already gone
  }

  await tmuxExec(['kill-session', '-t', validName]);
  return true;
}

// Capture pane content (for permission detection)
async function capturePane(sessionName, lines = 50) {
  const validName = validateTmuxName(sessionName);

  if (!(await sessionExists(validName))) {
    throw new Error(`Tmux session '${validName}' not found`);
  }

  const output = await tmuxExec([
    'capture-pane',
    '-t', validName,
    '-p',                    // Print to stdout
    '-S', `-${lines}`        // Start from N lines back
  ]);

  return output;
}

module.exports = {
  validateTmuxName,
  validateDirectoryPath,
  listSessions,
  sessionExists,
  createSession,
  sendToTmuxSafe,
  sendKeys,
  sendCancel,
  killSession,
  capturePane,
  TMUX_NAME_REGEX
};
