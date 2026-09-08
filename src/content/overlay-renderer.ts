import { TranslationUnit, DisplaySettings, PageContent, TextBlock } from '../types';
import { getSettings, onSettingsChange } from '../storage/settings';
import { renderBidiText, getBaseDirection } from '../utils/bidi';

export interface RenderedTranslation {
  id: string;
  pageNumber: number;
  textBlockId: string;
  translationElement: HTMLElement;
  sourceElement: HTMLElement | null;
  targetText: string;
}

export class OverlayRenderer {
  private translations: Map<string, RenderedTranslation> = new Map();
  private container: HTMLElement | null = null;
  private settings: DisplaySettings;
  private styleElement: HTMLStyleElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private updateThrottle: number | null = null;
  private isEnabled = true;

  constructor() {
    this.settings = {
      fontSize: 14,
      lineHeight: 1.6,
      opacity: 0.9,
      enabled: true,
    };
    this.loadSettings();
    this.injectStyles();
  }

  private loadSettings(): void {
    getSettings().then(settings => {
      this.settings = settings.display;
      this.isEnabled = settings.display.enabled;
      this.updateStyles();
    });

    onSettingsChange((settings) => {
      this.settings = settings.display;
      this.isEnabled = settings.display.enabled;
      this.updateStyles();
      this.repositionAll();
    });
  }

  private injectStyles(): void {
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'lingua-styles';
    document.head.appendChild(this.styleElement);
    this.updateStyles();
  }

  private updateStyles(): void {
    if (!this.styleElement) return;

    const { fontSize, lineHeight, opacity } = this.settings;
    const rtlStyles = `
      .lingua-translation {
        direction: rtl;
        text-align: right;
        font-family: 'Vazirmatn', 'Tahoma', 'Arial', sans-serif;
        font-size: ${fontSize}px;
        line-height: ${lineHeight};
        color: rgba(0, 0, 0, ${opacity});
        background-color: rgba(255, 255, 240, ${opacity * 0.8});
        border-radius: 4px;
        padding: 4px 8px;
        margin-top: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        white-space: pre-wrap;
        word-wrap: break-word;
        max-width: 100%;
        font-feature-settings: 'kern' 1, 'liga' 1;
        unicode-bidi: plaintext;
      }

      .lingua-translation .lingua-rtl {
        direction: rtl;
        unicode-bidi: embed;
        display: inline;
      }

      .lingua-translation .lingua-ltr {
        direction: ltr;
        unicode-bidi: embed;
        display: inline;
        font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
      }

      .lingua-translation.lingua-hidden {
        display: none !important;
      }

      .lingua-container {
        position: relative;
        pointer-events: none;
        z-index: 10000;
      }

      .lingua-translation.lingua-fade-in {
        animation: linguaFadeIn 0.2s ease-out;
      }

      @keyframes linguaFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @font-face {
        font-family: 'Vazirmatn';
        src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'Vazirmatn';
        src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2');
        font-weight: 500;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: 'JetBrains Mono';
        src: url('https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.0/files/jetbrains-mono-latin-400-normal.woff2') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
    `;

    this.styleElement.textContent = rtlStyles;
  }

  private ensureContainer(): HTMLElement {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }

    this.container = document.createElement('div');
    this.container.id = 'lingua-overlay-container';
    this.container.className = 'lingua-container';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10000;
    `;
    document.body.appendChild(this.container);

    this.setupObservers();
    return this.container;
  }

  private setupObservers(): void {
    if (this.resizeObserver) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.throttledReposition();
    });

    this.resizeObserver.observe(document.body);

    this.mutationObserver = new MutationObserver(() => {
      this.throttledReposition();
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'transform'],
    });

    window.addEventListener('scroll', () => this.throttledReposition(), { passive: true });
    window.addEventListener('resize', () => this.throttledReposition());
  }

  private throttledReposition(): void {
    if (this.updateThrottle) return;
    this.updateThrottle = window.setTimeout(() => {
      this.updateThrottle = null;
      this.repositionAll();
    }, 50);
  }

  renderTranslation(unit: TranslationUnit, pageContent: PageContent, textBlock: TextBlock): void {
    if (!this.isEnabled || !unit.targetText) return;

    const key = `${unit.pageNumber}_${unit.textBlockId}`;
    const existing = this.translations.get(key);

    if (existing && existing.targetText === unit.targetText) {
      this.repositionTranslation(existing, pageContent, textBlock);
      return;
    }

    const translationEl = document.createElement('div');
    translationEl.className = 'lingua-translation lingua-fade-in';
    translationEl.innerHTML = renderBidiText(unit.targetText);
    translationEl.dir = getBaseDirection(unit.targetText);
    translationEl.dataset.linguaKey = key;
    translationEl.style.cssText += `; opacity: 0;`;

    const container = this.ensureContainer();
    container.appendChild(translationEl);

    const sourceEl = this.findSourceElement(pageContent.pageNumber, textBlock);

    const rendered: RenderedTranslation = {
      id: key,
      pageNumber: unit.pageNumber,
      textBlockId: unit.textBlockId,
      translationElement: translationEl,
      sourceElement: sourceEl,
      targetText: unit.targetText,
    };

    this.translations.set(key, rendered);

    requestAnimationFrame(() => {
      this.repositionTranslation(rendered, pageContent, textBlock);
      translationEl.style.opacity = String(this.settings.opacity);
    });
  }

  private findSourceElement(pageNumber: number, textBlock: TextBlock): HTMLElement | null {
    const pageEl = document.querySelector(`[data-page-number="${pageNumber}"], #page${pageNumber}, .page[data-page-number="${pageNumber}"]`);
    if (!pageEl) return null;

