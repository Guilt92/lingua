import * as pdfjsLib from 'pdfjs-dist';
import { getCache, setCacheEntry } from '../storage/settings';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString();

let pdfDoc: any = null;
let currentPage = 1;
let totalPages = 0;
let currentScale = 1.5;
let isTranslating = false;
let translationMode = false;
let renderedPages = new Map<number, HTMLElement>();
let translationCache = new Map<string, string>();
let pendingRequests = new Set<string>();
let splitRatio = 50;
let isDragging = false;
let translationGeneration = 0;
let docUrl = '';
let translatingPage: number | null = null;
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT = 45000;

const $ = (id: string) => document.getElementById(id)!;
const pdfPanel = $('pdf-panel') as HTMLElement;
const pdfPages = $('pdf-pages') as HTMLElement;
const dividerEl = $('divider') as HTMLElement;
const transPanel = $('translation-panel') as HTMLElement;
const transPages = $('translation-pages') as HTMLElement;
const loadingEl = $('loading') as HTMLElement;
const errorEl = $('error') as HTMLElement;
const errorText = $('error-text') as HTMLElement;
const docTitle = $('doc-title') as HTMLElement;
const statusEl = $('status') as HTMLElement;
const zoomLevel = $('zoom-level') as HTMLElement;
const totalPagesEl = $('total-pages') as HTMLElement;
const pageInput = $('page-input') as HTMLInputElement;
const searchInput = $('search-input') as HTMLInputElement;
const searchInfo = $('search-info') as HTMLElement;
const searchPanel = $('search-panel') as HTMLElement;
const translateBtn = $('translate-btn') as HTMLButtonElement;
const prevPageBtn = $('prev-page') as HTMLButtonElement;
const nextPageBtn = $('next-page') as HTMLButtonElement;

const params = new URLSearchParams(window.location.search);
docUrl = params.get('file') || '';

if (!docUrl) {
  showError('No PDF file specified.');
} else {
  loadPDF(docUrl);
}

function showError(msg: string) {
  loadingEl.style.display = 'none';
  errorEl.style.display = 'flex';
  errorText.textContent = msg;
}

const BLOCK_MARKER = '===BLOCK_';
const BLOCK_MARKER_END = '===';

