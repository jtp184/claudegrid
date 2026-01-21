# Vibecraft: Claude Instance Control System

This document explains how Vibecraft enables sending prompts to and receiving responses from Claude Code instances.

## Architecture Overview

```
Browser (Prompt Input)
    ↓
SessionAPI (HTTP POST)
    ↓
Server: POST /sessions/:id/prompt
    ↓
tmux send-keys (via execFile)
    ↓
Claude Code (reads from tmux)
    ↓ (tool use/responses)
Hook captures events
    ↓
Server: events.jsonl + WebSocket broadcast
    ↓
Browser receives via WebSocket
```

Vibecraft uses a multi-layer communication system connecting:
- **Browser UI** (Three.js visualization)
- **Node.js WebSocket Server** (real-time relay)
- **tmux sessions** (Claude Code instances)
- **Event Hook System** (captures and broadcasts activity)

---

## Sending Prompts to Claude

### 1. Primary Endpoint: POST /sessions/:id/prompt

The main mechanism for sending prompts to managed Claude instances.

**Location:** `server/index.ts` lines 1841-1863

```typescript
// Request
POST /sessions/:id/prompt
Content-Type: application/json
{ "prompt": "Your prompt text here" }

// Response
{ "ok": true }
// or
{ "ok": false, "error": "Session not found" }
```

### 2. Safe tmux Injection

Vibecraft uses a **three-step security protocol** to safely inject text into tmux sessions.

**Location:** `server/index.ts` lines 225-249 (`sendToTmuxSafe`)

```bash
# Step 1: Write prompt to temp file with random name
/tmp/vibecraft-prompt-abc123.txt

# Step 2: Load into tmux paste buffer
tmux load-buffer /tmp/vibecraft-prompt-abc123.txt

# Step 3: Paste into target session
tmux paste-buffer -t vibecraft-session123

# Step 4: Send Enter key (after 100ms delay)
tmux send-keys -t vibecraft-session123 Enter

# Step 5: Clean up temp file
```

**Why this approach?**
- Uses `execFile` instead of `exec` to prevent shell injection
- Avoids shell metacharacter issues with complex prompts
- Validates tmux session names with regex: `/^[a-zA-Z0-9_-]+$/`

### 3. Client-Side API

**Location:** `src/api/SessionAPI.ts`

```typescript
class SessionAPI {
  async sendPrompt(sessionId: string, prompt: string): Promise<SimpleResponse> {
    const response = await fetch(`${apiUrl}/sessions/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    return await response.json()
  }
}
```

### 4. Legacy Endpoint: POST /prompt

For backwards compatibility with unmanaged Claude instances.

**Location:** `server/index.ts` lines 1582-1635

```typescript
POST /prompt
{ "prompt": "text", "send": true }
```

This uses the default `VIBECRAFT_TMUX_SESSION` (typically `claude`).

---

## Receiving Responses from Claude

### 1. Event Hook System

Claude Code is configured with 8 hooks that fire on key events.

**Hook Location:** `~/.vibecraft/hooks/vibecraft-hook.sh`

| Hook Type | Event Generated | Purpose |
|-----------|-----------------|---------|
| PreToolUse | `pre_tool_use` | Tool is about to run |
| PostToolUse | `post_tool_use` | Tool completed (with result) |
| Stop | `stop` | Claude finished responding |
| UserPromptSubmit | `user_prompt_submit` | User sent a prompt |
| SubagentStop | `subagent_stop` | Subagent task completed |
| SessionStart | `session_start` | New Claude session started |
| SessionEnd | `session_end` | Session terminated |
| Notification | `notification` | System notification |

**Hook writes to TWO places:**
1. **Append to `~/.vibecraft/data/events.jsonl`** - Persistent log
2. **POST to `http://localhost:4003/event`** - Real-time WebSocket broadcast

### 2. Response Extraction

The `stop` hook extracts Claude's final response from the transcript file.

```bash
# Hook reads transcript, extracts latest assistant message
# Stores in event.response field
```

### 3. WebSocket Broadcasting

**Location:** `server/index.ts` lines 1424-1431

```typescript
function broadcast(message: ServerMessage) {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}
```

### 4. Client Event Reception

**Location:** `src/events/EventClient.ts`

```typescript
eventClient.onEvent((event) => {
  // Handle individual events (pre_tool_use, post_tool_use, stop, etc.)
  handleEvent(event)
})

eventClient.onHistory((events) => {
  // Handle batch of historical events on reconnect
  events.forEach(handleEvent)
})
```

---

## WebSocket Protocol

### Client → Server Messages

```typescript
type ClientMessage =
  | { type: 'subscribe' }
  | { type: 'get_history'; payload?: { limit?: number } }
  | { type: 'ping' }
  | { type: 'voice_start' }
  | { type: 'voice_stop' }
  | { type: 'permission_response'; payload: { sessionId, response } }
```

### Server → Client Messages

