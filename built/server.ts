/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const DIST = __dirname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function proxyRequest(
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  body: string | null,
  res: http.ServerResponse,
  stream = false,
): void {
  const parsed = new URL(targetUrl);
  const reqHeaders: Record<string, string> = { ...headers };
  if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body).toString();

  const proxyReq = https.request(
    {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
    },
    (proxyRes) => {
      if (stream) {
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        proxyRes.pipe(res);
      } else {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => chunks.push(c));
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode || 200, {
            'Content-Type': 'application/json',
          });
          res.end(Buffer.concat(chunks).toString());
        });
      }
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: err.message }));
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // ── API proxy routes ──────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    const body = req.method === 'POST' ? await readBody(req) : null;

    if (url.pathname === '/api/auth/device-code' && req.method === 'POST') {
      proxyRequest('POST', 'https://github.com/login/device/code', {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }, body, res);
      return;
    }

    if (url.pathname === '/api/auth/token' && req.method === 'POST') {
      proxyRequest('POST', 'https://github.com/login/oauth/access_token', {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }, body, res);
      return;
    }

    if (url.pathname === '/api/github/user' && req.method === 'GET') {
      proxyRequest('GET', 'https://api.github.com/user', {
        'Authorization': req.headers['authorization'] || '',
        'Accept': 'application/json',
        'User-Agent': 'Blueprint-Compiler/0.1.0',
      }, null, res);
      return;
    }

    if (url.pathname === '/api/copilot/token' && req.method === 'GET') {
      proxyRequest('GET', 'https://api.github.com/copilot_internal/v2/token', {
        'Authorization': req.headers['authorization'] || '',
        'Accept': 'application/json',
        'User-Agent': 'Blueprint-Compiler/0.1.0',
      }, null, res);
      return;
    }

    if (url.pathname === '/api/copilot/chat' && req.method === 'POST') {
      proxyRequest('POST', 'https://api.githubcopilot.com/chat/completions', {
        'Authorization': req.headers['authorization'] || '',
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Editor-Version': 'Blueprint-Compiler/0.1.0',
        'Editor-Plugin-Version': 'blueprint-compiler/0.1.0',
        'User-Agent': 'Blueprint-Compiler/0.1.0',
        'Openai-Organization': 'github-copilot',
        'Copilot-Integration-Id': 'vscode-chat',
      }, body, res, true);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown API route' }));
    return;
  }

  // ── Static files ──────────────────────────────────────────────────
  const filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath);

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Blueprint Compiler running at http://localhost:${PORT}`);
});
