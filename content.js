// content.js

let smallIconPopup = null;
let detailedPopup = null;
let selectedTextGlobal = '';
let isDragging = false;
let dragStartX, dragStartY; // ドラッグ開始時のマウス座標
let popupStartX, popupStartY; // ドラッグ開始時のポップアップの左上座標

// リサイズ用の変数
let isResizing = false;
let resizeType = '';
let startWidth, startHeight, startX, startY;

// デフォルトのポップアップサイズ
const DEFAULT_POPUP_WIDTH = 400;
const DEFAULT_POPUP_HEIGHT = 300;

function removeDetailedPopup() {
  if (detailedPopup) {
    detailedPopup.remove();
    detailedPopup = null;
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
  removeDetailedPopup();
}

// 小さな翻訳アイコンを作成・表示する関数
function createSmallIconPopup(x, y) {
  removePopups(); // Remove any existing popups first

  smallIconPopup = document.createElement('div');
  smallIconPopup.id = 'openai-translator-small-icon-popup';
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
      createDetailedPopup(iconRect.left + window.scrollX, iconRect.bottom + window.scrollY + 5, selectedTextGlobal, true); // isLoading = true
      if (smallIconPopup) { // Check if smallIconPopup still exists
        smallIconPopup.style.display = 'none'; // 小アイコンは非表示に
      }


      // APIリクエスト
      chrome.runtime.sendMessage(
        { action: "translate", text: selectedTextGlobal, targetLanguage: "Japanese" },
        (response) => {
          // Ensure detailedPopup and its children are still available
          if (!detailedPopup) return;
          const loadingIndicator = detailedPopup.querySelector('#inlineLoadingIndicator');
          const outputArea = detailedPopup.querySelector('#inlineTranslationOutput');

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

// 詳細なポップアップ (翻訳結果表示のみ) を作成・表示する関数
function createDetailedPopup(x, y, originalText, isLoading = false) {
  removeDetailedPopup(); // Remove existing detailed popup first

  detailedPopup = document.createElement('div');
  detailedPopup.id = 'openai-translator-detailed-popup';
  detailedPopup.innerHTML = `
    <button class="popup-close-button" title="閉じる">&times;</button>
    <div class="translator-popup-content">
      <div id="inlineLoadingIndicator" style="display: ${isLoading ? 'block' : 'none'};">...</div>
      <div id="inlineTranslationOutput" class="translation-output"></div>
    </div>
    <div class="resize-handle resize-handle-e"></div>
    <div class="resize-handle resize-handle-s"></div>
    <div class="resize-handle resize-handle-se"></div>
  `;

  document.body.appendChild(detailedPopup);
  detailedPopup.style.left = `${x}px`;
  detailedPopup.style.top = `${y}px`;

  // 保存されたサイズを適用
  getSavedPopupSize((width, height) => {
    if (detailedPopup) { // Check if popup still exists
        detailedPopup.style.width = `${width}px`;
        detailedPopup.style.height = `${height}px`;
    }
  });

  const dragHandle = detailedPopup; // Pop-up itself is the drag handle

  dragHandle.addEventListener('mousedown', (e) => {
    // テキスト選択や他の要素のクリックイベントと競合しないように
    // Allow dragging unless clicking on button, output area, or resize handles
    if (e.target.closest('button, .translation-output, .resize-handle, .popup-close-button')) {
        return;
    }
    e.preventDefault(); // テキスト選択などを防ぐ

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    popupStartX = detailedPopup.offsetLeft;
    popupStartY = detailedPopup.offsetTop;

    detailedPopup.style.userSelect = 'none';
  });

  // Prevent click event on popup from propagating to document mousedown listener
  detailedPopup.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  // Add event listener for the close button
  const closeButton = detailedPopup.querySelector('.popup-close-button');
  if (closeButton) {
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent other listeners
      removeDetailedPopup();
    });
  }
  
  setupResizeHandlers();
}

// リサイズハンドラーをセットアップする関数
function setupResizeHandlers() {
  if (!detailedPopup) return;
  
  const eastResize = detailedPopup.querySelector('.resize-handle-e');
  const southResize = detailedPopup.querySelector('.resize-handle-s');
  const southEastResize = detailedPopup.querySelector('.resize-handle-se');
  
  if (!eastResize || !southResize || !southEastResize) return; // Ensure handles exist

  eastResize.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeType = 'e';
    startX = e.clientX;
    if (detailedPopup) startWidth = detailedPopup.offsetWidth; // Check detailedPopup
    document.body.style.cursor = 'e-resize';
  });
  
  southResize.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeType = 's';
    startY = e.clientY;
    if (detailedPopup) startHeight = detailedPopup.offsetHeight; // Check detailedPopup
    document.body.style.cursor = 's-resize';
  });
  
  southEastResize.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeType = 'se';
    startX = e.clientX;
    startY = e.clientY;
    if (detailedPopup) { // Check detailedPopup
        startWidth = detailedPopup.offsetWidth;
        startHeight = detailedPopup.offsetHeight;
    }
    document.body.style.cursor = 'se-resize';
  });
}

document.addEventListener('mousemove', (e) => {
  if (isDragging && detailedPopup) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    detailedPopup.style.left = `${popupStartX + dx}px`;
    detailedPopup.style.top = `${popupStartY + dy}px`;
  }
  
  if (isResizing && detailedPopup) {
    if (resizeType === 'e' || resizeType === 'se') {
      const width = startWidth + (e.clientX - startX);
      if (width >= 200) {
        detailedPopup.style.width = `${width}px`;
      }
    }
    
    if (resizeType === 's' || resizeType === 'se') {
      const height = startHeight + (e.clientY - startY);
      if (height >= 100) {
        detailedPopup.style.height = `${height}px`;
      }
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (isDragging) {
    isDragging = false;
    if (detailedPopup) {
        detailedPopup.style.userSelect = 'auto';
    }
  }
  
  if (isResizing) {
    isResizing = false;
    resizeType = '';
    document.body.style.cursor = 'default';
    
    if (detailedPopup) {
      const width = detailedPopup.offsetWidth;
      const height = detailedPopup.offsetHeight;
      savePopupSize(width, height);
    }
  }
});

// Modified mousedown listener to handle popup dismissal
document.addEventListener('mousedown', (event) => {
  // If the click is on or inside the detailedPopup, do nothing.
  // The detailedPopup is only closed by its own close button.
  if (detailedPopup && detailedPopup.contains(event.target)) {
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
  if (detailedPopup && detailedPopup.contains(event.target)) {
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
      removePopups(); // Clear previous popups before creating a new one
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
    createDetailedPopup(x, y, selectedTextGlobal, true);

    // APIリクエスト
    chrome.runtime.sendMessage(
      { action: "translate", text: selectedTextGlobal, targetLanguage: "Japanese" },
      (response) => {
        if (!detailedPopup) return;
        const loadingIndicator = detailedPopup.querySelector('#inlineLoadingIndicator');
        const outputArea = detailedPopup.querySelector('#inlineTranslationOutput');
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
