// options.js
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("model");
  const currentModelDisplay = document.getElementById("currentModelDisplay");
  const saveButton = document.getElementById("saveButton");
  const statusDiv = document.getElementById("status");

  function updateCurrentModelDisplay(model) {
    currentModelDisplay.textContent = `現在のモデル: ${model}`;
  }

  modelSelect.addEventListener("change", () => {
    updateCurrentModelDisplay(modelSelect.value);
  });

  // 保存されている設定を読み込んで表示
  chrome.storage.local.get(["openrouterApiKey", "openrouterModel"], (result) => {
    if (result.openrouterApiKey) {
      apiKeyInput.value = result.openrouterApiKey;
    }
    const model = result.openrouterModel || DEFAULT_MODEL;
    modelSelect.value = model;
    updateCurrentModelDisplay(model);
  });

  saveButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    if (apiKey) {
      chrome.storage.local.set(
        { openrouterApiKey: apiKey, openrouterModel: model },
        () => {
          updateCurrentModelDisplay(model);
          statusDiv.textContent = "設定が保存されました。";
          statusDiv.style.color = "green";
          setTimeout(() => {
            statusDiv.textContent = "";
          }, 3000);
        },
      );
    } else {
      statusDiv.textContent = "APIキーを入力してください。";
      statusDiv.style.color = "red";
    }
  });
});
