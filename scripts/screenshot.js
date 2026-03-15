#!/usr/bin/env node

/**
 * Automated screenshot generator for ClaudeGrid.
 *
 * Starts the server, opens a headless browser, seeds demo sessions
 * and events via the API (after the browser connects so events appear
 * in the event log), and captures an 800x600 PNG to example.png.
 *
 * Usage: node scripts/screenshot.js
 * Requires: playwright (dev dependency)
 */

const http = require('http');
const path = require('path');
const { createServer } = require('../server/index.js');

const PORT = 0; // Let OS pick a free port
const OUTPUT = path.join(__dirname, '..', 'example.png');
const WIDTH = 800;
const HEIGHT = 600;

// Three demo sessions — one per visual state
const DEMO_SESSIONS = [
  { id: 'aaaa1111-0000-0000-0000-000000000001', name: 'api-server' },
  { id: 'bbbb2222-0000-0000-0000-000000000002', name: 'test-suite' },
  { id: 'cccc3333-0000-0000-0000-000000000003', name: 'deploy-bot' },
];

/**
 * Build event sequence showing three distinct bit states:
 *   Session 0 → THINKING (cyan icosahedron, fast spin, orbiting tool bit)
 *   Session 1 → YES      (yellow octahedron, successful tool completion)
 *   Session 2 → NO       (orange starburst, blocked tool)
 */
function buildEventSequence() {
  const events = [];

  const push = (sessionIdx, hook_event_name, extra = {}) => {
    events.push({
      session_id: DEMO_SESSIONS[sessionIdx].id,
      hook_event_name,
      cwd: `/home/user/projects/${DEMO_SESSIONS[sessionIdx].name}`,
      ...extra,
    });
  };

  // Session 0: active work → ends in THINKING with an orbiting tool bit
  push(0, 'SessionStart');
  push(0, 'UserPromptSubmit');
  push(0, 'PreToolUse', { tool_name: 'Read', tool_use_id: 'tool-r-001' });
  push(0, 'PostToolUse', { tool_name: 'Read', tool_use_id: 'tool-r-001' });
  push(0, 'PreToolUse', { tool_name: 'Edit', tool_use_id: 'tool-e-002' });
  // Leave Edit open so the tool bit orbits

  // Session 1: completed a tool → YES state (yellow octahedron)
  push(1, 'SessionStart');
  push(1, 'UserPromptSubmit');
  push(1, 'PreToolUse', { tool_name: 'Grep', tool_use_id: 'tool-g-010' });
  push(1, 'PostToolUse', { tool_name: 'Grep', tool_use_id: 'tool-g-010' });

  // Session 2: blocked tool → NO state (orange starburst)
  push(2, 'SessionStart');
  push(2, 'UserPromptSubmit');
  push(2, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'tool-b-020' });
  push(2, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'tool-b-020', tool_use_blocked: true });

  return events;
}

async function postEvent(baseUrl, event) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(event);
    const url = new URL('/api/events', baseUrl);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // 1. Start the server
  const server = createServer();
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`Server listening on ${baseUrl}`);

  try {
    // 2. Launch browser with Playwright
    let playwright;
    try {
      playwright = require('playwright');
    } catch {
      playwright = require('playwright-core');
    }

    let browser;
    try {
      browser = await playwright.chromium.launch({ headless: true });
    } catch {
      browser = await playwright.firefox.launch({ headless: true });
    }

    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Navigate and wait for WebSocket to connect
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.status-badge.connected', { timeout: 10000 });

    // Expand the event log panel
    await page.click('#log-toggle');
    await sleep(350); // wait for CSS transition

    // 3. Seed events AFTER browser is connected so they show in the event log
    const events = buildEventSequence();
    for (const event of events) {
      await postEvent(baseUrl, event);
      await sleep(100); // enough delay for debouncer + event log animation
    }
    console.log(`Seeded ${events.length} demo events`);

    // Hide the empty state
    await page.evaluate(() => {
      const el = document.getElementById('empty-state');
      if (el) el.classList.add('hidden');
    });

    // Let Three.js render and animations settle (geometry morphs, color lerps)
    await sleep(2000);

    // 4. Take the screenshot
    await page.screenshot({ path: OUTPUT, type: 'png' });
    console.log(`Screenshot saved to ${OUTPUT}`);

    await browser.close();
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
