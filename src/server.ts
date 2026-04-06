// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as pty from 'node-pty';
import { initAgent, implementWithAgent, stopAgent, listModels, type ImplementEvent } from './copilot-agent.js';
import { cleanWorkspace } from './clean.js';

const app = express();
app.use(express.json());

// Get workspace folder from command line or use current directory
const workspaceFolder = path.resolve(process.argv[2] || process.cwd());
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

console.log(`[server] Workspace folder: ${workspaceFolder}`);
console.log(`[server] App root: ${appRoot}`);

// Serve static files from dist
const distPath = path.join(appRoot, 'dist');
app.use(express.static(distPath));

// Validate path is within workspace
function validatePath(relativePath: string): string {
  const resolved = path.resolve(workspaceFolder, relativePath);
  if (!resolved.startsWith(workspaceFolder)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

// REST API endpoints

// Workspace info
app.get('/api/workspace', (_req, res) => {
  res.json({ folder: workspaceFolder });
});

// Read directory
app.get('/api/fs/readDir', async (req, res) => {
  try {
    const relativePath = (req.query.path as string) || '';
    const fullPath = validatePath(relativePath);
    
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result = entries
      .filter(e => e.name !== '.git') // Exclude .git
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }))
      .sort((a, b) => {
        // Directories first
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    
    res.json(result);
  } catch (err) {
    console.error('[server] readDir error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Read file
app.get('/api/fs/readFile', async (req, res) => {
  try {
    const relativePath = req.query.path as string;
    if (!relativePath) {
      return res.status(400).json({ error: 'Path required' });
    }
    
    const fullPath = validatePath(relativePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    console.error('[server] readFile error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Write file
app.post('/api/fs/writeFile', async (req, res) => {
  try {
    const { path: relativePath, content } = req.body;
    if (!relativePath) {
      return res.status(400).json({ error: 'Path required' });
    }
    
    const fullPath = validatePath(relativePath);
    
    // Create parent directories if needed
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] writeFile error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Delete file or directory
app.post('/api/fs/delete', async (req, res) => {
  try {
    const { path: relativePath } = req.body;
    if (!relativePath) {
      return res.status(400).json({ error: 'Path required' });
    }
    
    const fullPath = validatePath(relativePath);
    
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] delete error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Clean workspace
app.post('/api/fs/cleanWorkspace', async (req, res) => {
  try {
    const { dryRun = false } = req.body;
    const result = await cleanWorkspace(workspaceFolder, dryRun);
    res.json(result);
  } catch (err) {
    console.error('[server] cleanWorkspace error:', err);
    res.status(500).json({ ok: false, deleted: [], error: String(err) });
  }
});

// Git status
app.get('/api/git/status', async (_req, res) => {
  try {
    // Check if workspace is a git repo
    const gitDir = path.join(workspaceFolder, '.git');
    if (!fs.existsSync(gitDir)) {
      return res.json([]);
    }
    
    const result = childProcess.execFileSync('git', ['status', '--porcelain'], {
      cwd: workspaceFolder,
      encoding: 'utf-8',
    });
    
    const entries = result.split('\n')
      .filter(line => line.trim())
      .map(line => ({
        status: line.substring(0, 2),
        file: line.substring(3),
      }));
    
    res.json(entries);
  } catch (err) {
    console.error('[server] git status error:', err);
    res.json([]);
  }
});

// Auth - get user
app.get('/api/auth/user', async (_req, res) => {
  try {
    const token = await resolveGitHubToken();
    if (!token) {
      return res.json(null);
    }
    
    const user = await fetchGitHubUser(token);
    res.json(user);
  } catch (err) {
    console.error('[server] auth error:', err);
    res.json(null);
  }
});

// Copilot - list models
app.get('/api/copilot/models', async (_req, res) => {
  try {
    const token = await resolveGitHubToken();
    if (!token) {
      return res.json({ ok: false, models: [], error: 'No GitHub token available' });
    }
    
    initAgent({ githubToken: token, appRoot });
    const models = await listModels();
    res.json({ ok: true, models });
  } catch (err) {
    console.error('[server] listModels error:', err);
    res.json({ ok: false, models: [], error: String(err) });
  }
});

// Copilot - init
app.post('/api/copilot/init', async (_req, res) => {
  try {
    const token = await resolveGitHubToken();
    if (!token) {
      return res.json({ ok: false, error: 'No GitHub token available. Set GITHUB_TOKEN or run gh auth login.' });
    }
    
    initAgent({ githubToken: token, appRoot });
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] init error:', err);
    res.json({ ok: false, error: String(err) });
  }
});

// Copilot - implement
app.post('/api/copilot/implement', async (req, res) => {
  try {
    const { model, systemPrompt, userPrompt } = req.body;
    
    // Send initial response
    res.json({ ok: true });
    
    // Events will be sent via WebSocket
  } catch (err) {
    console.error('[server] implement error:', err);
    res.json({ ok: false, error: String(err) });
  }
});

// Copilot - stop
app.post('/api/copilot/stop', async (_req, res) => {
  try {
    await stopAgent();
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] stop error:', err);
    res.json({ ok: false });
  }
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket servers
const terminalWss = new WebSocketServer({ noServer: true });
const copilotWss = new WebSocketServer({ noServer: true });
const chatWss = new WebSocketServer({ noServer: true });

// Handle upgrade requests
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  
  if (pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/copilot') {
    copilotWss.handleUpgrade(request, socket, head, (ws) => {
      copilotWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/chat') {
    chatWss.handleUpgrade(request, socket, head, (ws) => {
      chatWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Terminal WebSocket
interface PtyInstance {
  process: ReturnType<typeof pty.spawn>;
}

const ptyInstances = new Map<WebSocket, PtyInstance>();

terminalWss.on('connection', (ws) => {
  console.log('[terminal] Client connected');
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      switch (msg.type) {
        case 'spawn': {
          // Kill existing pty if any
          const existing = ptyInstances.get(ws);
          if (existing) {
            existing.process.kill();
          }
          
          // Spawn new pty
          const shell = process.env.SHELL || '/bin/bash';
          const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: workspaceFolder,
            env: { ...process.env, TERM: 'xterm-256color' },
          });
          
          ptyProcess.onData((output) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'data', data: output }));
            }
          });
          
          ptyProcess.onExit(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'exit' }));
            }
            ptyInstances.delete(ws);
          });
          
          ptyInstances.set(ws, { process: ptyProcess });
          break;
        }
        
        case 'write': {
          const instance = ptyInstances.get(ws);
          if (instance && msg.data) {
            instance.process.write(msg.data);
          }
          break;
        }
        
        case 'resize': {
          const instance = ptyInstances.get(ws);
          if (instance && msg.cols && msg.rows) {
            instance.process.resize(msg.cols, msg.rows);
          }
          break;
        }
        
        case 'kill': {
          const instance = ptyInstances.get(ws);
          if (instance) {
            instance.process.kill();
            ptyInstances.delete(ws);
          }
          break;
        }
      }
    } catch (err) {
      console.error('[terminal] Error:', err);
    }
  });
  
  ws.on('close', () => {
    const instance = ptyInstances.get(ws);
    if (instance) {
      instance.process.kill();
      ptyInstances.delete(ws);
    }
    console.log('[terminal] Client disconnected');
  });
});

// Copilot WebSocket
let activeCopilotWs: WebSocket | null = null;

copilotWss.on('connection', async (ws) => {
  console.log('[copilot] Client connected');
  activeCopilotWs = ws;
  
  ws.on('close', () => {
    if (activeCopilotWs === ws) {
      activeCopilotWs = null;
    }
    console.log('[copilot] Client disconnected');
  });
});

// Start implementation when POST /api/copilot/implement is called
// We need to modify the implement endpoint to actually trigger the agent
app.post('/api/copilot/implement', async (req, res) => {
  try {
    const { model, systemPrompt, userPrompt } = req.body;
    
    // Get the active WebSocket
    const ws = activeCopilotWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return res.json({ ok: false, error: 'No WebSocket connection' });
    }
    
    // Send immediate response
    res.json({ ok: true });
    
    // Start implementation in background
    const onEvent = (event: ImplementEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (event.type === 'chunk') {
          ws.send(JSON.stringify({ type: 'chunk', content: (event.data as { content: string })?.content || '' }));
        } else if (event.type === 'done') {
          const data = event.data as { ok: boolean; error?: string };
          ws.send(JSON.stringify({ type: 'done', ok: data.ok, error: data.error }));
        } else {
          // Send as event with the data spread into the message
          ws.send(JSON.stringify({ type: 'event', data: { type: event.type, ...event.data } }));
        }
      }
    };
    
    await implementWithAgent({
      model: model || 'claude-opus-4.5',
      markdown: userPrompt,
      workspaceFolder,
      systemPrompt,
      onEvent,
    });
  } catch (err) {
    console.error('[server] implement error:', err);
    if (activeCopilotWs && activeCopilotWs.readyState === WebSocket.OPEN) {
      activeCopilotWs.send(JSON.stringify({ type: 'done', ok: false, error: String(err) }));
    }
  }
});

// Chat WebSocket
interface ChatSession {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const chatSessions = new Map<WebSocket, ChatSession>();

chatWss.on('connection', async (ws) => {
  console.log('[chat] Client connected');
  chatSessions.set(ws, { messages: [] });
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'message' && msg.content) {
        const session = chatSessions.get(ws);
        if (!session) return;
        
        // Add user message to history
        session.messages.push({ role: 'user', content: msg.content });
        
        // Build chat-specific system prompt
        const chatSystemPrompt = `You are a helpful assistant that helps users refine, restructure, and extend their markdown blueprints. Your role is to:

1. Help users understand and improve their blueprint documents.
2. Suggest structural improvements to make blueprints clearer.
3. Answer questions about the blueprint's content and architecture.
4. Help add new features, components, or sections to the blueprint.
5. Read and write files in the workspace, primarily blueprint.md and files under /blueprint.

You have access to the same file tools as the implementation agent. You can read and modify files in the workspace.

When modifying the blueprint, explain what changes you're making and why.`;

        // Start agent response
        const onEvent = (event: ImplementEvent) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          
          if (event.type === 'chunk') {
            const content = (event.data as { content?: string })?.content || '';
            ws.send(JSON.stringify({ type: 'chunk', content }));
          } else if (event.type === 'done') {
            ws.send(JSON.stringify({ type: 'done' }));
          } else if (event.type === 'files_changed') {
            ws.send(JSON.stringify({ type: 'event', data: { type: 'files_changed' } }));
          }
        };
        
        await implementWithAgent({
          model: 'claude-sonnet-4-5',
          markdown: msg.content,
          workspaceFolder,
          systemPrompt: chatSystemPrompt,
          onEvent,
        });
      }
    } catch (err) {
      console.error('[chat] Error:', err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'done' }));
      }
    }
  });
  
  ws.on('close', () => {
    chatSessions.delete(ws);
    console.log('[chat] Client disconnected');
  });
});

// Helper functions
async function resolveGitHubToken(): Promise<string | null> {
  // Check environment variable first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  
  // Try gh auth token
  try {
    const result = childProcess.execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return result.trim();
  } catch {
    return null;
  }
}

async function fetchGitHubUser(token: string): Promise<{ login: string; avatar_url: string } | null> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/user',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Blueprint-Implementer',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const user = JSON.parse(data);
          resolve({ login: user.login, avatar_url: user.avatar_url });
        } catch {
          resolve(null);
        }
      });
    });
    
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`);
});
