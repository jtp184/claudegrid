#!/usr/bin/env node

const path = require('path');
const { createServer } = require('../server/index.js');

const PORT = process.env.CLAUDEGRID_PORT || 3333;

const server = createServer();

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  const urlPad = ' '.repeat(Math.max(0, 37 - url.length));
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                      ClaudeGrid                          ║
║         Claude Code Lifecycle Event Visualizer            ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on ${url}${urlPad}║
║                                                           ║
║  To install Claude Code hooks, run:                       ║
║    npx claudegrid --install-hooks                         ║
║  or:                                                      ║
║    node hooks/install.js                                  ║
╚═══════════════════════════════════════════════════════════╝
`);
});

// Handle install hooks flag
if (process.argv.includes('--install-hooks')) {
  require('../hooks/install.js');
}
