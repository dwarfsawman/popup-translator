// content.js

let smallIconPopup = null;
let selectedTextGlobal = '';
let popupIdCounter = 0;
let isPointerDown = false;
let lastPointerPosition = { x: null, y: null };
let selectionUpdateTimer = null;
let lastSelectionSignature = '';
const SELECTION_STABLE_DELAY_MS = 220;
const SELECTION_END_DELAY_MS = 120;
// Track the active interaction (drag/resize) and the element being interacted with.
let activeInteraction = {
  element: null,
  pointerId: null,
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
// Helper function to normalize coordinates for mouse and touch events
function getEventCoords(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    // For touchend
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

// デフォルトのポップアップサイズ
const DEFAULT_POPUP_WIDTH = 400;
const DEFAULT_POPUP_HEIGHT = 300;
const KEYBOARD_POPUP_OFFSET = 12;
const POPUP_VIEWPORT_MARGIN = 8;
const DETAILED_POPUP_SIDE_MARGIN = 8;

// 文字サイズ倍率。スマホと広い画面（DeX など）で別々に記憶する
const POPUP_SCALE_STORAGE_KEY = 'popupScaleByMode';
const POPUP_SCALE_STEP = 0.1;
const POPUP_SCALE_MIN = 0.6;
const POPUP_SCALE_MAX = 2.5;
// 画面の短い辺で判定するので、縦向き・横向きのどちらでも同じモードになる
const WIDE_SCREEN_MIN_SHORT_SIDE = 900;
const DEFAULT_WIDE_SCREEN_SCALE = 1.4;
let savedPopupScales = {};

function getScreenMode() {
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return shortSide >= WIDE_SCREEN_MIN_SHORT_SIDE ? 'wide' : 'narrow';
}

function getDefaultPopupScale(mode) {
  // Windows / Mac のブラウザは既定を等倍のままにし、DeX などの Android 側だけ大きくする
  const isDesktopOs = /Windows|Macintosh/.test(navigator.userAgent);
  return mode === 'wide' && !isDesktopOs ? DEFAULT_WIDE_SCREEN_SCALE : 1;
}

function normalizePopupScale(scale) {
  const rounded = Math.round(scale * 10) / 10;
  return Math.min(POPUP_SCALE_MAX, Math.max(POPUP_SCALE_MIN, rounded));
}

function getPopupScale() {
  const mode = getScreenMode();
  const saved = Number(savedPopupScales[mode]);
  return Number.isFinite(saved) && saved > 0 ? normalizePopupScale(saved) : getDefaultPopupScale(mode);
}

function updateSavedPopupScales(value) {
  savedPopupScales = value && typeof value === 'object' ? value : {};
}

function applyPopupScale(element, scale) {
  element.style.setProperty('--ort-scale', String(scale));
  element.dataset.ortScale = String(scale);
}

function updateZoomButtonTitles(popupElement, scale) {
  const modeLabel = getScreenMode() === 'wide' ? '広い画面' : 'スマホ';
  const description = `${modeLabel} ${Math.round(scale * 100)}%・画面 ${window.screen.width}×${window.screen.height}`;
  const zoomOutButton = popupElement.querySelector('.popup-zoom-out');
  const zoomInButton = popupElement.querySelector('.popup-zoom-in');
  if (zoomOutButton) zoomOutButton.title = `文字を小さく（${description}）`;
  if (zoomInButton) zoomInButton.title = `文字を大きく（${description}）`;
}

// 開いているアイコンとポップアップに今の倍率を反映する（他のフレームで変えた場合も storage.onChanged から呼ばれる）
function applyPopupScaleToOpenPopups() {
  const scale = getPopupScale();

  if (smallIconPopup && smallIconPopup.isConnected) {
    applyPopupScale(smallIconPopup, scale);
    clampElementToViewport(smallIconPopup, smallIconPopup.offsetLeft, smallIconPopup.offsetTop, 6);
  }

  document.querySelectorAll('.openrouter-translator-detailed-popup').forEach((popupElement) => {
    const previousScale = parseFloat(popupElement.dataset.ortScale);
    // まだ保存サイズの読み込み前のポップアップは、読み込み後に倍率が入る
    if (!Number.isFinite(previousScale) || previousScale === scale) return;

    // 文字と一緒にポップアップの大きさも同じ比率で拡大縮小する
    const width = popupElement.offsetWidth / previousScale * scale;
    const height = popupElement.offsetHeight / previousScale * scale;
    applyPopupScale(popupElement, scale);
    popupElement.style.width = `${width}px`;
    popupElement.style.height = `${height}px`;
    updateZoomButtonTitles(popupElement, scale);
    ensureDetailedPopupWithinViewport(popupElement);
  });
}

function changePopupScale(delta) {
  const mode = getScreenMode();
  const scale = normalizePopupScale(getPopupScale() + delta);
  savedPopupScales = { ...savedPopupScales, [mode]: scale };
  chrome.storage.local.set({ [POPUP_SCALE_STORAGE_KEY]: savedPopupScales });
  applyPopupScaleToOpenPopups();
}

chrome.storage.local.get([POPUP_SCALE_STORAGE_KEY], (result) => {
  updateSavedPopupScales(result[POPUP_SCALE_STORAGE_KEY]);
  applyPopupScaleToOpenPopups();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[POPUP_SCALE_STORAGE_KEY]) return;
  updateSavedPopupScales(changes[POPUP_SCALE_STORAGE_KEY].newValue);
  applyPopupScaleToOpenPopups();
});

// Return the visible rectangle in this window's client coordinates. Readers often
// put a very wide iframe inside an overflow:hidden scroller (also in shadow DOM).
function getVisibleWindowRect(targetWindow) {
  const viewport = targetWindow.visualViewport;
  const visible = {
    left: viewport ? viewport.offsetLeft : 0,
    top: viewport ? viewport.offsetTop : 0,
    right: (viewport ? viewport.offsetLeft + viewport.width : targetWindow.innerWidth),
    bottom: (viewport ? viewport.offsetTop + viewport.height : targetWindow.innerHeight),
  };

  try {
    const frame = targetWindow.frameElement;
    if (!frame || targetWindow.parent === targetWindow) return visible;
    const parentWindow = targetWindow.parent;
    const clipped = getVisibleWindowRect(parentWindow);
    const frameRect = frame.getBoundingClientRect();
    const scaleX = frame.offsetWidth ? frameRect.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight ? frameRect.height / frame.offsetHeight : 1;
    if (scaleX <= 0 || scaleY <= 0) return visible;
    const originX = frameRect.left + frame.clientLeft * scaleX;
    const originY = frameRect.top + frame.clientTop * scaleY;

    // Follow composed ancestors so clipping inside a reader's shadow root counts.
    let ancestor = frame.parentElement || frame.getRootNode().host;
    while (ancestor) {
      const style = parentWindow.getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      const sx = ancestor.offsetWidth ? rect.width / ancestor.offsetWidth : 1;
      const sy = ancestor.offsetHeight ? rect.height / ancestor.offsetHeight : 1;
      const clipsX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
      const clipsY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
      if (clipsX) {
        clipped.left = Math.max(clipped.left, rect.left + ancestor.clientLeft * sx);
        clipped.right = Math.min(clipped.right, rect.left + (ancestor.clientLeft + ancestor.clientWidth) * sx);
      }
      if (clipsY) {
        clipped.top = Math.max(clipped.top, rect.top + ancestor.clientTop * sy);
        clipped.bottom = Math.min(clipped.bottom, rect.top + (ancestor.clientTop + ancestor.clientHeight) * sy);
      }
      ancestor = ancestor.parentElement || ancestor.getRootNode().host;
    }

    visible.left = Math.max(visible.left, (clipped.left - originX) / scaleX);
    visible.top = Math.max(visible.top, (clipped.top - originY) / scaleY);
    visible.right = Math.min(visible.right, (clipped.right - originX) / scaleX);
    visible.bottom = Math.min(visible.bottom, (clipped.bottom - originY) / scaleY);
  } catch (error) {
    // Cross-origin parents are inaccessible; retain the local viewport bounds.
  }
  return visible;
}

function getViewportBounds() {
  const docEl = document.documentElement;
  const body = document.body;
  const fallbackScrollX = window.scrollX || (docEl && docEl.scrollLeft) || (body && body.scrollLeft) || 0;
  const fallbackScrollY = window.scrollY || (docEl && docEl.scrollTop) || (body && body.scrollTop) || 0;
  const visualViewport = window.visualViewport;

  const visible = getVisibleWindowRect(window);
  if (visible.right > visible.left && visible.bottom > visible.top) {
    return {
      left: fallbackScrollX + visible.left,
      top: fallbackScrollY + visible.top,
      width: visible.right - visible.left,
      height: visible.bottom - visible.top,
    };
  }

  if (visualViewport) {
    return {
      left: typeof visualViewport.pageLeft === 'number'
        ? visualViewport.pageLeft
        : fallbackScrollX + (visualViewport.offsetLeft || 0),
      top: typeof visualViewport.pageTop === 'number'
        ? visualViewport.pageTop
        : fallbackScrollY + (visualViewport.offsetTop || 0),
      width: visualViewport.width || window.innerWidth || (docEl && docEl.clientWidth) || DEFAULT_POPUP_WIDTH,
      height: visualViewport.height || window.innerHeight || (docEl && docEl.clientHeight) || DEFAULT_POPUP_HEIGHT,
    };
  }

  const widthCandidates = [
    window.innerWidth,
    docEl && docEl.clientWidth,
    body && body.clientWidth,
  ].filter((value) => Number.isFinite(value) && value > 0);
  const heightCandidates = [
    window.innerHeight,
    docEl && docEl.clientHeight,
    body && body.clientHeight,
  ].filter((value) => Number.isFinite(value) && value > 0);

  return {
    left: fallbackScrollX,
    top: fallbackScrollY,
    width: widthCandidates.length ? Math.min(...widthCandidates) : DEFAULT_POPUP_WIDTH,
    height: heightCandidates.length ? Math.min(...heightCandidates) : DEFAULT_POPUP_HEIGHT,
  };
}

function normalizeViewportMargins(margin = POPUP_VIEWPORT_MARGIN) {
  if (typeof margin === 'number') {
    return {
      top: margin,
      right: margin,
      bottom: margin,
      left: margin,
    };
  }

  return {
    top: Number.isFinite(margin.top) ? margin.top : POPUP_VIEWPORT_MARGIN,
    right: Number.isFinite(margin.right) ? margin.right : POPUP_VIEWPORT_MARGIN,
    bottom: Number.isFinite(margin.bottom) ? margin.bottom : POPUP_VIEWPORT_MARGIN,
    left: Number.isFinite(margin.left) ? margin.left : POPUP_VIEWPORT_MARGIN,
  };
}

function getDetailedPopupViewportMargins() {
  const viewport = getViewportBounds();
  const sideMargin = Math.min(DETAILED_POPUP_SIDE_MARGIN, Math.max(0, (viewport.width - 200) / 2), viewport.width / 10);
  return {
    top: Math.min(POPUP_VIEWPORT_MARGIN, viewport.height / 10),
    right: sideMargin,
    bottom: Math.min(POPUP_VIEWPORT_MARGIN, viewport.height / 10),
    left: sideMargin,
  };
}

function clampElementToViewport(element, desiredLeft, desiredTop, margin = POPUP_VIEWPORT_MARGIN, options = {}) {
  if (!element) return;

  const viewport = getViewportBounds();
  const margins = normalizeViewportMargins(margin);
  const rect = element.getBoundingClientRect();
  const elementWidth = element.offsetWidth || rect.width || 0;
  const elementHeight = element.offsetHeight || rect.height || 0;
  const minLeft = viewport.left + margins.left;
  const minTop = viewport.top + margins.top;
  const maxLeft = Math.max(minLeft, viewport.left + viewport.width - elementWidth - margins.right);
  const maxTop = Math.max(minTop, viewport.top + viewport.height - elementHeight - margins.bottom);
  const left = Number.isFinite(desiredLeft) ? desiredLeft : element.offsetLeft;
  const top = Number.isFinite(desiredTop) ? desiredTop : element.offsetTop;
  const clampX = options.clampX !== false;
  const clampY = options.clampY !== false;

  element.style.left = `${clampX ? Math.max(minLeft, Math.min(left, maxLeft)) : left}px`;
  element.style.top = `${clampY ? Math.max(minTop, Math.min(top, maxTop)) : top}px`;
}

function fitDetailedPopupToViewport(popupElement, margin = POPUP_VIEWPORT_MARGIN) {
  if (!popupElement) return;

  const viewport = getViewportBounds();
  const margins = normalizeViewportMargins(margin);
  const widthLimit = Math.max(1, Math.floor(viewport.width - margins.left - margins.right));
  const heightLimit = Math.max(1, Math.floor(viewport.height - margins.top - margins.bottom));
  popupElement.style.minWidth = `${Math.min(200, widthLimit)}px`;
  popupElement.style.minHeight = `${Math.min(100, heightLimit)}px`;
  popupElement.style.maxWidth = `${widthLimit}px`;
  popupElement.style.maxHeight = `${heightLimit}px`;

  if (popupElement.offsetWidth > widthLimit) {
    popupElement.style.width = `${widthLimit}px`;
  }
  if (popupElement.offsetHeight > heightLimit) {
    popupElement.style.height = `${heightLimit}px`;
  }
}

function ensureDetailedPopupWithinViewport(popupElement, options = {}) {
  if (!popupElement || !popupElement.isConnected) return;

  const margin = options.margin || getDetailedPopupViewportMargins();
  fitDetailedPopupToViewport(popupElement, margin);
  const desiredLeft = Number.isFinite(options.desiredLeft) ? options.desiredLeft : popupElement.offsetLeft;
  const desiredTop = Number.isFinite(options.desiredTop) ? options.desiredTop : popupElement.offsetTop;
  clampElementToViewport(popupElement, desiredLeft, desiredTop, margin, {
    clampX: options.clampX !== false,
    clampY: options.clampY !== false,
  });
}

let viewportClampFrame = null;
function scheduleTranslatorViewportClamp() {
  if (viewportClampFrame !== null) return;

  viewportClampFrame = requestAnimationFrame(() => {
    viewportClampFrame = null;

    if (smallIconPopup && smallIconPopup.isConnected) {
      clampElementToViewport(smallIconPopup, smallIconPopup.offsetLeft, smallIconPopup.offsetTop, 6);
    }

    document.querySelectorAll('.openrouter-translator-detailed-popup').forEach((popupElement) => {
      ensureDetailedPopupWithinViewport(popupElement);
    });
  });
}

function removeDetailedPopup(popupElement) {
  if (popupElement) {
    popupElement.remove();
  }
}

// 小さなアイコンポップアップを削除する関数
function removeSmallIconPopup() {
  if (smallIconPopup) {
    smallIconPopup.remove();
    smallIconPopup = null;
  }
}

// すべてのポップアップを削除する関数
function removePopups() {
  removeSmallIconPopup();
  // Detailed popups are now removed individually
  // removeDetailedPopup();
}

// Some readers claim pull-down gestures on document during capture, before any
// popup listener runs. Intercept touch events one level earlier, on window.
// Stopping propagation preserves native scrolling/clicks; preventDefault would
// also disable scrolling inside the translated text.
function isolatePopupTouch(event) {
  const popup = event.composedPath().find((node) =>
    node instanceof Element && node.classList.contains('openrouter-translator-detailed-popup'));
  if (!popup) return;
  event.stopImmediatePropagation();
}

['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((type) => {
  window.addEventListener(type, isolatePopupTouch, { capture: true, passive: true });
});

