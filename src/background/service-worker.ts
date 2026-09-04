import { translationManager } from '../translation';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/index.html'),
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_GEMINI_CONNECTION') {
    translationManager.testProvider(message.apiKey, message.model)
      .then(result => sendResponse({ success: result }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
  
  if (message.type === 'GET_TRANSLATION_STATUS') {
    sendResponse({
      isConfigured: translationManager.isProviderConfigured(),
      units: translationManager.getAllTranslationUnits().length,
    });
    return true;
  }
  
  return false;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/content.ts'],
    });
  }
});