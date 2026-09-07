import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString();

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
let pdfDoc: any = null;
let currentPage = 1;
let totalPages = 0;
let currentScale = 1.5;
let isTranslating = false;
let translationMode = false;
let renderedPages = new Map<number, HTMLElement>();
let translationCache = new Map<string, string>();
let pendingRequests = new Set<string>();

// ═══════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════
const $ = (id: string) => document.getElementById(id)!;
const pdfPanel = $('pdf-panel') as HTMLElement;
const pdfPages = $('pdf-pages') as HTMLElement;
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
const fileUrl = params.get('file');

if (!fileUrl) {
  showError('No PDF file specified.');
} else {
  loadPDF(fileUrl);
}

function showError(msg: string) {
  loadingEl.style.display = 'none';
  errorEl.style.display = 'flex';
  errorText.textContent = msg;
}

// ═══════════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════════
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

    updateNav();
    setupEvents();
    await renderPage(currentPage);
  } catch (err: any) {
    showError(err.message || 'Could not load the PDF file.');
  }
}

// ═══════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════
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
  $('close-search').onclick = () => { searchPanel.classList.add('hidden'); searchInput.value = ''; };
  $('search-prev').onclick = () => searchNav(-1);
  $('search-next').onclick = () => searchNav(1);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchNav(e.shiftKey ? -1 : 1);
    if (e.key === 'Escape') { searchPanel.classList.add('hidden'); searchInput.value = ''; }
  });

  $('download').onclick = downloadPDF;
  $('print').onclick = () => window.print();
  $('fullscreen').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  translateBtn.onclick = toggleTranslation;

  // Scroll sync: PDF panel drives translation panel
  let syncScrolling = false;
  pdfPanel.addEventListener('scroll', () => {
    if (!syncScrolling) {
      syncScrolling = true;
      transPanel.scrollTop = pdfPanel.scrollTop;
      requestAnimationFrame(() => { syncScrolling = false; });
    }
    detectCurrentPage();
  });
  transPanel.addEventListener('scroll', () => {
    if (!syncScrolling) {
      syncScrolling = true;
      pdfPanel.scrollTop = transPanel.scrollTop;
      requestAnimationFrame(() => { syncScrolling = false; });
    }
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

// ═══════════════════════════════════════════════
// ZOOM
// ═══════════════════════════════════════════════
function setZoom(s: number) {
  currentScale = s;
  zoomLevel.textContent = Math.round(s * 100) + '%';
  rerenderAll();
}

function fitWidth() {
  if (!pdfDoc) return;
  pdfDoc.getPage(currentPage).then((p: any) => {
    const vp = p.getViewport({ scale: 1 });
    const availWidth = translationMode
      ? (pdfPanel.clientWidth - 40)
      : (pdfPanel.clientWidth - 40);
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

// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════
function goPage(p: number) {
  if (p < 1 || p > totalPages || p === currentPage) return;
  currentPage = p;
  updateNav();
  ensurePageRendered(p);
  const el = renderedPages.get(p);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  if (best !== currentPage) { currentPage = best; updateNav(); }
}

function updateNav() {
  statusEl.textContent = `Page ${currentPage} / ${totalPages}`;
  pageInput.value = String(currentPage);
  totalPagesEl.textContent = `/ ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

// ═══════════════════════════════════════════════
// PDF RENDERING (left panel)
// ═══════════════════════════════════════════════
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

  // Insert in correct position
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

  // Store metadata for translation
  (container as any)._textContent = textContent;
  (container as any)._viewport = vp;

  // If translation mode is on, build the translation panel for this page
  if (translationMode) {
    await buildPageTranslation(pg, textContent, vp);
  }
}

async function rerenderAll() {
  const prev = currentPage;
  pdfPages.innerHTML = '';
  transPages.innerHTML = '';
  renderedPages.clear();

  for (let i = Math.max(1, prev - 1); i <= Math.min(totalPages, prev + 2); i++) {
    await renderPage(i);
  }

  const el = renderedPages.get(prev);
  if (el) el.scrollIntoView({ block: 'start' });
}

// ═══════════════════════════════════════════════
// TRANSLATION MODE
// ═══════════════════════════════════════════════
function toggleTranslation() {
  translationMode = !translationMode;

  if (translationMode) {
    transPanel.classList.add('open');
    translateBtn.classList.add('active');
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translating...`;
    translateBtn.disabled = true;
    translateCurrentPage();
  } else {
    transPanel.classList.remove('open');
    translateBtn.classList.remove('active');
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate Page`;
    transPages.innerHTML = '';
  }
}

async function translateCurrentPage() {
  if (isTranslating || !pdfDoc || !translationMode) return;

  const container = renderedPages.get(currentPage);
  if (!container) return;

  const textContent = (container as any)._textContent;
  const vp = (container as any)._viewport;
  if (!textContent || !vp) return;

  isTranslating = true;
  translateBtn.disabled = true;
  translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translating page ${currentPage}...`;

  try {
    await buildPageTranslation(currentPage, textContent, vp);
  } finally {
    isTranslating = false;
    translateBtn.disabled = false;
    translateBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate Page`;
  }
}

// ═══════════════════════════════════════════════
// TEXT BLOCK BUILDING
// ═══════════════════════════════════════════════
interface TextLine {
  y: number;
  height: number;
  maxY: number;
  minX: number;
  maxX: number;
  text: string;
}

interface TextBlock {
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

function groupLinesToBlocks(lines: TextLine[]): TextBlock[] {
  if (lines.length === 0) return [];

  const blocks: TextBlock[] = [];
  let cur: TextBlock = {
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
      cur = {
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

// ═══════════════════════════════════════════════
// TRANSLATION PANEL (right side)
// ═══════════════════════════════════════════════
async function buildPageTranslation(pg: number, textContent: any, vp: any) {
  const lines = buildBlocks(textContent, vp);
  const blocks = groupLinesToBlocks(lines);

  // Remove old page element if exists
  const oldPageEl = transPages.querySelector(`[data-trans-page="${pg}"]`);
  if (oldPageEl) oldPageEl.remove();

  // Create page container in translation panel
  const pageEl = document.createElement('div');
  pageEl.className = 'tp-page';
  pageEl.setAttribute('data-trans-page', String(pg));
  pageEl.style.height = vp.height + 'px';

  const label = document.createElement('div');
  label.className = 'tp-page-label';
  label.textContent = `Page ${pg}`;
  pageEl.appendChild(label);

  // Insert in order
  const existingPages = Array.from(transPages.querySelectorAll('.tp-page')) as HTMLElement[];
  const afterPage = existingPages.find(el => parseInt(el.getAttribute('data-trans-page') || '0') > pg);
  if (afterPage) transPages.insertBefore(pageEl, afterPage);
  else transPages.appendChild(pageEl);

  // Translate each block and create elements
  const GAP = 8;
  let cursorY = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.text.length < 3) continue;

    const cacheKey = `${pg}_${i}`;
    let text = translationCache.get(cacheKey);

    if (!text) {
      const result = await translateWithRetry(block.text, cacheKey);
      if (result) {
        text = result;
        translationCache.set(cacheKey, text);
      }
    }

    if (text && text.length > 0) {
      // Position the translation block at the same Y as the English source
      const top = Math.max(block.maxY + GAP, cursorY);

      const blockEl = document.createElement('div');
      blockEl.className = 'tp-block';
      blockEl.style.top = top + 'px';

      const faEl = document.createElement('div');
      faEl.className = 'tp-fa';
      faEl.textContent = text;
      blockEl.appendChild(faEl);

      pageEl.appendChild(blockEl);

      // Measure height after append
      const renderedHeight = faEl.getBoundingClientRect().height;
      const cssHeight = renderedHeight * (vp.height / pageEl.getBoundingClientRect().height);

      cursorY = top + cssHeight + GAP;
    }
  }
}

// ═══════════════════════════════════════════════
// TRANSLATION HTTP WITH RETRY
// ═══════════════════════════════════════════════
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT = 30000;

async function translateWithRetry(text: string, cacheKey: string): Promise<string | null> {
  if (pendingRequests.has(cacheKey)) return null;
  pendingRequests.add(cacheKey);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await translateSingle(text);
      pendingRequests.delete(cacheKey);
      return result;
    } catch (err: any) {
      const msg = err.message || 'Unknown error';
      const status = extractStatus(msg);

      console.warn(`[Lingua] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${msg}`);

      if (status === 401 || status === 403) {
        console.error(`[Lingua] Auth error (${status}). Not retrying.`);
        pendingRequests.delete(cacheKey);
        return null;
      }
      if (status === 400) {
        console.error(`[Lingua] Bad request (400). Not retrying.`);
        pendingRequests.delete(cacheKey);
        return null;
      }

      if (attempt >= MAX_RETRIES) {
        console.error(`[Lingua] All ${MAX_RETRIES + 1} attempts exhausted.`);
        pendingRequests.delete(cacheKey);
        return null;
      }

      const retryAfter = extractRetryAfter(msg);
      const backoff = 1000 * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      const delay = retryAfter || (backoff + jitter);

      console.log(`[Lingua] Retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }

  pendingRequests.delete(cacheKey);
  return null;
}

function extractStatus(errMsg: string): number | null {
  const match = errMsg.match(/^HTTP (\d+)/);
  return match ? parseInt(match[1]) : null;
}

function extractRetryAfter(errMsg: string): number | null {
  // Check Retry-After header format: "Retry-After: 30"
  const headerMatch = errMsg.match(/Retry-After:\s*(\d+)/i);
  if (headerMatch) return parseInt(headerMatch[1]) * 1000;

  // Check Gemini API retryDelay format: "(retryDelay: 34s)" or "(retryDelay: 34)"
  const delayMatch = errMsg.match(/retryDelay:\s*(\d+)s?/i);
  if (delayMatch) return parseInt(delayMatch[1]) * 1000;

  return null;
}

async function translateSingle(text: string): Promise<string> {
  const settings = await new Promise<any>(resolve => {
    chrome.storage.sync.get('lingua_settings', resolve);
  });

  const apiKey = settings?.lingua_settings?.translation?.apiKey;
  const model = settings?.lingua_settings?.translation?.model;

  if (!apiKey || !model) throw new Error('API key not configured');

  const prompt = `Translate this English text to Persian. Return ONLY the translation, no explanations.

Technical terms, code, URLs, file paths, and numbers must remain in their original form.
Preserve paragraph structure.

Text to translate:
${text}`;

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
      // Try to parse Gemini API JSON error body for retryDelay
      let retryDelay: string | null = null;
      let errorMessage = resp.statusText;
      try {
        const errJson = await resp.json();
        errorMessage = errJson?.error?.message || resp.statusText;
        retryDelay = errJson?.error?.details?.find(
          (d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
        )?.retryDelay || null;
        // Also check top-level retryDelay
        if (!retryDelay && errJson?.error?.retryDelay) {
          retryDelay = errJson.error.retryDelay;
        }
      } catch {
        // Body wasn't JSON, use statusText
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
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════
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

// ═══════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════
function downloadPDF() {
  if (!fileUrl) return;
  const a = document.createElement('a');
  a.href = fileUrl;
  a.download = docTitle.textContent || 'document.pdf';
  a.click();
}

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