function getRangeDisplayRect(range) {
  if (!range) return null;

  try {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) {
      return rect;
    }
  } catch (error) {
    // Ignore invalid ranges while the browser is updating the selection.
  }

  if (typeof range.getClientRects === 'function') {
    const rects = Array.from(range.getClientRects());
    for (const rect of rects) {
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return rect;
      }
    }
  }

  return null;
}

function getSelectionSignature(selection) {
  if (!selection || selection.rangeCount === 0) {
    return '';
  }

  try {
    const range = selection.getRangeAt(0);
    return [
      range.startContainer,
      range.startOffset,
      range.endContainer,
      range.endOffset,
    ].join(':');
  } catch (error) {
    return selection.toString();
  }
}

function getSmallIconPopupPosition(rect) {
  return {
    x: rect.right + window.scrollX - 10,
    y: rect.top + window.scrollY - 10,
  };
}

function clearSelectionUpdateTimer() {
  if (selectionUpdateTimer) {
    clearTimeout(selectionUpdateTimer);
    selectionUpdateTimer = null;
  }
}

function showSmallIconPopupIfReady() {
  if (isPointerDown) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    removeSmallIconPopup();
    return;
  }

  const text = selection.toString().trim();
  if (!text) {
    selectedTextGlobal = '';
    removeSmallIconPopup();
    return;
  }

  const activeEl = document.activeElement;
  if (activeEl && activeEl.closest && activeEl.closest('.openrouter-translator-detailed-popup')) {
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = getRangeDisplayRect(range);
  if (!rect) {
    return;
  }

  selectedTextGlobal = text;
  const { x, y } = getSmallIconPopupPosition(rect);
  createSmallIconPopup(x, y);
}

