import { TranslationProvider } from '../types';
import { TranslationRequest, TranslationResponse, TranslationUnit, PrefetchStrategy, ConnectionTestResult } from '../types';
import { translationCache } from './translation-cache';
import { GeminiProvider } from './gemini-provider';
import { getSettings } from '../storage/settings';

export class TranslationManager {
  private provider: TranslationProvider | null = null;
  private pendingTranslations: Map<string, Promise<TranslationResponse>> = new Map();
  private translationUnits: Map<string, TranslationUnit> = new Map();
  private prefetchQueue: string[] = [];
  private isProcessingPrefetch = false;
  private maxConcurrent = 3;
  private activeRequests = 0;
  
  async initialize(): Promise<void> {
    const settings = await getSettings();
    if (settings.translation.apiKey) {
      this.provider = new GeminiProvider(settings.translation.apiKey, settings.translation.model);
    }
    await translationCache.initialize();
  }
  
  setProvider(provider: TranslationProvider): void {
    this.provider = provider;
  }
  
  async updateConfig(apiKey: string, model: string): Promise<void> {
    if (this.provider instanceof GeminiProvider) {
      this.provider.setConfig(apiKey, model);
    } else {
      this.provider = new GeminiProvider(apiKey, model);
    }
  }
  
  private createTranslationUnitId(pageNumber: number, textBlockId: string): string {
    return `unit_${pageNumber}_${textBlockId}`;
  }
  
  async translateText(
    text: string,
    pageNumber: number,
    textBlockId: string,
    sourceLanguage: string,
    targetLanguage: string,
    mode: 'natural' | 'technical',
    context?: string
  ): Promise<TranslationResponse> {
    const unitId = this.createTranslationUnitId(pageNumber, textBlockId);
    
    const cached = await translationCache.get({
      text,
      sourceLanguage,
      targetLanguage,
      mode,
    });
    if (cached) {
      return { translatedText: cached, success: true };
    }
    
    const existing = this.pendingTranslations.get(unitId);
    if (existing) {
      return existing;
    }
    
    if (!this.provider) {
      return { translatedText: '', success: false, error: 'Translation provider not configured' };
    }
    
    const request: TranslationRequest = {
      text,
      sourceLanguage,
      targetLanguage,
      mode,
      context,
    };
    
    const promise = this.executeTranslation(unitId, request, pageNumber, textBlockId);
    this.pendingTranslations.set(unitId, promise);
    
    try {
      const result = await promise;
      if (result.success) {
        await translationCache.set(request, result.translatedText);
      }
      return result;
    } finally {
      this.pendingTranslations.delete(unitId);
    }
  }
  
  private async executeTranslation(
    unitId: string,
    request: TranslationRequest,
    pageNumber: number,
    textBlockId: string
  ): Promise<TranslationResponse> {
    this.translationUnits.set(unitId, {
      id: unitId,
      sourceText: request.text,
      targetText: '',
      pageNumber,
      textBlockId,
      status: 'translating',
      timestamp: Date.now(),
    });
    
    this.activeRequests++;
    
    try {
      const result = await this.provider!.translate(request);
      
      this.translationUnits.set(unitId, {
        id: unitId,
        sourceText: request.text,
        targetText: result.translatedText,
        pageNumber,
        textBlockId,
        status: result.success ? 'completed' : 'failed',
        timestamp: Date.now(),
      });
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.translationUnits.set(unitId, {
        id: unitId,
        sourceText: request.text,
        targetText: '',
        pageNumber,
        textBlockId,
        status: 'failed',
        timestamp: Date.now(),
      });
      return { translatedText: '', success: false, error: errorMessage };
    } finally {
      this.activeRequests--;
      this.processPrefetchQueue();
    }
  }
  
  async prefetch(
    translations: Array<{
      text: string;
      pageNumber: number;
      textBlockId: string;
      sourceLanguage: string;
      targetLanguage: string;
      mode: 'natural' | 'technical';
      priority: number;
    }>
  ): Promise<void> {
    const sorted = [...translations].sort((a, b) => a.priority - b.priority);
    
    for (const t of sorted) {
      const unitId = this.createTranslationUnitId(t.pageNumber, t.textBlockId);
      if (this.translationUnits.has(unitId) || this.pendingTranslations.has(unitId)) {
        continue;
      }
      
      const cached = await translationCache.get({
        text: t.text,
        sourceLanguage: t.sourceLanguage,
        targetLanguage: t.targetLanguage,
        mode: t.mode,
      });
      if (cached) continue;
      
      this.prefetchQueue.push(unitId);
      
      const request: TranslationRequest = {
        text: t.text,
        sourceLanguage: t.sourceLanguage,
        targetLanguage: t.targetLanguage,
        mode: t.mode,
      };
      
      const promise = this.executeTranslation(unitId, request, t.pageNumber, t.textBlockId);
      this.pendingTranslations.set(unitId, promise);
      
      if (this.activeRequests >= this.maxConcurrent) {
        await Promise.race(this.pendingTranslations.values());
      }
    }
  }
  
  private processPrefetchQueue(): void {
    if (this.isProcessingPrefetch || this.activeRequests >= this.maxConcurrent || this.prefetchQueue.length === 0) {
      return;
    }
    this.isProcessingPrefetch = true;
    
    while (this.prefetchQueue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const unitId = this.prefetchQueue.shift()!;
      const pending = this.pendingTranslations.get(unitId);
      if (pending) {
        pending.finally(() => {
          this.processPrefetchQueue();
        });
      }
    }
    
    this.isProcessingPrefetch = false;
  }
  
  getTranslationUnit(pageNumber: number, textBlockId: string): TranslationUnit | undefined {
    const unitId = this.createTranslationUnitId(pageNumber, textBlockId);
    return this.translationUnits.get(unitId);
  }
  
  getAllTranslationUnits(): TranslationUnit[] {
    return Array.from(this.translationUnits.values());
  }
  
  clearTranslations(): void {
    this.translationUnits.clear();
    this.pendingTranslations.clear();
    this.prefetchQueue = [];
  }
  
  isProviderConfigured(): boolean {
    return this.provider !== null;
  }
  
  async testProvider(apiKey: string, model: string): Promise<ConnectionTestResult> {
    const provider = new GeminiProvider(apiKey, model);
    const result = await provider.testConnection({ apiKey, model });
    
    if (result.success) {
      this.provider = provider;
    }
    
    return result;
  }
}

export const translationManager = new TranslationManager();