import { pdfDetector } from './pdf-detector';
import { pdfReader } from './pdf-reader';
import { textSegmenter, TranslationSegment } from './text-segmenter';
import { overlayRenderer } from './overlay-renderer';
import { translationManager } from '../translation';
import { getSettings, onSettingsChange } from '../storage/settings';
import { TranslationUnit, PageContent, TextBlock } from '../types';

class ContentScript {
  private isInitialized = false;
  private isProcessing = false;
  private currentPageSegments: Map<number, TranslationSegment[]> = new Map();
  private processedUnits: Set<string> = new Set();
  private prefetchPages: Set<number> = new Set();
  private settings!: ReturnType<typeof getSettings> extends Promise<infer T> ? T : never;
  private cleanupFns: (() => void)[] = [];
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    this.settings = await getSettings();
    this.isInitialized = true;
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'START_TRANSLATION') {
        this.handleStartTranslation();
        sendResponse({ success: true });
      }
      return true;
    });
    
    const info = pdfDetector.getCurrentInfo();
    if (!info.isPDFViewer) return;
    
    await this.setupPDFTranslation();
    this.setupSettingsListener();
    this.setupPDFDetectorListener();
  }
  
  private async handleStartTranslation(): Promise<void> {
    const info = pdfDetector.getCurrentInfo();
    if (!info.isPDFViewer) {
      return;
    }
    
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    await this.processVisiblePages();
  }
  
  private async setupPDFTranslation(): Promise<void> {
    const document = await pdfReader.initialize();
    if (!document) return;
    
    if (document.isScanned) {
      this.showScannedPDFNotice();
      return;
    }
    
    await translationManager.initialize();
    
    if (!translationManager.isProviderConfigured()) {
      this.showAPIKeyNotice();
      return;
    }
    
    this.processVisiblePages();
    this.setupPageChangeListener();
    this.setupScrollListener();
  }
  
  private async processVisiblePages(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      const visiblePages = pdfReader.getVisiblePages();
      
      for (const pageNumber of visiblePages) {
        await this.processPage(pageNumber);
      }
      
      this.schedulePrefetch(visiblePages);
    } finally {
      this.isProcessing = false;
    }
  }
  
  private async processPage(pageNumber: number): Promise<void> {
    const pageContent = pdfReader.getPage(pageNumber);
    if (!pageContent || pageContent.textBlocks.length === 0) return;
    
    const segments = textSegmenter.segmentPage(pageContent);
    this.currentPageSegments.set(pageNumber, segments);
    
    for (const segment of segments) {
      const unitId = `${segment.pageNumber}_${segment.textBlockId}_${segment.id}`;
      if (this.processedUnits.has(unitId)) continue;
      
      const existingUnit = translationManager.getTranslationUnit(segment.pageNumber, segment.textBlockId);
      if (existingUnit && existingUnit.targetText) {
        overlayRenderer.renderTranslation(existingUnit, pageContent, this.findTextBlock(pageContent, segment.textBlockId));
        this.processedUnits.add(unitId);
        continue;
      }
      
      const context = textSegmenter.getContextForSegment(segment, segments);
      
      const result = await translationManager.translateText(
        segment.text,
        segment.pageNumber,
        segment.textBlockId,
        this.settings.translation.sourceLanguage,
        this.settings.translation.targetLanguage,
        this.settings.translation.mode,
        context
      );
      
      if (result.success) {
        const unit = translationManager.getTranslationUnit(segment.pageNumber, segment.textBlockId);
        if (unit) {
          overlayRenderer.renderTranslation(unit, pageContent, this.findTextBlock(pageContent, segment.textBlockId));
        }
        this.processedUnits.add(unitId);
      }
    }
  }
  
  private findTextBlock(pageContent: PageContent, textBlockId: string): TextBlock {
    return pageContent.textBlocks.find(b => b.id === textBlockId) || pageContent.textBlocks[0];
  }
  
  private schedulePrefetch(currentPages: number[]): void {
    const document = pdfReader.getDocument();
    if (!document) return;
    
    const allPages = Array.from(document.pages.keys()).sort((a, b) => a - b);
    const currentMax = Math.max(...currentPages);
    
    const nextPages = allPages.filter(p => p > currentMax && p <= currentMax + 3);
    
    const prefetchItems: Array<{
      text: string;
      pageNumber: number;
      textBlockId: string;
      sourceLanguage: string;
      targetLanguage: string;
      mode: 'natural' | 'technical';
      priority: number;
    }> = [];
    
    for (const pageNumber of nextPages) {
      if (this.prefetchPages.has(pageNumber)) continue;
      
      const pageContent = document.pages.get(pageNumber);
      if (!pageContent) continue;
      
      const segments = textSegmenter.segmentPage(pageContent);
      
      for (let i = 0; i < Math.min(segments.length, 5); i++) {
        const segment = segments[i];
        prefetchItems.push({
          text: segment.text,
          pageNumber: segment.pageNumber,
          textBlockId: segment.textBlockId,
          sourceLanguage: this.settings.translation.sourceLanguage,
          targetLanguage: this.settings.translation.targetLanguage,
          mode: this.settings.translation.mode,
          priority: segment.priority + (pageNumber - currentMax) * 100,
        });
      }
      
      this.prefetchPages.add(pageNumber);
    }
    
    if (prefetchItems.length > 0) {
      translationManager.prefetch(prefetchItems);
    }
  }
  
  private setupPageChangeListener(): void {
    const cleanup = pdfReader.onPageChange((pageNumber) => {
      if (!this.processedUnits.has(`page_${pageNumber}`)) {
        this.processPage(pageNumber);
        this.processedUnits.add(`page_${pageNumber}`);
      }
    });
    this.cleanupFns.push(cleanup);
  }
  
  private setupScrollListener(): void {
    const cleanup = pdfReader.onScroll(() => {
      this.processVisiblePages();
    });
    this.cleanupFns.push(cleanup);
  }
  
  private setupSettingsListener(): void {
    const cleanup = onSettingsChange((settings) => {
      this.settings = settings;
      overlayRenderer.setEnabled(settings.display.enabled);
      
      if (settings.translation.apiKey && translationManager.isProviderConfigured()) {
        translationManager.updateConfig(settings.translation.apiKey, settings.translation.model);
      }
    });
    this.cleanupFns.push(cleanup);
  }
  
  private setupPDFDetectorListener(): void {
    const cleanup = pdfDetector.onChange((info) => {
      if (info.isPDFViewer && !this.isInitialized) {
        this.initialize();
      } else if (!info.isPDFViewer) {
        this.cleanupAll();
      }
    });
    this.cleanupFns.push(cleanup);
  }
  
  private showScannedPDFNotice(): void {
    const notice = document.createElement('div');
    notice.id = 'lingua-scanned-notice';
    notice.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 8px;
      padding: 16px 20px;
      max-width: 350px;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      direction: ltr;
    `;
    notice.innerHTML = `
      <strong>Lingua: Scanned PDF Detected</strong>
      <p style="margin: 8px 0 0; color: #666; font-size: 14px;">
        This PDF appears to be scanned or image-based with no extractable text. 
        OCR support is planned for a future version.
      </p>
    `;
    document.body.appendChild(notice);
    
    setTimeout(() => notice.remove(), 10000);
  }
  
  private showAPIKeyNotice(): void {
    const notice = document.createElement('div');
    notice.id = 'lingua-apikey-notice';
    notice.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      border-radius: 8px;
      padding: 16px 20px;
      max-width: 350px;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      direction: ltr;
    `;
    notice.innerHTML = `
      <strong>Lingua: API Key Required</strong>
      <p style="margin: 8px 0 0; color: #666; font-size: 14px;">
        Please configure your Gemini API key in the extension settings to enable translation.
      </p>
    `;
    document.body.appendChild(notice);
  }
  
  private cleanupAll(): void {
    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns = [];
    pdfReader.destroy();
    overlayRenderer.destroy();
    translationManager.clearTranslations();
    this.currentPageSegments.clear();
    this.processedUnits.clear();
    this.prefetchPages.clear();
    this.isInitialized = false;
  }
  
  destroy(): void {
    this.cleanupAll();
  }
}

const contentScript = new ContentScript();

// Do NOT initialize on our own custom viewer page — it has its own translation system
if (window.location.href.includes('/src/viewer/index.html')) {
  // Skip initialization entirely
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => contentScript.initialize());
} else {
  contentScript.initialize();
}

(window as any).__LINGUA_CONTENT_SCRIPT__ = contentScript;

export { contentScript };