function scheduleSmallIconPopupUpdate(delay = SELECTION_STABLE_DELAY_MS) {
  clearSelectionUpdateTimer();
  removeSmallIconPopup();

  selectionUpdateTimer = setTimeout(() => {
    selectionUpdateTimer = null;
    showSmallIconPopupIfReady();
  }, delay);
}

// 小さな翻訳アイコンを作成・表示する関数
function createSmallIconPopup(x, y) {
  // 既存の小アイコンがあれば置き換える（重複表示を避ける）
  removeSmallIconPopup();

  smallIconPopup = document.createElement('button');
  smallIconPopup.type = 'button';
  smallIconPopup.id = 'openrouter-translator-small-icon-popup';
  smallIconPopup.setAttribute('aria-label', '翻訳する');
  smallIconPopup.title = '翻訳する';
  const emojiIcon = '🌐'; // 地球儀マーク
  smallIconPopup.innerHTML = `<span class="emoji-trigger" aria-hidden="true">${emojiIcon}</span>`;

  document.body.appendChild(smallIconPopup);
  applyPopupScale(smallIconPopup, getPopupScale());
  smallIconPopup.style.left = `${x}px`;
  smallIconPopup.style.top = `${y}px`;
  smallIconPopup.classList.remove('icon-interactive');

  // Keep the trigger inside the actually visible viewport, including pages that use visualViewport.
  clampElementToViewport(smallIconPopup, x, y, 6);

  requestAnimationFrame(() => {
    if (smallIconPopup && smallIconPopup.isConnected) {
      smallIconPopup.classList.add('icon-interactive');
    }
  });

  smallIconPopup.addEventListener('click', (event) => {
    event.stopPropagation();
    if (selectedTextGlobal) {
      const iconRect = smallIconPopup.getBoundingClientRect();
      // 詳細ポップアップを先に生成してローディング表示
      // Create the popup first and get a reference to it
      const newDetailedPopup = createDetailedPopup(iconRect.left + window.scrollX, iconRect.bottom + window.scrollY + 5, selectedTextGlobal, true);
      if (smallIconPopup) {
        smallIconPopup.style.display = 'none';
      }

      requestTranslationForPopup(newDetailedPopup, selectedTextGlobal);
    }
  });
}

