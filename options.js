// options.js
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("apiKey");
  const modelInput = document.getElementById("model");
  const currentModelDisplay = document.getElementById("currentModelDisplay");
  const saveButton = document.getElementById("saveButton");
  const statusDiv = document.getElementById("status");

  function resolveModel(value) {
    return value.trim() || DEFAULT_MODEL;
  }

  function updateCurrentModelDisplay(value) {
    currentModelDisplay.textContent = `現在のモデル: ${resolveModel(value)}`;
  }

  modelInput.addEventListener("input", () => {
    updateCurrentModelDisplay(modelInput.value);
  });

  // 保存されている設定を読み込んで表示
  chrome.storage.local.get(["openrouterApiKey", "openrouterModel"], (result) => {
    if (result.openrouterApiKey) {
      apiKeyInput.value = result.openrouterApiKey;
    }
    const model = result.openrouterModel || DEFAULT_MODEL;
    modelInput.value = model;
    updateCurrentModelDisplay(model);
  });

  saveButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const model = resolveModel(modelInput.value);
    if (apiKey) {
      chrome.storage.local.set(
        { openrouterApiKey: apiKey, openrouterModel: model },
        () => {
          modelInput.value = model;
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
