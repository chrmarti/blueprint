#!/usr/bin/env node
// implement-cli.ts - Standalone CLI implement tool for Blueprint Implementer

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { initAgent, implementWithAgent, stopAgent, listModels as agentListModels } from './copilot-agent';
import { cleanWorkspace } from './clean';

const RETRY_DELAY_MS = 10000;
const MAX_RETRIES = 3;
const ACTIVITY_TIMEOUT_MS = 120000;

interface CLIArgs {
  command: 'implement' | 'clean' | 'models' | 'help';
  folder?: string;
  model?: string;
  noSandbox?: boolean;
  dryRun?: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return { command: 'help' };
  }

  const command = args[0] as CLIArgs['command'];

  if (command === 'models') {
    return { command: 'models' };
  }

  if (command === 'implement' || command === 'clean') {
    const folder = args[1];
    if (!folder) {
      console.error(`Error: ${command} requires a folder argument`);
      process.exit(1);
    }

    let model: string | undefined;
    let noSandbox = false;
    let dryRun = false;

    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--model' && args[i + 1]) {
        model = args[i + 1];
        i++;
      } else if (args[i] === '--no-sandbox') {
        noSandbox = true;
      } else if (args[i] === '--dry-run') {
        dryRun = true;
      }
    }

    return { command, folder, model, noSandbox, dryRun };
  }

  console.error(`Unknown command: ${command}`);
  return { command: 'help' };
}

function printHelp(): void {
  console.log(`
Blueprint CLI

Usage:
  blueprint implement <folder>              Implement a blueprint into code
  blueprint implement <folder> --model X    Use a specific model
  blueprint implement <folder> --no-sandbox Run without safehouse sandbox
  blueprint clean <folder>                  Remove generated files
  blueprint clean <folder> --dry-run        Preview what would be deleted
  blueprint models                          List available models
  blueprint help                            Show this help

Environment:
  GITHUB_TOKEN    GitHub personal access token (required)

Examples:
  blueprint implement ./my-project
  blueprint implement ./my-project --model claude-opus-4.6-1m
  blueprint clean ./my-project --dry-run
`);
}

async function getGitHubToken(): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is required');
    console.error('Set it with: export GITHUB_TOKEN=$(gh auth token)');
    process.exit(1);
  }
  return token;
}

async function listModels(): Promise<void> {
  const githubToken = await getGitHubToken();
  let appRoot = path.dirname(fileURLToPath(import.meta.url));
  while (appRoot !== '/' && !fs.existsSync(path.join(appRoot, 'node_modules'))) {
    appRoot = path.dirname(appRoot);
  }
  const initResult = await initAgent({ githubToken, appRoot });
  if (!initResult.ok) {
    throw new Error(`Failed to initialize agent: ${initResult.error}`);
  }
  const models = await agentListModels();
  console.log('Available models:\n');
  for (const m of models) {
    console.log(`  ${m.id}  ${m.name}`);
  }
  await stopAgent();
}

