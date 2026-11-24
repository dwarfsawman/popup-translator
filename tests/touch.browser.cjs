// Requires Playwright (PLAYWRIGHT_MODULE_PATH can point at an existing install).
// CHROME_EXECUTABLE optionally selects a locally installed Chrome binary.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

test('popup touch scrolling bypasses reader capture gestures and preserves controls', async () => {
  const browser = await chromium.launch(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE, headless: true }
    : { channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: true });
    const page = await context.newPage();
    await page.setContent('<body style="margin:0;height:1600px"><p>Reader outside the popup</p></body>');
    // Model Readest's document-capture bookmark listeners, registered FIRST.
    await page.evaluate(() => {
      window.readerTouches = 0;
      window.chrome = { storage: {
        local: { get: (keys, callback) => callback({}), set: () => {} },
        onChanged: { addListener: () => {} },
      }, runtime: { onMessage: { addListener: () => {} } } };
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        document.addEventListener(type, () => window.readerTouches++, { capture: true });
      }
    });
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../content.css'), 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8') });
    await page.evaluate(() => {
      createDetailedPopup(150, 150, '');
      document.querySelector('.translation-output').textContent = '翻訳文のスクロール検証\n'.repeat(100);
    });
    const popup = page.locator('.openrouter-translator-detailed-popup');
    await page.locator('.popup-zoom-in').tap();
    assert.equal(await popup.getAttribute('data-ort-scale'), '1.1');
    await page.locator('.popup-zoom-out').tap();
    assert.equal(await popup.getAttribute('data-ort-scale'), '1');
    const session = await context.newCDPSession(page);
    async function drag(selector, dx, dy) {
      const box = await page.locator(selector).boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let i = 1; i <= 8; i++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8, id: 1 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    const start = await popup.boundingBox();
    await drag('.popup-drag-handle', 80, 40);
    const moved = await popup.boundingBox();
    assert.equal(moved.x - start.x, 80);
    assert.equal(moved.y - start.y, 40);
    await drag('.resize-handle-se', 60, 50);
    assert.equal((await popup.boundingBox()).width - moved.width, 60);
    await drag('.resize-handle-se', -40, -30);
    assert.equal((await popup.boundingBox()).width - moved.width, 20);
    const output = page.locator('.translation-output');
    await output.evaluate(e => { e.scrollTop = 300; });
    await drag('.translation-output', 0, 100);
    await page.waitForFunction(() => document.querySelector('.translation-output').scrollTop < 300);
    assert.equal(await page.evaluate(() => window.readerTouches), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.evaluate(() => activeInteraction.element), null);
    // Let native scroll inertia settle before testing the next independent tap.
    await output.evaluate(e => new Promise(resolve => {
      let previous = e.scrollTop, stableFrames = 0;
      const check = () => {
        stableFrames = Math.abs(e.scrollTop - previous) < 0.1 ? stableFrames + 1 : 0;
        previous = e.scrollTop;
        if (stableFrames >= 6) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    await output.evaluate(e => { e.scrollTop = 0; });
    await drag('.translation-output', 0, 100);
    assert.equal(await page.evaluate(() => window.readerTouches), 0);
    assert.equal(await output.evaluate(e => e.scrollTop), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.locator('.popup-close-button').tap();
    assert.equal(await popup.count(), 0);
    // Outside gestures still reach the reader; the shield is popup-specific.
    await page.touchscreen.tap(50, 50);
    assert.ok(await page.evaluate(() => window.readerTouches > 0));
  } finally {
    await browser.close();
  }
});

test('a failed translation can be retried in the same popup', async () => {
  const browser = await chromium.launch(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE, headless: true }
    : { channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true });
    await page.setContent('<body></body>');
    await page.evaluate(() => {
      window.translationRequests = [];
      window.chrome = {
        storage: {
          local: { get: (keys, callback) => callback({}), set: () => {} },
          onChanged: { addListener: () => {} },
        },
        runtime: {
          onMessage: { addListener: (listener) => { window.openTranslation = listener; } },
          sendMessage: (request, callback) => window.translationRequests.push({ request, callback }),
        },
      };
    });
    await page.addStyleTag({ path: path.join(__dirname, '../content.css') });
    await page.addScriptTag({ path: path.join(__dirname, '../content.js') });
    await page.evaluate(() => {
      window.openTranslation({ action: 'showPopupFromContextMenu', selection: 'Original text' });
      window.translationRequests[0].callback({ error: 'APIから翻訳結果が返されませんでした。' });
      selectedTextGlobal = 'Different selection';
    });

    const popup = page.locator('.openrouter-translator-detailed-popup');
    const popupId = await popup.getAttribute('data-popup-id');
    const retry = popup.getByRole('button', { name: '再試行' });
    await retry.tap();
    assert.equal(await retry.count(), 0);
    assert.equal(await popup.locator('#inlineLoadingIndicator').isVisible(), true);

    await page.evaluate(() => {
      chrome.runtime.lastError = { message: 'Connection lost' };
      window.translationRequests[1].callback();
      delete chrome.runtime.lastError;
    });
    assert.equal(await popup.getByText('エラー: Connection lost').isVisible(), true);
    await retry.tap();
    await page.evaluate(() => {
      window.translationRequests[2].callback({ translatedText: '元の文章' });
    });

    assert.equal(await popup.count(), 1);
    assert.equal(await popup.getAttribute('data-popup-id'), popupId);
    assert.equal(await popup.locator('.translation-output').textContent(), '元の文章');
    assert.equal(await popup.locator('#inlineLoadingIndicator').isVisible(), false);
    assert.equal(await retry.count(), 0);
    const requests = await page.evaluate(() => window.translationRequests.map(({ request }) => request));
    assert.deepEqual(requests, Array(3).fill({
      action: 'translate', text: 'Original text', targetLanguage: 'Japanese',
    }));
  } finally {
    await browser.close();
  }
});
