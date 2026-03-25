#!/usr/bin/env node
// implement-cli.ts — Standalone CLI implement tool (no Electron)

import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { initAgent, implementWithAgent, stopAgent, listModels } from './copilot-agent';
import { cleanWorkspace } from './clean';

const ACTIVITY_TIMEOUT = 120_000; // 120 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 10_000; // 10 seconds

function resolveAppRoot(): string {
  const scriptDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  // Global install: node_modules/@github/copilot is inside the package dir (sibling of index.mjs)
  if (fs.existsSync(path.join(scriptDir, 'node_modules', '@github', 'copilot'))) {
    return scriptDir;
  }
  // Local dev: cli/index.mjs — node_modules is in the parent (project root)
  return path.resolve(scriptDir, '..');
}

function resolveGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' }).trim();
    if (token) return token;
  } catch {
    // gh CLI not available or not logged in
  }
  return null;
}

async function main(): Promise<void> {
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
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  console.log(`Usage:
  blueprint implement <folder> [--model <model>] [--no-sandbox]
  blueprint clean <folder> [--dry-run]
  blueprint models`);
}

async function handleImplement(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: workspace folder required');
    process.exit(1);
  }

  const folder = path.resolve(args[0]);
  let model = 'claude-opus-4.5';
  let noSandbox = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--no-sandbox') {
      noSandbox = true;
    }
  }

  if (!fs.existsSync(folder)) {
    console.error(`Error: folder not found: ${folder}`);
    process.exit(1);
  }

  const blueprintPath = path.join(folder, 'blueprint.md');
  if (!fs.existsSync(blueprintPath)) {
    console.error(`Error: blueprint.md not found in ${folder}`);
    process.exit(1);
  }

  const githubToken = resolveGitHubToken();
  if (!githubToken) {
    console.error('Error: No GitHub token. Set GITHUB_TOKEN or run `gh auth login`.');
    process.exit(1);
  }

  const markdown = fs.readFileSync(blueprintPath, 'utf-8');
  const appRoot = resolveAppRoot();

  // Prefix user prompt with implementation directive
  const userPrompt = `Implement the following blueprint now. Do not ask for confirmation — start immediately.\n\n${markdown}`;

  let attempts = 0;
  let lastError = '';

  while (attempts < MAX_RETRIES) {
    attempts++;
    if (attempts > 1) {
      console.log(`\n[implement] ♻️  Retry ${attempts}/${MAX_RETRIES} (waiting ${RETRY_DELAY / 1000}s)...`);
      await sleep(RETRY_DELAY);
    }

    try {
      initAgent({ githubToken, appRoot, noSandbox });

      let lastActivity = Date.now();
      let timedOut = false;
      const activityCheck = setInterval(() => {
        if (Date.now() - lastActivity > ACTIVITY_TIMEOUT) {
          timedOut = true;
          console.log('\n[implement] ⏱️  Activity timeout — no events for 120s');
          clearInterval(activityCheck);
        }
      }, 5000);

      const result = await implementWithAgent({
        model,
        markdown: userPrompt,
        workspaceFolder: folder,
        onEvent: (event) => {
          lastActivity = Date.now();

          switch (event.type) {
            case 'chunk':
              process.stdout.write(String(event.data.content || ''));
              break;
            case 'tool_start':
              console.log(`\n[implement] 🔧 ${event.data.toolName}`);
              break;
            case 'tool_complete':
              console.log(`[implement] ✓ ${event.data.toolName} complete`);
              break;
            case 'usage': {
              const inT = event.data.inputTokens;
              const outT = event.data.outputTokens;
              const dur = ((event.data.duration as number) / 1000).toFixed(1);
              console.log(`[implement] tokens: ${inT} in / ${outT} out (${dur}s)`);
              break;
            }
            case 'error':
              console.error(`\n[implement] ✗ ${event.data.message}`);
              break;
            case 'done':
              console.log('\n[implement] ✅ Implementation complete');
              break;
            case 'log':
              console.log(`[implement] ${event.data.message}`);
              break;
          }
        },
      });

      clearInterval(activityCheck);

      if (timedOut) {
        lastError = 'Activity timeout';
        stopAgent();
        continue; // retry
      }

      stopAgent();

      if (result.ok) {
        process.exit(0);
      } else {
        // Non-timeout errors fail immediately
        console.error(`\n[implement] Failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`\n[implement] Error: ${lastError}`);
      stopAgent();
      // Non-timeout errors fail immediately
      process.exit(1);
    }
  }

  console.error(`\n[implement] Failed after ${MAX_RETRIES} retries. Last error: ${lastError}`);
  process.exit(1);
}

async function handleClean(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: workspace folder required');
    process.exit(1);
  }

  const folder = path.resolve(args[0]);
  const dryRun = args.includes('--dry-run');

  const result = await cleanWorkspace(folder, { dryRun });

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (result.deleted.length === 0) {
    console.log('Nothing to clean.');
  } else if (dryRun) {
    console.log('Would delete:');
    for (const entry of result.deleted) {
      console.log(`  ${entry}`);
    }
  } else {
    console.log('Deleted:');
    for (const entry of result.deleted) {
      console.log(`  ${entry}`);
    }
  }
}

async function handleModels(): Promise<void> {
  const githubToken = resolveGitHubToken();
  if (!githubToken) {
    console.error('Error: No GitHub token. Set GITHUB_TOKEN or run `gh auth login`.');
    process.exit(1);
  }

  const appRoot = resolveAppRoot();

  const result = await listModels(githubToken, appRoot);
  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log('Available models:');
  for (const model of result.models) {
    console.log(`  ${model.id} — ${model.name}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
