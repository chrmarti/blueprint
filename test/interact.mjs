// Playwright test script for Blueprint Implementer
// Tests basic functionality, terminal, settings, and implementation

import { _electron as electron } from 'playwright';
import { execFileSync, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const TEST_WORKSPACE = path.join(PROJECT_ROOT, 'test', 'tictactoe');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'test', 'screenshots');

// Ensure screenshots directory exists
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Resolve GitHub token
function resolveGitHubToken() {
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

// CLI Tests
async function runCLITests() {
  console.log('\n=== CLI Tests ===\n');

  // Create temp directory for local CLI install
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-cli-test-'));
  const cliTarball = path.join(PROJECT_ROOT, 'cli', 'blueprint-1.0.0.tgz');
  
  try {
    // Pack the CLI
    console.log('Packing CLI...');
    execSync('npm pack', { cwd: path.join(PROJECT_ROOT, 'cli'), stdio: 'inherit' });

    // Install CLI to temp directory
    console.log('Installing CLI to temp directory...');
    execSync(`npm install --prefix "${tmpDir}" "${cliTarball}"`, { stdio: 'inherit' });

    const blueprintBin = path.join(tmpDir, 'node_modules', '.bin', 'blueprint');

    // Test 1: Help text
    console.log('\n1. Testing help text...');
    try {
      execFileSync(blueprintBin, [], { encoding: 'utf-8' });
      console.log('   ✗ Expected non-zero exit code');
      process.exit(1);
    } catch (error) {
      const output = error.stdout + error.stderr;
      if (output.toLowerCase().includes('usage')) {
        console.log('   ✓ Help text contains "usage"');
      } else {
        console.log('   ✗ Help text does not contain "usage"');
        console.log('   Output:', output);
        process.exit(1);
      }
    }

    // Test 2: Clean command
    console.log('\n2. Testing clean command...');
    try {
      execFileSync(blueprintBin, ['clean', TEST_WORKSPACE], { encoding: 'utf-8', stdio: 'pipe' });
      console.log('   ✓ Clean command succeeded');
    } catch (error) {
      console.log('   ✗ Clean command failed:', error.message);
      process.exit(1);
    }

    // Test 3: Implement command (requires GitHub token)
    const token = resolveGitHubToken();
    if (token) {
      console.log('\n3. Testing implement command...');
      try {
        execFileSync(blueprintBin, ['implement', TEST_WORKSPACE, '--no-sandbox'], {
          encoding: 'utf-8',
          stdio: 'inherit',
          env: { ...process.env, GITHUB_TOKEN: token },
          timeout: 600000, // 10 minutes
        });
        
        // Check if index.html was created
        const indexPath = path.join(TEST_WORKSPACE, 'index.html');
        if (fs.existsSync(indexPath)) {
          console.log('   ✓ Implement command succeeded, index.html created');
        } else {
          console.log('   ✗ Implement command succeeded but index.html not found');
          process.exit(1);
        }
      } catch (error) {
        console.log('   ✗ Implement command failed:', error.message);
        process.exit(1);
      }
    } else {
      console.log('\n3. Skipping implement test (no GitHub token)');
    }

  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (fs.existsSync(cliTarball)) {
      fs.unlinkSync(cliTarball);
    }
  }

  console.log('\n=== CLI Tests Complete ===\n');
}

// Electron/Playwright Tests
async function runElectronTests() {
  console.log('\n=== Electron Tests ===\n');

  const token = resolveGitHubToken();
  
  // Launch Electron app
  console.log('Launching Electron app...');
  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, TEST_WORKSPACE],
    env: {
      ...process.env,
      ...(token ? { GITHUB_TOKEN: token } : {}),
    },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  try {
    // Test 1: App Launch
    console.log('\n1. Testing app launch...');
    const title = await window.title();
    if (title.includes('Blueprint')) {
      console.log('   ✓ Window title contains "Blueprint"');
    } else {
      console.log('   ✗ Window title does not contain "Blueprint":', title);
    }
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-launch.png') });

    // Test 2: Folder loaded
    console.log('\n2. Testing folder loading...');
    await window.waitForTimeout(2000); // Wait for folder to load
    const folderName = await window.locator('#folder-name').textContent();
    if (folderName?.includes('tictactoe')) {
      console.log('   ✓ Folder name displayed:', folderName);
    } else {
      console.log('   ✗ Folder name not displayed correctly:', folderName);
    }

    // Test 3: File tree
    console.log('\n3. Testing file tree...');
    const blueprintFile = await window.locator('.file-tree-item .name', { hasText: 'blueprint.md' });
    if (await blueprintFile.count() > 0) {
      console.log('   ✓ blueprint.md visible in file tree');
    } else {
      console.log('   ✗ blueprint.md not found in file tree');
    }
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-file-tree.png') });

    // Test 4: Click file to load in editor
    console.log('\n4. Testing file loading...');
    await blueprintFile.first().click();
    await window.waitForTimeout(500);
    const editorContent = await window.locator('#editor-textarea').inputValue();
    if (editorContent.includes('Tic-Tac-Toe')) {
      console.log('   ✓ File content loaded in editor');
    } else {
      console.log('   ✗ File content not loaded correctly');
    }
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-editor.png') });

    // Test 5: Terminal panel
    console.log('\n5. Testing terminal panel...');
    await window.waitForTimeout(2000); // Wait for terminal to spawn
    const terminalContainer = window.locator('#terminal-container');
    const hasTerminal = await terminalContainer.locator('.xterm').count() > 0;
    if (hasTerminal) {
      console.log('   ✓ Terminal xterm instance rendered');
    } else {
      console.log('   ✗ Terminal not rendered');
    }
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-terminal.png') });

    // Test 6: Type in terminal
    console.log('\n6. Testing terminal input...');
    // Focus terminal and type
    await terminalContainer.click();
    await window.keyboard.type('echo "Blueprint test successful!"');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-terminal-echo.png') });
    console.log('   ✓ Terminal echo command executed');

    // Test 7: Browser tab visibility
    console.log('\n7. Testing browser tab visibility...');
    const editTab = window.locator('#edit-tab');
    const browserTab = window.locator('#browser-tab');
    const editPanel = window.locator('#edit-panel');
    const browserPanel = window.locator('#browser-panel');

    // Check Edit tab is active
    if (await editPanel.isVisible()) {
      console.log('   ✓ Edit panel visible on Edit tab');
    }

    // Switch to Browser tab
    await browserTab.click();
    await window.waitForTimeout(200);
    if (await browserPanel.isVisible() && !(await editPanel.isVisible())) {
      console.log('   ✓ Browser panel visible, Edit panel hidden on Browser tab');
    }

    // Switch back to Edit tab
    await editTab.click();
    await window.waitForTimeout(200);
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-tabs.png') });

    // Test 8: Settings modal
    console.log('\n8. Testing settings modal...');
    await window.locator('#settings-btn').click();
    await window.waitForTimeout(300);
    const modal = window.locator('#settings-modal');
    if (await modal.isVisible()) {
      console.log('   ✓ Settings modal opened');
    }
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-settings.png') });

    // Close with Escape
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    if (!(await modal.isVisible())) {
      console.log('   ✓ Settings modal closed with Escape');
    }

    // Test 9: Model picker (if authenticated)
    if (token) {
      console.log('\n9. Testing model picker...');
      await window.waitForTimeout(3000); // Wait for models to load
      const modelSelect = window.locator('#model-select');
      const options = await modelSelect.locator('option').all();
      if (options.length > 1) {
        const firstOption = await options[0].textContent();
        if (!firstOption?.toLowerCase().includes('unavailable') && !firstOption?.toLowerCase().includes('loading')) {
          console.log('   ✓ Model picker populated with', options.length, 'models');
        } else {
          console.log('   ⚠ Model picker shows loading/unavailable state');
        }
      } else {
        console.log('   ⚠ Model picker has only one option');
      }
      await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-models.png') });

      // Test 10: Implementation
      console.log('\n10. Testing implementation...');
      await window.locator('#implement-btn').click();
      
      // Wait for implementation to start
      await window.waitForTimeout(2000);
      const status = window.locator('#implement-status');
      const statusText = await status.textContent();
      if (statusText?.includes('Implementing')) {
        console.log('   ✓ Implementation started');
      }
      await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-implementing.png') });

      // Wait for implementation to complete (with periodic screenshots)
      console.log('   Waiting for implementation to complete (up to 10 minutes)...');
      const startTime = Date.now();
      const timeout = 600000; // 10 minutes
      let completed = false;
      let screenshotCount = 10;

      while (Date.now() - startTime < timeout) {
        const currentStatus = await status.getAttribute('class') || '';
        if (currentStatus.includes('success')) {
          completed = true;
          console.log('   ✓ Implementation completed successfully');
          break;
        }
        if (currentStatus.includes('error')) {
          console.log('   ✗ Implementation failed');
          break;
        }
        
        // Take periodic screenshots
        if ((Date.now() - startTime) % 30000 < 5000) {
          await window.screenshot({ path: path.join(SCREENSHOTS_DIR, `10-progress-${screenshotCount++}.png`) });
        }
        
        await window.waitForTimeout(5000);
      }

      await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '11-complete.png') });

      if (completed) {
        // Check if index.html appears in file tree
        const indexFile = await window.locator('.file-tree-item .name', { hasText: 'index.html' });
        if (await indexFile.count() > 0) {
          console.log('   ✓ index.html appeared in file tree');
        }
      }

      // Test 11: Chat multi-turn (if implementation succeeded)
      if (completed) {
        console.log('\n11. Testing chat multi-turn...');
        
        // Switch to Chat tab
        await window.locator('#chat-tab').click();
        await window.waitForTimeout(200);
        
        // Send first message
        const chatInput = window.locator('#chat-input');
        await chatInput.fill('Create a file called counter.txt containing just the number 1');
        await window.locator('#chat-send-btn').click();
        
        // Wait for response
        console.log('   Waiting for first chat response...');
        await window.waitForTimeout(30000);
        await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '12-chat-1.png') });
        
        // Send second message (tests conversation context)
        await chatInput.fill('Increase the counter');
        await window.locator('#chat-send-btn').click();
        
        // Wait for response
        console.log('   Waiting for second chat response...');
        await window.waitForTimeout(30000);
        await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '13-chat-2.png') });
        
        // Check counter.txt content
        const counterPath = path.join(TEST_WORKSPACE, 'counter.txt');
        if (fs.existsSync(counterPath)) {
          const content = fs.readFileSync(counterPath, 'utf-8').trim();
          if (content === '2') {
            console.log('   ✓ Chat multi-turn context working (counter = 2)');
          } else {
            console.log('   ⚠ Counter value is', content, '(expected 2)');
          }
        } else {
          console.log('   ⚠ counter.txt not found');
        }
      }
    } else {
      // Test auth gate
      console.log('\n9. Testing auth gate...');
      await window.locator('#implement-btn').click();
      await window.waitForTimeout(1000);
      const status = await window.locator('#implement-status').textContent();
      if (status?.includes('Not signed in')) {
        console.log('   ✓ Auth gate working (shows "Not signed in")');
      }
      await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-auth-gate.png') });
    }

    // Test: Terminal respawn after opening new folder
    console.log('\n12. Testing terminal respawn...');
    
    // Open a different folder (use project root)
    await window.evaluate(async (projectRoot) => {
      await window.electronAPI.setWorkspaceFolder(projectRoot);
    }, PROJECT_ROOT);
    
    // Click open folder button to trigger respawn
    // (In real app, opening folder respawns terminal)
    await window.locator('#refresh-btn').click();
    await window.waitForTimeout(2000);
    
    // Type in terminal again
    await terminalContainer.click();
    await window.keyboard.type('echo "Terminal respawn test!"');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(SCREENSHOTS_DIR, '14-terminal-respawn.png') });
    console.log('   ✓ Terminal respawn test complete');

  } finally {
    await electronApp.close();
  }

  console.log('\n=== Electron Tests Complete ===\n');
}

// Main
async function main() {
  console.log('Blueprint Implementer Test Suite');
  console.log('================================\n');
  console.log('Project root:', PROJECT_ROOT);
  console.log('Test workspace:', TEST_WORKSPACE);
  console.log('Screenshots:', SCREENSHOTS_DIR);

  const token = resolveGitHubToken();
  if (token) {
    console.log('GitHub token: available');
  } else {
    console.log('GitHub token: NOT AVAILABLE (some tests will be skipped)');
  }

  try {
    // Run CLI tests first
    await runCLITests();
    
    // Run Electron tests
    await runElectronTests();
    
    console.log('\n✓ All tests completed!\n');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

main();