// 保存されたポップアップサイズを取得する関数（サイズは倍率 100% 換算で保存している）
function getSavedPopupSize(callback) {
  chrome.storage.local.get(['popupWidth', 'popupHeight', POPUP_SCALE_STORAGE_KEY], (result) => {
    updateSavedPopupScales(result[POPUP_SCALE_STORAGE_KEY]);
    const width = result.popupWidth || DEFAULT_POPUP_WIDTH;
    const height = result.popupHeight || DEFAULT_POPUP_HEIGHT;
    callback(width, height);
  });
}

// ポップアップサイズを保存する関数
function savePopupSize(width, height, scale = 1) {
  chrome.storage.local.set({
    popupWidth: Math.round(width / scale),
    popupHeight: Math.round(height / scale)
  });
}

// A new popup is created for each translation.
function createDetailedPopup(x, y, originalText, isLoading = false) {
  // removeDetailedPopup(); // No longer remove existing popups

  const popupElement = document.createElement('div');
  // Use a class for styling and data-id for identification
  popupElement.className = 'openrouter-translator-detailed-popup';
  popupElement.dataset.popupId = `popup-translator-${popupIdCounter++}`;

  popupElement.innerHTML = `
    <div class="popup-toolbar">
      <div class="popup-drag-handle" title="ドラッグして移動" aria-label="ドラッグして移動"></div>
      <button type="button" class="popup-toolbar-button popup-zoom-button popup-zoom-out" aria-label="文字を小さく">&minus;</button>
      <button type="button" class="popup-toolbar-button popup-zoom-button popup-zoom-in" aria-label="文字を大きく">+</button>
      <button type="button" class="popup-toolbar-button popup-close-button" title="閉じる" aria-label="閉じる">&times;</button>
    </div>
    <div class="translator-popup-content">
      <div id="inlineLoadingIndicator" style="display: ${isLoading ? 'block' : 'none'};">...</div>
      <div id="inlineTranslationOutput" class="translation-output"></div>
    </div>
    <div class="resize-handle resize-handle-e"></div>
    <div class="resize-handle resize-handle-s"></div>
    <div class="resize-handle resize-handle-se" title="ドラッグしてサイズ変更" aria-label="ドラッグしてサイズ変更"></div>
  `;

  document.body.appendChild(popupElement);
  popupElement.style.left = `${x}px`;
  popupElement.style.top = `${y}px`;
  popupElement.style.visibility = 'hidden';
  // Set z-index to bring new popups to the front
  popupElement.style.zIndex = 10000 + popupIdCounter;

  // Apply saved size
  getSavedPopupSize((width, height) => {
    if (!popupElement.isConnected) return;

    const scale = getPopupScale();
    applyPopupScale(popupElement, scale);
    updateZoomButtonTitles(popupElement, scale);
    popupElement.style.width = `${width * scale}px`;
    popupElement.style.height = `${height * scale}px`;

    ensureDetailedPopupWithinViewport(popupElement, { desiredLeft: x, desiredTop: y });
    popupElement.style.visibility = '';
  });

  // Setup all interaction event listeners for this specific popup
  setupPopupInteractions(popupElement);

  return popupElement; // Return the new element so it can be updated with content
}

