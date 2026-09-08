import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { getSettings, saveDisplaySettings, getEffectiveTheme } from '../storage/settings';
import { translationManager } from '../translation';
import { Settings } from '../types';

interface PopupState {
  settings: Settings | null;
  isConnected: boolean | null;
  isTesting: boolean;
  pdfDetected: boolean;
  isTranslating: boolean;
}

function Popup() {
  const [state, setState] = useState<PopupState>({
    settings: null,
    isConnected: null,
    isTesting: false,
    pdfDetected: false,
    isTranslating: false,
  });
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');

  const applyTheme = useCallback((theme: 'light' | 'dark') => {
    setEffectiveTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    initializePopup();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (state.settings?.ui.theme === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [applyTheme]);

  useEffect(() => {
    if (state.settings) {
      const theme = getEffectiveTheme(state.settings.ui.theme);
      applyTheme(theme);
    }
  }, [state.settings, applyTheme]);

  const initializePopup = async () => {

    const settings = await getSettings();


    let isConnected = false;

    if (settings.translation.apiKey && settings.translation.model) {

      const cached = await chrome.storage.local.get('lingua_connection_status');
      const cachedStatus = cached.lingua_connection_status;

      if (cachedStatus &&
          cachedStatus.apiKey === settings.translation.apiKey &&
          cachedStatus.model === settings.translation.model &&
          cachedStatus.success &&
          Date.now() - cachedStatus.timestamp < 3600000) {

        isConnected = true;
      } else {

        setState(prev => ({ ...prev, settings, isTesting: true }));
        try {
          const result = await translationManager.testProvider(
            settings.translation.apiKey,
            settings.translation.model
          );


          await chrome.storage.local.set({
            lingua_connection_status: {
              apiKey: settings.translation.apiKey,
              model: settings.translation.model,
              success: result.success,
              timestamp: Date.now(),
            }
          });

          isConnected = result.success;
        } catch {
          isConnected = false;
        }
      }
    }


    let pdfDetected = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        pdfDetected = tab.url.includes('.pdf') ||
                      tab.url.includes('/viewer.html') ||
                      tab.url.includes('chrome-extension://');
      }
    } catch {

    }

    setState(prev => ({
      ...prev,
      settings,
      isConnected,
      isTesting: false,
      pdfDetected,
    }));
  };

  const toggleEnabled = async () => {
    if (!state.settings) return;
    const newEnabled = !state.settings.display.enabled;
    await saveDisplaySettings({ enabled: newEnabled });
    setState(prev => ({
      ...prev,
      settings: prev.settings ? { ...prev.settings, display: { ...prev.settings.display, enabled: newEnabled } } : null,
    }));
  };

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
    window.close();
  };

  const translatePDF = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'START_TRANSLATION' });
      }
    } catch (err) {
      console.error('Failed to start translation:', err);
    }
    window.close();
  };

  if (!state.settings) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '40px 16px' }}>
        <div className="logo">L</div>
        <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  const { settings } = state;
  const hasApiKey = !!settings.translation.apiKey;

  return (
    <div className="container">
      <div className="header">
        <div className="logo">L</div>
        <div className="title">Lingua</div>
      </div>

      {!hasApiKey && (
        <div className="error-message">
          Gemini API key is not configured.<br />
          Open Settings to configure it.
        </div>
      )}

      <div className="section">
        <div className="section-title">PDF Translation</div>
        <div className="status-row">
          <span className="status-label">Translation</span>
          <button
            className={`toggle ${settings.display.enabled ? 'active' : ''}`}
            onClick={toggleEnabled}
            aria-label={settings.display.enabled ? 'Disable translation' : 'Enable translation'}
          />
        </div>
      </div>

      <div className="section">
        <div className="section-title">Language</div>
        <div className="lang-pair">
          <span className="lang">English</span>
          <span className="arrow">→</span>
          <span className="lang" style={{ direction: 'rtl', fontFamily: 'Vazirmatn, Tahoma, sans-serif' }}>فارسی</span>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Gemini</div>
        <div className="gemini-status">
          <div className={`status-dot ${state.isTesting ? 'testing' : state.isConnected ? 'connected' : hasApiKey ? 'error' : ''}`} />
          <span className="status-text">
            {state.isTesting ? 'Testing...' :
             state.isConnected ? `Connected` :
             hasApiKey ? 'Not connected' : 'Not configured'}
          </span>
        </div>
        {state.isConnected && settings.translation.model && (
          <div className="model-name" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {settings.translation.model}
          </div>
        )}
      </div>

      {state.pdfDetected && state.isConnected && settings.display.enabled && (
        <button className="btn btn-primary" onClick={translatePDF} style={{ width: '100%', marginBottom: '12px' }}>
          Translate PDF
        </button>
      )}

      <button className="btn btn-secondary" onClick={openSettings}>
        Open Settings
      </button>

      <div className="footer">
        <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
        <span className="separator">·</span>
        <a href="#" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); }}>
          Privacy
        </a>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
