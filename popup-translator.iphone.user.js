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
  const POPUP_VIEWPORT_MARGIN = 8;
  const DETAILED_POPUP_SIDE_MARGIN = 72;
  const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const DEFAULT_MODEL = 'openai/gpt-5.6-luna';
  const MODEL_STORAGE_KEY = 'openrouterModel';
  const AVAILABLE_MODELS = [
    'openai/gpt-5.6-luna',
    'openai/gpt-5.2',
    'x-ai/grok-4.3',
    'anthropic/claude-sonnet-4',
    'google/gemini-2.5-pro-preview',
  ];
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

  function getRangeDisplayRect(range) {
    if (!range) return null;
    try {
      const rect = range.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) return rect;
    } catch (_) {}
    if (typeof range.getClientRects === 'function') {
      const rects = Array.from(range.getClientRects());
      for (const rect of rects) {
        if (rect && (rect.width > 0 || rect.height > 0)) return rect;
      }
    }
    return null;
  }

  function getViewportMetrics() {
    const docEl = document.documentElement;
    const body = document.body;
    const fallbackScrollX = window.scrollX || (docEl && docEl.scrollLeft) || (body && body.scrollLeft) || 0;
    const fallbackScrollY = window.scrollY || (docEl && docEl.scrollTop) || (body && body.scrollTop) || 0;

    try {
      if (window.parent && window.parent !== window && window.frameElement) {
        const frameRect = window.frameElement.getBoundingClientRect();
        const parentViewport = window.parent.visualViewport;
        const parentLeft = parentViewport ? parentViewport.offsetLeft : 0;
        const parentTop = parentViewport ? parentViewport.offsetTop : 0;
        const parentRight = parentLeft + (parentViewport ? parentViewport.width : window.parent.innerWidth);
        const parentBottom = parentTop + (parentViewport ? parentViewport.height : window.parent.innerHeight);
        const visibleLeft = Math.max(parentLeft, frameRect.left);
        const visibleTop = Math.max(parentTop, frameRect.top);
        const visibleRight = Math.min(parentRight, frameRect.right);
        const visibleBottom = Math.min(parentBottom, frameRect.bottom);

        if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
          return {
            width: visibleRight - visibleLeft,
            height: visibleBottom - visibleTop,
            left: fallbackScrollX + visibleLeft - frameRect.left,
            top: fallbackScrollY + visibleTop - frameRect.top,
          };
        }
      }
    } catch (_) {}

    if (window.visualViewport) {
      const vv = window.visualViewport;
      const widthCandidate = vv.width || window.innerWidth || (docEl && docEl.clientWidth) || (typeof screen !== 'undefined' ? screen.width : 0);
      const heightCandidate = vv.height || window.innerHeight || (docEl && docEl.clientHeight) || (typeof screen !== 'undefined' ? screen.height : 0);
      const pageLeft = typeof vv.pageLeft === 'number' ? vv.pageLeft : fallbackScrollX;
      const pageTop = typeof vv.pageTop === 'number' ? vv.pageTop : fallbackScrollY;
      return {
        width: widthCandidate > 0 ? widthCandidate : DEFAULT_POPUP_WIDTH,
        height: heightCandidate > 0 ? heightCandidate : DEFAULT_POPUP_HEIGHT,
        left: pageLeft + (vv.offsetLeft || 0),
        top: pageTop + (vv.offsetTop || 0),
      };
    }
    const rawWidth = window.innerWidth || (docEl && docEl.clientWidth) || (typeof screen !== 'undefined' ? screen.width : 0);
    const rawHeight = window.innerHeight || (docEl && docEl.clientHeight) || (typeof screen !== 'undefined' ? screen.height : 0);
    return {
      width: rawWidth > 0 ? rawWidth : DEFAULT_POPUP_WIDTH,
      height: rawHeight > 0 ? rawHeight : DEFAULT_POPUP_HEIGHT,
      left: fallbackScrollX,
      top: fallbackScrollY,
    };
  }

  function clientRectToPageRect(rect) {
    const viewport = getViewportMetrics();
    return {
      left: rect.left + viewport.left,
      right: rect.right + viewport.left,
      top: rect.top + viewport.top,
      bottom: rect.bottom + viewport.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function normalizeViewportMargins(marginOverride) {
    if (typeof marginOverride === 'number') {
      return {
        top: marginOverride,
        right: marginOverride,
        bottom: marginOverride,
        left: marginOverride,
      };
    }

    if (marginOverride && typeof marginOverride === 'object') {
      return {
        top: Number.isFinite(marginOverride.top) ? marginOverride.top : POPUP_VIEWPORT_MARGIN,
        right: Number.isFinite(marginOverride.right) ? marginOverride.right : POPUP_VIEWPORT_MARGIN,
        bottom: Number.isFinite(marginOverride.bottom) ? marginOverride.bottom : POPUP_VIEWPORT_MARGIN,
        left: Number.isFinite(marginOverride.left) ? marginOverride.left : POPUP_VIEWPORT_MARGIN,
      };
    }

    const viewport = getViewportMetrics();
    const defaultMargin = viewport.width <= 540 ? 6 : POPUP_VIEWPORT_MARGIN;
    return {
      top: defaultMargin,
      right: defaultMargin,
      bottom: defaultMargin,
      left: defaultMargin,
    };
  }

  function getDetailedPopupViewportMargins() {
    return {
      top: POPUP_VIEWPORT_MARGIN,
      right: DETAILED_POPUP_SIDE_MARGIN,
      bottom: POPUP_VIEWPORT_MARGIN,
      left: DETAILED_POPUP_SIDE_MARGIN,
    };
  }

  function clampElementToViewport(element, desiredLeft, desiredTop, marginOverride) {
    if (!element) return { left: desiredLeft, top: desiredTop };
    const viewport = getViewportMetrics();
    const margins = normalizeViewportMargins(marginOverride);
    const elementWidth = element.offsetWidth || element.clientWidth || DEFAULT_POPUP_WIDTH;
    const elementHeight = element.offsetHeight || element.clientHeight || DEFAULT_POPUP_HEIGHT;
    const viewportWidth = viewport.width > 0 ? viewport.width : elementWidth + margins.left + margins.right;
    const viewportHeight = viewport.height > 0 ? viewport.height : elementHeight + margins.top + margins.bottom;
    const baseLeft = viewport.left + margins.left;
    const baseTop = viewport.top + margins.top;
    const maxLeft = Math.max(baseLeft, viewport.left + viewportWidth - elementWidth - margins.right);
    const maxTop = Math.max(baseTop, viewport.top + viewportHeight - elementHeight - margins.bottom);
    const clampedLeft = Math.max(baseLeft, Math.min(desiredLeft, maxLeft));
    const clampedTop = Math.max(baseTop, Math.min(desiredTop, maxTop));
    element.style.left = `${clampedLeft}px`;
    element.style.top = `${clampedTop}px`;
    return { left: clampedLeft, top: clampedTop, margins, viewport };
  }

  function ensurePopupWithinViewport(popup, options = {}) {
    if (!popup) return;
    const viewport = getViewportMetrics();
    const margin = options.margin || getDetailedPopupViewportMargins();
    const margins = normalizeViewportMargins(margin);
    const widthLimit = Math.max(200, viewport.width - margins.left - margins.right);
    const heightLimit = Math.max(150, viewport.height - margins.top - margins.bottom);
    if (popup.offsetWidth > widthLimit) {
      popup.style.width = `${widthLimit}px`;
    }
    if (popup.offsetHeight > heightLimit) {
      popup.style.height = `${heightLimit}px`;
    }
    const desiredLeft = typeof options.desiredLeft === 'number' ? options.desiredLeft : popup.offsetLeft;
    const desiredTop = typeof options.desiredTop === 'number' ? options.desiredTop : popup.offsetTop;
    clampElementToViewport(popup, desiredLeft, desiredTop, margin);
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

  async function getModel() {
    return gmGetValue(MODEL_STORAGE_KEY, DEFAULT_MODEL);
  }

  function updateCurrentModelLabel(labelEl, model) {
    labelEl.textContent = `現在のモデル: ${model}`;
  }

  async function openModelSettingsDialog() {
    const existing = document.getElementById('openrouter-translator-settings-overlay');
    if (existing) existing.remove();

    const currentModel = await getModel();

    const overlay = document.createElement('div');
    overlay.id = 'openrouter-translator-settings-overlay';
    overlay.innerHTML = `
      <div class="openrouter-translator-settings-dialog" role="dialog" aria-labelledby="openrouter-translator-settings-title">
        <h2 id="openrouter-translator-settings-title">OpenRouter 設定</h2>
        <label for="openrouter-translator-settings-model">モデル</label>
        <select id="openrouter-translator-settings-model">
          ${AVAILABLE_MODELS.map(
            (model) =>
              `<option value="${model}"${model === currentModel ? ' selected' : ''}>${model}</option>`,
          ).join('')}
        </select>
        <p id="openrouter-translator-settings-current-model" class="current-model-label"></p>
        <div class="openrouter-translator-settings-actions">
          <button type="button" id="openrouter-translator-settings-cancel">キャンセル</button>
          <button type="button" id="openrouter-translator-settings-save">保存</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    const modelSelect = overlay.querySelector('#openrouter-translator-settings-model');
    const currentModelLabel = overlay.querySelector('#openrouter-translator-settings-current-model');
    const saveButton = overlay.querySelector('#openrouter-translator-settings-save');
    const cancelButton = overlay.querySelector('#openrouter-translator-settings-cancel');
    const dialog = overlay.querySelector('.openrouter-translator-settings-dialog');

    updateCurrentModelLabel(currentModelLabel, modelSelect.value);

    modelSelect.addEventListener('change', () => {
      updateCurrentModelLabel(currentModelLabel, modelSelect.value);
    });

    function closeDialog() {
      overlay.remove();
    }

    cancelButton.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeDialog();
    });
    dialog.addEventListener('click', (event) => event.stopPropagation());

    saveButton.addEventListener('click', async () => {
      const model = modelSelect.value;
      await gmSetValue(MODEL_STORAGE_KEY, model);
      updateCurrentModelLabel(currentModelLabel, model);
      alert('設定が保存されました。');
      closeDialog();
    });
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

    const model = await getModel();

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': location.href,
      'X-Title': 'OpenRouter Translator Userscript',
    };

    const body = {
      model,
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

    clampElementToViewport(div, x, y, 6);

    div.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!selectedTextGlobal) return;
      const iconRect = clientRectToPageRect(div.getBoundingClientRect());
      const popup = createDetailedPopup(iconRect.left, iconRect.bottom + 5, selectedTextGlobal, true);
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
        const adjust = () => {
          if (!popup || !popup.isConnected) return;
          ensurePopupWithinViewport(popup);
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(adjust);
        } else {
          setTimeout(adjust, 0);
        }
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

    popup.style.visibility = 'hidden';
    getSavedPopupSize()
      .then(({ width, height }) => {
        const safeWidth = Number(width) > 0 ? Number(width) : DEFAULT_POPUP_WIDTH;
        const safeHeight = Number(height) > 0 ? Number(height) : DEFAULT_POPUP_HEIGHT;
        popup.style.width = `${safeWidth}px`;
        popup.style.height = `${safeHeight}px`;
      })
      .catch(() => {
        popup.style.width = `${DEFAULT_POPUP_WIDTH}px`;
        popup.style.height = `${DEFAULT_POPUP_HEIGHT}px`;
      })
      .finally(() => {
        ensurePopupWithinViewport(popup, { desiredLeft: x, desiredTop: y });
        popup.style.visibility = '';
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
    const frameRect = clientRectToPageRect(frameEl.getBoundingClientRect());
    const x = frameRect.left + info.rect.right - 10;
    const y = frameRect.top + info.rect.top - 10;
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
        const frameRect = clientRectToPageRect(f.getBoundingClientRect());
        const x = frameRect.left + info.rect.right - 10;
        const y = frameRect.top + info.rect.top - 10;
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
      ensurePopupWithinViewport(activeInteraction.element, {
        desiredLeft: activeInteraction.popupStartX + dx,
        desiredTop: activeInteraction.popupStartY + dy,
      });
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
          ensurePopupWithinViewport(activeInteraction.element, {
            desiredLeft: activeInteraction.popupStartX + dx,
            desiredTop: activeInteraction.popupStartY,
          });
        }
      }
      ensurePopupWithinViewport(activeInteraction.element);
    }
  };

  const handlePointerUp = () => {
    isPointerDown = false;
    const element = activeInteraction.element;
    if (!element) return;
    if (activeInteraction.isDragging) {
      element.style.userSelect = 'auto';
    }
    if (activeInteraction.isResizing) {
      document.body.style.cursor = 'default';
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      savePopupSize(width, height);
    }
    ensurePopupWithinViewport(element);
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
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const currentSelectedText = selection.toString().trim();
      if (!currentSelectedText) return;
      selectedTextGlobal = currentSelectedText;
      const rect = getRangeDisplayRect(selection.getRangeAt(0));
      if (!rect) return;
      const rectPage = clientRectToPageRect(rect);
      createSmallIconPopup(rectPage.right - 10, rectPage.top - 10);
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
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const text = selection.toString().trim();
      if (!text) return;
      const activeEl = document.activeElement;
      if (activeEl && activeEl.closest && activeEl.closest('.openrouter-translator-detailed-popup')) return;
      selectedTextGlobal = text;
      const rect = getRangeDisplayRect(selection.getRangeAt(0));
      if (!rect) return;
      const rectPage = clientRectToPageRect(rect);
      createSmallIconPopup(rectPage.right - 10, rectPage.top - 10);
    }, 80);
  }

  // ---------- Menu Commands ----------
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Settings (Model)', openModelSettingsDialog);
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
          const rect = getRangeDisplayRect(selection.getRangeAt(0));
          if (rect) {
            const rectPage = clientRectToPageRect(rect);
            x = rectPage.right - 10;
            y = rectPage.top - 10;
          }
        }
      }
      if (!text) {
        alert('No text selected.');
        return;
      }
      selectedTextGlobal = text;
      if (typeof x !== 'number' || typeof y !== 'number') {
        const viewport = getViewportMetrics();
        x = viewport.left + viewport.width / 2 - 200;
        y = viewport.top + viewport.height / 2 - 100;
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
        const adjust = () => {
          if (!popup || !popup.isConnected) return;
          ensurePopupWithinViewport(popup);
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(adjust);
        } else {
          setTimeout(adjust, 0);
        }
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

#openrouter-translator-settings-overlay {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background-color: rgba(0, 0, 0, 0.45);
  font-family: "Noto Sans JP", sans-serif !important;
}

.openrouter-translator-settings-dialog {
  all: unset;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(420px, calc(100vw - 32px));
  padding: 20px;
  border-radius: 8px;
  background-color: #fff;
  color: #333;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
}

.openrouter-translator-settings-dialog h2 {
  all: unset;
  display: block;
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: bold;
}

.openrouter-translator-settings-dialog label {
  all: unset;
  display: block;
  font-size: 14px;
  font-weight: bold;
}

.openrouter-translator-settings-dialog select {
  all: unset;
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  background-color: #fff;
  color: #333;
}

.openrouter-translator-settings-dialog .current-model-label {
  all: unset;
  display: block;
  margin: 0;
  font-size: 13px;
  color: #555;
}

.openrouter-translator-settings-actions {
  all: unset;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.openrouter-translator-settings-actions button {
  all: unset;
  padding: 8px 14px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  text-align: center;
}

#openrouter-translator-settings-cancel {
  background-color: #eee;
  color: #333;
}

#openrouter-translator-settings-save {
  background-color: #5cb85c;
  color: #fff;
}
`);

  // Start scanning for same-origin iframes (e.g., Readest viewer)
  try { startFrameBridge(); } catch (_) {}


  let viewportAdjustTimer = null;
  const scheduleViewportAdjust = () => {
    if (viewportAdjustTimer !== null) return;
    const runAdjust = () => {
      viewportAdjustTimer = null;
      if (smallIconPopup && smallIconPopup.isConnected) {
        clampElementToViewport(smallIconPopup, smallIconPopup.offsetLeft, smallIconPopup.offsetTop, 6);
      }
      const popups = document.querySelectorAll('.openrouter-translator-detailed-popup');
      popups.forEach((popup) => ensurePopupWithinViewport(popup));
    };
    if (typeof requestAnimationFrame === 'function') {
      viewportAdjustTimer = requestAnimationFrame(runAdjust);
    } else {
      viewportAdjustTimer = setTimeout(runAdjust, 16);
    }
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportAdjust);
    window.visualViewport.addEventListener('scroll', scheduleViewportAdjust);
  } else {
    window.addEventListener('resize', scheduleViewportAdjust);
  }
  window.addEventListener('resize', scheduleViewportAdjust);
  window.addEventListener('scroll', scheduleViewportAdjust, true);

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
      const settingsOverlay = document.getElementById('openrouter-translator-settings-overlay');
      if (settingsOverlay) {
        settingsOverlay.remove();
        return;
      }
      const popups = document.querySelectorAll('.openrouter-translator-detailed-popup');
      const last = popups[popups.length - 1];
      if (last) last.remove();
    }
  });

})();
