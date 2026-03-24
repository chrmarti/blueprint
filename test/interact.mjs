// test/interact.mjs — Playwright E2E tests for Blueprint Implementer
//
// Verification sections covered:
// 1. main.md: File Operations — Open Folder button
// 2. main.md: Browser Tab — iframe visibility on tab switch
// 3. main.md: Settings — modal dismiss with Esc/close button
// 4. main.md: Output Panel — implement triggers streaming (requires GITHUB_TOKEN)
// 5. terminal.md — terminal functional with echo command

import { _electron } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const tictactoeFolder = join(__dirname, 'tictactoe');
const screenshotsDir = join(__dirname, 'screenshots');

mkdirSync(screenshotsDir, { recursive: true });

// Resolve GitHub token: GITHUB_TOKEN env var or `gh auth token`
let githubToken = process.env.GITHUB_TOKEN || '';
if (!githubToken) {
  try {
    githubToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' }).trim();
  } catch {
    // gh CLI not available or not logged in
  }
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message || String(err) });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message || err}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(screenshotsDir, `${name}.png`) });
}

// ── Launch App ──
console.log('\nLaunching Blueprint Implementer...');

const electronApp = await _electron.launch({
  args: [projectRoot, tictactoeFolder],
  env: { ...process.env, GITHUB_TOKEN: githubToken, ELECTRON_DISABLE_SANDBOX: '1' },
});

const page = await electronApp.firstWindow();
await page.waitForLoadState('domcontentloaded');
// Give UI a moment to initialize
await page.waitForTimeout(1500);

await screenshot(page, '01-launch');

// ── Test 1: App Launch ──
console.log('\n— App Launch —');

await test('Window has correct title', async () => {
  const title = await page.title();
  assert(title.includes('Blueprint Implementer'), `Expected title to include "Blueprint Implementer", got "${title}"`);
});

await test('Toolbar is visible', async () => {
  const toolbar = page.locator('#toolbar');
  await toolbar.waitFor({ state: 'visible', timeout: 5000 });
});

// ── Test 2: Folder Open (via command-line arg) ──
console.log('\n— Folder Open —');

await test('Folder name appears in toolbar', async () => {
  const folderName = page.locator('#folder-name');
  await folderName.waitFor({ state: 'visible', timeout: 5000 });
  const text = await folderName.textContent();
  assert(text && text.includes('tictactoe'), `Expected folder name to include "tictactoe", got "${text}"`);
});

await test('blueprint.md appears in file tree', async () => {
  // Wait for file tree to populate
  await page.waitForTimeout(1000);
  const treeEntry = page.locator('.tree-name', { hasText: 'blueprint.md' });
  await treeEntry.waitFor({ state: 'visible', timeout: 5000 });
});

await screenshot(page, '02-folder-open');

// ── Test 3: File Tree ──
console.log('\n— File Tree —');

await test('Clicking a file loads content into editor', async () => {
  const blueprintEntry = page.locator('.tree-entry.file', { hasText: 'blueprint.md' });
  await blueprintEntry.click();
  await page.waitForTimeout(500);

  const textarea = page.locator('#editor-textarea');
  const content = await textarea.inputValue();
  assert(content.includes('Tic-Tac-Toe'), `Expected editor to contain "Tic-Tac-Toe", got "${content.slice(0, 100)}"`);
});

await test('Current file label updates', async () => {
  const label = page.locator('#current-file-label');
  const text = await label.textContent();
  assert(text && text.includes('blueprint.md'), `Expected file label "blueprint.md", got "${text}"`);
});

await screenshot(page, '03-file-tree');

// ── Test 4: Browser Tab — iframe visibility ──
console.log('\n— Browser Tab —');