```typescript
type ServerMessage =
  | { type: 'event'; payload: ClaudeEvent }        // Individual event
  | { type: 'history'; payload: ClaudeEvent[] }    // Batch of old events
  | { type: 'sessions'; payload: ManagedSession[] } // Session list update
  | { type: 'permission_prompt'; payload: {...} }   // Permission request
  | { type: 'tokens'; payload: {...} }              // Token count update
  | { type: 'text_tiles'; payload: TextTile[] }     // Grid labels
```

---

## Managed Session Lifecycle

### Session Creation

**Location:** `server/index.ts` lines 764-842 (`createSession`)

```typescript
POST /sessions
{
  "name": "My Session",
  "directory": "/path/to/project",
  "continueSession": true,
  "useChrome": false,
  "dangerouslySkipPermissions": true
}
```

This:
1. Spawns a new tmux session: `vibecraft-{shortId}`
2. Runs Claude Code with specified flags
3. Tracks git status
4. Persists to `data/sessions.json`

### Session States

| State | Meaning |
|-------|---------|
| `idle` | Waiting for prompts |
| `working` | Claude is processing |
| `waiting` | Permission prompt shown |
| `offline` | tmux session died |

### Health Checks

**Every 5 seconds:** Runs `tmux list-sessions`, marks missing sessions `offline`

**Every 10 seconds:** Sessions stuck in `working` for >2min auto-transition to `idle`

---

## Permission Prompt Handling

When Claude needs permission (file edit, bash command), Vibecraft intercepts and forwards to the browser.

### Detection

**Location:** `server/index.ts` lines 495-578

```bash
# Polls tmux output every 1 second
tmux capture-pane -t session -p

# Detects "Do you want to proceed?" patterns
# Extracts numbered options (1. Yes, 2. No, etc.)
```

### Browser Response

```typescript
// Browser sends back option number
POST /sessions/:id/permission
{ "response": "1" }

// Server sends to tmux
execFile('tmux', ['send-keys', '-t', session.tmuxSession, '1'])
```

---

## Complete Control Flow Example

**User sends "List files" to a managed session:**

```
1. Browser: User types prompt, presses Enter
   └─ form.addEventListener('submit')

2. Browser: Calls SessionAPI
   └─ sessionAPI.sendPrompt(sessionId, "List files")
   └─ fetch(POST /sessions/:id/prompt)

3. Server: Receives HTTP request
   └─ sendPromptToSession(id, "List files")
   └─ sendToTmuxSafe(session.tmuxSession, "List files")
      ├─ Write to temp file
      ├─ tmux load-buffer
      ├─ tmux paste-buffer
      ├─ Wait 100ms
      ├─ tmux send-keys Enter
      └─ Delete temp file

4. Claude Code: Receives text in tmux pane
   └─ Executes Bash tool (ls -la)

5. Hook captures: PreToolUse event
   └─ Appends to events.jsonl
   └─ POST to /event endpoint
   └─ Server broadcasts via WebSocket

6. Browser: Receives WebSocket event
   └─ EventClient.onEvent()
   └─ handleEvent() updates UI
   └─ Character moves to terminal station

7. Hook captures: PostToolUse event
   └─ Same broadcast flow

8. Hook captures: Stop event
   └─ Includes Claude's final response text
   └─ Response shown in activity feed
```

---

## API Reference

### Session Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/sessions` | Create new session |
| `GET` | `/sessions` | List all sessions |
| `POST` | `/sessions/:id/prompt` | Send prompt |
| `PATCH` | `/sessions/:id` | Rename session |
| `DELETE` | `/sessions/:id` | Kill session |
| `POST` | `/sessions/:id/restart` | Respawn offline session |
| `POST` | `/sessions/:id/link` | Link Claude sessionId |
| `POST` | `/sessions/:id/cancel` | Send Ctrl+C |
| `POST` | `/sessions/:id/permission` | Answer permission prompt |

### Utility Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Server health check |
| `GET` | `/stats` | Event statistics |
| `POST` | `/event` | Receive hook events |
| `GET` | `/tmux-output` | Get last 100 lines of tmux pane |

---

## Security Considerations

### Input Validation

- **Directory paths:** `validateDirectoryPath()` prevents directory traversal
- **tmux names:** Whitelist regex `/^[a-zA-Z0-9_-]+$/`
- **Request body:** 1MB size limit prevents DoS

### Origin Validation

```typescript
function isOriginAllowed(origin: string): boolean {
  const url = new URL(origin)

  // Allow localhost on any port
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return true
  }

  // Production: vibecraft.sh over HTTPS only
  if (url.hostname === 'vibecraft.sh' && url.protocol === 'https:') {
    return true
  }

  return false
}
```

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIBECRAFT_PORT` | 4003 | WebSocket/API server port |
| `VIBECRAFT_EVENTS_FILE` | `~/.vibecraft/data/events.jsonl` | Event log |
| `VIBECRAFT_SESSIONS_FILE` | `~/.vibecraft/data/sessions.json` | Session persistence |
| `VIBECRAFT_TMUX_SESSION` | `claude` | Default tmux session |
| `VIBECRAFT_DATA_DIR` | `~/.vibecraft/data` | Data directory |
