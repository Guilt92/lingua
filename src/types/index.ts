export interface TranslationSettings {
  apiKey: string;
  model: string;
  sourceLanguage: 'en';
  targetLanguage: 'fa';
  mode: 'natural' | 'technical';
}

export interface DisplaySettings {
  fontSize: number;
  lineHeight: number;
  opacity: number;
  enabled: boolean;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UISettings {
  theme: ThemeMode;
}

export interface Settings {
  translation: TranslationSettings;
  display: DisplaySettings;
  ui: UISettings;
}

export interface TextBlock {
  id: string;
  pageNumber: number;
  text: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lines: TextLine[];
}

export interface TextLine {
  text: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PageContent {
  pageNumber: number;
  viewport: {
    width: number;
    height: number;
    scale: number;
  };
  textBlocks: TextBlock[];
}

export interface PDFDocument {
  url: string;
  pageCount: number;
  pages: Map<number, PageContent>;
  isScanned: boolean;
}

export interface TranslationUnit {
  id: string;
  sourceText: string;
  targetText: string;
  pageNumber: number;
  textBlockId: string;
  status: 'pending' | 'translating' | 'completed' | 'failed';
  timestamp: number;
}

export interface CacheEntry {
  sourceText: string;
  targetText: string;
  sourceLanguage: string;
  targetLanguage: string;
  mode: string;
  timestamp: number;
}

export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  mode: 'natural' | 'technical';
  context?: string;
}

export interface TranslationResponse {
  translatedText: string;
  success: boolean;
  error?: string;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export type TranslationProviderType = 'gemini';

export interface TranslationProvider {
  name: TranslationProviderType;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
  testConnection(config: ProviderConfig): Promise<ConnectionTestResult>;
  getModels(): string[];
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: string;
}

export interface PrefetchStrategy {
  currentPage: number;
  nextPages: number[];
  maxConcurrent: number;
}

export interface OverlayElement {
  id: string;
  pageNumber: number;
  sourceTextBlockId: string;
  translationElement: HTMLElement;
  sourceBBox: DOMRect;
  targetText: string;
}