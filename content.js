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
const DETAILED_POPUP_SIDE_MARGIN = 72;

function getViewportBounds() {
  const docEl = document.documentElement;
  const body = document.body;
  const fallbackScrollX = window.scrollX || (docEl && docEl.scrollLeft) || (body && body.scrollLeft) || 0;
  const fallbackScrollY = window.scrollY || (docEl && docEl.scrollTop) || (body && body.scrollTop) || 0;
  const visualViewport = window.visualViewport;

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
          left: fallbackScrollX + visibleLeft - frameRect.left,
          top: fallbackScrollY + visibleTop - frameRect.top,
          width: visibleRight - visibleLeft,
          height: visibleBottom - visibleTop,
        };
      }
    }
  } catch (error) {
    // Cross-origin frames can deny parent/frame access; fall back to the local viewport.
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
  return {
    top: POPUP_VIEWPORT_MARGIN,
    right: DETAILED_POPUP_SIDE_MARGIN,
    bottom: POPUP_VIEWPORT_MARGIN,
    left: DETAILED_POPUP_SIDE_MARGIN,
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
  const widthLimit = Math.max(200, Math.floor(viewport.width - margins.left - margins.right));
  const heightLimit = Math.max(100, Math.floor(viewport.height - margins.top - margins.bottom));

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
    clampY: options.clampY === true,
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

// 保存されたポップアップサイズを取得する関数
function getSavedPopupSize(callback) {
  chrome.storage.local.get(['popupWidth', 'popupHeight'], (result) => {
    const width = result.popupWidth || DEFAULT_POPUP_WIDTH;
    const height = result.popupHeight || DEFAULT_POPUP_HEIGHT;
    callback(width, height);
  });
}

// ポップアップサイズを保存する関数
function savePopupSize(width, height) {
  chrome.storage.local.set({
    popupWidth: width,
    popupHeight: height
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
    <button class="popup-close-button" title="閉じる">&times;</button>
    <div class="translator-popup-content">
      <div id="inlineLoadingIndicator" style="display: ${isLoading ? 'block' : 'none'};">...</div>
      <div id="inlineTranslationOutput" class="translation-output"></div>
    </div>
    <div class="resize-handle resize-handle-e"></div>
    <div class="resize-handle resize-handle-s"></div>
    <div class="resize-handle resize-handle-se"></div>
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

    popupElement.style.width = `${width}px`;
    popupElement.style.height = `${height}px`;

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
  popupElement.addEventListener('mousedown', bringToFront, true);
  popupElement.addEventListener('touchstart', bringToFront, { passive: true, capture: true });

  const startDrag = (e) => {
    if (e.target.closest('button, .translation-output, .resize-handle, .popup-close-button')) {
      return;
    }
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
    document.body.style.cursor = `${type}-resize`;
  };

  eastResize.addEventListener('mousedown', (e) => startResize(e, 'e'));
  southResize.addEventListener('mousedown', (e) => startResize(e, 's'));
  southEastResize.addEventListener('mousedown', (e) => startResize(e, 'se'));

  // Touch support
  eastResize.addEventListener('touchstart', (e) => startResize(e, 'e'), { passive: false });
  southResize.addEventListener('touchstart', (e) => startResize(e, 's'), { passive: false });
  southEastResize.addEventListener('touchstart', (e) => startResize(e, 'se'), { passive: false });
}

// Global move handler for dragging and resizing (mouse & touch).
const handlePointerMove = (e) => {
  const { x, y } = getEventCoords(e);
  lastPointerPosition = {
    x: x + window.scrollX,
    y: y + window.scrollY,
  };

  if (!activeInteraction.element) return;

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
      if (width >= 200) {
        activeInteraction.element.style.width = `${width}px`;
      }
    }
    if (activeInteraction.resizeType.includes('s')) {
      const height = activeInteraction.startHeight + (y - activeInteraction.startY);
      if (height >= 100) {
        activeInteraction.element.style.height = `${height}px`;
      }
    }
    ensureDetailedPopupWithinViewport(activeInteraction.element);
  }
};
document.addEventListener('mousemove', handlePointerMove, { passive: false });
document.addEventListener('touchmove', handlePointerMove, { passive: false });

// Global pointer up handler to end interactions.
const handlePointerUp = () => {
  isPointerDown = false;
  if (!activeInteraction.element) return;

  if (activeInteraction.isDragging) {
    activeInteraction.element.style.userSelect = 'auto';
  }

  if (activeInteraction.isResizing) {
    document.body.style.cursor = 'default';
    ensureDetailedPopupWithinViewport(activeInteraction.element);
    const width = activeInteraction.element.offsetWidth;
    const height = activeInteraction.element.offsetHeight;
    savePopupSize(width, height); // Saves size for future popups
  }

  // Reset interaction state
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
document.addEventListener('mouseup', handlePointerUp);
document.addEventListener('touchend', handlePointerUp);
document.addEventListener('touchcancel', () => {
  isPointerDown = false;
});
window.addEventListener('resize', scheduleTranslatorViewportClamp);
window.addEventListener('scroll', scheduleTranslatorViewportClamp, true);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleTranslatorViewportClamp);
  window.visualViewport.addEventListener('scroll', scheduleTranslatorViewportClamp);
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

