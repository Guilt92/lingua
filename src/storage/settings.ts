import { Settings, TranslationSettings, DisplaySettings, UISettings, ThemeMode } from '../types';

const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  apiKey: '',
  model: 'gemini-1.5-flash',
  sourceLanguage: 'en',
  targetLanguage: 'fa',
  mode: 'technical',
};

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  fontSize: 14,
  lineHeight: 1.6,
  opacity: 0.9,
  enabled: true,
};

const DEFAULT_UI_SETTINGS: UISettings = {
  theme: 'system',
};

export const DEFAULT_SETTINGS: Settings = {
  translation: DEFAULT_TRANSLATION_SETTINGS,
  display: DEFAULT_DISPLAY_SETTINGS,
  ui: DEFAULT_UI_SETTINGS,
};

const SETTINGS_KEY = 'lingua_settings';
const CACHE_KEY = 'lingua_translation_cache';

export async function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      const stored = result[SETTINGS_KEY];
      if (stored) {
        resolve({ ...DEFAULT_SETTINGS, ...stored });
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    });
  });
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      const current = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
      const updated = { ...current, ...settings };
      chrome.storage.sync.set({ [SETTINGS_KEY]: updated }, () => resolve());
    });
  });
}

export async function saveTranslationSettings(settings: Partial<TranslationSettings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      const current = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
      const updated = {
        ...current,
        translation: { ...current.translation, ...settings },
      };
      chrome.storage.sync.set({ [SETTINGS_KEY]: updated }, () => resolve());
    });
  });
}

export async function saveDisplaySettings(settings: Partial<DisplaySettings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      const current = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
      const updated = {
        ...current,
        display: { ...current.display, ...settings },
      };
      chrome.storage.sync.set({ [SETTINGS_KEY]: updated }, () => resolve());
    });
  });
}

export async function saveUISettings(settings: Partial<UISettings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (result) => {
      const current = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
      const updated = {
        ...current,
        ui: { ...current.ui, ...settings },
      };
      chrome.storage.sync.set({ [SETTINGS_KEY]: updated }, () => resolve());
    });
  });
}

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function getEffectiveTheme(themeMode: ThemeMode): 'light' | 'dark' {
  if (themeMode === 'system') {
    return getSystemTheme();
  }
  return themeMode;
}

export async function getCache(): Promise<Record<string, { targetText: string; timestamp: number }>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_KEY, (result) => {
      resolve(result[CACHE_KEY] || {});
    });
  });
}

export async function setCacheEntry(key: string, targetText: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_KEY, (result) => {
      const cache = result[CACHE_KEY] || {};
      cache[key] = { targetText, timestamp: Date.now() };
      chrome.storage.local.set({ [CACHE_KEY]: cache }, () => resolve());
    });
  });
}

export async function clearCache(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(CACHE_KEY, () => resolve());
  });
}

export function generateCacheKey(text: string, sourceLang: string, targetLang: string, mode: string): string {
  const str = `${sourceLang}|${targetLang}|${mode}|${text}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `cache_${Math.abs(hash).toString(36)}`;
}

export function onSettingsChange(callback: (settings: Settings) => void): () => void {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes[SETTINGS_KEY]) {
      const newSettings = { ...DEFAULT_SETTINGS, ...changes[SETTINGS_KEY].newValue };
      callback(newSettings);
    }
  });
  return () => {};
}