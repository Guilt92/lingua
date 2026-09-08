import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getSettings,
  saveTranslationSettings,
  saveDisplaySettings,
  saveUISettings,
  clearCache,
  getEffectiveTheme
} from '../storage/settings';
import { translationManager } from '../translation';
import { Settings, TranslationSettings, DisplaySettings, ThemeMode, ConnectionTestResult, ModelInfo } from '../types';

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  const applyTheme = useCallback((theme: 'light' | 'dark') => {
    setEffectiveTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    loadSettings();
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (settings?.ui.theme === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [applyTheme]);

  useEffect(() => {
    if (settings) {
      const theme = getEffectiveTheme(settings.ui.theme);
      applyTheme(theme);
    }
  }, [settings, applyTheme]);

  const loadSettings = async () => {
    const s = await getSettings();
    setSettings(s);
  };

  const handleTranslationSettingChange = async <K extends keyof TranslationSettings>(
    key: K,
    value: TranslationSettings[K]
  ) => {
    if (!settings) return;
    const newSettings = { ...settings.translation, [key]: value };
    setSettings(prev => prev ? { ...prev, translation: newSettings } : null);
    await saveTranslationSettings({ [key]: value });
    showSaveStatus('saved');

    if (key === 'apiKey' || key === 'model') {
      if (value) {
        await translationManager.updateConfig(
          newSettings.apiKey,
          newSettings.model
        );
      }
    }
  };

  const handleDisplaySettingChange = async <K extends keyof DisplaySettings>(
    key: K,
    value: DisplaySettings[K]
  ) => {
    if (!settings) return;
    const newSettings = { ...settings.display, [key]: value };
    setSettings(prev => prev ? { ...prev, display: newSettings } : null);
    await saveDisplaySettings({ [key]: value });
    showSaveStatus('saved');
  };

  const handleUISettingChange = async <K extends keyof Settings['ui']>(
    key: K,
    value: Settings['ui'][K]
  ) => {
    if (!settings) return;
    const newSettings = { ...settings.ui, [key]: value };
    setSettings(prev => prev ? { ...prev, ui: newSettings } : null);
    await saveUISettings({ [key]: value });
    showSaveStatus('saved');
  };

  const showSaveStatus = (status: 'saving' | 'saved' | 'error') => {
    setSaveStatus(status);
    if (status === 'saved') {
      setTimeout(() => setSaveStatus('idle'), 1500);
    }
  };

  const handleTestConnection = async () => {
    if (!settings?.translation.apiKey) return;

    setTesting(true);
    setTestResult(null);
    setModelsLoaded(false);
    setAvailableModels([]);

    try {
      const result = await translationManager.testProvider(
        settings.translation.apiKey,
        settings.translation.model
      );

      const models = result.availableModels ?? [];
      setAvailableModels(models);
      setModelsLoaded(true);
      setTestResult(result);

      if (result.success) {

        await chrome.storage.local.set({
          lingua_connection_status: {
            apiKey: settings.translation.apiKey,
            model: settings.translation.model,
            success: true,
            timestamp: Date.now(),
          }
        });

        if (result.message.includes('Using:')) {
          const match = result.message.match(/Using: (.+)$/);
          if (match) {
            const displayName = match[1];
            const model = models.find(m => m.displayName === displayName);
            if (model) {
              await handleTranslationSettingChange('model', model.name);
            }
          }
        }
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Connection failed',
        details: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleClearCache = async () => {
    await clearCache();
    setTestResult({ success: true, message: 'Translation cache cleared.' });
    setTimeout(() => setTestResult(null), 2000);
  };

  if (!settings) {
    return (
      <div className="app-loading">
        <div className="logo">L</div>
        <p>Loading settings...</p>
      </div>
    );
  }

  const modelOptions = availableModels;
  const currentModel = modelOptions.find(m => m.name === settings.translation.model);

  return (
    <div className="app">
      <header className="header">
        <div className="logo">L</div>
        <div className="header-text">
          <h1 className="title">Lingua Settings</h1>
          <p className="subtitle">Configure PDF translation preferences</p>
        </div>
      </header>

      <main className="main">
        <section className="card">
          <header className="card-header">
            <h2 className="card-title">Gemini API</h2>
          </header>

          <div className="field">
            <label className="label" htmlFor="apiKey">API Key</label>
            <div className="input-wrapper">
              <input
                type="password"
                id="apiKey"
                className="input"
                placeholder="Enter your Gemini API key"
                value={settings.translation.apiKey}
                onChange={(e) => handleTranslationSettingChange('apiKey', e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-icon"
                onClick={handleTestConnection}
                disabled={testing || !settings.translation.apiKey}
                aria-label={testing ? 'Testing connection...' : 'Test API connection'}
              >
                {testing ? (
                  <span className="spinner" aria-hidden="true"></span>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="helper">
              Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="model">Model</label>
            <div className="model-select-wrapper">
              <select
                id="model"
                className="input select"
                value={settings.translation.model}
                onChange={(e) => handleTranslationSettingChange('model', e.target.value)}
                disabled={!modelsLoaded || modelOptions.length === 0}
              >
                {modelOptions.length === 0 && (
                  <option value="">No models available</option>
                )}
                {modelOptions.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.displayName}
                  </option>
                ))}
              </select>
              {!modelsLoaded && (
                <span className="model-hint">Enter API key and click "Test Connection" to fetch available models</span>
              )}
              {modelsLoaded && modelOptions.length === 0 && (
                <span className="model-hint error">No compatible text-generation models available for this API key</span>
              )}
            </div>
          </div>

          <div className="field">
            <div className="btn-group">
              <button
                className="btn btn-primary"
                onClick={handleTestConnection}
                disabled={testing || !settings.translation.apiKey}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleClearCache}
              >
                Clear Cache
              </button>
            </div>
            {testResult && (
              <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                <div className="test-result-main">{testResult.message}</div>
                {testResult.details && (
                  <div className="test-result-details">{testResult.details}</div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h2 className="card-title">Translation</h2>
          </header>

          <div className="field">
            <label className="label">Translation Mode</label>
            <div className="radio-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  value="natural"
                  checked={settings.translation.mode === 'natural'}
                  onChange={() => handleTranslationSettingChange('mode', 'natural')}
                />
                <span className="radio-custom"></span>
                <span>Natural</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  value="technical"
                  checked={settings.translation.mode === 'technical'}
                  onChange={() => handleTranslationSettingChange('mode', 'technical')}
                />
                <span className="radio-custom"></span>
                <span>Technical</span>
              </label>
            </div>
            <p className="helper">
              <strong>Natural:</strong> Fluent, idiomatic Persian.<br />
              <strong>Technical:</strong> Preserves terminology (Kubernetes, API, Linux, etc.) in English.
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="sourceLanguage">Source Language</label>
            <select
              id="sourceLanguage"
              className="input select"
              value={settings.translation.sourceLanguage}
              onChange={(e) => handleTranslationSettingChange('sourceLanguage', e.target.value as 'en')}
              disabled
            >
              <option value="en">English</option>
            </select>
            <p className="helper">More languages coming in future versions</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="targetLanguage">Target Language</label>
            <select
              id="targetLanguage"
              className="input select"
              value={settings.translation.targetLanguage}
              onChange={(e) => handleTranslationSettingChange('targetLanguage', e.target.value as 'fa')}
              disabled
            >
              <option value="fa">Persian (Farsi)</option>
            </select>
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h2 className="card-title">Display</h2>
          </header>

          <div className="field">
            <div className="checkbox-container">
              <input
                type="checkbox"
                id="enabled"
                className="checkbox"
                checked={settings.display.enabled}
                onChange={(e) => handleDisplaySettingChange('enabled', e.target.checked)}
              />
              <label className="label" htmlFor="enabled" style={{ margin: 0, cursor: 'pointer' }}>
                Enable Translation Overlay
              </label>
            </div>
          </div>

          <div className="field">
            <label className="label">Font Size: {settings.display.fontSize}px</label>
            <div className="slider-container">
              <input
                type="range"
                className="slider"
                min="10"
                max="24"
                step="1"
                value={settings.display.fontSize}
                onChange={(e) => handleDisplaySettingChange('fontSize', parseInt(e.target.value, 10))}
              />
              <span className="slider-label">{settings.display.fontSize}px</span>
            </div>
          </div>

          <div className="field">
            <label className="label">Line Height: {settings.display.lineHeight.toFixed(1)}</label>
            <div className="slider-container">
              <input
                type="range"
                className="slider"
                min="1.2"
                max="2.0"
                step="0.1"
                value={settings.display.lineHeight}
                onChange={(e) => handleDisplaySettingChange('lineHeight', parseFloat(e.target.value))}
              />
              <span className="slider-label">{settings.display.lineHeight.toFixed(1)}</span>
            </div>
          </div>

          <div className="field">
            <label className="label">Opacity: {Math.round(settings.display.opacity * 100)}%</label>
            <div className="slider-container">
              <input
                type="range"
                className="slider"
                min="0.3"
                max="1.0"
                step="0.05"
                value={settings.display.opacity}
                onChange={(e) => handleDisplaySettingChange('opacity', parseFloat(e.target.value))}
              />
              <span className="slider-label">{Math.round(settings.display.opacity * 100)}%</span>
            </div>
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h2 className="card-title">Appearance</h2>
          </header>

          <div className="field">
            <label className="label" htmlFor="theme">Theme</label>
            <select
              id="theme"
              className="input select"
              value={settings.ui.theme}
              onChange={(e) => handleUISettingChange('theme', e.target.value as ThemeMode)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
            <p className="helper">Choose your preferred color scheme</p>
          </div>
        </section>
      </main>

      {saveStatus === 'saved' && (
        <div className="toast toast-success">
          Settings saved
        </div>
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Options />);
}
