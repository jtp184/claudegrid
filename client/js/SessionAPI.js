/**
 * SessionAPI - REST client for session management
 */
export class SessionAPI {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async request(method, endpoint, body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  // Create a new session
  async createSession({ name, directory, continueSession = false }) {
    return this.request('POST', '/api/sessions', {
      name,
      directory,
      continueSession
    });
  }

  // List all sessions
  async listSessions() {
    return this.request('GET', '/api/sessions');
  }

  // Get single session
  async getSession(id) {
    return this.request('GET', `/api/sessions/${id}`);
  }

  // Send prompt to session
  async sendPrompt(id, prompt) {
    return this.request('POST', `/api/sessions/${id}/prompt`, { prompt });
  }

  // Cancel current operation (Ctrl+C)
  async cancelSession(id) {
    return this.request('POST', `/api/sessions/${id}/cancel`);
  }

  // Delete/kill session
  async deleteSession(id) {
    return this.request('DELETE', `/api/sessions/${id}`);
  }

  // Restart offline session
  async restartSession(id) {
    return this.request('POST', `/api/sessions/${id}/restart`);
  }

  // Rename session
  async renameSession(id, name) {
    return this.request('PATCH', `/api/sessions/${id}`, { name });
  }

  // Link Claude session ID
  async linkSession(id, claudeSessionId) {
    return this.request('POST', `/api/sessions/${id}/link`, { claudeSessionId });
  }

  // Send permission response
  async sendPermission(id, response) {
    return this.request('POST', `/api/sessions/${id}/permission`, { response });
  }

  // Get tmux output
  async getOutput(id, lines = 100) {
    return this.request('GET', `/api/sessions/${id}/output?lines=${lines}`);
  }
}
