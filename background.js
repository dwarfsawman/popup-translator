// background.js (変更点は少ない、APIキー関連のメッセージも処理できるようにする)

async function getApiKey() {
  const result = await chrome.storage.local.get(['openaiApiKey']);
  return result.openaiApiKey;
}

async function translateTextWithOpenAI(text, targetLanguage, apiKey) {
  // ... (以前のコードと同じ)
  if (!apiKey) {
    return { error: 'APIキーが設定されていません。ポップアップから設定してください。' };
  }
  if (!text) {
    return { error: '翻訳するテキストが入力されていません。' };
  }

  const API_URL = 'https://api.openai.com/v1/chat/completions';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "o4-mini",
        messages: [
          {
            role: "system",
            content: `以下の文章を日本語訳してください。なるべく直訳は避け自然な日本語にしてください。`
          },
          {
            role: "user",
            content: text
          }
        ],
        max_completion_tokens: 6000,
        temperature: 1.0
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API Error:', errorData);
      let errorMessage = `APIエラー: ${response.status}`;
      if (errorData && errorData.error && errorData.error.message) {
        errorMessage += ` - ${errorData.error.message}`;
      }
      return { error: errorMessage };
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return { translatedText: data.choices[0].message.content.trim() };
    } else {
      console.error('OpenAI API Response format error:', data);
      return { error: 'APIからの応答形式が正しくありません。' };
    }

  } catch (error) {
    console.error('Fetch Error:', error);
    return { error: `ネットワークエラーまたはリクエスト失敗: ${error.message}` };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "translate") {
    (async () => {
      const apiKey = await getApiKey();
      const result = await translateTextWithOpenAI(request.text, request.targetLanguage, apiKey);
      sendResponse(result);
    })();
    return true; // Indicate that the response is asynchronous
  } else if (request.action === "saveApiKey") {
    chrome.storage.local.set({ openaiApiKey: request.apiKey }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  } else if (request.action === "getApiKey") {
    (async () => {
        const apiKey = await getApiKey();
        sendResponse({ apiKey: apiKey });
    })();
    return true;
  }
});