function makePageCacheKey(pg: number, provider: string, model: string): string {

  const str = `${docUrl}|${pg}|${provider}|${model}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `page_${Math.abs(hash).toString(36)}`;
}

async function loadPersistentCache() {
  const cache = await getCache();
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.targetText) {
      translationCache.set(key, entry.targetText);
    }
  }
}

async function saveToCache(key: string, text: string) {
  translationCache.set(key, text);
  await setCacheEntry(key, text);
}

async function loadPDF(url: string) {
  try {
    docTitle.textContent = decodeURIComponent(url).split('/').pop() || 'PDF';

    const resp = await new Promise<{ success: boolean; data?: number[]; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_PDF_FILE', url }, resolve);
    });

    if (!resp.success || !resp.data) throw new Error(resp.error || 'Failed to fetch PDF');

    pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(resp.data) }).promise;
    totalPages = pdfDoc.numPages;

    document.title = `${docTitle.textContent} - Lingua`;
    loadingEl.style.display = 'none';

    await loadPersistentCache();
    updateNav();
    setupEvents();
    initSplitDrag();
    loadSplitRatio();
    applySplit();
    await renderPage(currentPage);
  } catch (err: any) {
    showError(err.message || 'Could not load the PDF file.');
  }
}

function setupEvents() {
  $('zoom-in').onclick = () => setZoom(currentScale + 0.25);
  $('zoom-out').onclick = () => setZoom(Math.max(0.25, currentScale - 0.25));
  $('fit-width').onclick = fitWidth;
  $('fit-page').onclick = fitPage;
  prevPageBtn.onclick = () => goPage(currentPage - 1);
  nextPageBtn.onclick = () => goPage(currentPage + 1);

  pageInput.addEventListener('change', () => {
    const p = parseInt(pageInput.value);
    if (p >= 1 && p <= totalPages) goPage(p);
    else pageInput.value = String(currentPage);
  });
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const p = parseInt(pageInput.value);
      if (p >= 1 && p <= totalPages) goPage(p);
    }
  });

  $('search-toggle').onclick = () => {
    searchPanel.classList.toggle('hidden');
    if (!searchPanel.classList.contains('hidden')) { searchInput.focus(); searchInput.select(); }
  };
  $('close-search').onclick = () => { searchPanel.classList.add('hidden'); searchInput.value = ''; searchResults = []; searchIdx = -1; searchInfo.textContent = ''; };
  $('search-prev').onclick = () => searchNav(-1);
  $('search-next').onclick = () => searchNav(1);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchNav(e.shiftKey ? -1 : 1);
    if (e.key === 'Escape') { searchPanel.classList.add('hidden'); searchInput.value = ''; searchResults = []; searchIdx = -1; searchInfo.textContent = ''; }
  });
  searchInput.addEventListener('input', () => { searchResults = []; searchIdx = -1; searchInfo.textContent = ''; });

  $('download').onclick = downloadPDF;
  $('print').onclick = () => window.print();
  $('fullscreen').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  translateBtn.onclick = () => {
    if (!translationMode) {

      toggleTranslation();
    } else {

      translateCurrentPage();
    }
  };


  let pdfScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let transScrollTimer: ReturnType<typeof setTimeout> | null = null;

  pdfPanel.addEventListener('scroll', () => {
    if (transScrollTimer) return;
    syncScrollToSegment('pdf');
    if (pdfScrollTimer) clearTimeout(pdfScrollTimer);
    pdfScrollTimer = setTimeout(() => { pdfScrollTimer = null; }, 100);
  });
  transPanel.addEventListener('scroll', () => {
    if (pdfScrollTimer) return;
    syncScrollToSegment('trans');
    if (transScrollTimer) clearTimeout(transScrollTimer);
    transScrollTimer = setTimeout(() => { transScrollTimer = null; }, 100);
  });

  document.addEventListener('keydown', handleKey);
}

function handleKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return;
  switch (e.key) {
    case 'ArrowLeft': case 'PageUp': e.preventDefault(); goPage(currentPage - 1); break;
    case 'ArrowRight': case 'PageDown': e.preventDefault(); goPage(currentPage + 1); break;
    case 'Home': e.preventDefault(); goPage(1); break;
    case 'End': e.preventDefault(); goPage(totalPages); break;
    case '+': case '=': e.preventDefault(); setZoom(currentScale + 0.25); break;
    case '-': e.preventDefault(); setZoom(Math.max(0.25, currentScale - 0.25)); break;
    case 'f': if (e.ctrlKey || e.metaKey) { e.preventDefault(); $('search-toggle').click(); } break;
    case 'p': if (e.ctrlKey || e.metaKey) { e.preventDefault(); window.print(); } break;
  }
}

function setZoom(s: number) {
  currentScale = s;
  zoomLevel.textContent = Math.round(s * 100) + '%';
  rerenderAll();
}

function fitWidth() {
  if (!pdfDoc) return;
  pdfDoc.getPage(currentPage).then((p: any) => {
    const vp = p.getViewport({ scale: 1 });
    const availWidth = pdfPanel.clientWidth - 40;
    setZoom(availWidth / vp.width);
  });
}

function fitPage() {
  if (!pdfDoc) return;
  pdfDoc.getPage(currentPage).then((p: any) => {
    const vp = p.getViewport({ scale: 1 });
    const sx = (pdfPanel.clientWidth - 40) / vp.width;
    const sy = (pdfPanel.clientHeight - 40) / vp.height;
    setZoom(Math.min(sx, sy));
  });
}

function goPage(p: number) {
  if (p < 1 || p > totalPages || p === currentPage) return;
  currentPage = p;
  updateNav();
  ensurePageRendered(p);
  const el = renderedPages.get(p);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (translationMode) {
    syncTransPanelToPage(p);
  }
}

function detectCurrentPage() {
  const rect = pdfPanel.getBoundingClientRect();
  const center = rect.top + rect.height / 2;
  let best = 1, bestDist = Infinity;

  for (const [pg, el] of renderedPages) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - center);
    if (d < bestDist) { bestDist = d; best = pg; }
  }

  if (best !== currentPage) {
    currentPage = best;
    updateNav();
    if (translationMode) {
      syncTransPanelToPage(best);
    }
  }
}

function updateNav() {
  statusEl.textContent = `Page ${currentPage} / ${totalPages}`;
  pageInput.value = String(currentPage);
  totalPagesEl.textContent = `/ ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;

  if (translationMode && !isTranslating) {
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate Page ${currentPage}`;
  }
}

function syncTransPanelToPage(pg: number) {
  const pageEl = transPages.querySelector(`[data-trans-page="${pg}"]`) as HTMLElement;
  if (pageEl) {
    const transRect = transPanel.getBoundingClientRect();
    const elRect = pageEl.getBoundingClientRect();
    const offset = elRect.top - transRect.top + transPanel.scrollTop - 20;
    transPanel.scrollTo({ top: offset, behavior: 'smooth' });
  }
}

function syncScrollToSegment(source: 'pdf' | 'trans') {
  if (!translationMode) return;

  if (source === 'pdf') {
    const pdfRect = pdfPanel.getBoundingClientRect();
    const pdfCenter = pdfRect.top + pdfRect.height / 2;

    let bestId: string | null = null;
    let bestDist = Infinity;

    for (const [pg, container] of renderedPages) {
      const textContent = (container as any)._textContent;
      const vp = (container as any)._viewport;
      if (!textContent || !vp) continue;

      const srcLines = buildBlocks(textContent, vp);
      const srcBlocks = groupLinesToBlocks(srcLines, pg);

      for (const block of srcBlocks) {
        if (block.text.length < 3) continue;
        const containerRect = container.getBoundingClientRect();
        const blockCenterY = containerRect.top + (block.minY + block.maxY) / 2 * (containerRect.height / vp.height);
        const dist = Math.abs(blockCenterY - pdfCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = block.id;
        }
      }
    }

    if (bestId) {
      const transEl = transPages.querySelector(`[data-segment-id="${bestId}"]`);
      if (transEl) {
        const transRect = transPanel.getBoundingClientRect();
        const elRect = transEl.getBoundingClientRect();
        const offset = elRect.top - transRect.top - transRect.height / 3;
        transPanel.scrollBy({ top: offset, behavior: 'auto' });
      }
    }
  } else {
    const transRect = transPanel.getBoundingClientRect();
    const visibleSegments = transPages.querySelectorAll('.tp-segment');
    let bestEl: Element | null = null;
    let bestDist = Infinity;

    for (const el of visibleSegments) {
      const r = el.getBoundingClientRect();
      const center = r.top + r.height / 2;
      const dist = Math.abs(center - (transRect.top + transRect.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestEl = el;
      }
    }

    if (bestEl) {
      const segId = bestEl.getAttribute('data-segment-id');
      if (segId) {
        const match = segId.match(/^p(\d+)-b(\d+)$/);
        if (match) {
          const pg = parseInt(match[1]);
          const blockIdx = parseInt(match[2]);
          const container = renderedPages.get(pg);
          if (container) {
            const textContent = (container as any)._textContent;
            const vp = (container as any)._viewport;
            if (textContent && vp) {
              const srcLines = buildBlocks(textContent, vp);
              const srcBlocks = groupLinesToBlocks(srcLines, pg);
              if (srcBlocks[blockIdx]) {
                const block = srcBlocks[blockIdx];
                const containerRect = container.getBoundingClientRect();
                const blockScreenY = containerRect.top + block.minY * (containerRect.height / vp.height);
                const offset = blockScreenY - pdfPanel.getBoundingClientRect().top - pdfPanel.clientHeight / 3;
                pdfPanel.scrollBy({ top: offset, behavior: 'auto' });
              }
            }
          }
        }
      }
    }
  }
}

async function ensurePageRendered(pg: number) {
  if (!renderedPages.has(pg)) await renderPage(pg);
}

async function renderPage(pg: number) {
  if (!pdfDoc) return;

  renderedPages.get(pg)?.remove();
  renderedPages.delete(pg);

  const page = await pdfDoc.getPage(pg);
  const vp = page.getViewport({ scale: currentScale });

  const container = document.createElement('div');
  container.className = 'page-container';
  container.setAttribute('data-page-number', String(pg));
  container.style.width = vp.width + 'px';
  container.style.height = vp.height + 'px';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = vp.width;
  canvas.height = vp.height;
  container.appendChild(canvas);

  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';
  container.appendChild(textLayer);

  const siblings = Array.from(pdfPages.children) as HTMLElement[];
  const after = siblings.find(el => parseInt(el.getAttribute('data-page-number') || '0') > pg);
  if (after) pdfPages.insertBefore(container, after);
  else pdfPages.appendChild(container);

  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  const textContent = await page.getTextContent();

  for (const item of textContent.items) {
    const span = document.createElement('span');
    span.textContent = item.str;
    const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
    const fs = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
    span.style.left = tx[4] + 'px';
    span.style.top = tx[5] + 'px';
    span.style.fontSize = fs + 'px';
    span.style.fontFamily = item.fontName || 'sans-serif';
    if (item.width > 0 && item.str.length > 0) {
      span.style.letterSpacing = ((item.width / item.str.length - fs * 0.5) / fs) + 'em';
    }
    textLayer.appendChild(span);
  }

  renderedPages.set(pg, container);


  (container as any)._textContent = textContent;
  (container as any)._viewport = vp;


  if (translationMode) {
    await showCachedPageTranslation(pg, textContent, vp);
  }
}

async function rerenderAll() {
  const prev = currentPage;
  const wasTranslating = translationMode;
  pdfPages.innerHTML = '';
  if (!wasTranslating) transPages.innerHTML = '';
  renderedPages.clear();

  for (let i = Math.max(1, prev - 1); i <= Math.min(totalPages, prev + 2); i++) {
    await renderPage(i);
  }

  const el = renderedPages.get(prev);
  if (el) el.scrollIntoView({ block: 'start' });
}

function toggleTranslation() {
  translationMode = !translationMode;

  if (translationMode) {
    translateBtn.classList.add('active');
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate Page ${currentPage}`;
    translateBtn.disabled = false;
    applySplit();

    showCachedPageTranslation(currentPage, null, null).then(() => syncTransPanelToPage(currentPage));
  } else {
    translateBtn.classList.remove('active');
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate Page`;
    transPages.innerHTML = '';
    applySplit();
  }
}

async function showCachedPageTranslation(pg: number, textContentOverride: any, vpOverride: any) {
  const container = renderedPages.get(pg);
  if (!container) return;

  const textContent = textContentOverride || (container as any)._textContent;
  const vp = vpOverride || (container as any)._viewport;
  if (!textContent || !vp) return;

  const lines = buildBlocks(textContent, vp);
  const blocks = groupLinesToBlocks(lines, pg);


  const oldPageEl = transPages.querySelector(`[data-trans-page="${pg}"]`);
  if (oldPageEl) oldPageEl.remove();


  const pageEl = document.createElement('div');
  pageEl.className = 'tp-page';
  pageEl.setAttribute('data-trans-page', String(pg));
  pageEl.style.height = vp.height + 'px';

  const label = document.createElement('div');
  label.className = 'tp-page-label';
  label.textContent = `Page ${pg}`;
  pageEl.appendChild(label);


  const existingPages = Array.from(transPages.querySelectorAll('.tp-page')) as HTMLElement[];
  const afterPage = existingPages.find(el => parseInt(el.getAttribute('data-trans-page') || '0') > pg);
  if (afterPage) transPages.insertBefore(pageEl, afterPage);
  else transPages.appendChild(pageEl);


  const settings = await new Promise<any>(resolve => {
    chrome.storage.sync.get('lingua_settings', resolve);
  });
  const apiKey = settings?.lingua_settings?.translation?.apiKey || '';
  const model = settings?.lingua_settings?.translation?.model || '';
  const provider = apiKey ? 'gemini' : '';

  const cacheKey = makePageCacheKey(pg, provider, model);
  const cached = translationCache.get(cacheKey);

  if (cached) {

    const translations = parsePageTranslations(cached, blocks.length);
    renderTranslatedBlocks(pageEl, blocks, translations, vp);
  } else {

    const hint = document.createElement('div');
    hint.className = 'tp-status';
    hint.textContent = 'Click "Translate Page" to translate this page.';
    pageEl.appendChild(hint);
  }
}

async function translateCurrentPage() {
  if (isTranslating || !pdfDoc || !translationMode) return;

  const container = renderedPages.get(currentPage);
  if (!container) return;

  const textContent = (container as any)._textContent;
  const vp = (container as any)._viewport;
  if (!textContent || !vp) return;

  translationGeneration++;
  const gen = translationGeneration;
  translatingPage = currentPage;

  isTranslating = true;
  translateBtn.disabled = true;
  translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translating page ${currentPage}...`;

  try {
    await translateEntirePage(currentPage, textContent, vp, gen);
  } finally {
    if (gen === translationGeneration) {
      isTranslating = false;
      translatingPage = null;
      translateBtn.disabled = false;
      translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate Page ${currentPage}`;
    }
  }
}

interface TextLine {
  y: number;
  height: number;
  maxY: number;
  minX: number;
  maxX: number;
  text: string;
}

interface TextBlock {
  id: string;
  text: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lines: TextLine[];
}

function buildBlocks(textContent: any, vp: any): TextLine[] {
  const items = textContent.items
    .filter((it: any) => it.str.trim().length > 0)
    .map((it: any) => {
      const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
      const h = it.height || Math.abs(tx[3]) || 12;
      const dirLen = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]) || 1;
      const w = it.width * dirLen;
      return {
        str: it.str.trim(),
        x: tx[4],
        y: tx[5],
        w,
        h,
        maxY: tx[5] + h,
      };
    })
    .sort((a: any, b: any) => a.y - b.y || a.x - b.x);

  if (items.length === 0) return [];

  const lines: TextLine[] = [];
  let curLine: any = { items: [items[0]], y: items[0].y, h: items[0].h };

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    if (Math.abs(item.y - curLine.y) < curLine.h * 0.5) {
      curLine.items.push(item);
    } else {
      lines.push(finalizeLine(curLine));
      curLine = { items: [item], y: item.y, h: item.h };
    }
  }
  lines.push(finalizeLine(curLine));

  return lines;
}

function finalizeLine(line: { items: any[]; y: number; h: number }): TextLine {
  const minX = Math.min(...line.items.map((i: any) => i.x));
  const maxX = Math.max(...line.items.map((i: any) => i.x + i.w));
  const maxY = Math.max(...line.items.map((i: any) => i.maxY));
  const text = line.items.map((i: any) => i.str).join(' ');
  return { y: line.y, height: line.h, maxY, minX, maxX, text };
}

function groupLinesToBlocks(lines: TextLine[], pg: number): TextBlock[] {
  if (lines.length === 0) return [];

  const blocks: TextBlock[] = [];
  let blockIdx = 0;
  let cur: TextBlock = {
    id: `p${pg}-b${blockIdx}`,
    text: lines[0].text,
    minX: lines[0].minX,
    minY: lines[0].y,
    maxX: lines[0].maxX,
    maxY: lines[0].maxY,
    lines: [lines[0]],
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const gap = line.y - cur.maxY;
    const avgH = cur.lines.reduce((s, l) => s + l.height, 0) / cur.lines.length;

    if (gap > avgH * 1.3) {
      blocks.push(cur);
      blockIdx++;
      cur = {
        id: `p${pg}-b${blockIdx}`,
        text: line.text,
        minX: line.minX,
        minY: line.y,
        maxX: line.maxX,
        maxY: line.maxY,
        lines: [line],
      };
    } else {
      cur.text += ' ' + line.text;
      cur.minX = Math.min(cur.minX, line.minX);
      cur.maxX = Math.max(cur.maxX, line.maxX);
      cur.maxY = Math.max(cur.maxY, line.maxY);
      cur.lines.push(line);
    }
  }
  blocks.push(cur);
  return blocks;
}

const MAX_BLOCKS_PER_REQUEST = 50;

async function translateEntirePage(pg: number, textContent: any, vp: any, generation: number) {
  const lines = buildBlocks(textContent, vp);
  const blocks = groupLinesToBlocks(lines, pg);


  const translatableBlocks = blocks.filter(b => b.text.length >= 3);

  if (translatableBlocks.length === 0) {
    showTransStatus(pg, 'error', 'No translatable text found on this page.');
    return;
  }


  const oldPageEl = transPages.querySelector(`[data-trans-page="${pg}"]`);
  if (oldPageEl) oldPageEl.remove();


  const pageEl = document.createElement('div');
  pageEl.className = 'tp-page';
  pageEl.setAttribute('data-trans-page', String(pg));
  pageEl.style.height = vp.height + 'px';

  const label = document.createElement('div');
  label.className = 'tp-page-label';
  label.textContent = `Page ${pg}`;
  pageEl.appendChild(label);


  const existingPages = Array.from(transPages.querySelectorAll('.tp-page')) as HTMLElement[];
  const afterPage = existingPages.find(el => parseInt(el.getAttribute('data-trans-page') || '0') > pg);
  if (afterPage) transPages.insertBefore(pageEl, afterPage);
  else transPages.appendChild(pageEl);


  const settings = await new Promise<any>(resolve => {
    chrome.storage.sync.get('lingua_settings', resolve);
  });
  const apiKey = settings?.lingua_settings?.translation?.apiKey || '';
  const model = settings?.lingua_settings?.translation?.model || '';
  const provider = apiKey ? 'gemini' : '';


  const cacheKey = makePageCacheKey(pg, provider, model);
  const cached = translationCache.get(cacheKey);

  let allTranslations: string[] | null = null;

  if (cached) {

    allTranslations = parsePageTranslations(cached, translatableBlocks.length);
  } else {

    allTranslations = await translatePageInBatches(
      translatableBlocks, pg, provider, model, generation
    );
    if (generation !== translationGeneration) return;

    if (allTranslations) {

      const serialized = allTranslations.join('\n===BLOCK_SEP===\n');
      await saveToCache(cacheKey, serialized);
    } else {

      showTransStatus(pg, 'error', 'Translation failed. Check your API key and connection.');
      return;
    }
  }


  renderTranslatedBlocks(pageEl, translatableBlocks, allTranslations, vp);
  clearTransPanelStatus(pg);
}

async function translatePageInBatches(
  blocks: TextBlock[], pg: number, provider: string, model: string, generation: number
): Promise<string[] | null> {
  if (blocks.length <= MAX_BLOCKS_PER_REQUEST) {

    return translatePageBatch(blocks, pg, provider, model, generation);
  }


  const allTranslations: string[] = [];
  const batches = Math.ceil(blocks.length / MAX_BLOCKS_PER_REQUEST);

  for (let b = 0; b < batches; b++) {
    if (generation !== translationGeneration) return null;

    const start = b * MAX_BLOCKS_PER_REQUEST;
    const end = Math.min(start + MAX_BLOCKS_PER_REQUEST, blocks.length);
    const batch = blocks.slice(start, end);

    showTransStatus(pg, 'retrying', `Translating batch ${b + 1}/${batches}...`);

    const batchResult = await translatePageBatch(batch, pg, provider, model, generation);
    if (!batchResult) return null;

    allTranslations.push(...batchResult);
  }

  return allTranslations;
}

async function translatePageBatch(
  blocks: TextBlock[], pg: number, provider: string, model: string, generation: number
): Promise<string[] | null> {
  const requestKey = `page_batch_${pg}_${blocks.length}`;

  if (pendingRequests.has(requestKey)) return null;
  pendingRequests.add(requestKey);

  try {

    const prompt = buildPagePrompt(blocks);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (generation !== translationGeneration) return null;

      try {
        const rawResponse = await callTranslationAPI(prompt, generation);
        if (generation !== translationGeneration) return null;


        const translations = parsePageResponse(rawResponse, blocks.length);
        pendingRequests.delete(requestKey);
        return translations;
      } catch (err: any) {
        const msg = err.message || 'Unknown error';
        const status = extractStatus(msg);

        if (status === 401 || status === 403) {
          pendingRequests.delete(requestKey);
          showTransStatus(pg, 'error', `Authentication failed (${status}). Check your API key.`);
          return null;
        }
        if (status === 400) {
          pendingRequests.delete(requestKey);
          showTransStatus(pg, 'error', 'Invalid request. The text may be too long or malformed.');
          return null;
        }

        if (attempt >= MAX_RETRIES) {
          pendingRequests.delete(requestKey);
          const label = status ? `HTTP ${status}` : 'Network error';
          showTransStatus(pg, 'error', `Translation failed after ${MAX_RETRIES + 1} attempts. ${label}`);
          return null;
        }

        const retryAfter = extractRetryAfter(msg);
        const backoff = 1000 * Math.pow(2, attempt);
        const jitter = Math.random() * 1000;
        const delay = retryAfter || (backoff + jitter);

        const delaySec = Math.round(delay / 1000);
        const retryLabel = status === 429 ? 'Rate limited' : status === 503 ? 'Service unavailable' : 'Request failed';
        showTransStatus(pg, 'retrying', `${retryLabel}. Retrying in ${delaySec}s...`);
        await sleep(delay);
      }
    }

    pendingRequests.delete(requestKey);
    return null;
  } catch {
    pendingRequests.delete(requestKey);
    return null;
  }
}

function buildPagePrompt(blocks: TextBlock[]): string {
  const blockTexts = blocks.map((block, i) => `[BLOCK_${i}]\n${block.text}`).join('\n\n');

  return `You are a professional English to Persian (Farsi) translator specializing in technical documentation.

Translate the following text blocks from English to Persian. Each block is marked with [BLOCK_N] where N is the block number.

CRITICAL RULES:
1. Preserve ALL [BLOCK_N] markers EXACTLY as they appear — they are used for parsing
2. Return the translated text for each block in the same order
3. Separate each block translation with a blank line
4. Do NOT merge blocks or split blocks — keep the 1:1 correspondence
5. Preserve technical terms (Kubernetes, Docker, API, Linux, etc.) in English
6. Preserve code, URLs, file paths, numbers, and commands exactly
7. Use proper Persian punctuation (، ؛ ؟) for Persian text
8. Preserve paragraph structure within each block

Text blocks to translate:

${blockTexts}

Return ONLY the translated blocks with their markers, no explanations.`;
}

function parsePageResponse(response: string, expectedCount: number): string[] {
  const translations: string[] = [];


  const parts = response.split(/\[BLOCK_\d+\]/);


  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();

    if (trimmed.length === 0) continue;

    if (translations.length === 0 && !response.includes(`[BLOCK_${translations.length}]`)) {
      continue;
    }
    translations.push(trimmed);
  }


  if (translations.length !== expectedCount) {
    const fallback = response.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
    if (fallback.length === expectedCount) {
      return fallback;
    }


    if (translations.length === expectedCount) {
      return translations;
    }


    while (translations.length < expectedCount) {
      translations.push('');
    }
    return translations.slice(0, expectedCount);
  }

  return translations;
}

function parsePageTranslations(cached: string, expectedCount: number): string[] {
  const parts = cached.split('\n===BLOCK_SEP===\n');
  if (parts.length === expectedCount) return parts;


  while (parts.length < expectedCount) parts.push('');
  return parts.slice(0, expectedCount);
}

function renderTranslatedBlocks(pageEl: HTMLElement, blocks: TextBlock[], translations: string[], vp: any) {
  const GAP = 8;
  let cursorY = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = translations[i];

    if (!text || text.length === 0) continue;

    const top = Math.max(block.maxY + GAP, cursorY);

    const blockEl = document.createElement('div');
    blockEl.className = 'tp-segment';
    blockEl.setAttribute('data-segment-id', block.id);
    blockEl.style.top = top + 'px';

    const faEl = document.createElement('div');
    faEl.className = 'tp-fa';
    faEl.textContent = text;
    blockEl.appendChild(faEl);

    blockEl.addEventListener('click', () => highlightSegment(block.id));
    pageEl.appendChild(blockEl);

    const renderedHeight = faEl.getBoundingClientRect().height;
    const cssHeight = renderedHeight * (vp.height / pageEl.getBoundingClientRect().height);
    cursorY = top + cssHeight + GAP;
  }
}

function showTransStatus(pg: number, status: 'retrying' | 'error' | 'success', msg: string) {
  const pageEl = transPages.querySelector(`[data-trans-page="${pg}"]`);
  if (!pageEl) return;

  let el = pageEl.querySelector('.tp-status-line') as HTMLElement;
  if (!el) {
    el = document.createElement('div');
    el.className = 'tp-status-line';
    pageEl.appendChild(el);
  }

  if (status === 'success') {
    el.remove();
    return;
  }

  el.textContent = msg;
  el.className = `tp-status-line tp-status-${status}`;
}

function clearTransPanelStatus(pg: number) {
  const pageEl = transPages.querySelector(`[data-trans-page="${pg}"]`);
  if (!pageEl) return;
  const el = pageEl.querySelector('.tp-status-line');
  if (el) el.remove();
}

async function callTranslationAPI(prompt: string, generation: number): Promise<string> {
  const settings = await new Promise<any>(resolve => {
    chrome.storage.sync.get('lingua_settings', resolve);
  });

  const apiKey = settings?.lingua_settings?.translation?.apiKey;
  const model = settings?.lingua_settings?.translation?.model;

  if (!apiKey || !model) throw new Error('API key not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
        signal: controller.signal,
      }
    );

    const retryAfterHeader = resp.headers.get('Retry-After');

    if (!resp.ok) {
      let retryDelay: string | null = null;
      let errorMessage = resp.statusText;
      try {
        const errJson = await resp.json();
        errorMessage = errJson?.error?.message || resp.statusText;
        retryDelay = errJson?.error?.details?.find(
          (d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
        )?.retryDelay || null;
        if (!retryDelay && errJson?.error?.retryDelay) {
          retryDelay = errJson.error.retryDelay;
        }
      } catch {

      }

      let errMsg = `HTTP ${resp.status}: ${errorMessage}`;
      if (retryAfterHeader) errMsg += ` (Retry-After: ${retryAfterHeader})`;
      if (retryDelay) errMsg += ` (retryDelay: ${retryDelay})`;
      throw new Error(errMsg);
    }

    const data = await resp.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!result) throw new Error('Empty response from API');
    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(REQUEST_TIMEOUT / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

let activeSegmentId: string | null = null;
let highlightTimeout: ReturnType<typeof setTimeout> | null = null;

function highlightSegment(segmentId: string) {
  if (highlightTimeout) clearTimeout(highlightTimeout);
  clearHighlights();

  activeSegmentId = segmentId;

  const transEl = transPages.querySelector(`[data-segment-id="${segmentId}"]`);
  if (transEl) {
    transEl.classList.add('segment-active');
  }

  const match = segmentId.match(/^p(\d+)-b(\d+)$/);
  if (match) {
    const pg = parseInt(match[1]);
    const blockIdx = parseInt(match[2]);
    const container = renderedPages.get(pg);
    if (container) {
      const textContent = (container as any)._textContent;
      const vp = (container as any)._viewport;
      if (textContent && vp) {
        const srcLines = buildBlocks(textContent, vp);
        const srcBlocks = groupLinesToBlocks(srcLines, pg);
        if (srcBlocks[blockIdx]) {
          const srcBlock = srcBlocks[blockIdx];
          const highlight = document.createElement('div');
          highlight.className = 'src-highlight';
          highlight.setAttribute('data-highlight-for', segmentId);
          highlight.style.left = srcBlock.minX + 'px';
          highlight.style.top = srcBlock.minY + 'px';
          highlight.style.width = (srcBlock.maxX - srcBlock.minX) + 'px';
          highlight.style.height = (srcBlock.maxY - srcBlock.minY) + 'px';
          container.appendChild(highlight);
        }
      }
    }
  }

  highlightTimeout = setTimeout(clearHighlights, 2000);
}

function clearHighlights() {
  activeSegmentId = null;
  document.querySelectorAll('.segment-active').forEach(el => el.classList.remove('segment-active'));
  document.querySelectorAll('.src-highlight').forEach(el => el.remove());
}

function extractStatus(errMsg: string): number | null {
  const match = errMsg.match(/^HTTP (\d+)/);
  return match ? parseInt(match[1]) : null;
}

function extractRetryAfter(errMsg: string): number | null {
  const headerMatch = errMsg.match(/Retry-After:\s*(\d+)/i);
  if (headerMatch) return parseInt(headerMatch[1]) * 1000;

  const delayMatch = errMsg.match(/retryDelay:\s*(\d+)s?/i);
  if (delayMatch) return parseInt(delayMatch[1]) * 1000;

  return null;
}

let searchResults: { page: number }[] = [];
let searchIdx = -1;

async function searchNav(dir: number) {
  const q = searchInput.value.trim().toLowerCase();
  if (!q || !pdfDoc) return;

  if (searchResults.length === 0) {
    searchResults = [];
    for (let i = 1; i <= totalPages; i++) {
      const p = await pdfDoc.getPage(i);
      const tc = await p.getTextContent();
      const txt = tc.items.map((it: any) => it.str).join(' ').toLowerCase();
      if (txt.includes(q)) searchResults.push({ page: i });
    }
    searchIdx = -1;
  }

  if (searchResults.length === 0) { searchInfo.textContent = 'No results'; return; }

  searchIdx = (searchIdx + dir + searchResults.length) % searchResults.length;
  goPage(searchResults[searchIdx].page);
  searchInfo.textContent = `${searchIdx + 1} / ${searchResults.length}`;
}

function downloadPDF() {
  if (!docUrl) return;
  const a = document.createElement('a');
  a.href = docUrl;
  a.download = docTitle.textContent || 'document.pdf';
  a.click();
}

const MIN_SPLIT = 25;
const MAX_SPLIT = 75;

function applySplit() {
  if (!translationMode) {
    pdfPanel.style.flex = '1 1 0%';
    dividerEl.style.display = 'none';
    transPanel.style.flex = '0 0 0px';
    transPanel.style.width = '0';
  } else {
    dividerEl.style.display = '';
    const pdfPct = splitRatio;
    const transPct = 100 - splitRatio;
    pdfPanel.style.flex = `0 0 ${pdfPct}%`;
    transPanel.style.flex = `0 0 ${transPct}%`;
    transPanel.style.width = transPct + '%';
  }
}

function initSplitDrag() {
  let startX = 0;
  let startRatio = 0;

  function onMouseDown(e: MouseEvent) {
    if (!translationMode) return;
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startRatio = splitRatio;
    dividerEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const containerWidth = pdfPanel.parentElement!.getBoundingClientRect().width;
    const dx = e.clientX - startX;
    const dPct = (dx / containerWidth) * 100;
    let newRatio = startRatio + dPct;
    newRatio = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, newRatio));
    splitRatio = Math.round(newRatio);
    applySplit();
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    dividerEl.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    saveSplitRatio();
  }

  dividerEl.addEventListener('mousedown', onMouseDown);

  dividerEl.addEventListener('dblclick', () => {
    splitRatio = 50;
    applySplit();
    saveSplitRatio();
  });


  dividerEl.addEventListener('touchstart', (e: TouchEvent) => {
    if (!translationMode) return;
    e.preventDefault();
    isDragging = true;
    startX = e.touches[0].clientX;
    startRatio = splitRatio;
    dividerEl.classList.add('dragging');
  }, { passive: false });

  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (!isDragging) return;
    const containerWidth = pdfPanel.parentElement!.getBoundingClientRect().width;
    const dx = e.touches[0].clientX - startX;
    const dPct = (dx / containerWidth) * 100;
    let newRatio = startRatio + dPct;
    newRatio = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, newRatio));
    splitRatio = Math.round(newRatio);
    applySplit();
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    dividerEl.classList.remove('dragging');
    saveSplitRatio();
  });
}

function saveSplitRatio() {
  try {
    chrome.storage.local.set({ lingua_split_ratio: splitRatio });
  } catch {  }
}

function loadSplitRatio() {
  try {
    chrome.storage.local.get('lingua_split_ratio', (result) => {
      if (result?.lingua_split_ratio) {
        splitRatio = result.lingua_split_ratio;
        splitRatio = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, splitRatio));
        applySplit();
      }
    });
  } catch {  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