async function runImplementation(args: CLIArgs): Promise<void> {
  const folder = path.resolve(args.folder!);
  const blueprintPath = path.join(folder, 'blueprint.md');

  if (!fs.existsSync(folder)) {
    console.error(`Error: Folder not found: ${folder}`);
    process.exit(1);
  }

  if (!fs.existsSync(blueprintPath)) {
    console.error(`Error: blueprint.md not found in ${folder}`);
    process.exit(1);
  }

  const githubToken = await getGitHubToken();
  const blueprintContent = await fs.promises.readFile(blueprintPath, 'utf-8');
  const model = args.model || 'claude-opus-4.6-1m';

  console.log('[implement] Starting implementation');
  console.log('[implement] Folder:', folder);
  console.log('[implement] Model:', model);
  console.log();

  // Find app root (where node_modules is)
  let appRoot = path.dirname(fileURLToPath(import.meta.url));
  while (appRoot !== '/' && !fs.existsSync(path.join(appRoot, 'node_modules'))) {
    appRoot = path.dirname(appRoot);
  }

  let retries = 0;
  let success = false;

  while (retries <= MAX_RETRIES && !success) {
    if (retries > 0) {
      console.log(`\n[implement] Retry ${retries}/${MAX_RETRIES} after timeout...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    await initAgent({
      githubToken,
      appRoot,
      noSandbox: args.noSandbox,
    });

    let lastActivityTime = Date.now();
    let activityCheckInterval: ReturnType<typeof setInterval> | null = null;

    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      // Start activity check
      activityCheckInterval = setInterval(() => {
        const elapsed = Date.now() - lastActivityTime;
        if (elapsed > ACTIVITY_TIMEOUT_MS) {
          console.log(`\n[implement] ⚠️ No activity for ${Math.round(elapsed / 1000)}s`);
          if (activityCheckInterval) clearInterval(activityCheckInterval);
          resolve({ ok: false, error: 'Activity timeout' });
        }
      }, 10000);

      implementWithAgent({
        model,
        markdown: blueprintContent,
        workspaceFolder: folder,
        onEvent: (event) => {
          lastActivityTime = Date.now();

          switch (event.type) {
            case 'chunk': {
              const content = event.data.content as string;
              if (content) process.stdout.write(content);
              break;
            }
            case 'tool_start': {
              const toolName = event.data.toolName as string;
              const toolArgs = event.data.arguments as Record<string, unknown> | undefined;
              const summary = getToolSummary(toolName, toolArgs);
              console.log(`\n\x1b[33m🔧 ${toolName}\x1b[0m ${summary}`);
              break;
            }
            case 'tool_complete': {
              const toolName = event.data.toolName as string;
              console.log(`\x1b[32m✓ ${toolName} complete\x1b[0m`);
              break;
            }
            case 'usage': {
              const inputTokens = event.data.inputTokens as number;
              const outputTokens = event.data.outputTokens as number;
              const duration = event.data.duration as number;
              const durationSec = (duration / 1000).toFixed(1);
              console.log(`\x1b[90mtokens: ${inputTokens?.toLocaleString() || '?'} in / ${outputTokens?.toLocaleString() || '?'} out (${durationSec}s)\x1b[0m`);
              break;
            }
            case 'error': {
              const message = event.data.message as string;
              console.log(`\n\x1b[31m✗ ${message}\x1b[0m`);
              break;
            }
            case 'done': {
              if (activityCheckInterval) clearInterval(activityCheckInterval);
              resolve({ ok: true });
              break;
            }
          }
        },
      }).then((r) => {
        if (activityCheckInterval) clearInterval(activityCheckInterval);
        resolve(r);
      });
    });

    if (result.ok) {
      success = true;
      console.log('\n[implement] ✅ Implementation complete');
    } else if (result.error === 'Activity timeout') {
      retries++;
      await stopAgent();
    } else {
      console.error('\n[implement] ❌ Implementation failed:', result.error);
      await stopAgent();
      process.exit(1);
    }
  }

  if (!success) {
    console.error('\n[implement] ❌ Implementation failed after', MAX_RETRIES, 'retries');
    process.exit(1);
  }

  await stopAgent();
}

function getToolSummary(toolName: string, args?: Record<string, unknown>): string {
  if (!args) return '';

  if (toolName.includes('file') || toolName.includes('create') || toolName.includes('edit') || toolName.includes('view')) {
    const p = args.path || args.file_path || args.filepath || args.file;
    if (p) return String(p);
  }

  if (toolName.includes('bash') || toolName.includes('shell') || toolName.includes('command')) {
    const cmd = args.command || args.cmd;
    if (cmd) {
      const cmdStr = String(cmd);
      return cmdStr.length > 60 ? cmdStr.substring(0, 57) + '...' : cmdStr;
    }
  }

  if (toolName.includes('grep') || toolName.includes('search')) {
    const pattern = args.pattern || args.query;
    if (pattern) return `"${pattern}"`;
  }

  return '';
}

async function runClean(args: CLIArgs): Promise<void> {
  const folder = path.resolve(args.folder!);

  if (!fs.existsSync(folder)) {
    console.error(`Error: Folder not found: ${folder}`);
    process.exit(1);
  }

  const result = await cleanWorkspace(folder, { dryRun: args.dryRun });

  if (!result.ok) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (result.deleted && result.deleted.length > 0) {
    if (args.dryRun) {
      console.log('Would delete:');
    } else {
      console.log('Deleted:');
    }
    for (const entry of result.deleted) {
      console.log(`  ${entry}`);
    }
  } else {
    console.log('Nothing to clean.');
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  switch (args.command) {
    case 'help':
      printHelp();
      break;
    case 'models':
      await listModels();
      break;
    case 'implement':
      await runImplementation(args);
      break;
    case 'clean':
      await runClean(args);
      break;
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