    const textLayer = pageEl.querySelector('.textLayer, [data-text-layer]');
    if (!textLayer) return pageEl as HTMLElement;

    const allDivs = textLayer.querySelectorAll('div, span');
    for (const div of Array.from(allDivs)) {
      const text = div.textContent?.trim();
      if (text && textBlock.text.includes(text.substring(0, Math.min(50, text.length)))) {
        return div as HTMLElement;
      }
    }

    return pageEl as HTMLElement;
  }

  private repositionTranslation(
    rendered: RenderedTranslation,
    pageContent: PageContent,
    textBlock: TextBlock
  ): void {
    const { translationElement, sourceElement } = rendered;

    if (!sourceElement || !document.body.contains(sourceElement)) {
      translationElement.style.display = 'none';
      return;
    }

    const sourceRect = sourceElement.getBoundingClientRect();
    const containerRect = this.ensureContainer().getBoundingClientRect();

    const scale = pageContent.viewport.scale || 1;

    const left = sourceRect.left - containerRect.left;
    const top = sourceRect.bottom - containerRect.top + 4;
    const width = Math.min(sourceRect.width, containerRect.width - left - 10);

    translationElement.style.position = 'absolute';
    translationElement.style.left = `${Math.max(0, left)}px`;
    translationElement.style.top = `${Math.max(0, top)}px`;
    translationElement.style.maxWidth = `${width}px`;
    translationElement.style.display = 'block';
  }

  repositionAll(): void {
    if (!this.container) return;

    for (const [key, rendered] of this.translations) {
      const [pageStr, blockId] = key.split('_', 2);
      const pageNumber = parseInt(pageStr, 10);



      if (rendered.sourceElement && document.body.contains(rendered.sourceElement)) {
        const sourceRect = rendered.sourceElement.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        rendered.translationElement.style.left = `${sourceRect.left - containerRect.left}px`;
        rendered.translationElement.style.top = `${sourceRect.bottom - containerRect.top + 4}px`;
        rendered.translationElement.style.maxWidth = `${Math.min(sourceRect.width, containerRect.width - (sourceRect.left - containerRect.left) - 10)}px`;
      }
    }
  }

  updateTranslation(unit: TranslationUnit): void {
    const key = `${unit.pageNumber}_${unit.textBlockId}`;
    const rendered = this.translations.get(key);

    if (rendered && rendered.targetText !== unit.targetText) {
      rendered.targetText = unit.targetText;
      rendered.translationElement.innerHTML = renderBidiText(unit.targetText);
      rendered.translationElement.dir = getBaseDirection(unit.targetText);
      rendered.translationElement.classList.add('lingua-fade-in');
      setTimeout(() => rendered.translationElement.classList.remove('lingua-fade-in'), 200);
    }
  }

  removeTranslation(pageNumber: number, textBlockId: string): void {
    const key = `${pageNumber}_${textBlockId}`;
    const rendered = this.translations.get(key);
    if (rendered) {
      rendered.translationElement.remove();
      this.translations.delete(key);
    }
  }

  clearAll(): void {
    for (const rendered of this.translations.values()) {
      rendered.translationElement.remove();
    }
    this.translations.clear();
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    for (const rendered of this.translations.values()) {
      if (enabled) {
        rendered.translationElement.classList.remove('lingua-hidden');
      } else {
        rendered.translationElement.classList.add('lingua-hidden');
      }
    }
  }

  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.updateThrottle) {
      clearTimeout(this.updateThrottle);
      this.updateThrottle = null;
    }
    this.clearAll();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}

export const overlayRenderer = new OverlayRenderer();
