import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { getSettings, saveTranslationSettings, saveDisplaySettings, clearCache } from '../storage/settings';
import { translationManager } from '../translation';
import { Settings, TranslationSettings, DisplaySettings } from '../types';

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  useEffect(() => {
    loadSettings();
  }, []);
  
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
    
    try {
      const success = await translationManager.testProvider(
        settings.translation.apiKey,
        settings.translation.model
      );
      setTestResult({
        success,
        message: success ? 'Connection successful!' : 'Connection failed. Check your API key and model.',
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
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
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="logo">L</div>
        <p style={{ marginTop: '12px', color: '#5f6368' }}>Loading settings...</p>
      </div>
    );
  }
  
  return (
    <div>
      <div className="header">
        <div className="logo">L</div>
        <div>
          <div className="title">Lingua Settings</div>
          <div className="subtitle">Configure PDF translation preferences</div>
        </div>
      </div>
      
      <div className="card">
        <div className="card-title">Gemini API</div>
        
        <div className="field">
          <label className="label">API Key</label>
          <input
            type="password"
            className="input"
            placeholder="Enter your Gemini API key"
            value={settings.translation.apiKey}
            onChange={(e) => handleTranslationSettingChange('apiKey', e.target.value)}
            autoComplete="off"
          />
          <div className="helper">
            Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>
          </div>
        </div>
        
        <div className="field">
          <label className="label">Model</label>
          <select
            className="input select"
            value={settings.translation.model}
            onChange={(e) => handleTranslationSettingChange('model', e.target.value)}
          >
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast, Free)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Higher Quality)</option>
            <option value="gemini-1.0-pro">Gemini 1.0 Pro</option>
          </select>
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
          <div className={`test-result ${testResult ? 'visible' : ''} ${testResult?.success ? 'success' : 'error'}`}>
            {testResult?.message}
          </div>
        </div>
      </div>
      
      <div className="card">
        <div className="card-title">Translation</div>
        
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
              <span>Technical</span>
            </label>
          </div>
          <div className="helper">
            <strong>Natural:</strong> Fluent, idiomatic Persian.<br />
            <strong>Technical:</strong> Preserves terminology (Kubernetes, API, Linux, etc.) in English.
          </div>
        </div>
        
        <div className="field">
          <label className="label">Source Language</label>
          <select
            className="input select"
            value={settings.translation.sourceLanguage}
            onChange={(e) => handleTranslationSettingChange('sourceLanguage', e.target.value as 'en')}
            disabled
          >
            <option value="en">English</option>
          </select>
          <div className="helper">More languages coming in future versions</div>
        </div>
        
        <div className="field">
          <label className="label">Target Language</label>
          <select
            className="input select"
            value={settings.translation.targetLanguage}
            onChange={(e) => handleTranslationSettingChange('targetLanguage', e.target.value as 'fa')}
            disabled
          >
            <option value="fa">Persian (Farsi)</option>
          </select>
        </div>
      </div>
      
      <div className="card">
        <div className="card-title">Display</div>
        
        <div className="field">
          <div className="checkbox-container">
            <input
              type="checkbox"
              className="checkbox"
              checked={settings.display.enabled}
              onChange={(e) => handleDisplaySettingChange('enabled', e.target.checked)}
            />
            <label className="label" style={{ margin: 0, cursor: 'pointer' }}>
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
      </div>
      
      {saveStatus === 'saved' && (
        <div style={{ 
          position: 'fixed', 
          bottom: 20, 
          right: 20, 
          background: '#137333', 
          color: 'white', 
          padding: '10px 16px', 
          borderRadius: 6,
          fontSize: 13,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
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