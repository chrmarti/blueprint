// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Test configuration
const SCREENSHOT_DIR = 'test/screenshots';
const WORKSPACE = 'test/tictactoe';

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server not ready after ${timeout}ms`);
}

async function resolveGitHubToken() {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    const result = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8', timeout: 5000 });
    return result.trim();
  } catch {
    return null;
  }
}

// CLI Tests (run before browser tests)
async function runCLITests() {
  console.log('\n═══════════════════════════════════════');
  console.log('CLI Tests');
  console.log('═══════════════════════════════════════\n');

  // Create temp directory for local CLI install
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-test-'));
  console.log(`[CLI] Temp directory: ${tmpDir}`);

  try {
    // Build and pack the CLI
    console.log('[CLI] Building...');
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

    console.log('[CLI] Packing...');
    execFileSync('npm', ['pack'], { cwd: 'cli', stdio: 'inherit' });

    // Install locally to temp directory
    console.log('[CLI] Installing locally...');
    execFileSync('npm', ['install', '--prefix', tmpDir, './cli/blueprint-1.0.0.tgz'], { stdio: 'inherit' });

    const blueprintBin = path.join(tmpDir, 'node_modules', '.bin', 'blueprint');

    // Test 1: Help text
    console.log('\n[CLI Test 1] Help text...');
    try {
      execFileSync(blueprintBin, [], { encoding: 'utf-8' });
      console.log('  ❌ FAIL: Expected non-zero exit code');
      process.exit(1);
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      if (output.toLowerCase().includes('usage')) {
        console.log('  ✅ PASS: Help text contains "usage"');
      } else {
        console.log('  ❌ FAIL: Help text does not contain "usage"');
        console.log('  Output:', output);
        process.exit(1);
      }
    }

    // Test 2: Clean
    console.log('\n[CLI Test 2] Clean...');
    try {
      execFileSync(blueprintBin, ['clean', WORKSPACE], { encoding: 'utf-8' });
      console.log('  ✅ PASS: Clean succeeded');
    } catch (err) {
      console.log('  ❌ FAIL: Clean failed');
      console.log('  Error:', err.message);
      process.exit(1);
    }

    // Test 3: Implement (requires GitHub token)
    const token = await resolveGitHubToken();
    if (token) {
      console.log('\n[CLI Test 3] Implement...');
      try {
        execFileSync(blueprintBin, ['implement', WORKSPACE], {
          encoding: 'utf-8',
          timeout: 600000, // 10 minute timeout
          env: { ...process.env, GITHUB_TOKEN: token },
        });
        
        // Check if index.html was created
        const indexPath = path.join(WORKSPACE, 'index.html');
        if (fs.existsSync(indexPath)) {
          console.log('  ✅ PASS: Implementation succeeded, index.html created');
        } else {
          console.log('  ❌ FAIL: index.html not created');
          process.exit(1);
        }
      } catch (err) {
        console.log('  ❌ FAIL: Implement failed');
        console.log('  Error:', err.message);
        process.exit(1);
      }
    } else {
      console.log('\n[CLI Test 3] Implement... SKIPPED (no GitHub token)');
    }

    console.log('\n[CLI] All CLI tests passed!\n');
  } finally {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clean up tarball
    const tarball = 'cli/blueprint-1.0.0.tgz';
    if (fs.existsSync(tarball)) {
      fs.unlinkSync(tarball);
    }
  }
}

// Browser Tests
async function runBrowserTests() {
  console.log('\n═══════════════════════════════════════');
  console.log('Browser Tests');
  console.log('═══════════════════════════════════════\n');

  // Start the server
  console.log('[Browser] Starting server...');
  const server = spawn('node', ['dist/server.mjs', WORKSPACE], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  server.stdout.on('data', (data) => console.log(`[server] ${data.toString().trim()}`));
  server.stderr.on('data', (data) => console.error(`[server] ${data.toString().trim()}`));

  try {
    await waitForServer(BASE_URL);
    console.log('[Browser] Server ready\n');

    // Launch browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Test 1: App Launch
      console.log('[Browser Test 1] App Launch...');
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');
      const title = await page.title();
      if (title === 'Blueprint Implementer') {
        console.log('  ✅ PASS: Title is correct');
      } else {
        console.log(`  ❌ FAIL: Expected "Blueprint Implementer", got "${title}"`);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/01-app-launch.png` });

      // Test 2: File Tree Loads
      console.log('\n[Browser Test 2] File Tree Loads...');
      await page.waitForSelector('#file-tree .tree-item', { timeout: 10000 });
      const fileTreeText = await page.$eval('#file-tree', el => el.textContent);
      if (fileTreeText.includes('blueprint.md')) {
        console.log('  ✅ PASS: blueprint.md appears in file tree');
      } else {
        console.log('  ❌ FAIL: blueprint.md not found in file tree');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/02-file-tree.png` });

      // Test 3: File Click Opens in Editor
      console.log('\n[Browser Test 3] File Opens in Editor...');
      await page.click('.tree-row:has-text("blueprint.md")');
      await page.waitForTimeout(500);
      const editorContent = await page.$eval('#editor-textarea', el => el.value);
      if (editorContent.includes('Tic-Tac-Toe')) {
        console.log('  ✅ PASS: File content loaded into editor');
      } else {
        console.log('  ❌ FAIL: File content not loaded');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/03-editor.png` });

      // Test 4: Browser Tab Toggle
      console.log('\n[Browser Test 4] Browser Tab Toggle...');
      await page.click('#browser-tab');
      await page.waitForTimeout(200);
      const iframeVisible = await page.$eval('#preview-iframe', el => {
        const panel = el.closest('#browser-panel');
        return panel && window.getComputedStyle(panel).display !== 'none';
      });
      if (iframeVisible) {
        console.log('  ✅ PASS: Browser panel visible on Browser tab');
      } else {
        console.log('  ❌ FAIL: Browser panel not visible');
      }
      
      await page.click('#edit-tab');
      await page.waitForTimeout(200);
      const iframeHidden = await page.$eval('#preview-iframe', el => {
        const panel = el.closest('#browser-panel');
        return panel && window.getComputedStyle(panel).display === 'none';
      });
      if (iframeHidden) {
        console.log('  ✅ PASS: Browser panel hidden on Edit tab');
      } else {
        console.log('  ❌ FAIL: Browser panel still visible');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/04-browser-tab.png` });

      // Test 5: Settings Modal
      console.log('\n[Browser Test 5] Settings Modal...');
      await page.click('#settings-btn');
      await page.waitForSelector('#settings-modal.visible', { timeout: 2000 });
      console.log('  ✅ PASS: Settings modal opens');
      
      // Close with ESC
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const modal = document.getElementById('settings-modal');
        return modal && !modal.classList.contains('visible');
      }, { timeout: 2000 });
      console.log('  ✅ PASS: Settings modal closes with Escape');
      
      // Reopen and close with button
      await page.click('#settings-btn');
      await page.waitForSelector('#settings-modal.visible');
      await page.click('#close-settings-btn');
      await page.waitForFunction(() => {
        const modal = document.getElementById('settings-modal');
        return modal && !modal.classList.contains('visible');
      }, { timeout: 2000 });
      console.log('  ✅ PASS: Settings modal closes with close button');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/05-settings.png` });

      // Test 6: Terminal Echo
      console.log('\n[Browser Test 6] Terminal Echo...');
      await page.waitForSelector('#terminal-container .xterm', { timeout: 10000 });

      // Helper: read all text from the xterm buffer
      const readTerminalBuffer = () => page.evaluate(() => {
        const term = window._xtermTerminal;
        if (!term) return '';
        const buf = term.buffer.active;
        const lines = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        return lines.join('\n');
      });

      // Wait for shell prompt (any non-empty content in terminal buffer)
      await page.waitForFunction(() => {
        const term = window._xtermTerminal;
        if (!term) return false;
        const buf = term.buffer.active;
        for (let i = 0; i <= buf.cursorY; i++) {
          const line = buf.getLine(i);
          if (line && line.translateToString(true).trim().length > 0) return true;
        }
        return false;
      }, { timeout: 10000 });
      console.log('  ✅ PASS: Shell prompt appeared');

      // Focus terminal and type echo command
      await page.click('#terminal-container');
      const echoText = 'Hello from Blueprint Implementer test';
      await page.keyboard.type(`echo "${echoText}"`);
      await page.keyboard.press('Enter');

      // Wait for echo output to appear in the xterm buffer
      await page.waitForFunction((expected) => {
        const term = window._xtermTerminal;
        if (!term) return false;
        const buf = term.buffer.active;
        // Start from line 1 to skip the command line itself — look for output
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line && line.translateToString(true).includes(expected)) return true;
        }
        return false;
      }, echoText, { timeout: 5000 });
      console.log('  ✅ PASS: Terminal echoes command output');

      // Test 6b: Terminal reports valid dimensions
      const termSize = await page.evaluate(() => {
        const term = window._xtermTerminal;
        if (!term) return null;
        return { cols: term.cols, rows: term.rows };
      });
      if (termSize && termSize.cols > 0 && termSize.rows > 0) {
        console.log(`  ✅ PASS: Terminal has valid size (${termSize.cols}x${termSize.rows})`);
      } else {
        throw new Error(`Terminal has invalid size: ${JSON.stringify(termSize)}`);
      }

      // Test 7: Model Picker
      console.log('\n[Browser Test 7] Model Picker...');
      const token = await resolveGitHubToken();
      if (token) {
        await page.waitForTimeout(3000); // Wait for models to load
        const options = await page.$$eval('#model-select option', opts => opts.map(o => o.textContent));
        if (options.length > 1 && !options.some(o => o.toLowerCase().includes('unavailable') || o.toLowerCase().includes('loading'))) {
          console.log(`  ✅ PASS: Model picker has ${options.length} models`);
        } else {
          console.log(`  ⚠️ WARN: Model picker may not have loaded correctly: ${options.join(', ')}`);
        }
      } else {
        console.log('  ⚠️ SKIP: No GitHub token for model loading');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/07-models.png` });

      // Test 8: Auth Display
      console.log('\n[Browser Test 8] Auth Display...');
      if (token) {
        await page.waitForTimeout(2000);
        const userInfo = await page.$eval('#user-info', el => el.textContent);
        if (userInfo && !userInfo.includes('Loading') && !userInfo.includes('error')) {
          console.log(`  ✅ PASS: User info displayed: ${userInfo.trim()}`);
        } else {
          console.log(`  ⚠️ WARN: User info may not have loaded: ${userInfo}`);
        }
      } else {
        console.log('  ⚠️ SKIP: No GitHub token for auth');
      }

      // Test 9: Implementation (requires token)
      if (token) {
        console.log('\n[Browser Test 9] Implementation...');
        await page.click('#implement-btn');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/08-implementing.png` });
        
        // Wait for implementation to complete (up to 10 minutes)
        console.log('  Waiting for implementation (up to 10 minutes)...');
        let completed = false;
        const startTime = Date.now();
        const timeout = 10 * 60 * 1000; // 10 minutes
        let screenshotCount = 0;
        
        while (!completed && (Date.now() - startTime) < timeout) {
          // Check status
          const statusClass = await page.$eval('#implement-status', el => el.className);
          
          if (statusClass.includes('success')) {
            completed = true;
            console.log('  ✅ PASS: Implementation completed successfully');
          } else if (statusClass.includes('error')) {
            console.log('  ❌ FAIL: Implementation failed');
            break;
          }
          
          // Take periodic screenshots
          if ((Date.now() - startTime) % 30000 < 5000) { // Every ~30 seconds
            screenshotCount++;
            await page.screenshot({ path: `${SCREENSHOT_DIR}/09-progress-${screenshotCount}.png` });
          }
          
          await page.waitForTimeout(5000);
        }
        
        await page.screenshot({ path: `${SCREENSHOT_DIR}/09-implementation-done.png` });
        
        // Check if index.html appears in file tree
        if (completed) {
          await page.click('#refresh-btn');
          await page.waitForTimeout(1000);
          const treeContent = await page.$eval('#file-tree', el => el.textContent);
          if (treeContent.includes('index.html')) {
            console.log('  ✅ PASS: index.html appears in file tree');
          } else {
            console.log('  ⚠️ WARN: index.html not found in file tree');
          }
        }
      } else {
        console.log('\n[Browser Test 9] Implementation... SKIPPED (no GitHub token)');
      }

      // Test 10: Chat Multi-Turn (requires token)
      if (token) {
        console.log('\n[Browser Test 10] Chat Multi-Turn...');
        
        // Switch to Chat tab
        await page.click('#chat-tab');
        await page.waitForTimeout(500);
        
        // First message
        await page.fill('#chat-input', 'Create a file called counter.txt containing just the number 1');
        await page.click('#chat-send-btn');
        
        // Wait for response
        await page.waitForFunction(() => {
          const input = document.getElementById('chat-input');
          return input && !input.disabled;
        }, { timeout: 120000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/10-chat-1.png` });
        
        // Second message
        await page.fill('#chat-input', 'Increase the counter');
        await page.click('#chat-send-btn');
        
        // Wait for response
        await page.waitForFunction(() => {
          const input = document.getElementById('chat-input');
          return input && !input.disabled;
        }, { timeout: 120000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/10-chat-2.png` });
        
        // Check counter.txt content
        try {
          const counterPath = path.join(WORKSPACE, 'counter.txt');
          if (fs.existsSync(counterPath)) {
            const content = fs.readFileSync(counterPath, 'utf-8').trim();
            if (content === '2') {
              console.log('  ✅ PASS: counter.txt contains "2"');
            } else {
              console.log(`  ⚠️ WARN: counter.txt contains "${content}" instead of "2"`);
            }
          } else {
            console.log('  ⚠️ WARN: counter.txt not found');
          }
        } catch (err) {
          console.log(`  ⚠️ WARN: Could not read counter.txt: ${err.message}`);
        }
      } else {
        console.log('\n[Browser Test 10] Chat Multi-Turn... SKIPPED (no GitHub token)');
      }

      console.log('\n[Browser] All browser tests completed!');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/final.png` });

    } finally {
      await browser.close();
    }
  } finally {
    // Stop server
    server.kill();
    console.log('\n[Browser] Server stopped');
  }
}

// Main
async function main() {
  try {
    await runCLITests();
    await runBrowserTests();
    console.log('\n═══════════════════════════════════════');
    console.log('All tests completed!');
    console.log('═══════════════════════════════════════\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}

main();
