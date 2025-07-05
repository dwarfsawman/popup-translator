// content.js

let smallIconPopup = null;
let selectedTextGlobal = '';
let popupIdCounter = 0;
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
  //removePopups(); // Remove any existing popups first

  smallIconPopup = document.createElement('div');
  smallIconPopup.id = 'openrouter-translator-small-icon-popup';
  const emojiIcon = '🌐'; // 地球儀マーク
  smallIconPopup.innerHTML = `<span class="emoji-trigger" title="翻訳する">${emojiIcon}</span>`;

  document.body.appendChild(smallIconPopup);
  smallIconPopup.style.left = `${x}px`;
  smallIconPopup.style.top = `${y}px`;

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
  });

  // Setup all interaction event listeners for this specific popup
  setupPopupInteractions(popupElement);

  return popupElement; // Return the new element so it can be updated with content
}

// Sets up dragging, closing, and resizing for a specific popup element.
function setupPopupInteractions(popupElement) {
  const dragHandle = popupElement;

  // Bring popup to front when clicked
  popupElement.addEventListener('mousedown', (e) => {
    popupElement.style.zIndex = 10000 + popupIdCounter++;
  }, true);

  dragHandle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, .translation-output, .resize-handle, .popup-close-button')) {
      return;
    }
    e.preventDefault();

    activeInteraction.isDragging = true;
    activeInteraction.element = popupElement;
    activeInteraction.dragStartX = e.clientX;
    activeInteraction.dragStartY = e.clientY;
    activeInteraction.popupStartX = popupElement.offsetLeft;
    activeInteraction.popupStartY = popupElement.offsetTop;

    popupElement.style.userSelect = 'none';
  });

  const closeButton = popupElement.querySelector('.popup-close-button');
  if (closeButton) {
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      removeDetailedPopup(popupElement);
    });
  }

  setupResizeHandlers(popupElement);
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

    activeInteraction.isResizing = true;
    activeInteraction.resizeType = type;
    activeInteraction.element = popupElement;
    activeInteraction.startX = e.clientX;
    activeInteraction.startY = e.clientY;
    activeInteraction.startWidth = popupElement.offsetWidth;
    activeInteraction.startHeight = popupElement.offsetHeight;
    document.body.style.cursor = `${type}-resize`;
  };

  eastResize.addEventListener('mousedown', (e) => startResize(e, 'e'));
  southResize.addEventListener('mousedown', (e) => startResize(e, 's'));
  southEastResize.addEventListener('mousedown', (e) => startResize(e, 'se'));
}

// Global mouse move handler for dragging and resizing.
document.addEventListener('mousemove', (e) => {
  if (!activeInteraction.element) return;

  if (activeInteraction.isDragging) {
    const dx = e.clientX - activeInteraction.dragStartX;
    const dy = e.clientY - activeInteraction.dragStartY;
    activeInteraction.element.style.left = `${activeInteraction.popupStartX + dx}px`;
    activeInteraction.element.style.top = `${activeInteraction.popupStartY + dy}px`;
  }

  if (activeInteraction.isResizing) {
    if (activeInteraction.resizeType.includes('e')) {
      const width = activeInteraction.startWidth + (e.clientX - activeInteraction.startX);
      if (width >= 200) {
        activeInteraction.element.style.width = `${width}px`;
      }
    }
    if (activeInteraction.resizeType.includes('s')) {
      const height = activeInteraction.startHeight + (e.clientY - activeInteraction.startY);
      if (height >= 100) {
        activeInteraction.element.style.height = `${height}px`;
      }
    }
  }
});

// Global mouse up handler to end interactions.
document.addEventListener('mouseup', () => {
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
});

// Modified mousedown listener to handle popup dismissal
document.addEventListener('mousedown', (event) => {
  // If the click is on or inside the detailedPopup, do nothing.
  // If the click is on or inside any of the detailed popups, do nothing.
  if (event.target.closest('.openrouter-translator-detailed-popup')) {
    return;
  }

  // If the click is on or inside the smallIconPopup, do nothing.
  // Its own click handler will manage its behavior.
  if (smallIconPopup && smallIconPopup.contains(event.target)) {
    return;
  }

  // If the click is outside both popups, remove the smallIconPopup.
  // The detailedPopup remains, as per the requirement.
  removeSmallIconPopup();
});

document.addEventListener('mouseup', (event) => {
  // If the mouseup event is inside the detailed popup, let its own handlers (drag, resize, close) manage it.
  if (event.target.closest('.openrouter-translator-detailed-popup')) {
    return;
  }
  // If the mouseup event is inside the small icon popup, let its click handler manage it.
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

      // Only remove popups if we are about to create a new small icon.
      // This prevents closing the detailed popup if text is selected elsewhere while it's open.

      //removePopups(); // Clear previous popups before creating a new one

      createSmallIconPopup(rect.right + window.scrollX - 10, rect.top + window.scrollY - 10);
    } else {
      // If no text is selected, and the click was outside any popups (handled by document mousedown),
      // the smallIconPopup would have been removed by the mousedown listener.
      // No explicit action needed here for detailedPopup as it persists.
    }
  }, 0);
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
