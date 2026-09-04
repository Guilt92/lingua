import { CacheEntry, TranslationRequest } from '../types';
import { getCache, setCacheEntry, generateCacheKey, clearCache } from '../storage/settings';

export class TranslationCache {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private initialized = false;
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const stored = await getCache();
    for (const [key, value] of Object.entries(stored)) {
      this.memoryCache.set(key, {
        sourceText: '',
        targetText: value.targetText,
        sourceLanguage: '',
        targetLanguage: '',
        mode: '',
        timestamp: value.timestamp,
      });
    }
    this.initialized = true;
  }
  
  private getKey(request: TranslationRequest): string {
    return generateCacheKey(request.text, request.sourceLanguage, request.targetLanguage, request.mode);
  }
  
  async get(request: TranslationRequest): Promise<string | null> {
    await this.initialize();
    const key = this.getKey(request);
    const entry = this.memoryCache.get(key);
    if (entry) {
      return entry.targetText;
    }
    return null;
  }
  
  async set(request: TranslationRequest, targetText: string): Promise<void> {
    await this.initialize();
    const key = this.getKey(request);
    const entry: CacheEntry = {
      sourceText: request.text,
      targetText,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      mode: request.mode,
      timestamp: Date.now(),
    };
    this.memoryCache.set(key, entry);
    await setCacheEntry(key, targetText);
  }
  
  async clear(): Promise<void> {
    this.memoryCache.clear();
    await clearCache();
  }
  
  getStats(): { size: number; memorySize: number } {
    return {
      size: this.memoryCache.size,
      memorySize: this.memoryCache.size,
    };
  }
}

export const translationCache = new TranslationCache();