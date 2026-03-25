#!/usr/bin/env node
// CLI implement tool - headless blueprint implementation

import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { initAgent, implementWithAgent, stopAgent, ImplementEvent } from './copilot-agent.js';
import { cleanWorkspace, previewClean } from './clean.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve app root (where node_modules and scripts are)
function resolveAppRoot(): string {
  // When installed as npm package, structure is:
  // cli/index.mjs (this file)
  // cli/scripts/safehouse
  // node_modules/@github/copilot-*/copilot
  
  // First check if we're in the CLI package directory
  const cliRoot = path.resolve(__dirname);
  if (fs.existsSync(path.join(cliRoot, 'scripts', 'safehouse'))) {
    return cliRoot;
  }

  // Check parent directory (development mode)
  const parentRoot = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(parentRoot, 'scripts', 'safehouse'))) {
    return parentRoot;
  }

  // Fallback to current directory
  return process.cwd();
}

// Resolve GitHub token
function resolveGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  try {
    const stdout = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

// List available models
async function listModelsCommand(): Promise<void> {
  const token = resolveGitHubToken();
  if (!token) {
    console.error('Error: No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.');
    process.exit(1);
  }

  const appRoot = resolveAppRoot();
  
  try {
    const { CopilotClient } = await import('@github/copilot-sdk');
    
    // Find CLI path
    const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const binaryName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
    
    let cliPath = path.join(appRoot, 'node_modules', '@github', `copilot-${platform}-${arch}`, binaryName);
    if (!fs.existsSync(cliPath)) {
      cliPath = path.join(appRoot, 'node_modules', '@github', 'copilot', 'npm-loader.js');
    }

    const client = new CopilotClient({
      cwd: process.cwd(),
      cliPath,
      githubToken: token,
      autoRestart: false,
      logLevel: 'error',
    });

    const models = await client.listModels();
    
    console.log('Available models:');
    for (const model of models) {
      console.log(`  ${model.id}${model.name ? ` (${model.name})` : ''}`);
    }

    await client.stop?.();
  } catch (error) {
    console.error('Error listing models:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Clean command
async function cleanCommand(folder: string, dryRun: boolean): Promise<void> {
  const workspaceFolder = path.resolve(folder);
  
  if (!fs.existsSync(workspaceFolder)) {
    console.error(`Error: Folder not found: ${workspaceFolder}`);
    process.exit(1);
  }

  const result = dryRun 
    ? await previewClean(workspaceFolder)
    : await cleanWorkspace(workspaceFolder);

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (result.deleted.length === 0) {
    console.log('No files to clean.');
    return;
  }

  if (dryRun) {
    console.log('Would delete:');
  } else {
    console.log('Deleted:');
  }
  
  for (const file of result.deleted) {
    console.log(`  ${file}`);
  }
}

// Implement command
async function implementCommand(folder: string, model: string, noSandbox: boolean): Promise<void> {
  const workspaceFolder = path.resolve(folder);
  
  if (!fs.existsSync(workspaceFolder)) {
    console.error(`Error: Folder not found: ${workspaceFolder}`);
    process.exit(1);
  }

  const blueprintPath = path.join(workspaceFolder, 'blueprint.md');
  if (!fs.existsSync(blueprintPath)) {
    console.error(`Error: No blueprint.md found in ${workspaceFolder}`);
    process.exit(1);
  }

  const token = resolveGitHubToken();
  if (!token) {
    console.error('Error: No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.');
    process.exit(1);
  }

  const appRoot = resolveAppRoot();
  const blueprintContent = fs.readFileSync(blueprintPath, 'utf-8');

  console.log(`[implement] Starting implementation in ${workspaceFolder}`);
  console.log(`[implement] Model: ${model}`);

  let retries = 0;
  const maxRetries = 3;
  let lastError = '';

  while (retries <= maxRetries) {
    if (retries > 0) {
      console.log(`[implement] Retrying (${retries}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, 10000));
    }

    try {
      await initAgent({
        githubToken: token,
        appRoot,
        noSandbox,
      });

      let lastEventTime = Date.now();
      const activityTimeout = 120000; // 2 minutes

      const onEvent = (event: ImplementEvent) => {
        lastEventTime = Date.now();

        switch (event.type) {
          case 'session_start':
            console.log(`[implement] 🚀 Session started (model: ${event.data?.model})`);
            break;
          case 'tool_start': {
            const toolName = event.data?.toolName as string;
            const args = event.data?.arguments as Record<string, unknown>;
            let summary = '';
            if (args) {
              if (['create', 'edit', 'write_file', 'create_file'].includes(toolName)) {
                summary = args.path as string || args.file_path as string || '';
              } else if (['bash', 'shell'].includes(toolName)) {
                const cmd = args.command as string || '';
                summary = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
              }
            }
            console.log(`[implement] 🔧 ${toolName} ${summary}`);
            break;
          }
          case 'tool_complete':
            console.log(`[implement] ✓ ${event.data?.toolName} complete`);
            break;
          case 'usage': {
            const u = event.data as { inputTokens: number; outputTokens: number; duration: number };
            const dur = (u.duration / 1000).toFixed(1);
            console.log(`[implement] tokens: ${u.inputTokens} in / ${u.outputTokens} out (${dur}s)`);
            break;
          }
          case 'error':
            console.error(`[implement] ✗ ${event.data?.message}`);
            break;
          case 'done':
            console.log(`[implement] ✓ Implementation complete`);
            break;
        }
      };

      // Check for activity timeout
      const checkTimeout = setInterval(() => {
        if (Date.now() - lastEventTime > activityTimeout) {
          console.error('[implement] Activity timeout - no events for 2 minutes');
          clearInterval(checkTimeout);
        }
      }, 10000);

      const result = await implementWithAgent({
        model,
        markdown: blueprintContent,
        workspaceFolder,
        onEvent,
      });

      clearInterval(checkTimeout);

      if (result.ok) {
        await stopAgent();
        process.exit(0);
      } else {
        lastError = result.error || 'Unknown error';
        
        // Check if it's a timeout error (retry)
        if (lastError.includes('timeout') || lastError.includes('Timeout')) {
          retries++;
          continue;
        }
        
        // Non-timeout error, fail immediately
        console.error(`[implement] Error: ${lastError}`);
        await stopAgent();
        process.exit(1);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`[implement] Error: ${lastError}`);
      
      if (lastError.includes('timeout') || lastError.includes('Timeout')) {
        retries++;
        continue;
      }
      
      await stopAgent();
      process.exit(1);
    }
  }

  console.error(`[implement] Failed after ${maxRetries} retries: ${lastError}`);
  await stopAgent();
  process.exit(1);
}

// Show usage
function showUsage(): void {
  console.log(`
Usage: blueprint <command> [options]

Commands:
  implement <folder>              Implement a blueprint into code
  clean <folder>                  Remove generated files (keeps .blueprintfiles and .git)
  models                          List available models

Options:
  --model <model>                 Model to use (default: claude-opus-4.5)
  --no-sandbox                    Run without safehouse sandbox
  --dry-run                       Preview changes without executing (clean only)

Examples:
  blueprint implement ./my-project
  blueprint implement ./my-project --model claude-sonnet-4
  blueprint clean ./my-project --dry-run
  blueprint models
`);
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showUsage();
    process.exit(1);
  }

  const command = args[0];

  switch (command) {
    case 'implement': {
      const folder = args[1];
      if (!folder) {
        console.error('Error: Missing folder argument');
        showUsage();
        process.exit(1);
      }
      
      const modelIdx = args.indexOf('--model');
      const model = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : 'claude-opus-4.5';
      const noSandbox = args.includes('--no-sandbox');
      
      await implementCommand(folder, model, noSandbox);
      break;
    }

    case 'clean': {
      const folder = args[1];
      if (!folder) {
        console.error('Error: Missing folder argument');
        showUsage();
        process.exit(1);
      }
      
      const dryRun = args.includes('--dry-run');
      await cleanCommand(folder, dryRun);
      break;
    }

    case 'models':
      await listModelsCommand();
      break;

    case 'help':
    case '--help':
    case '-h':
      showUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      showUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