function requestTranslationForPopup(popupElement, text) {
  if (!popupElement) return;

  chrome.runtime.sendMessage(
    { action: "translate", text, targetLanguage: "Japanese" },
    (response) => {
      if (!popupElement || !popupElement.isConnected) return;
      const loadingIndicator = popupElement.querySelector('#inlineLoadingIndicator');
      const outputArea = popupElement.querySelector('#inlineTranslationOutput');

      if (loadingIndicator) loadingIndicator.style.display = 'none';
      if (!outputArea) return;

      if (chrome.runtime.lastError) {
        outputArea.textContent = 'エラー: ' + chrome.runtime.lastError.message;
        ensureDetailedPopupWithinViewport(popupElement);
        return;
      }

      if (response) {
        if (response.error) {
          outputArea.textContent = 'エラー: ' + response.error;
        } else if (response.translatedText) {
          outputArea.textContent = response.translatedText;
        } else {
          outputArea.textContent = '翻訳結果がありません。';
        }
      } else {
        outputArea.textContent = '応答がありません。';
      }

      ensureDetailedPopupWithinViewport(popupElement);
    }
  );
}

// Sets up dragging, closing, and resizing for a specific popup element.
function setupPopupInteractions(popupElement) {
  const dragHandle = popupElement;

  // Bring popup to front when clicked or tapped
  const bringToFront = () => {
    popupElement.style.zIndex = 10000 + popupIdCounter++;
  };
  popupElement.addEventListener('pointerdown', bringToFront, true);

  const startDrag = (e) => {
    if (!e.isPrimary || e.button !== 0 || activeInteraction.element) return;
    if (e.target.closest('button, .translation-output, .resize-handle, .popup-close-button')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getEventCoords(e);
    activeInteraction.isDragging = true;
    activeInteraction.element = popupElement;
    activeInteraction.pointerId = e.pointerId;
    popupElement.setPointerCapture(e.pointerId);
    activeInteraction.dragStartX = x;
    activeInteraction.dragStartY = y;
    activeInteraction.popupStartX = popupElement.offsetLeft;
    activeInteraction.popupStartY = popupElement.offsetTop;

    popupElement.style.userSelect = 'none';
  };
  dragHandle.addEventListener('pointerdown', startDrag);
  popupElement.addEventListener('lostpointercapture', handlePointerUp);
  // Reader apps also handle these events to turn pages. Keep popup gestures local,
  // while allowing the browser's native text scrolling and button clicks.
  popupElement.addEventListener('pointerdown', (event) => event.stopPropagation());
  popupElement.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
  popupElement.addEventListener('touchend', (event) => event.stopPropagation(), { passive: true });
  popupElement.addEventListener('click', (event) => event.stopPropagation());

  const closeButton = popupElement.querySelector('.popup-close-button');
  if (closeButton) {
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      removeDetailedPopup(popupElement);
    });
  }

  popupElement.querySelectorAll('.popup-zoom-button').forEach((zoomButton) => {
    zoomButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const direction = zoomButton.classList.contains('popup-zoom-in') ? 1 : -1;
      changePopupScale(direction * POPUP_SCALE_STEP);
    });
  });

  setupResizeHandlers(popupElement);

  const handleWheel = (event) => {
    const scrollableArea = event.target.closest('.translation-output');
    if (scrollableArea) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleTouchMove = (event) => {
    const scrollableArea = event.target.closest('.translation-output');
    if (!scrollableArea) {
      event.preventDefault();
    }
    event.stopPropagation();
  };

  popupElement.addEventListener('wheel', handleWheel, { passive: false });
  popupElement.addEventListener('touchmove', handleTouchMove, { passive: false });
}


