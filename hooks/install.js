#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'SessionEnd',
  'Notification',
  'PermissionRequest'
];

function getClaudeConfigPath() {
  const home = os.homedir();
  return path.join(home, '.claude', 'settings.json');
}

function getHookScriptPath() {
  return path.resolve(__dirname, 'claudegrid-hook.sh');
}

function readSettings() {
  const configPath = getClaudeConfigPath();
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  }
  return {};
}

function writeSettings(settings) {
  const configPath = getClaudeConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
}

function hookContainsClaudeGrid(hookEntry, hookPath) {
  // Handle nested hooks structure: { hooks: [{ type, command }] }
  if (hookEntry.hooks && Array.isArray(hookEntry.hooks)) {
    return hookEntry.hooks.some(h =>
      h.command && (h.command === hookPath || h.command.includes('claudegrid-hook.sh'))
    );
  }
  // Handle flat structure: { type, command }
  if (hookEntry.command) {
    return hookEntry.command === hookPath || hookEntry.command.includes('claudegrid-hook.sh');
  }
  return false;
}

function installHooks() {
  const hookPath = getHookScriptPath();

  // Make hook script executable
  try {
    fs.chmodSync(hookPath, '755');
  } catch (err) {
    console.error('Warning: Could not make hook script executable:', err.message);
  }

  const settings = readSettings();

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let installed = 0;
  let skipped = 0;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    // Check if hook already exists (handle both nested and flat structures)
    const alreadyExists = settings.hooks[event].some(entry =>
      hookContainsClaudeGrid(entry, hookPath)
    );

    if (alreadyExists) {
      skipped++;
      continue;
    }

    // Add hook in nested format (matching Claude Code's expected structure)
    settings.hooks[event].push({
      hooks: [{
        type: 'command',
        command: hookPath
      }]
    });
    installed++;
  }

  writeSettings(settings);

  console.log(`
ClaudeGrid Hooks Installation
=============================
Hook script: ${hookPath}
Config file: ${getClaudeConfigPath()}

Installed: ${installed} hooks
Skipped:   ${skipped} hooks (already installed)

Events hooked:
${HOOK_EVENTS.map(e => `  - ${e}`).join('\n')}

You may need to restart Claude Code for hooks to take effect.
`);
}

function uninstallHooks() {
  const settings = readSettings();
  const hookPath = getHookScriptPath();

  if (!settings.hooks) {
    console.log('No hooks configured.');
    return;
  }

  let removed = 0;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) continue;

    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(
      entry => !hookContainsClaudeGrid(entry, hookPath)
    );
    removed += before - settings.hooks[event].length;

    // Clean up empty arrays
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings);

  console.log(`
ClaudeGrid Hooks Uninstallation
===============================
Removed: ${removed} hooks

You may need to restart Claude Code for changes to take effect.
`);
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--uninstall') || args.includes('-u')) {
  uninstallHooks();
} else {
  installHooks();
}
