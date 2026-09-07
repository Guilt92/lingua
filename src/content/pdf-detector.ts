export interface PDFViewerInfo {
  isPDFViewer: boolean;
  viewerType: 'native' | 'pdfjs' | 'custom' | 'unknown';
  pdfUrl: string | null;
  iframeElement: HTMLIFrameElement | null;
}

export class PDFDetector {
  private static instance: PDFDetector;
  private observer: MutationObserver | null = null;
  private currentInfo: PDFViewerInfo = {
    isPDFViewer: false,
    viewerType: 'unknown',
    pdfUrl: null,
    iframeElement: null,
  };
  private callbacks: Set<(info: PDFViewerInfo) => void> = new Set();
  
  static getInstance(): PDFDetector {
    if (!PDFDetector.instance) {
      PDFDetector.instance = new PDFDetector();
    }
    return PDFDetector.instance;
  }
  
  detect(): PDFViewerInfo {
    return this.analyzeCurrentPage();
  }
  
  private analyzeCurrentPage(): PDFViewerInfo {
    const url = window.location.href;
    
    // Our custom viewer
    if (url.includes('/src/viewer/index.html')) {
      return {
        isPDFViewer: true,
        viewerType: 'custom',
        pdfUrl: this.extractFileFromViewerUrl(url),
        iframeElement: null,
      };
    }
    
    // Chrome's built-in PDF viewer URL pattern
    if (url.startsWith('chrome-extension://') && url.includes('/pdfjs/web/viewer.html')) {
      return {
        isPDFViewer: true,
        viewerType: 'pdfjs',
        pdfUrl: this.extractFileFromViewerUrl(url),
        iframeElement: null,
      };
    }
    
    // Standard PDF URL patterns
    if (url.endsWith('.pdf') || url.includes('.pdf?') || url.includes('.pdf#')) {
      return {
        isPDFViewer: true,
        viewerType: 'native',
        pdfUrl: url,
        iframeElement: null,
      };
    }
    
    // Check for PDF embed/object elements
    const pdfViewer = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
    if (pdfViewer) {
      return {
        isPDFViewer: true,
        viewerType: 'native',
        pdfUrl: (pdfViewer as HTMLElement).getAttribute('src') || url,
        iframeElement: null,
      };
    }
    
    // Check for PDF iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of Array.from(iframes)) {
      try {
        const src = iframe.src;
        if (src && (src.endsWith('.pdf') || src.includes('.pdf?') || src.includes('.pdf#'))) {
          return {
            isPDFViewer: true,
            viewerType: 'native',
            pdfUrl: src,
            iframeElement: iframe,
          };
        }
      } catch {
        // Ignore cross-origin iframe access errors
      }
    }
    
    // Check for PDF.js viewer elements
    if (document.querySelector('#viewer, .pdfViewer, [data-pdfjs-viewer], #viewerContainer')) {
      return {
        isPDFViewer: true,
        viewerType: 'pdfjs',
        pdfUrl: url,
        iframeElement: null,
      };
    }
    
    return {
      isPDFViewer: false,
      viewerType: 'unknown',
      pdfUrl: null,
      iframeElement: null,
    };
  }
  
  private extractFileFromViewerUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const fileParam = urlObj.searchParams.get('file');
      if (fileParam) {
        return decodeURIComponent(fileParam);
      }
    } catch {
      // Ignore URL parsing errors
    }
    return url;
  }
  
  onChange(callback: (info: PDFViewerInfo) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  
  private notifyChange(): void {
    const info = this.analyzeCurrentPage();
    if (info.isPDFViewer !== this.currentInfo.isPDFViewer || 
        info.pdfUrl !== this.currentInfo.pdfUrl ||
        info.viewerType !== this.currentInfo.viewerType) {
      this.currentInfo = info;
      this.callbacks.forEach(cb => cb(info));
    }
  }
  
  startWatching(): void {
    if (this.observer) return;
    
    this.observer = new MutationObserver(() => {
      this.notifyChange();
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'type'],
    });
    
    this.notifyChange();
  }
  
  stopWatching(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
  
  getCurrentInfo(): PDFViewerInfo {
    return { ...this.currentInfo };
  }
  
  isInPDFViewer(): boolean {
    return this.currentInfo.isPDFViewer;
  }
}

export const pdfDetector = PDFDetector.getInstance();