// Sets up resize handlers for a specific popup element.
function setupResizeHandlers(popupElement) {
  const eastResize = popupElement.querySelector('.resize-handle-e');
  const southResize = popupElement.querySelector('.resize-handle-s');
  const southEastResize = popupElement.querySelector('.resize-handle-se');

  if (!eastResize || !southResize || !southEastResize) return;

  const startResize = (e, type) => {
    if (!e.isPrimary || e.button !== 0 || activeInteraction.element) return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getEventCoords(e);

    activeInteraction.isResizing = true;
    activeInteraction.resizeType = type;
    activeInteraction.element = popupElement;
    activeInteraction.pointerId = e.pointerId;
    popupElement.setPointerCapture(e.pointerId);
    activeInteraction.startX = x;
    activeInteraction.startY = y;
    activeInteraction.startWidth = popupElement.offsetWidth;
    activeInteraction.startHeight = popupElement.offsetHeight;
    document.body.style.cursor = `${type}-resize`;
  };

  eastResize.addEventListener('pointerdown', (e) => startResize(e, 'e'));
  southResize.addEventListener('pointerdown', (e) => startResize(e, 's'));
  southEastResize.addEventListener('pointerdown', (e) => startResize(e, 'se'));
}

// Global move handler for dragging and resizing (mouse & touch).
const handlePointerMove = (e) => {
  const { x, y } = getEventCoords(e);
  lastPointerPosition = {
    x: x + window.scrollX,
    y: y + window.scrollY,
  };

  if (!activeInteraction.element || e.pointerId !== activeInteraction.pointerId) return;
  e.preventDefault();
  e.stopPropagation();

  if (activeInteraction.isDragging) {
    const dx = x - activeInteraction.dragStartX;
    const dy = y - activeInteraction.dragStartY;
    ensureDetailedPopupWithinViewport(activeInteraction.element, {
      desiredLeft: activeInteraction.popupStartX + dx,
      desiredTop: activeInteraction.popupStartY + dy,
    });
  }

  if (activeInteraction.isResizing) {
    if (activeInteraction.resizeType.includes('e')) {
      const width = activeInteraction.startWidth + (x - activeInteraction.startX);
      activeInteraction.element.style.width = `${Math.max(200, width)}px`;
    }
    if (activeInteraction.resizeType.includes('s')) {
      const height = activeInteraction.startHeight + (y - activeInteraction.startY);
      activeInteraction.element.style.height = `${Math.max(100, height)}px`;
    }
    ensureDetailedPopupWithinViewport(activeInteraction.element);
  }
};
// Capture before page/reader handlers, even when the finger leaves the popup.
document.addEventListener('pointermove', handlePointerMove, { passive: false, capture: true });

