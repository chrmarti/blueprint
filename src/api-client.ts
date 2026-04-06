// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import type { ServerAPI, DirEntry, GitStatusEntry } from './types';

// Terminal WebSocket connection
interface TerminalConnection {
  send(message: { type: string; data?: string; cols?: number; rows?: number }): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: () => void): void;
  close(): void;
}

// Chat WebSocket connection
interface ChatConnection {
  send(content: string): void;
  onChunk(callback: (content: string) => void): void;
  onEvent(callback: (data: unknown) => void): void;
  onDone(callback: () => void): void;
  close(): void;
}

// Copilot WebSocket connection
interface CopilotConnection {
  onChunk(callback: (content: string) => void): void;
  onEvent(callback: (data: unknown) => void): void;
  onDone(callback: (ok: boolean, error?: string) => void): void;
  close(): void;
}

const serverAPI: ServerAPI = {
  async readDir(relativePath = ''): Promise<DirEntry[]> {
    const url = `/api/fs/readDir?path=${encodeURIComponent(relativePath)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`readDir failed: ${res.statusText}`);
    return res.json();
  },

  async readFile(relativePath: string): Promise<string> {
    const url = `/api/fs/readFile?path=${encodeURIComponent(relativePath)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`readFile failed: ${res.statusText}`);
    return res.text();
  },

  async writeFile(relativePath: string, content: string): Promise<void> {
    const res = await fetch('/api/fs/writeFile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relativePath, content }),
    });
    if (!res.ok) throw new Error(`writeFile failed: ${res.statusText}`);
  },

  async deleteEntry(relativePath: string): Promise<void> {
    const res = await fetch('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relativePath }),
    });
    if (!res.ok) throw new Error(`deleteEntry failed: ${res.statusText}`);
  },

  async cleanWorkspace(dryRun = false): Promise<{ ok: boolean; deleted: string[]; error?: string }> {
    const res = await fetch('/api/fs/cleanWorkspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    });
    return res.json();
  },

  async getWorkspaceFolder(): Promise<string> {
    const res = await fetch('/api/workspace');
    if (!res.ok) throw new Error(`getWorkspaceFolder failed: ${res.statusText}`);
    const data = await res.json();
    return data.folder;
  },

  async getUser(): Promise<{ login: string; avatar_url: string } | null> {
    const res = await fetch('/api/auth/user');
    if (!res.ok) return null;
    return res.json();
  },

  async listModels(): Promise<{ ok: boolean; models: Array<{ id: string; name: string }>; error?: string }> {
    const res = await fetch('/api/copilot/models');
    return res.json();
  },

  async initCopilot(): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/copilot/init', { method: 'POST' });
    return res.json();
  },

  async implement(options: { model: string; systemPrompt?: string; userPrompt: string }): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/copilot/implement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return res.json();
  },

  async stopCopilot(): Promise<{ ok: boolean }> {
    const res = await fetch('/api/copilot/stop', { method: 'POST' });
    return res.json();
  },

  async gitStatus(): Promise<GitStatusEntry[]> {
    const res = await fetch('/api/git/status');
    if (!res.ok) return [];
    return res.json();
  },

  connectTerminal(): TerminalConnection {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<() => void> = [];

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          dataCallbacks.forEach((cb) => cb(msg.data));
        } else if (msg.type === 'exit') {
          exitCallbacks.forEach((cb) => cb());
        }
      } catch {
        // Ignore parse errors
      }
    };

    return {
      send(message) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
      onData(callback) {
        dataCallbacks.push(callback);
      },
      onExit(callback) {
        exitCallbacks.push(callback);
      },
      close() {
        ws.close();
      },
    };
  },

  connectChat(): ChatConnection {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
    const chunkCallbacks: Array<(content: string) => void> = [];
    const eventCallbacks: Array<(data: unknown) => void> = [];
    const doneCallbacks: Array<() => void> = [];

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chunk') {
          chunkCallbacks.forEach((cb) => cb(msg.content));
        } else if (msg.type === 'event') {
          eventCallbacks.forEach((cb) => cb(msg.data));
        } else if (msg.type === 'done') {
          doneCallbacks.forEach((cb) => cb());
        }
      } catch {
        // Ignore parse errors
      }
    };

    return {
      send(content) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'message', content }));
        }
      },
      onChunk(callback) {
        chunkCallbacks.push(callback);
      },
      onEvent(callback) {
        eventCallbacks.push(callback);
      },
      onDone(callback) {
        doneCallbacks.push(callback);
      },
      close() {
        ws.close();
      },
    };
  },

  connectCopilot(): CopilotConnection {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/copilot`);
    const chunkCallbacks: Array<(content: string) => void> = [];
    const eventCallbacks: Array<(data: unknown) => void> = [];
    const doneCallbacks: Array<(ok: boolean, error?: string) => void> = [];

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chunk') {
          chunkCallbacks.forEach((cb) => cb(msg.content));
        } else if (msg.type === 'event') {
          eventCallbacks.forEach((cb) => cb(msg.data));
        } else if (msg.type === 'done') {
          doneCallbacks.forEach((cb) => cb(msg.ok, msg.error));
        }
      } catch {
        // Ignore parse errors
      }
    };

    return {
      onChunk(callback) {
        chunkCallbacks.push(callback);
      },
      onEvent(callback) {
        eventCallbacks.push(callback);
      },
      onDone(callback) {
        doneCallbacks.push(callback);
      },
      close() {
        ws.close();
      },
    };
  },
};

// Export for use in other modules
export { serverAPI };

// Make available globally for browser context
(window as unknown as { serverAPI: ServerAPI }).serverAPI = serverAPI;
