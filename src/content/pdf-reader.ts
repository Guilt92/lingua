import { PDFDocument, PageContent, TextBlock, TextLine } from '../types';
import { pdfDetector } from './pdf-detector';

interface PDFTextLayer {
  pageNumber: number;
  viewport: { width: number; height: number; scale: number };
  textDivs: HTMLDivElement[];
}

export class PDFReader {
  private currentDocument: PDFDocument | null = null;
  private textLayers: Map<number, PDFTextLayer> = new Map();
  private pageChangeCallbacks: Set<(page: number) => void> = new Set();
  private scrollCallbacks: Set<() => void> = new Set();
  private observer: MutationObserver | null = null;
  private lastScrollY = 0;
  private scrollCheckInterval: number | null = null;
  
  async initialize(): Promise<PDFDocument | null> {
    const info = pdfDetector.getCurrentInfo();
    if (!info.isPDFViewer) return null;
    
    this.currentDocument = {
      url: info.pdfUrl || window.location.href,
      pageCount: 0,
      pages: new Map(),
      isScanned: false,
    };
    
    await this.waitForPDFViewer();
    await this.extractDocument();
    this.setupObservers();
    
    return this.currentDocument;
  }
  
  private async waitForPDFViewer(maxWait = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (this.isPDFViewerReady()) {
        await new Promise(r => setTimeout(r, 500));
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  private isPDFViewerReady(): boolean {
    const viewer = document.querySelector('#viewer, .pdfViewer, .pdf-page');
    return !!viewer;
  }
  
  private async extractDocument(): Promise<void> {
    if (!this.currentDocument) return;
    
    const pages = document.querySelectorAll('.page, [data-page-number], .pdf-page');
    let pageCount = 0;
    let hasExtractableText = false;
    
    for (const pageEl of Array.from(pages)) {
      const pageNumber = this.getPageNumber(pageEl);
      if (pageNumber === null) continue;
      
      const pageContent = await this.extractPage(pageEl, pageNumber);
      if (pageContent.textBlocks.length > 0) {
        hasExtractableText = true;
      }
      
      this.currentDocument.pages.set(pageNumber, pageContent);
      pageCount = Math.max(pageCount, pageNumber);
    }
    
    this.currentDocument.pageCount = pageCount;
    this.currentDocument.isScanned = !hasExtractableText;
  }
  
  private getPageNumber(pageEl: Element): number | null {
    const pageNum = pageEl.getAttribute('data-page-number') || 
                    pageEl.getAttribute('page-number') ||
                    pageEl.id.match(/page[_-]?(\d+)/i)?.[1];
    return pageNum ? parseInt(pageNum, 10) : null;
  }
  
  private async extractPage(pageEl: Element, pageNumber: number): Promise<PageContent> {
    const viewport = this.getViewport(pageEl);
    const textBlocks: TextBlock[] = [];
    
    const textLayer = pageEl.querySelector('.textLayer, [data-text-layer]');
    if (textLayer) {
      const divs = textLayer.querySelectorAll('div, span');
      let blockId = 0;
      
      for (const div of Array.from(divs)) {
        const text = div.textContent?.trim();
        if (!text || text.length < 2) continue;
        
        const rect = div.getBoundingClientRect();
        const pageRect = pageEl.getBoundingClientRect();
        
        const lines: TextLine[] = [{
          text,
          bbox: {
            x: rect.left - pageRect.left,
            y: rect.top - pageRect.top,
            width: rect.width,
            height: rect.height,
          },
        }];
        
        textBlocks.push({
          id: `block_${pageNumber}_${blockId++}`,
          pageNumber,
          text,
          bbox: {
            x: rect.left - pageRect.left,
            y: rect.top - pageRect.top,
            width: rect.width,
            height: rect.height,
          },
          lines,
        });
      }
    } else {
      const textContent = pageEl.textContent?.trim();
      if (textContent && textContent.length > 10) {
        const rect = pageEl.getBoundingClientRect();
        textBlocks.push({
          id: `block_${pageNumber}_full`,
          pageNumber,
          text: textContent,
          bbox: { x: 0, y: 0, width: rect.width, height: rect.height },
          lines: [{
            text: textContent,
            bbox: { x: 0, y: 0, width: rect.width, height: rect.height },
          }],
        });
      }
    }
    
    this.textLayers.set(pageNumber, {
      pageNumber,
      viewport,
      textDivs: Array.from(pageEl.querySelectorAll('.textLayer div, .textLayer span')) as HTMLDivElement[],
    });
    
    return { pageNumber, viewport, textBlocks };
  }
  
  private getViewport(pageEl: Element): PageContent['viewport'] {
    const rect = pageEl.getBoundingClientRect();
    const style = getComputedStyle(pageEl);
    const transform = style.transform;
    let scale = 1;
    
    if (transform && transform !== 'none') {
      const matrix = new DOMMatrix(transform);
      scale = matrix.a;
    }
    
    return {
      width: rect.width / scale,
      height: rect.height / scale,
      scale,
    };
  }
  
  private setupObservers(): void {
    this.observer = new MutationObserver((mutations) => {
      let shouldReextract = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              if (el.matches('.page, [data-page-number], .pdf-page') || 
                  el.querySelector('.page, [data-page-number], .pdf-page')) {
                shouldReextract = true;
                break;
              }
            }
          }
        }
      }
      if (shouldReextract) {
        this.extractDocument();
      }
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    this.scrollCheckInterval = window.setInterval(() => {
      const scrollY = window.scrollY;
      if (Math.abs(scrollY - this.lastScrollY) > 50) {
        this.lastScrollY = scrollY;
        this.scrollCallbacks.forEach(cb => cb());
        this.checkVisiblePages();
      }
    }, 200);
  }
  
  private checkVisiblePages(): void {
    if (!this.currentDocument) return;
    
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    
    for (const [pageNumber, pageContent] of this.currentDocument.pages) {
      const pageEl = document.querySelector(`[data-page-number="${pageNumber}"], #page${pageNumber}, .page[data-page-number="${pageNumber}"]`);
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        const isVisible = rect.bottom > 0 && rect.top < viewportHeight;
        
        if (isVisible) {
          this.pageChangeCallbacks.forEach(cb => cb(pageNumber));
        }
      }
    }
  }
  
  getDocument(): PDFDocument | null {
    return this.currentDocument;
  }
  
  getPage(pageNumber: number): PageContent | undefined {
    return this.currentDocument?.pages.get(pageNumber);
  }
  
  getVisiblePages(): number[] {
    if (!this.currentDocument) return [];
    
    const visible: number[] = [];
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    
    for (const [pageNumber] of this.currentDocument.pages) {
      const pageEl = document.querySelector(`[data-page-number="${pageNumber}"], #page${pageNumber}, .page[data-page-number="${pageNumber}"]`);
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < viewportHeight) {
          visible.push(pageNumber);
        }
      }
    }
    
    return visible;
  }
  
  onPageChange(callback: (page: number) => void): () => void {
    this.pageChangeCallbacks.add(callback);
    return () => this.pageChangeCallbacks.delete(callback);
  }
  
  onScroll(callback: () => void): () => void {
    this.scrollCallbacks.add(callback);
    return () => this.scrollCallbacks.delete(callback);
  }
  
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scrollCheckInterval) {
      clearInterval(this.scrollCheckInterval);
      this.scrollCheckInterval = null;
    }
    this.currentDocument = null;
    this.textLayers.clear();
    this.pageChangeCallbacks.clear();
    this.scrollCallbacks.clear();
  }
}

export const pdfReader = new PDFReader();