// Global pointer up handler to end interactions.
const handlePointerUp = (event) => {
  if (activeInteraction.element && event.pointerId !== activeInteraction.pointerId) return;
  isPointerDown = false;
  if (!activeInteraction.element) return;
  event.stopPropagation();

  if (activeInteraction.isDragging) {
    activeInteraction.element.style.userSelect = 'auto';
  }

  if (activeInteraction.isResizing) {
    document.body.style.cursor = 'default';
    ensureDetailedPopupWithinViewport(activeInteraction.element);
    const width = activeInteraction.element.offsetWidth;
    const height = activeInteraction.element.offsetHeight;
    const scale = parseFloat(activeInteraction.element.dataset.ortScale) || 1;
    savePopupSize(width, height, scale); // Saves size for future popups
  }

  const finishedElement = activeInteraction.element;
  const finishedPointerId = activeInteraction.pointerId;
  // Reset before releasing capture, which can dispatch lostpointercapture.
  activeInteraction = {
    element: null,
    pointerId: null,
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
  if (finishedElement.hasPointerCapture(finishedPointerId)) {
    finishedElement.releasePointerCapture(finishedPointerId);
  }
};
document.addEventListener('pointerup', handlePointerUp, true);
document.addEventListener('pointercancel', handlePointerUp, true);
document.addEventListener('touchcancel', () => {
  isPointerDown = false;
});
window.addEventListener('resize', scheduleTranslatorViewportClamp);
window.addEventListener('scroll', scheduleTranslatorViewportClamp, true);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleTranslatorViewportClamp);
  window.visualViewport.addEventListener('scroll', scheduleTranslatorViewportClamp);
}
// A paginated reader may move the iframe without scrolling its own document.
try {
  let ancestorWindow = window.parent;
  while (ancestorWindow && ancestorWindow !== window) {
    ancestorWindow.addEventListener('resize', scheduleTranslatorViewportClamp);
    ancestorWindow.addEventListener('scroll', scheduleTranslatorViewportClamp, true);
    if (ancestorWindow === ancestorWindow.parent) break;
    ancestorWindow = ancestorWindow.parent;
  }
} catch (error) {
  // Cross-origin ancestors cannot be observed.
}