await test('Edit tab: iframe and address bar are not visible', async () => {
  // Ensure Edit tab is active
  const editTab = page.locator('[data-tab="edit"]');
  await editTab.click();
  await page.waitForTimeout(300);

  const browserPane = page.locator('#browser-pane');
  const display = await browserPane.evaluate(el => getComputedStyle(el).display);
  assert(display === 'none', `Expected browser-pane display to be "none", got "${display}"`);
});

await test('Browser tab: iframe and address bar are visible', async () => {
  const browserTab = page.locator('[data-tab="browser"]');
  await browserTab.click();
  await page.waitForTimeout(300);

  const browserPane = page.locator('#browser-pane');
  const display = await browserPane.evaluate(el => getComputedStyle(el).display);
  assert(display !== 'none', `Expected browser-pane to be visible, got display="${display}"`);

  const addressBar = page.locator('#address-bar');
  await addressBar.waitFor({ state: 'visible', timeout: 3000 });

  const iframe = page.locator('#preview-iframe');
  await iframe.waitFor({ state: 'visible', timeout: 3000 });
});

await test('Switch back to Edit tab hides browser pane', async () => {
  const editTab = page.locator('[data-tab="edit"]');
  await editTab.click();
  await page.waitForTimeout(300);

  const browserPane = page.locator('#browser-pane');
  const display = await browserPane.evaluate(el => getComputedStyle(el).display);
  assert(display === 'none', `Expected browser-pane hidden after switching to Edit, got "${display}"`);
});

await screenshot(page, '04-browser-tab');

// ── Test 5: Settings Modal ──
console.log('\n— Settings Modal —');

await test('Settings modal opens on gear click', async () => {
  const settingsBtn = page.locator('#settings-btn');
  await settingsBtn.click();
  await page.waitForTimeout(300);

  const modal = page.locator('#settings-modal');
  const hasOpen = await modal.evaluate(el => el.classList.contains('open'));
  assert(hasOpen, 'Expected settings modal to have "open" class');
});

await test('Settings modal closes with Esc', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const modal = page.locator('#settings-modal');
  const hasOpen = await modal.evaluate(el => el.classList.contains('open'));
  assert(!hasOpen, 'Expected settings modal to not have "open" class after Esc');
});

await test('Settings modal closes with close button', async () => {
  // Open it again
  const settingsBtn = page.locator('#settings-btn');
  await settingsBtn.click();
  await page.waitForTimeout(300);

  // Click the close button
  const closeBtn = page.locator('#settings-close-btn');
  await closeBtn.click();
  await page.waitForTimeout(300);

  const modal = page.locator('#settings-modal');
  const hasOpen = await modal.evaluate(el => el.classList.contains('open'));
  assert(!hasOpen, 'Expected settings modal closed after close button click');
});

await screenshot(page, '05-settings');

// ── Test 6: Terminal ──
console.log('\n— Terminal —');

await test('Terminal container is visible', async () => {
  const container = page.locator('#terminal-container');
  await container.waitFor({ state: 'visible', timeout: 5000 });
});

await test('Terminal has xterm content', async () => {
  // Wait for xterm to render something
  await page.waitForTimeout(2000);

  const hasContent = await page.evaluate(() => {
    const container = document.getElementById('terminal-container');
    if (!container) return false;
    // xterm renders into a .xterm-screen element
    const screen = container.querySelector('.xterm-screen');
    return !!screen;
  });
  assert(hasContent, 'Expected xterm screen element to exist in terminal container');
});

