// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { initAgent, implementWithAgent, stopAgent, listModels, type ImplementEvent } from './copilot-agent.js';
import { cleanWorkspace } from './clean.js';

const VERSION = '1.0.0';
const DEFAULT_MODEL = 'claude-opus-4.5';

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  printUsage();
  process.exit(1);
}

const command = args[0];

switch (command) {
  case 'implement':
    await handleImplement(args.slice(1));
    break;
  case 'clean':
    await handleClean(args.slice(1));
    break;
  case 'models':
    await handleModels();
    break;
  case '--help':
  case '-h':
    printUsage();
    break;
  case '--version':
  case '-v':
    console.log(`blueprint v${VERSION}`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}

function printUsage(): void {
  console.log(`
Usage: blueprint <command> [options]

Commands:
  implement <folder>              Implement a blueprint into code
  implement <folder> --model X    Use a specific model
  clean <folder>                  Remove generated files (keeps .blueprintfiles and .git)
  clean <folder> --dry-run        Preview what would be deleted
  models                          List available models

Options:
  --help, -h                      Show this help message
  --version, -v                   Show version number

Examples:
  blueprint implement ./my-project
  blueprint implement ./my-project --model claude-sonnet-4-5
  blueprint clean ./my-project --dry-run
  blueprint clean ./my-project
  blueprint models
`);
}

async function handleImplement(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: No folder specified');
    printUsage();
    process.exit(1);
  }

  const folder = path.resolve(args[0]);
  let model = DEFAULT_MODEL;

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    }
  }

  // Validate folder exists
  if (!fs.existsSync(folder)) {
    console.error(`Error: Folder not found: ${folder}`);
    process.exit(1);
  }

  // Check for blueprint.md
  const blueprintPath = path.join(folder, 'blueprint.md');
  if (!fs.existsSync(blueprintPath)) {
    console.error(`Error: No blueprint.md found in ${folder}`);
    process.exit(1);
  }

  // Resolve GitHub token
  const token = await resolveGitHubToken();
  if (!token) {
    console.error('Error: No GitHub token available.');
    console.error('Set GITHUB_TOKEN environment variable or run: gh auth login');
    process.exit(1);
  }

  console.log(`[implement] 📁 Folder: ${folder}`);
  console.log(`[implement] 🤖 Model: ${model}`);
  console.log(`[implement] 🚀 Starting implementation...\n`);

  // Read blueprint
  const markdown = fs.readFileSync(blueprintPath, 'utf-8');

  // Initialize agent
  const appRoot = findAppRoot();
  initAgent({ githubToken: token, appRoot });

  // Track activity for retry logic
  let lastActivityTime = Date.now();
  const ACTIVITY_TIMEOUT = 120000; // 120 seconds
  const MAX_RETRIES = 3;
  let retryCount = 0;

  async function runImplementation(): Promise<{ ok: boolean; error?: string }> {
    lastActivityTime = Date.now();

    const onEvent = (event: ImplementEvent): void => {
      lastActivityTime = Date.now();
      
      switch (event.type) {
        case 'chunk': {
          const content = (event.data as { content?: string })?.content || '';
          process.stdout.write(content);
          break;
        }
        case 'tool_start': {
          const data = event.data as { toolName?: string; arguments?: Record<string, unknown> };
          const toolName = data.toolName || 'unknown';
          let summary = '';
          if (data.arguments) {
            if (data.arguments.path) {
              summary = String(data.arguments.path);
            } else if (data.arguments.command) {
              summary = String(data.arguments.command).substring(0, 50);
            }
          }
          console.log(`\n[implement] 🔧 ${toolName} ${summary}`);
          break;
        }
        case 'tool_complete': {
          const data = event.data as { toolName?: string };
          console.log(`[implement] ✓ ${data.toolName || 'tool'} complete`);
          break;
        }
        case 'usage': {
          const data = event.data as { inputTokens?: number; outputTokens?: number; duration?: number };
          const duration = ((data.duration || 0) / 1000).toFixed(1);
          console.log(`[implement] 📊 tokens: ${data.inputTokens?.toLocaleString() || 0} in / ${data.outputTokens?.toLocaleString() || 0} out (${duration}s)`);
          break;
        }
        case 'error': {
          const data = event.data as { message?: string };
          console.error(`\n[implement] ❌ ${data.message || 'Unknown error'}`);
          break;
        }
        case 'session_start':
        case 'turn_start':
        case 'turn_end':
          console.log(`[implement] 📋 ${event.type.replace('_', ' ')}`);
          break;
      }
    };

    // Create a promise that tracks activity timeout
    return new Promise(async (resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const checkActivity = (): void => {
        const elapsed = Date.now() - lastActivityTime;
        if (elapsed > ACTIVITY_TIMEOUT) {
          console.log('\n[implement] ⚠️ Activity timeout detected');
          resolve({ ok: false, error: 'Activity timeout' });
        } else {
          timeoutId = setTimeout(checkActivity, 5000);
        }
      };

      timeoutId = setTimeout(checkActivity, 5000);

      try {
        const result = await implementWithAgent({
          model,
          markdown,
          workspaceFolder: folder,
          onEvent,
        });
        
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(result);
      } catch (err) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // Run with retry logic
  let result = await runImplementation();

  while (!result.ok && result.error === 'Activity timeout' && retryCount < MAX_RETRIES) {
    retryCount++;
    console.log(`\n[implement] 🔄 Retrying (${retryCount}/${MAX_RETRIES})...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Reinitialize agent
    await stopAgent();
    initAgent({ githubToken: token, appRoot });
    
    result = await runImplementation();
  }

  // Cleanup
  await stopAgent();

  if (result.ok) {
    console.log('\n[implement] ✅ Implementation complete!');
    process.exit(0);
  } else {
    console.error(`\n[implement] ❌ Implementation failed: ${result.error}`);
    process.exit(1);
  }
}

async function handleClean(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: No folder specified');
    printUsage();
    process.exit(1);
  }

  const folder = path.resolve(args[0]);
  const dryRun = args.includes('--dry-run');

  // Validate folder exists
  if (!fs.existsSync(folder)) {
    console.error(`Error: Folder not found: ${folder}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('[clean] Dry run - showing what would be deleted:\n');
  }

  const result = await cleanWorkspace(folder, dryRun);

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (result.deleted.length === 0) {
    console.log('Nothing to clean - all files are in .blueprintfiles');
  } else {
    for (const entry of result.deleted) {
      console.log(`  ${dryRun ? 'Would delete' : 'Deleted'}: ${entry}`);
    }
    console.log(`\n${dryRun ? 'Would delete' : 'Deleted'} ${result.deleted.length} entries`);
  }

  process.exit(0);
}

async function handleModels(): Promise<void> {
  const token = await resolveGitHubToken();
  if (!token) {
    console.error('Error: No GitHub token available.');
    console.error('Set GITHUB_TOKEN environment variable or run: gh auth login');
    process.exit(1);
  }

  console.log('Loading available models...\n');

  const appRoot = findAppRoot();
  initAgent({ githubToken: token, appRoot });

  try {
    const models = await listModels();
    console.log('Available models:\n');
    for (const model of models) {
      console.log(`  ${model.id}${model.name !== model.id ? ` (${model.name})` : ''}`);
    }
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  } finally {
    await stopAgent();
  }

  process.exit(0);
}

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

function findAppRoot(): string {
  // The CLI is bundled to cli/index.mjs, so app root is the parent directory
  let dir = path.dirname(new URL(import.meta.url).pathname);
  
  // Look for node_modules in parent directories
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, 'node_modules', '@github', 'copilot'))) {
      return dir;
    }
    // Also check if we're in the cli directory
    const parentNodeModules = path.join(path.dirname(dir), 'node_modules', '@github', 'copilot');
    if (fs.existsSync(parentNodeModules)) {
      return path.dirname(dir);
    }
    dir = path.dirname(dir);
  }
  
  // Default to the directory containing the script
  return path.dirname(new URL(import.meta.url).pathname);
}