// Pointer start listener to handle popup dismissal
const handlePointerStart = (event) => {
  const { x, y } = getEventCoords(event);
  if (typeof x === 'number' && typeof y === 'number') {
    lastPointerPosition = {
      x: x + window.scrollX,
      y: y + window.scrollY,
    };
  }

  if (event.type === 'mousedown') {
    if (event.button === 0) {
      isPointerDown = true;
    }
  } else {
    isPointerDown = true;
  }

  // If the tap/click is on or inside the detailedPopup, do nothing.
  if (event.target.closest('.openrouter-translator-detailed-popup')) {
    return;
  }

  // If the tap/click is on or inside the smallIconPopup, do nothing.
  if (smallIconPopup && smallIconPopup.contains(event.target)) {
    return;
  }

  clearSelectionUpdateTimer();
  lastSelectionSignature = '';

  // If the tap/click is outside both popups, remove the smallIconPopup.
  removeSmallIconPopup();
};
document.addEventListener('mousedown', handlePointerStart);
document.addEventListener('touchstart', handlePointerStart);

const handleSelectionEnd = (event) => {
  // If the event is inside the detailed popup, let its own handlers manage it.
  if (event.target.closest('.openrouter-translator-detailed-popup')) {
    return;
  }
  // If the event is inside the small icon popup, let its click handler manage it.
  if (smallIconPopup && smallIconPopup.contains(event.target)) {
    return;
  }

  scheduleSmallIconPopupUpdate(SELECTION_END_DELAY_MS);
};
document.addEventListener('mouseup', handleSelectionEnd);
document.addEventListener('touchend', handleSelectionEnd);

// Android等で long-press 選択時に touchend が届かない場合に備え、selectionchange でも補足
document.addEventListener('selectionchange', () => {
  if (isPointerDown) {
    clearSelectionUpdateTimer();
    removeSmallIconPopup();
    return;
  }

  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';
  if (!text) {
    lastSelectionSignature = '';
    clearSelectionUpdateTimer();
    removeSmallIconPopup();
    return;
  }

  const signature = getSelectionSignature(selection);
  if (signature === lastSelectionSignature) {
    return;
  }

  lastSelectionSignature = signature;
  scheduleSmallIconPopupUpdate(SELECTION_STABLE_DELAY_MS);
});

const handleKeyboardTranslationShortcut = (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const isQuoteKey = event.code === 'Quote' || event.key === "'" || event.key === '"';
  if (!isQuoteKey || event.repeat) {
    return;
  }

  const selection = window.getSelection();
  let text = selection ? selection.toString().trim() : '';
  if (!text && selectedTextGlobal) {
    text = selectedTextGlobal;
  }
  if (!text) {
    return;
  }

  selectedTextGlobal = text;

  event.preventDefault();

  let popupX = Number.isFinite(lastPointerPosition.x) ? lastPointerPosition.x + KEYBOARD_POPUP_OFFSET : null;
  let popupY = Number.isFinite(lastPointerPosition.y) ? lastPointerPosition.y + KEYBOARD_POPUP_OFFSET : null;

  if ((popupX === null || popupY === null) && selection && selection.rangeCount > 0) {
    const rect = getRangeDisplayRect(selection.getRangeAt(0));
    if (rect) {
      const iconPosition = getSmallIconPopupPosition(rect);
      popupX = iconPosition.x;
      popupY = iconPosition.y;
    }
  }

  if (popupX === null || popupY === null) {
    popupX = window.scrollX + window.innerWidth / 2 - DEFAULT_POPUP_WIDTH / 2;
    popupY = window.scrollY + window.innerHeight / 2 - DEFAULT_POPUP_HEIGHT / 2;
  }

  removeSmallIconPopup();

  const keyboardPopup = createDetailedPopup(popupX, popupY, text, true);
  requestTranslationForPopup(keyboardPopup, text);
};
document.addEventListener('keydown', handleKeyboardTranslationShortcut);

// Listen for context menu message from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "showPopupFromContextMenu") {
    // Use the selected text if available, otherwise prompt user
    let text = request.selection || window.getSelection().toString().trim();
    if (!text || text.length === 0) {
      alert("No text selected.");
      return;
    }
    selectedTextGlobal = text;
    // Try to show the popup near the selected text
    let x, y;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const rect = getRangeDisplayRect(selection.getRangeAt(0));
      if (rect) {
        const iconPosition = getSmallIconPopupPosition(rect);
        x = iconPosition.x;
        y = iconPosition.y;
      }
    }
    // Fallback to center if selection position is not available
    if (typeof x !== "number" || typeof y !== "number") {
      const viewport = getViewportBounds();
      x = viewport.left + viewport.width / 2 - DEFAULT_POPUP_WIDTH / 2;
      y = viewport.top + viewport.height / 2 - DEFAULT_POPUP_HEIGHT / 2;
    }
    const newDetailedPopup = createDetailedPopup(x, y, selectedTextGlobal, true);

    requestTranslationForPopup(newDetailedPopup, selectedTextGlobal);
  }
});

