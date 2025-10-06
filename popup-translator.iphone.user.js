// ==UserScript==
// @name         OpenRouter Inline Translator (iPhone)
// @namespace    https://github.com/
// @version      1.0.0
// @description  iPhone向け: タッチでドラッグ可能な翻訳ポップアップ。OpenRouter APIを使用。
// @match        *://*/*
// @match        about:blank
// @match        blob:*
// @match        data:*
// @include      about:blank
// @include      /^about:blank.*/
// @include      /^blob:.*/
// @include      /^data:.*/
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      openrouter.ai
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Configuration ----------
  const DEFAULT_POPUP_WIDTH = 400;
  const DEFAULT_POPUP_HEIGHT = 300;
  const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'openai/gpt-4.1';
  // iPhone版ではAPIキーをハードコードして使用します。
  // 必ずあなたのOpenRouter APIキーに置き換えてください。
  // 例: const HARDCODED_API_KEY = 'sk-or-v1-...';
  const HARDCODED_API_KEY = '';

  // ---------- State ----------
  let smallIconPopup = null;
  let selectedTextGlobal = '';
  let popupIdCounter = 0;
  let isPointerDown = false;
  let activeInteraction = {
    element: null,
    isDragging: false,
    isResizing: false,
    resizeType: '',
    dragStartX: 0,
    dragStartY: 0,
    popupStartX: 0,
    popupStartY: 0,
    startWidth: 0,
    startHeight: 0,
    startX: 0,
    startY: 0,
  };

  // ---------- Utilities ----------
  function addStyle(css) {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
  }

  function getEventCoords(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  // Backward-compatible wrappers for GM storage (support both GM_* and GM.*)
  async function gmGetValue(key, defaultValue) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, defaultValue);
        return v && typeof v.then === 'function' ? await v : v;
      }
      if (typeof GM !== 'undefined' && GM.getValue) {
        return await GM.getValue(key, defaultValue);
      }
    } catch (_) { }
    return defaultValue;
  }

  async function gmSetValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        const r = GM_setValue(key, value);
        if (r && typeof r.then === 'function') await r;
        return;
      }
      if (typeof GM !== 'undefined' && GM.setValue) {
        await GM.setValue(key, value);
        return;
      }
    } catch (_) { }
  }

  async function getSavedPopupSize() {
    const width = await gmGetValue('popupWidth', DEFAULT_POPUP_WIDTH);
    const height = await gmGetValue('popupHeight', DEFAULT_POPUP_HEIGHT);
    return { width, height };
  }

  function savePopupSize(width, height) {
    gmSetValue('popupWidth', width);
    gmSetValue('popupHeight', height);
  }

  async function getApiKey() {
    return (HARDCODED_API_KEY || '').trim();
  }

  // iPhone版ではAPIキーの対話設定は不要（未使用）。

  function buildSystemPrompt(targetLanguage) {
    switch (targetLanguage) {
      case 'Japanese':
        return '以下の文章を日本語訳してください。なるべく直訳は避け自然な日本語にしてください。前置きや説明は省き、翻訳結果だけを出力してください。';
      case 'English':
        return 'Please translate the following text to English. Make it natural and avoid literal translation. Output only the translation without any preamble or explanation.';
      case 'Korean':
        return '다음 문장을 한국어로 번역해주세요. 직역보다는 자연스러운 한국어로 번역해주세요. 전제나 설명 없이 번역 결과만 출력해주세요.';
      case 'Chinese':
        return '请将以下文本翻译成中文。请避免直译，使用自然的中文表达。 只输出翻译结果，不要任何前言或解释。';
      default:
        return `Please translate the following text to ${targetLanguage}. Make it natural and avoid literal translation. Output only the translation without any preamble or explanation.`;
    }
  }

  function postJsonWithGM(url, headers, body) {
    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        // Fallback to fetch if GM_xmlhttpRequest not available
        fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
          .then(async (r) => {
            const ok = r.ok;
            let data = null;
            try { data = await r.json(); } catch (_) { }
            resolve({ ok, data, status: r.status, error: ok ? null : data });
          })
          .catch((err) => resolve({ ok: false, data: null, status: 0, error: err }));
        return;
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        data: JSON.stringify(body),
        onload: (resp) => {
          let data = null;
          try { data = JSON.parse(resp.responseText); } catch (_) { }
          resolve({ ok: resp.status >= 200 && resp.status < 300, data, status: resp.status, error: data });
        },
        onerror: (err) => resolve({ ok: false, data: null, status: 0, error: err }),
        ontimeout: () => resolve({ ok: false, data: null, status: 0, error: { message: 'timeout' } }),
      });
    });
  }

  async function translateTextWithOpenRouter(text, targetLanguage) {
    const apiKey = await getApiKey();
    if (!apiKey) {
      return { error: 'APIキーが未設定です。スクリプト先頭の HARDCODED_API_KEY をあなたのキーに置き換えてください。' };
    }
    if (!text) {
      return { error: '翻訳するテキストが入力されていません。' };
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': location.href,
      'X-Title': 'OpenRouter Translator Userscript',
    };

    const body = {
      model: MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt(targetLanguage) },
        { role: 'user', content: text }
      ],
      max_tokens: 4000,
      temperature: 0.7,
    };

    try {
      const resp = await postJsonWithGM(API_URL, headers, body);
      if (!resp.ok) {
        let errorMessage = `APIエラー: ${resp.status}`;
        if (resp.error && resp.error.error && resp.error.error.message) {
          errorMessage += ` - ${resp.error.error.message}`;
        }
        return { error: errorMessage };
      }
      const data = resp.data;
      if (data && data.choices && data.choices.length > 0 && data.choices[0].message) {
        return { translatedText: String(data.choices[0].message.content || '').trim() };
      }
      return { error: 'APIからの応答形式が正しくありません。' };
    } catch (err) {
      return { error: `ネットワークエラーまたはリクエスト失敗: ${err && err.message ? err.message : err}` };
    }
  }

  // ---------- UI Elements ----------
  function removeDetailedPopup(popupElement) {
    if (popupElement) popupElement.remove();
  }

  function removeSmallIconPopup() {
    if (smallIconPopup) {
      smallIconPopup.remove();
      smallIconPopup = null;
    }
  }

  function createSmallIconPopup(x, y) {
    removeSmallIconPopup();
    if (!document.body) return;

    const div = document.createElement('div');
    div.id = 'openrouter-translator-small-icon-popup';
    div.innerHTML = `<span class="emoji-trigger" title="翻訳する">🌐</span>`;

    document.body.appendChild(div);
    smallIconPopup = div;
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;

    // Clamp to viewport
    const margin = 6;
    const usedWidth = div.offsetWidth;
    const usedHeight = div.offsetHeight;
    const maxLeft = window.scrollX + window.innerWidth - usedWidth - margin;
    const maxTop = window.scrollY + window.innerHeight - usedHeight - margin;
    const clampedLeft = Math.max(window.scrollX + margin, Math.min(x, maxLeft));
    const clampedTop = Math.max(window.scrollY + margin, Math.min(y, maxTop));
    div.style.left = `${clampedLeft}px`;
    div.style.top = `${clampedTop}px`;

    div.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!selectedTextGlobal) return;
      const iconRect = div.getBoundingClientRect();
      const popup = createDetailedPopup(iconRect.left + window.scrollX, iconRect.bottom + window.scrollY + 5, selectedTextGlobal, true);
      if (smallIconPopup) smallIconPopup.style.display = 'none';

      const loading = popup.querySelector('#inlineLoadingIndicator');
      const out = popup.querySelector('#inlineTranslationOutput');
      try {
        const apiKey = await getApiKey();
        if (!apiKey) {
          if (out) out.textContent = 'エラー: APIキーが未設定です。スクリプト先頭の HARDCODED_API_KEY をあなたのキーに置き換えてください。';
          return;
        }
        const response = await translateTextWithOpenRouter(selectedTextGlobal, 'Japanese');
        if (!out) return;
        if (response && response.error) {
          out.textContent = `エラー: ${response.error}`;
        } else if (response && response.translatedText) {
          out.textContent = response.translatedText;
        } else {
          out.textContent = '翻訳結果がありません。';
        }
      } catch (err) {
        if (out) out.textContent = `エラー: ${err && err.message ? err.message : err}`;
      } finally {
        if (loading) loading.style.display = 'none';
      }
    });
  }

  function createDetailedPopup(x, y, originalText, isLoading = false) {
    const popup = document.createElement('div');
    popup.className = 'openrouter-translator-detailed-popup';
    popup.dataset.popupId = `popup-translator-${popupIdCounter++}`;
    popup.innerHTML = `
      <div class="popup-drag-handle" title="ドラッグで移動"></div>
      <button class="popup-close-button" title="閉じる" type="button">&times;</button>
      <div class="translator-popup-content">
        <div id="inlineLoadingIndicator" class="loading" style="display: ${isLoading ? 'block' : 'none'};">...</div>
        <div id="inlineTranslationOutput" class="translation-output"></div>
      </div>
      <div class="resize-handle resize-handle-e"></div>
      <div class="resize-handle resize-handle-w"></div>
      <div class="resize-handle resize-handle-s"></div>
      <div class="resize-handle resize-handle-se"></div>
    `;

    document.body.appendChild(popup);
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    popup.style.zIndex = 10000 + popupIdCounter;

    getSavedPopupSize().then(({ width, height }) => {
      popup.style.width = `${width}px`;
      popup.style.height = `${height}px`;
      const margin = 8;
      const usedWidth = popup.offsetWidth;
      const usedHeight = popup.offsetHeight;
      const maxLeft = window.scrollX + window.innerWidth - usedWidth - margin;
      const maxTop = window.scrollY + window.innerHeight - usedHeight - margin;
      const clampedLeft = Math.max(window.scrollX + margin, Math.min(x, maxLeft));
      const clampedTop = Math.max(window.scrollY + margin, Math.min(y, maxTop));
      popup.style.left = `${clampedLeft}px`;
      popup.style.top = `${clampedTop}px`;
    });

    setupPopupInteractions(popup);
    return popup;
  }

  // ---------- Frame bridge (Readest/iframe viewers) ----------
  // Some readers render content inside about:blank/blob/data iframes (often under Shadow DOM).
  // Many userscript managers don't inject into those frames. We attach listeners from the
  // top document into any same-origin iframe we can access and mirror the UI in the top doc.

  const attachedFrames = new WeakSet();
  const shadowObservers = new WeakMap();
  const frameSelTimers = new WeakMap();

  function getSelectionRectFrom(win) {
    try {
      const sel = win.getSelection && win.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const text = String(sel.toString() || '').trim();
      if (!text) return null;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return { text, rect };
    } catch (_) {
      return null;
    }
  }

  function showIconForFrameSelection(frameEl, win) {
    const info = getSelectionRectFrom(win);
    if (!info) return false;
    selectedTextGlobal = info.text;
    const frameRect = frameEl.getBoundingClientRect();
    const x = window.scrollX + frameRect.left + info.rect.right - 10;
    const y = window.scrollY + frameRect.top + info.rect.top - 10;
    createSmallIconPopup(x, y);
    return true;
  }

  function onFramePointerStart() {
    removeSmallIconPopup();
  }

  function onFrameMouseUp(e) {
    const frameEl = e.view && e.view.frameElement;
    if (!frameEl) return;
    // Defer to let selection settle
    setTimeout(() => {
      showIconForFrameSelection(frameEl, e.view);
    }, 0);
  }

  function onFrameSelectionChange(e) {
    const doc = e.target && e.target.ownerDocument ? e.target.ownerDocument : (e.view && e.view.document);
    if (!doc) return;
    const prev = frameSelTimers.get(doc);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      const win = doc.defaultView;
      const frameEl = win && win.frameElement;
      if (!frameEl) return;
      showIconForFrameSelection(frameEl, win);
    }, 80);
    frameSelTimers.set(doc, timer);
  }

  function attachToAccessibleIframe(iframe) {
    if (!iframe || attachedFrames.has(iframe)) return;
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) return; // not ready yet
      // Access test (throws if cross-origin)
      void doc.documentElement;
      // Attach listeners
      doc.addEventListener('mousedown', onFramePointerStart, true);
      doc.addEventListener('touchstart', onFramePointerStart, { passive: true, capture: true });
      doc.addEventListener('mouseup', onFrameMouseUp, true);
      doc.addEventListener('touchend', onFrameMouseUp, { passive: true, capture: true });
      doc.addEventListener('selectionchange', onFrameSelectionChange);
      // Re-attach on navigation/refresh
      iframe.addEventListener('load', () => {
        attachedFrames.delete(iframe);
        attachToAccessibleIframe(iframe);
      }, { once: true });
      attachedFrames.add(iframe);
    } catch (_) {
      // Cross-origin or sandboxed without same-origin: cannot attach.
    }
  }

  function scanIframesIn(root) {
    // Direct iframes
    const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
    iframes.forEach((f) => attachToAccessibleIframe(f));
    // Traverse shadow roots (open only)
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    all.forEach((el) => {
      if (el.shadowRoot && !shadowObservers.has(el.shadowRoot)) {
        // Observe additions inside shadow root
        try {
          scanIframesIn(el.shadowRoot);
          const mo = new MutationObserver(() => scanIframesIn(el.shadowRoot));
          mo.observe(el.shadowRoot, { childList: true, subtree: true });
          shadowObservers.set(el.shadowRoot, mo);
        } catch (_) { /* ignore */ }
      }
    });
  }

  function startFrameBridge() {
    // Initial scan after body is ready
    const initial = () => scanIframesIn(document);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initial, { once: true });
    } else {
      initial();
    }
    // Observe top-level DOM for new iframes or hosts
    const mo = new MutationObserver(() => scanIframesIn(document));
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
    // Periodic safety scan (handles virtualized re-renders)
    setInterval(() => scanIframesIn(document), 1500);
  }

  function collectAccessibleIframes() {
    const result = [];
    const tryAdd = (f) => {
      try {
        const doc = f.contentDocument;
        const win = f.contentWindow;
        if (doc && win) {
          void doc.documentElement; // access test
          result.push(f);
        }
      } catch (_) { /* cross-origin */ }
    };
    // Top-level iframes
    document.querySelectorAll('iframe').forEach(tryAdd);
    // Open shadow roots
    const all = document.querySelectorAll('*');
    all.forEach((el) => {
      if (el.shadowRoot) {
        try { el.shadowRoot.querySelectorAll('iframe').forEach(tryAdd); } catch (_) {}
      }
    });
    return result;
  }

  function findSelectionInAnyFrame() {
    const frames = collectAccessibleIframes();
    for (const f of frames) {
      const info = getSelectionRectFrom(f.contentWindow);
      if (info) {
        const frameRect = f.getBoundingClientRect();
        const x = window.scrollX + frameRect.left + info.rect.right - 10;
        const y = window.scrollY + frameRect.top + info.rect.top - 10;
        return { text: info.text, x, y };
      }
    }
    return null;
  }

  function setupPopupInteractions(popupElement) {
    const bringToFront = () => {
      popupElement.style.zIndex = 10000 + popupIdCounter++;
    };
    popupElement.addEventListener('mousedown', bringToFront, true);
    popupElement.addEventListener('touchstart', bringToFront, { passive: true, capture: true });

    const startDrag = (e) => {
      // Drag only from dedicated handle to avoid conflicts with content selection
      if (!e.target.closest('.popup-drag-handle')) return;
      e.preventDefault();
      const { x, y } = getEventCoords(e);
      activeInteraction.isDragging = true;
      activeInteraction.element = popupElement;
      activeInteraction.dragStartX = x;
      activeInteraction.dragStartY = y;
      activeInteraction.popupStartX = popupElement.offsetLeft;
      activeInteraction.popupStartY = popupElement.offsetTop;
      popupElement.style.userSelect = 'none';
    };
    const dragHandle = popupElement.querySelector('.popup-drag-handle') || popupElement;
    dragHandle.addEventListener('mousedown', startDrag, { passive: false });
    dragHandle.addEventListener('touchstart', startDrag, { passive: false });

    const closeButton = popupElement.querySelector('.popup-close-button');
    if (closeButton) {
      closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        removeDetailedPopup(popupElement);
      });
    }

    setupResizeHandlers(popupElement);
  }

  function setupResizeHandlers(popupElement) {
    const eastResize = popupElement.querySelector('.resize-handle-e');
    const westResize = popupElement.querySelector('.resize-handle-w');
    const southResize = popupElement.querySelector('.resize-handle-s');
    const southEastResize = popupElement.querySelector('.resize-handle-se');
    if (!eastResize || !southResize || !southEastResize) return;

    const startResize = (e, type) => {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = getEventCoords(e);
      activeInteraction.isResizing = true;
      activeInteraction.resizeType = type;
      activeInteraction.element = popupElement;
      activeInteraction.startX = x;
      activeInteraction.startY = y;
      activeInteraction.startWidth = popupElement.offsetWidth;
      activeInteraction.startHeight = popupElement.offsetHeight;
      activeInteraction.popupStartX = popupElement.offsetLeft;
      activeInteraction.popupStartY = popupElement.offsetTop;
      document.body.style.cursor = `${type}-resize`;
    };

    eastResize.addEventListener('mousedown', (e) => startResize(e, 'e'));
    if (westResize) westResize.addEventListener('mousedown', (e) => startResize(e, 'w'));
    southResize.addEventListener('mousedown', (e) => startResize(e, 's'));
    southEastResize.addEventListener('mousedown', (e) => startResize(e, 'se'));
    eastResize.addEventListener('touchstart', (e) => startResize(e, 'e'), { passive: false });
    if (westResize) westResize.addEventListener('touchstart', (e) => startResize(e, 'w'), { passive: false });
    southResize.addEventListener('touchstart', (e) => startResize(e, 's'), { passive: false });
    southEastResize.addEventListener('touchstart', (e) => startResize(e, 'se'), { passive: false });
  }

  const handlePointerMove = (e) => {
    if (!activeInteraction.element) return;
    const { x, y } = getEventCoords(e);
    if (activeInteraction.isDragging || activeInteraction.isResizing) {
      // Prevent page scroll on iPhone during drag/resize
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
    }
    if (activeInteraction.isDragging) {
      const dx = x - activeInteraction.dragStartX;
      const dy = y - activeInteraction.dragStartY;
      activeInteraction.element.style.left = `${activeInteraction.popupStartX + dx}px`;
      activeInteraction.element.style.top = `${activeInteraction.popupStartY + dy}px`;
    }
    if (activeInteraction.isResizing) {
      if (activeInteraction.resizeType.includes('e')) {
        const width = activeInteraction.startWidth + (x - activeInteraction.startX);
        if (width >= 200) activeInteraction.element.style.width = `${width}px`;
      }
      if (activeInteraction.resizeType.includes('s')) {
        const height = activeInteraction.startHeight + (y - activeInteraction.startY);
        if (height >= 100) activeInteraction.element.style.height = `${height}px`;
      }
      if (activeInteraction.resizeType.includes('w')) {
        const dx = x - activeInteraction.startX;
        const newWidth = activeInteraction.startWidth - dx;
        if (newWidth >= 200) {
          activeInteraction.element.style.width = `${newWidth}px`;
          activeInteraction.element.style.left = `${activeInteraction.popupStartX + dx}px`;
        }
      }
    }
  };

  const handlePointerUp = () => {
    isPointerDown = false;
    if (!activeInteraction.element) return;
    if (activeInteraction.isDragging) {
      activeInteraction.element.style.userSelect = 'auto';
    }
    if (activeInteraction.isResizing) {
      document.body.style.cursor = 'default';
      const width = activeInteraction.element.offsetWidth;
      const height = activeInteraction.element.offsetHeight;
      savePopupSize(width, height);
    }
    activeInteraction = {
      element: null,
      isDragging: false,
      isResizing: false,
      resizeType: '',
      dragStartX: 0,
      dragStartY: 0,
      popupStartX: 0,
      popupStartY: 0,
      startWidth: 0,
      startHeight: 0,
      startX: 0,
      startY: 0,
    };
  };

  const handlePointerStart = (event) => {
    if (event.type === 'mousedown') {
      if (event.button === 0) {
        isPointerDown = true;
      }
    } else {
      isPointerDown = true;
    }
    if (event.target.closest('.openrouter-translator-detailed-popup')) return;
    if (smallIconPopup && smallIconPopup.contains(event.target)) return;
    removeSmallIconPopup();
  };

  function onSelectionEnd(event) {
    if (event.target.closest && event.target.closest('.openrouter-translator-detailed-popup')) return;
    if (smallIconPopup && smallIconPopup.contains(event.target)) return;
    setTimeout(() => {
      const currentSelectedText = window.getSelection().toString().trim();
      if (currentSelectedText.length > 0) {
        selectedTextGlobal = currentSelectedText;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        createSmallIconPopup(rect.right + window.scrollX - 10, rect.top + window.scrollY - 10);
      }
    }, 0);
  }

  let selectionChangeTimer = null;
  function onSelectionChange() {
    if (selectionChangeTimer) {
      clearTimeout(selectionChangeTimer);
      selectionChangeTimer = null;
    }
    if (isPointerDown) {
      return;
    }
    selectionChangeTimer = setTimeout(() => {
      const text = window.getSelection().toString().trim();
      if (!text) return;
      const activeEl = document.activeElement;
      if (activeEl && activeEl.closest && activeEl.closest('.openrouter-translator-detailed-popup')) return;
      selectedTextGlobal = text;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      createSmallIconPopup(rect.right + window.scrollX - 10, rect.top + window.scrollY - 10);
    }, 80);
  }

  // ---------- Menu Commands ----------
  if (typeof GM_registerMenuCommand === 'function') {
    // iPhone版ではAPIキーのメニュー設定は不要
    // GM_registerMenuCommand('Set OpenRouter API Key', setApiKeyInteractively);
    GM_registerMenuCommand('Translate Selection (→日本語)', async () => {
      let text = (window.getSelection && window.getSelection().toString().trim()) || '';
      let x, y;
      if (!text) {
        const found = findSelectionInAnyFrame();
        if (found) {
          text = found.text;
          x = found.x;
          y = found.y;
        }
      } else {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          if (rect && (rect.width > 0 || rect.height > 0)) {
            x = rect.right + window.scrollX - 10;
            y = rect.top + window.scrollY - 10;
          }
        }
      }
      if (!text) {
        alert('No text selected.');
        return;
      }
      selectedTextGlobal = text;
      if (typeof x !== 'number' || typeof y !== 'number') {
        x = window.scrollX + window.innerWidth / 2 - 200;
        y = window.scrollY + window.innerHeight / 2 - 100;
      }
      const popup = createDetailedPopup(x, y, selectedTextGlobal, true);
      const loading = popup.querySelector('#inlineLoadingIndicator');
      const out = popup.querySelector('#inlineTranslationOutput');
      try {
        const apiKey = await getApiKey();
        if (!apiKey) {
          if (out) out.textContent = 'エラー: APIキーが設定されていません。ユーザースクリプトのメニューから設定してください。';
          return;
        }
        const response = await translateTextWithOpenRouter(selectedTextGlobal, 'Japanese');
        if (!out) return;
        if (response && response.error) {
          out.textContent = `エラー: ${response.error}`;
        } else if (response && response.translatedText) {
          out.textContent = response.translatedText;
        } else {
          out.textContent = '翻訳結果がありません。';
        }
      } catch (err) {
        if (out) out.textContent = `エラー: ${err && err.message ? err.message : err}`;
      } finally {
        if (loading) loading.style.display = 'none';
      }
    });
  }

  // ---------- CSS ----------
  addStyle(`
/* content.css (embedded) */
#openrouter-translator-small-icon-popup {
  all: unset;
  display: block;
  position: absolute;
  z-index: 2147483647;
  cursor: pointer;
  background-color: rgba(240, 240, 240, 0.95);
  border: 1px solid #ccc;
  border-radius: 15px;
  padding: 3px 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}

@media (max-width: 480px) {
  #openrouter-translator-small-icon-popup {
    font-size: 22px; /* easier to tap on iPhone */
    padding: 8px 10px;
  }
}

#openrouter-translator-small-icon-popup .emoji-trigger {
}

.openrouter-translator-detailed-popup {
  all: unset;
  display: block;
  position: absolute;
  z-index: 2147483647;
  background-color: #0b0d0f;
  color: #abb2bf;
  border: 1px solid #444c56;
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  font-family: "Noto Sans JP", sans-serif !important;
  font-size: 14px;
  width: min(400px, 95vw);
  max-width: 95vw;
  min-width: 200px;
  min-height: 100px;
  max-height: 90vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.openrouter-translator-detailed-popup .popup-drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 24px; /* iPhone: larger touch target */
  cursor: move;
  background: linear-gradient(to bottom, rgba(255,255,255,0.04), rgba(255,255,255,0));
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  z-index: 4;
  touch-action: none; /* prevent page scroll while dragging */
  -webkit-user-select: none;
}

.openrouter-translator-detailed-popup .popup-close-button {
  position: absolute;
  top: 6px;
  right: 8px;
  background: none;
  border: none;
  font-size: 22px;
  color: #abb2bf;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  z-index: 10;
  font-weight: bold;
}

.openrouter-translator-detailed-popup .popup-close-button:hover {
  color: #e06c75;
}

.openrouter-translator-detailed-popup .resize-handle {
  position: absolute;
  background: transparent;
  z-index: 5;
  touch-action: none;
}

.openrouter-translator-detailed-popup .resize-handle-e {
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
  cursor: e-resize;
}

.openrouter-translator-detailed-popup .resize-handle-w {
  top: 0;
  left: 0;
  width: 10px;
  height: 100%;
  cursor: w-resize;
}

.openrouter-translator-detailed-popup .resize-handle-s {
  bottom: 0;
  left: 0;
  width: 100%;
  height: 10px;
  cursor: s-resize;
}

.openrouter-translator-detailed-popup .resize-handle-se {
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  cursor: se-resize;
  z-index: 6;
}

.openrouter-translator-detailed-popup .translator-popup-content {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow: hidden;
  min-height: 0;
  margin-top: 10px;
}

.openrouter-translator-detailed-popup .language-selector {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.openrouter-translator-detailed-popup .language-selector label {
  margin-right: 8px;
  color: #98c379;
}

.openrouter-translator-detailed-popup select {
  flex-grow: 1;
  padding: 8px;
  border: 1px solid #444c56;
  border-radius: 4px;
  background-color: #0b0d0f;
  color: #abb2bf;
}

.openrouter-translator-detailed-popup button:not(.popup-close-button) {
  background-color: #61afef;
  color: #282c34;
  border: none;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  margin-top: 10px;
}

.openrouter-translator-detailed-popup button:not(.popup-close-button):hover {
  background-color: #5299d8;
}

.openrouter-translator-detailed-popup #inlineLoadingIndicator {
  text-align: center;
  color: #e5c07b;
  margin: 10px 0;
}

.openrouter-translator-detailed-popup .translation-output {
  background-color: #0b0d0f;
  padding: 10px;
  border-radius: 4px;
  min-height: 40px;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  font-size: 0.95em;
  max-height: min(400px, 60vh);
  overflow-y: auto;
  flex-grow: 1;
  scrollbar-width: thin;
  scrollbar-color: #6e7886 #0b0d0f;
}

.openrouter-translator-detailed-popup .translation-output::-webkit-scrollbar { width: 8px; }
.openrouter-translator-detailed-popup .translation-output::-webkit-scrollbar-track { background: #0b0d0f; border-radius: 10px; margin: 2px 0; }
.openrouter-translator-detailed-popup .translation-output::-webkit-scrollbar-thumb { background-color: #6e7886; border-radius: 10px; border: 2px solid #0b0d0f; }
.openrouter-translator-detailed-popup .translation-output::-webkit-scrollbar-thumb:hover { background-color: #818c99; }
.openrouter-translator-detailed-popup .translation-output::-webkit-scrollbar-button { display: none; }
  .openrouter-translator-detailed-popup .translation-output::-webkit-scrollbar-corner { background: transparent; display: none; }
`);

  // Start scanning for same-origin iframes (e.g., Readest viewer)
  try { startFrameBridge(); } catch (_) {}

  // ---------- Global listeners ----------
  document.addEventListener('mousemove', handlePointerMove, { passive: false });
  document.addEventListener('touchmove', handlePointerMove, { passive: false });
  document.addEventListener('mouseup', handlePointerUp);
  document.addEventListener('touchend', handlePointerUp);
  document.addEventListener('touchcancel', () => { isPointerDown = false; });
  document.addEventListener('mousedown', handlePointerStart);
  document.addEventListener('touchstart', handlePointerStart);
  document.addEventListener('mouseup', onSelectionEnd);
  document.addEventListener('touchend', onSelectionEnd);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const popups = document.querySelectorAll('.openrouter-translator-detailed-popup');
      const last = popups[popups.length - 1];
      if (last) last.remove();
    }
  });

})();
