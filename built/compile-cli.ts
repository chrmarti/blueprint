/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CLI tool for compiling a workspace using the Copilot SDK agent.
// Usage: node dist/compile-cli.mjs <workspace-folder>
//
// The workspace folder should contain a blueprint.md in its root describing
// the project's folder structure, tools, and processes. Additional .md files
// in src/ are included as source documents if present.
//
// Requires a GitHub token in the GITHUB_TOKEN environment variable.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initAgent, compileWithAgent, stopAgent, checkHealth, SYSTEM_PROMPT } from './copilot-agent.js';

/** Recursively read all .md files under a directory and concatenate them. */
function readMarkdownFiles(dir: string): { files: string[]; content: string } {
  const files: string[] = [];
  let content = '';

  function walk(d: string): void {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        files.push(full);
        const rel = path.relative(dir, full);
        const text = fs.readFileSync(full, 'utf-8');
        content += `\n\n<!-- file: src/${rel} -->\n\n${text}`;
      }
    }
  }

  walk(dir);
  return { files, content: content.trim() };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node dist/compile-cli.mjs <workspace-folder>

Reads blueprint.md from the workspace root and any .md files from src/ (if
present), then compiles them into generated code using the Copilot agent.

Options:
  --model <model>    Model to use (default: claude-opus-4.6)
  -h, --help         Show this help

Environment:
  GITHUB_TOKEN       GitHub personal access token (required)`);
    process.exit(0);
  }

  // Parse arguments
  let workspaceArg: string | null = null;
  let model = 'claude-opus-4.6';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (!args[i].startsWith('-')) {
      workspaceArg = args[i];
    }
  }

  if (!workspaceArg) {
    console.error('Error: No workspace folder specified');
    console.error('Usage: node dist/compile-cli.mjs <workspace-folder>');
    process.exit(1);
  }

  const workspaceFolder = path.resolve(workspaceArg);
  if (!fs.existsSync(workspaceFolder) || !fs.statSync(workspaceFolder).isDirectory()) {
    console.error(`Error: Not a directory: ${workspaceFolder}`);
    process.exit(1);
  }

  const blueprintPath = path.join(workspaceFolder, 'blueprint.md');
  if (!fs.existsSync(blueprintPath)) {
    console.error(`Error: No blueprint.md found in ${workspaceFolder}`);
    process.exit(1);
  }

  // Read blueprint.md as the primary input
  let markdown = fs.readFileSync(blueprintPath, 'utf-8');
  const sourceFiles = [blueprintPath];

  // Also include any .md files from src/ if the directory exists
  const srcDir = path.join(workspaceFolder, 'src');
  if (fs.existsSync(srcDir)) {
    const { files, content } = readMarkdownFiles(srcDir);
    sourceFiles.push(...files);
    if (content) {
      markdown += '\n\n' + content;
    }
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('Error: GITHUB_TOKEN environment variable is required');
    console.error('Set it with: export GITHUB_TOKEN=$(gh auth token)');
    process.exit(1);
  }

  const ts = () => new Date().toISOString().slice(11, 23);

  console.log(`[${ts()}] Workspace: ${workspaceFolder}`);
  console.log(`[${ts()}] Source files: ${sourceFiles.map(f => path.relative(workspaceFolder, f)).join(', ')}`);
  console.log(`[${ts()}] Total markdown: ${markdown.length} chars`);
  console.log(`[${ts()}] Model: ${model}`);

  // Determine project root (where node_modules is)
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const appRoot = path.dirname(scriptDir);

  // Initialize the Copilot agent
  console.log(`[${ts()}] Initializing agent...`);
  const initResult = await initAgent({ githubToken, appRoot, workspaceFolder });
  if (!initResult.ok) {
    console.error(`[${ts()}] Failed to initialize agent: ${initResult.error}`);
    process.exit(1);
  }

  // Run the agent with a heartbeat so the user can tell it's alive
  let lastEventTime = Date.now();
  let currentTurn: string | null = null;
  let turnStartTime = 0;
  const heartbeat = setInterval(async () => {
    const silentSec = Math.round((Date.now() - lastEventTime) / 1000);
    if (silentSec >= 10) {
      const health = await checkHealth().catch(() => null);
      const healthStr = health ? ` [state=${health.state}${health.pingMs !== undefined ? ` ping=${health.pingMs}ms` : ''}${health.error ? ` err=${health.error}` : ''}]` : ' [no client]';
      const turnElapsed = currentTurn ? Math.round((Date.now() - turnStartTime) / 1000) : 0;
      const turnStr = currentTurn ? `Turn ${currentTurn}, ${turnElapsed}s` : `${silentSec}s since last event`;
      process.stderr.write(`[${ts()}] ⏳ generating... (${turnStr})${healthStr}\n`);
    }
  }, 10_000);

  const result = await compileWithAgent({
    model,
    markdown,
    workspaceFolder,
    systemPrompt: SYSTEM_PROMPT,
    onEvent: (event) => {
      lastEventTime = Date.now();
      switch (event.type) {
        case 'chunk':
          process.stdout.write(event.message || '');
          break;
        case 'error':
          console.error(`[${ts()}] ERROR: ${event.message}`);
          break;
        case 'tool_start':
          console.log(`[${ts()}] 🔧 ${event.message}`);
          break;
        case 'tool_complete':
          console.log(`[${ts()}] ✅ ${event.message}`);
          break;
        case 'usage':
          console.log(`[${ts()}] 📊 ${event.message}`);
          break;
        case 'turn_start':
          currentTurn = event.data?.turnId ?? currentTurn;
          turnStartTime = Date.now();
          console.log(`[${ts()}] ${event.message}`);
          break;
        case 'turn_end':
          console.log(`[${ts()}] ${event.message}`);
          currentTurn = null;
          break;
        case 'done':
          console.log(`[${ts()}] ✨ ${event.message}`);
          break;
        case 'files_changed':
          console.log(`[${ts()}] Files may have changed in: ${event.data?.workspaceFolder}`);
          break;
        default:
          console.log(`[${ts()}] ${event.message || event.type}`);
          break;
      }
    },
  });

  clearInterval(heartbeat);

  // Clean up
  console.log(`[${ts()}] Stopping agent...`);
  await stopAgent();

  if (!result.ok) {
    console.error(`[${ts()}] Compilation failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`[${ts()}] Done.`);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString().slice(11, 23)}] Fatal error:`, err.message);
  console.error(err.stack);
  stopAgent().catch(() => {});
  process.exit(1);
});
