/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CLI tool for implementing a workspace using the Copilot SDK agent.
// Usage: blueprint implement <workspace-folder>
//
// The workspace folder should contain a blueprint.md in its root describing
// the project's folder structure, tools, and processes. Additional .md files
// in blueprint/ are included as source documents if present.
//
// Requires a GitHub token in the GITHUB_TOKEN environment variable.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initAgent, implementWithAgent, stopAgent, checkHealth, listModels, SYSTEM_PROMPT } from './copilot-agent.js';
import { cleanWorkspace } from './clean.js';

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
        content += `\n\n<!-- file: blueprint/${rel} -->\n\n${text}`;
      }
    }
  }

  walk(dir);
  return { files, content: content.trim() };
}

function getAppRoot(): string {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  // When globally installed, node_modules is inside the script's directory.
  // When running from the dev workspace (dist/), node_modules is one level up.
  if (fs.existsSync(path.join(scriptDir, 'node_modules'))) {
    return scriptDir;
  }
  return path.dirname(scriptDir);
}

function requireGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is required');
    console.error('Set it with: export GITHUB_TOKEN=$(gh auth token)');
    process.exit(1);
  }
  return token;
}

async function commandModels(): Promise<void> {
  const githubToken = requireGitHubToken();
  const initResult = await initAgent({ githubToken, appRoot: getAppRoot() });
  if (!initResult.ok) {
    console.error(`Failed to initialize agent: ${initResult.error}`);
    process.exit(1);
  }
  const models = await listModels();
  for (const m of models) {
    console.log(`${m.id}  ${m.name}`);
  }
  await stopAgent();
}

async function commandClean(args: string[]): Promise<void> {
  let workspaceArg: string | null = null;
  const dryRun = args.includes('--dry-run');

  for (const arg of args) {
    if (!arg.startsWith('-')) {
      workspaceArg = arg;
      break;
    }
  }

  if (!workspaceArg) {
    console.error('Error: No workspace folder specified');
    console.error('Usage: blueprint clean <workspace-folder> [--dry-run]');
    process.exit(1);
  }

  const workspaceFolder = path.resolve(workspaceArg);
  if (!fs.existsSync(workspaceFolder) || !fs.statSync(workspaceFolder).isDirectory()) {
    console.error(`Error: Not a directory: ${workspaceFolder}`);
    process.exit(1);
  }

  const result = cleanWorkspace(workspaceFolder, { dryRun });
  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (dryRun) {
    if (result.toDelete?.length) {
      console.log('Would delete:');
      for (const name of result.toDelete) {
        console.log(`  ${name}`);
      }
    } else {
      console.log('Nothing to delete.');
    }
  } else {
    if (result.deleted?.length) {
      console.log(`Deleted ${result.deleted.length} entries:`);
      for (const name of result.deleted) {
        console.log(`  ${name}`);
      }
    } else {
      console.log('Nothing to delete.');
    }
  }
}

async function commandImplement(args: string[]): Promise<void> {
  let workspaceArg: string | null = null;
  let model = 'claude-opus-4.5';
  let noSandbox = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--no-sandbox') {
      noSandbox = true;
    } else if (!args[i].startsWith('-')) {
      workspaceArg = args[i];
    }
  }

  if (!workspaceArg) {
    console.error('Error: No workspace folder specified');
    console.error('Usage: blueprint implement <workspace-folder>');
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

  // Also include any .md files from blueprint/ if the directory exists
  const srcDir = path.join(workspaceFolder, 'blueprint');
  if (fs.existsSync(srcDir)) {
    const { files, content } = readMarkdownFiles(srcDir);
    sourceFiles.push(...files);
    if (content) {
      markdown += '\n\n' + content;
    }
  }

  // Wrap the blueprint content with a clear instruction to implement immediately
  markdown = 'Implement the following blueprint now. Do not ask for confirmation — start immediately.\n\n' + markdown;

  const githubToken = requireGitHubToken();
  const ts = () => new Date().toISOString().slice(11, 23);

  console.log(`[${ts()}] Workspace: ${workspaceFolder}`);
  console.log(`[${ts()}] Source files: ${sourceFiles.map(f => path.relative(workspaceFolder, f)).join(', ')}`);
  console.log(`[${ts()}] Total markdown: ${markdown.length} chars`);
  console.log(`[${ts()}] Model: ${model}`);

  const appRoot = getAppRoot();

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 10_000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Initialize the Copilot agent
    console.log(`[${ts()}] Initializing agent...${attempt > 1 ? ` (attempt ${attempt}/${MAX_RETRIES})` : ''}`);
    const initResult = await initAgent({ githubToken, appRoot, workspaceFolder, noSandbox });
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

    const result = await implementWithAgent({
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

    if (result.ok) {
      console.log(`[${ts()}] Done.`);
      return;
    }

    const isTimeout = result.error?.includes('Activity timeout');
    if (isTimeout && attempt < MAX_RETRIES) {
      console.error(`[${ts()}] Agent timed out. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    console.error(`[${ts()}] Implementation failed: ${result.error}`);
    process.exit(1);
  }
}

const HELP = `Usage: blueprint <command> [options]

Commands:
  implement <folder>   Implement a blueprint into code
  clean <folder>       Remove generated files (keeps .blueprintfiles and .git)
  models               List available models

Options:
  -h, --help           Show this help

Run 'blueprint <command> --help' for command-specific help.

Environment:
  GITHUB_TOKEN         GitHub personal access token (required)`;

const IMPLEMENT_HELP = `Usage: blueprint implement <workspace-folder> [options]

Reads blueprint.md from the workspace root and any .md files from blueprint/ (if
present), then implements them into generated code using the Copilot agent.

Options:
  --model <model>    Model to use (default: claude-opus-4.5)
  --no-sandbox       Run without the safehouse sandbox
  -h, --help         Show this help`;

const CLEAN_HELP = `Usage: blueprint clean <workspace-folder> [options]

Removes all files and directories from the workspace except those listed in
.blueprintfiles and the .git folder.

Options:
  --dry-run          Show what would be deleted without deleting
  -h, --help         Show this help`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  switch (command) {
    case 'models':
      await commandModels();
      break;
    case 'implement': {
      const subArgs = args.slice(1);
      if (subArgs.includes('--help') || subArgs.includes('-h')) {
        console.log(IMPLEMENT_HELP);
        process.exit(0);
      }
      await commandImplement(subArgs);
      break;
    }
    case 'clean': {
      const subArgs = args.slice(1);
      if (subArgs.includes('--help') || subArgs.includes('-h')) {
        console.log(CLEAN_HELP);
        process.exit(0);
      }
      await commandClean(subArgs);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString().slice(11, 23)}] Fatal error:`, err.message);
  console.error(err.stack);
  stopAgent().catch(() => {});
  process.exit(1);
});
