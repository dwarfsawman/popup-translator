// options.js
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveButton = document.getElementById('saveButton');
  const statusDiv = document.getElementById('status');

  // 保存されているAPIキーを読み込んで表示
  chrome.storage.local.get(['openaiApiKey'], (result) => {
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }
  });

  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ openaiApiKey: apiKey }, () => {
        statusDiv.textContent = 'APIキーが保存されました。';
        statusDiv.style.color = 'green';
        setTimeout(() => {
          statusDiv.textContent = '';
        }, 3000);
      });
    } else {
      statusDiv.textContent = 'APIキーを入力してください。';
      statusDiv.style.color = 'red';
    }
  });
});