await test('Terminal responds to echo command', async () => {
  // The shell may have already exited — kill and respawn
  // Keep existing data listeners intact so pty output reaches xterm.js
  await page.evaluate(async () => {
    window.electronAPI.terminalKill();
  });
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    await window.electronAPI.terminalSpawn();
  });

  // Wait for shell to fully initialize and show prompt
  await page.waitForTimeout(3000);

  const echoText = 'Blueprint_Terminal_Test_12345_Verification';

  // Send echo command to the pty
  await page.evaluate((text) => {
    window.electronAPI.terminalWrite(`echo ${text}\n`);
  }, echoText);

  // Wait for echo output to render in xterm
  await page.waitForTimeout(2000);

  await screenshot(page, '06-terminal-echo');

  // Read terminal buffer text — try multiple approaches
  const found = await page.evaluate((text) => {
    const container = document.getElementById('terminal-container');
    if (!container) return false;

    // Approach 1: Read from xterm rows (DOM)
    const rows = container.querySelectorAll('.xterm-rows > div');
    let domText = '';
    rows.forEach(row => {
      domText += (row.textContent || '') + '\n';
    });
    if (domText.includes(text)) return true;

    // Approach 2: Read all text content from the container
    const allText = container.textContent || '';
    if (allText.includes(text)) return true;

    return false;
  }, echoText);

  assert(found, `Expected terminal to contain "${echoText}"`);
});

await screenshot(page, '07-terminal-final');

// ── Test 7: Model Picker Populated ──
const hasToken = !!githubToken;

if (!hasToken) {
  failed++;
  failures.push({ name: 'GitHub token resolution', error: 'No GitHub token available. Set GITHUB_TOKEN or run `gh auth login`.' });
  console.error('  ✗ GitHub token resolution: no token available');
} else {
  console.log('\n— Model Picker (E2E) —');

  await test('Model picker is populated with real models', async () => {
    // Wait for models to load (SDK client start + listModels can take a while)
    const populated = await page.waitForFunction(() => {
      const select = document.getElementById('model-select');
      if (!select) return false;
      const options = select.querySelectorAll('option');
      if (options.length < 2) return false;
      // Check none say "unavailable" or "Loading"
      for (const opt of options) {
        const text = opt.textContent || '';
        if (text.includes('unavailable') || text.includes('Loading')) return false;
      }
      return true;
    }, { timeout: 60000 }).catch(() => null);

    assert(populated, 'Expected model-select to have real model options within 60s');
  });

  await screenshot(page, '08-models-loaded');

  // ── Test 8: Implementation Completes ──
  console.log('\n— Implementation E2E —');

  await test('Implement produces index.html (tic-tac-toe)', async () => {
    const implementBtn = page.locator('#implement-btn');
    await implementBtn.click();

    // Wait for status to show implementing
    await page.waitForTimeout(2000);
    await screenshot(page, '09-implementing');

    // Poll for completion with periodic screenshots (up to 10 minutes)
    const maxWait = 10 * 60 * 1000;
    const interval = 15000;
    const start = Date.now();
    let screenshotIdx = 10;
    let completed = false;

    while (Date.now() - start < maxWait) {
      const status = await page.evaluate(() => {
        const el = document.getElementById('implement-status');
        return el ? { text: el.textContent, className: el.className } : null;
      });

      if (status && status.className.includes('success')) {
        completed = true;
        break;
      }
      if (status && status.className.includes('error')) {
        throw new Error(`Implementation failed: ${status.text}`);
      }

      await page.waitForTimeout(interval);
      await screenshot(page, `${screenshotIdx}-implementing-progress`);
      screenshotIdx++;
    }

    assert(completed, 'Expected implementation to complete with success status within 10 minutes');

    await screenshot(page, `${screenshotIdx}-implement-done`);

    // Verify index.html appears in the file tree
    await page.waitForTimeout(2000);
    const indexEntry = page.locator('.tree-name', { hasText: 'index.html' });
    const visible = await indexEntry.isVisible().catch(() => false);
    assert(visible, 'Expected index.html to appear in the file tree after implementation');
  });

  await screenshot(page, '99-e2e-complete');
}

// ── Summary ──
console.log('\n═══════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failures:');
  for (const f of failures) {
    console.log(`    ✗ ${f.name}: ${f.error}`);
  }
}
console.log('═══════════════════════════════════════\n');

await electronApp.close();
process.exit(failed > 0 ? 1 : 0);
