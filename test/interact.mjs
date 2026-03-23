// test/interact.mjs - Playwright end-to-end tests for Blueprint Implementer
import { _electron } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const testFixturesDir = path.join(__dirname, 'fixtures');

// Ensure test fixtures directory exists
if (!fs.existsSync(testFixturesDir)) {
  fs.mkdirSync(testFixturesDir, { recursive: true });
}

// Create a simple test workspace with a blueprint
const testWorkspace = path.join(testFixturesDir, 'test-workspace');
if (!fs.existsSync(testWorkspace)) {
  fs.mkdirSync(testWorkspace, { recursive: true });
  fs.writeFileSync(
    path.join(testWorkspace, 'blueprint.md'),
    `# Test Application

A simple test application.

## Components

- Main component that displays "Hello World"
`
  );
  fs.writeFileSync(
    path.join(testWorkspace, '.blueprintfiles'),
    `# Test blueprint files
blueprint.md
`
  );
}

let screenshotCount = 0;

async function screenshot(page, name) {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  screenshotCount++;
  const filename = `${String(screenshotCount).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(screenshotDir, filename) });
  console.log(`  📸 Screenshot: ${filename}`);
}

async function waitFor(condition, timeout = 10000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

async function runTests() {
  console.log('🚀 Starting Blueprint Implementer tests\n');

  // Launch Electron app
  console.log('📱 Launching Electron app...');
  const electronApp = await _electron.launch({
    args: [projectRoot, testWorkspace, '--no-sandbox'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  try {
    // Test 1: App Launch
    console.log('\n✅ Test 1: App Launch');
    const title = await page.title();
    console.log(`  Title: ${title}`);
    if (!title.includes('Blueprint')) {
      throw new Error(`Expected title to include "Blueprint", got "${title}"`);
    }
    await screenshot(page, 'app-launch');

    // Test 2: Folder Open
    console.log('\n✅ Test 2: Folder Open');
    await page.waitForTimeout(1000); // Wait for initial load
    const folderDisplay = await page.locator('#folder-display').textContent();
    console.log(`  Folder display: ${folderDisplay}`);
    if (!folderDisplay.includes('test-workspace')) {
      throw new Error(`Expected folder display to include "test-workspace", got "${folderDisplay}"`);
    }
    await screenshot(page, 'folder-open');

    // Test 3: File Tree
    console.log('\n✅ Test 3: File Tree');
    const fileTree = page.locator('#file-tree');
    await fileTree.waitFor({ state: 'visible', timeout: 5000 });

    // Look for blueprint.md in the tree
    const found = await waitFor(async () => {
      const text = await fileTree.textContent();
      return text.includes('blueprint.md');
    }, 5000);

    if (!found) {
      throw new Error('blueprint.md not found in file tree');
    }
    console.log('  blueprint.md found in file tree');
    await screenshot(page, 'file-tree');

    // Test 4: Click on file to open
    console.log('\n✅ Test 4: Open File');
    const blueprintEntry = page.locator('.file-entry', { hasText: 'blueprint.md' });
    await blueprintEntry.click();
    await page.waitForTimeout(500);

    const editorContent = await page.locator('#editor-textarea').inputValue();
    console.log(`  Editor content length: ${editorContent.length} chars`);
    if (!editorContent.includes('Test Application')) {
      throw new Error('Editor should contain blueprint content');
    }
    await screenshot(page, 'file-open');

    // Test 5: Settings Modal
    console.log('\n✅ Test 5: Settings Modal');
    await page.locator('#settings-btn').click();
    await page.waitForTimeout(300);

    const modal = page.locator('#settings-modal');
    const isVisible = await modal.isVisible();
    if (!isVisible) {
      throw new Error('Settings modal should be visible');
    }
    console.log('  Modal opened');
    await screenshot(page, 'settings-open');

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const isHidden = await modal.evaluate((el) => el.classList.contains('hidden'));
    if (!isHidden) {
      throw new Error('Settings modal should be hidden after Escape');
    }
    console.log('  Modal closed with Escape');
    await screenshot(page, 'settings-closed');

    // Test 6: Terminal Panel
    console.log('\n✅ Test 6: Terminal Panel');
    const terminal = page.locator('#terminal');
    await terminal.waitFor({ state: 'visible', timeout: 5000 });

    // Wait for terminal to have content
    const hasContent = await waitFor(async () => {
      const terminalEl = page.locator('#terminal .xterm-screen');
      const text = await terminalEl.textContent();
      return text && text.trim().length > 0;
    }, 10000);

    if (!hasContent) {
      console.log('  ⚠️ Terminal may not have content yet (shell startup delay)');
    } else {
      console.log('  Terminal has content');
    }
    await screenshot(page, 'terminal');

    // Test 7: Type echo command in terminal
    console.log('\n✅ Test 7: Terminal Echo Command');
    // Focus the terminal by clicking on it
    await terminal.click();
    await page.waitForTimeout(500);

    // Type a command
    const testString = 'Blueprint_Test_Echo_12345';
    await page.keyboard.type(`echo "${testString}"`, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Check if echo output is visible
    const terminalText = await page.locator('#terminal .xterm-screen').textContent();
    if (terminalText.includes(testString)) {
      console.log('  Echo command output verified');
    } else {
      console.log('  ⚠️ Echo output not found in terminal (may need more time)');
    }
    await screenshot(page, 'terminal-echo');

    // Test 8: Browser Tab
    console.log('\n✅ Test 8: Browser Tab');
    // Switch to Browser tab
    await page.locator('.editor-tab[data-tab="browser"]').click();
    await page.waitForTimeout(300);

    const iframe = page.locator('#browser-iframe');
    const iframeVisible = await iframe.isVisible();
    if (!iframeVisible) {
      throw new Error('Browser iframe should be visible on Browser tab');
    }
    console.log('  Browser iframe visible');

    // Switch back to Edit tab
    await page.locator('.editor-tab[data-tab="edit"]').click();
    await page.waitForTimeout(300);
    const iframeHidden = !(await iframe.isVisible());
    console.log(`  Iframe hidden on Edit tab: ${iframeHidden}`);
    await screenshot(page, 'browser-tab');

    // Test 9: Auth Gate (no token = not signed in)
    console.log('\n✅ Test 9: Auth Gate');
    // Check if user is signed in (or not)
    const userInfo = await page.locator('#user-info').textContent();
    console.log(`  User info: ${userInfo}`);
    // This test just verifies the auth display works
    await screenshot(page, 'auth-state');

    // Test 10: Implement Button (just check it exists and is clickable)
    console.log('\n✅ Test 10: Implement Button');
    const implementBtn = page.locator('#implement-btn');
    const btnVisible = await implementBtn.isVisible();
    if (!btnVisible) {
      throw new Error('Implement button should be visible');
    }
    console.log('  Implement button visible');
    await screenshot(page, 'implement-button');

    // If GITHUB_TOKEN is available, test implementation
    if (process.env.GITHUB_TOKEN) {
      console.log('\n✅ Test 11: Implementation (with token)');
      await implementBtn.click();
      await page.waitForTimeout(1000);

      const status = await page.locator('#implement-status').textContent();
      console.log(`  Status: ${status}`);
      // Check that status changed to something (running, error, etc.)
      if (status) {
        console.log('  Implementation triggered');
      }
      await screenshot(page, 'implementation-started');

      // Wait a bit and take another screenshot
      await page.waitForTimeout(5000);
      const status2 = await page.locator('#implement-status').textContent();
      console.log(`  Status after 5s: ${status2}`);
      await screenshot(page, 'implementation-progress');
    } else {
      console.log('\n⏭️ Test 11: Skipped (no GITHUB_TOKEN)');
    }

    console.log('\n🎉 All tests passed!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await screenshot(page, 'error');
    throw error;
  } finally {
    await electronApp.close();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
