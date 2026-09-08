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
  
  if (message.type === 'OPEN_IN_LINGUA_VIEWER') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        const viewerUrl = chrome.runtime.getURL('src/viewer/index.html') + '?file=' + encodeURIComponent(tabs[0].url);
        chrome.tabs.create({ url: viewerUrl });
      }
    });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'FETCH_PDF_FILE') {
    fetch(message.url)
      .then(response => response.arrayBuffer())
      .then(buffer => {
        const arr = new Uint8Array(buffer);
        sendResponse({ success: true, data: Array.from(arr) });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  
  return false;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url) {
    const isPdf = tab.url.endsWith('.pdf') || 
                  tab.url.includes('.pdf?') || 
                  tab.url.includes('.pdf#') ||
                  (tab.url.startsWith('chrome-extension://') && tab.url.includes('/pdfjs/web/viewer.html'));
    
    if (isPdf) {
      let fileUrl = tab.url;
      if (tab.url.startsWith('chrome-extension://') && tab.url.includes('/pdfjs/web/viewer.html')) {
        try {
          const urlObj = new URL(tab.url);
          const fileParam = urlObj.searchParams.get('file');
          if (fileParam) {
            fileUrl = decodeURIComponent(fileParam);
          }
        } catch (e) {
        }
      }
      
      const viewerUrl = chrome.runtime.getURL('src/viewer/index.html') + '?file=' + encodeURIComponent(fileUrl);
      chrome.tabs.create({ url: viewerUrl });
    } else {
      chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['src/content/content.ts'],
      });
    }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  
  const url = details.url;
  
  const isPdf = (url.endsWith('.pdf') || url.includes('.pdf?') || url.includes('.pdf#'));
  const isOurViewer = url.includes('/src/viewer/index.html');
  
  if (isPdf && !isOurViewer) {
    const viewerUrl = chrome.runtime.getURL('src/viewer/index.html') + '?file=' + encodeURIComponent(url);
    chrome.tabs.update(details.tabId, { url: viewerUrl });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;
  
  const url = tab.url;
  
  if (url.startsWith('chrome-extension://') && url.includes('/pdfjs/web/viewer.html')) {
    try {
      const urlObj = new URL(url);
      const fileParam = urlObj.searchParams.get('file');
      if (fileParam) {
        const fileUrl = decodeURIComponent(fileParam);
        const viewerUrl = chrome.runtime.getURL('src/viewer/index.html') + '?file=' + encodeURIComponent(fileUrl);
        chrome.tabs.update(tabId, { url: viewerUrl });
      }
    } catch (e) {
    }
  }
});
