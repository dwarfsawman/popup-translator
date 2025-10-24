// content.js

let smallIconPopup = null;
let selectedTextGlobal = '';
let popupIdCounter = 0;
let isPointerDown = false;
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

  // モバイル等の狭い画面でアイコンが画面外に出ないようにクランプ
  const margin = 6;
  const usedWidth = smallIconPopup.offsetWidth;
  const usedHeight = smallIconPopup.offsetHeight;
  const maxLeft = window.scrollX + window.innerWidth - usedWidth - margin;
  const maxTop = window.scrollY + window.innerHeight - usedHeight - margin;
  const clampedLeft = Math.max(window.scrollX + margin, Math.min(x, maxLeft));
  const clampedTop = Math.max(window.scrollY + margin, Math.min(y, maxTop));
  smallIconPopup.style.left = `${clampedLeft}px`;
  smallIconPopup.style.top = `${clampedTop}px`;

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

      // APIリクエスト
      chrome.runtime.sendMessage(
        { action: "translate", text: selectedTextGlobal, targetLanguage: "Japanese" },
        (response) => {
          // Use the specific popup instance we just created
          if (!newDetailedPopup) return;
          const loadingIndicator = newDetailedPopup.querySelector('#inlineLoadingIndicator');
          const outputArea = newDetailedPopup.querySelector('#inlineTranslationOutput');

          if (loadingIndicator) loadingIndicator.style.display = 'none';
          if (!outputArea) return;

          if (chrome.runtime.lastError) {
            outputArea.textContent = 'エラー: ' + chrome.runtime.lastError.message;
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
        }
      );
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
  // Set z-index to bring new popups to the front
  popupElement.style.zIndex = 10000 + popupIdCounter;

  // Apply saved size
  getSavedPopupSize((width, height) => {
    popupElement.style.width = `${width}px`;
    popupElement.style.height = `${height}px`;

    // 幅・高さ反映後に、ポップアップ位置をビューポート内にクランプ
    // max-width/max-height により実際の表示サイズは縮む可能性があるため、offsetWidth/offsetHeight を使用
    const margin = 8; // 画面端からの最小余白
    const usedWidth = popupElement.offsetWidth;
    const usedHeight = popupElement.offsetHeight;
    const maxLeft = window.scrollX + window.innerWidth - usedWidth - margin;
    const maxTop = window.scrollY + window.innerHeight - usedHeight - margin;
    const clampedLeft = Math.max(window.scrollX + margin, Math.min(x, maxLeft));
    const clampedTop = Math.max(window.scrollY + margin, Math.min(y, maxTop));
    popupElement.style.left = `${clampedLeft}px`;
    popupElement.style.top = `${clampedTop}px`;
  });

  // Setup all interaction event listeners for this specific popup
  setupPopupInteractions(popupElement);

  return popupElement; // Return the new element so it can be updated with content
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
  if (!activeInteraction.element) return;
  const { x, y } = getEventCoords(e);

  if (activeInteraction.isDragging) {
    const dx = x - activeInteraction.dragStartX;
    const dy = y - activeInteraction.dragStartY;
    activeInteraction.element.style.left = `${activeInteraction.popupStartX + dx}px`;
    activeInteraction.element.style.top = `${activeInteraction.popupStartY + dy}px`;
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

// Pointer start listener to handle popup dismissal
const handlePointerStart = (event) => {
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

  // Use a timeout to ensure selection is registered
  setTimeout(() => {
    const currentSelectedText = window.getSelection().toString().trim();
    if (currentSelectedText.length > 0) {
      selectedTextGlobal = currentSelectedText;
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return; // No selection range

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      createSmallIconPopup(rect.right + window.scrollX - 10, rect.top + window.scrollY - 10);
    }
  }, 0);
};
document.addEventListener('mouseup', handleSelectionEnd);
document.addEventListener('touchend', handleSelectionEnd);

// Android等で long-press 選択時に touchend が届かない場合に備え、selectionchange でも補足
let selectionChangeTimer = null;
document.addEventListener('selectionchange', () => {
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
    // �|�b�v�A�b�v��̑���ɂ�� selection �ɂ͔������Ȃ�
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
});

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
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // If the selection is visible, use its position
      if (rect && rect.width > 0 && rect.height > 0) {
        x = rect.right + window.scrollX - 10;
        y = rect.top + window.scrollY - 10;
      }
    }
    // Fallback to center if selection position is not available
    if (typeof x !== "number" || typeof y !== "number") {
      x = window.innerWidth / 2 - 200;
      y = window.innerHeight / 2 - 100;
    }
    const newDetailedPopup = createDetailedPopup(x, y, selectedTextGlobal, true);

    // APIリクエスト
    chrome.runtime.sendMessage(
      { action: "translate", text: selectedTextGlobal, targetLanguage: "Japanese" },
      (response) => {
        if (!newDetailedPopup) return;
        const loadingIndicator = newDetailedPopup.querySelector('#inlineLoadingIndicator');
        const outputArea = newDetailedPopup.querySelector('#inlineTranslationOutput');
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (!outputArea) return;

        if (chrome.runtime.lastError) {
          outputArea.textContent = 'エラー: ' + chrome.runtime.lastError.message;
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
      }
    );
  }
});

