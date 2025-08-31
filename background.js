/* global chrome */
// background.js - OpenRouter API対応

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translate-with-OpenRouter",
    title: "Translate with OpenRouter",
    contexts: ["selection", "page"]
  });
});

// Listen for context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-with-OpenRouter") {
    chrome.tabs.sendMessage(tab.id, { action: "showPopupFromContextMenu", selection: info.selectionText });
  }
});

async function getApiKey() {
  const result = await chrome.storage.local.get(['openrouterApiKey']);
  return result.openrouterApiKey;
}

async function translateTextWithOpenRouter(text, targetLanguage, apiKey) {
  if (!apiKey) {
    return { error: 'APIキーが設定されていません。ポップアップから設定してください。' };
  }
  if (!text) {
    return { error: '翻訳するテキストが入力されていません。' };
  }

  const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

  // 翻訳先言語に応じたプロンプトを設定
  let systemPrompt;
  switch (targetLanguage) {
    case 'Japanese':
      systemPrompt = '以下の文章を日本語訳してください。なるべく直訳は避け自然な日本語にしてください。前置きや説明は省き、翻訳結果だけを出力してください。';
      break;
    case 'English':
      systemPrompt = 'Please translate the following text to English. Make it natural and avoid literal translation. Output only the translation without any preamble or explanation.';
      break;
    case 'Korean':
      systemPrompt = '다음 문장을 한국어로 번역해주세요. 직역보다는 자연스러운 한국어로 번역해주세요. 전제나 설명 없이 번역 결과만 출력해주세요.';
      break;
    case 'Chinese':
      systemPrompt = '请将以下文本翻译成中文。请避免直译，使用自然的中文表达。 只输出翻译结果，不要任何前言或解释。';
      break;
    default:
      systemPrompt = `Please translate the following text to ${targetLanguage}. Make it natural and avoid literal translation. Output only the translation without any preamble or explanation.`;
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': chrome.runtime.getURL(''),
        'X-Title': 'OpenRouter Translator Extension'
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: text
          }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter API Error:', errorData);
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
      console.error('OpenRouter API Response format error:', data);
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
      const result = await translateTextWithOpenRouter(request.text, request.targetLanguage, apiKey);
      sendResponse(result);
    })();
    return true; // Indicate that the response is asynchronous
  } else if (request.action === "saveApiKey") {
    chrome.storage.local.set({ openrouterApiKey: request.apiKey }, () => {
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