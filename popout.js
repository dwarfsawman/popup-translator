document.addEventListener('DOMContentLoaded', () => {
  const inputText = document.getElementById('inputText');
  const translateButton = document.getElementById('translateButton');
  const outputText = document.getElementById('outputText');
  const targetLanguageSelect = document.getElementById('targetLanguage');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyButton = document.getElementById('saveApiKeyButton');
  const loadingIndicator = document.getElementById('loadingIndicator');

  // 保存されているAPIキーを読み込んで表示 (セキュリティのため実際には表示しない方が良い場合も)
  chrome.runtime.sendMessage({ action: "getApiKey" }, (response) => {
    if (response && response.apiKey) {
      // apiKeyInput.value = response.apiKey; // デバッグ用。通常は表示しない
      console.log("APIキーは設定済みです。");
    } else {
      console.log("APIキーが未設定です。");
    }
  });

  saveApiKeyButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.runtime.sendMessage({ action: "saveApiKey", apiKey: apiKey }, (response) => {
        if (response && response.success) {
          alert('APIキーが保存されました！');
          apiKeyInput.value = ''; // 保存後はクリア
        } else {
          alert('APIキーの保存に失敗しました: ' + (response && response.error ? response.error : '不明なエラー'));
        }
      });
    } else {
      alert('APIキーを入力してください。');
    }
  });

  translateButton.addEventListener('click', () => {
    const textToTranslate = inputText.value.trim();
    const selectedLanguage = targetLanguageSelect.value;

    if (!textToTranslate) {
      outputText.textContent = '翻訳するテキストを入力してください。';
      return;
    }

    loadingIndicator.style.display = 'block';
    outputText.textContent = ''; // 前回の結果をクリア

    // バックグラウンドスクリプトに翻訳リクエストを送信
    chrome.runtime.sendMessage(
      {
        action: "translate",
        text: textToTranslate,
        targetLanguage: selectedLanguage
      },
      (response) => {
        loadingIndicator.style.display = 'none';
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          outputText.textContent = 'エラーが発生しました: ' + chrome.runtime.lastError.message;
          return;
        }
        if (response) {
          if (response.error) {
            outputText.textContent = 'エラー: ' + response.error;
          } else if (response.translatedText) {
            outputText.textContent = response.translatedText;
          } else {
            outputText.textContent = '翻訳結果がありません。';
          }
        } else {
          outputText.textContent = 'APIからの応答がありません。';
        }
      }
    );
  });
});