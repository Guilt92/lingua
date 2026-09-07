import { BaseTranslationProvider } from './translation-provider';
import { TranslationRequest, TranslationResponse, ProviderConfig, ConnectionTestResult, ModelInfo } from '../types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const EXCLUDED_PATTERNS = [
  'tts', 'image', 'robotics', 'deep-research', 'computer-use',
  'omni', 'transcribe', 'lyria', 'antigravity', 'embedding',
  'preview-tts', '-image-preview', '-image',
];

const PREFERRED_PREFIXES = ['gemini-3.8', 'gemini-3.7', 'gemini-3.6', 'gemini-3.5', 'gemini-3.1'];

function isExcludedModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_PATTERNS.some(p => lower.includes(p));
}

function modelSortScore(name: string): number {
  for (let i = 0; i < PREFERRED_PREFIXES.length; i++) {
    if (name.startsWith(PREFERRED_PREFIXES[i])) return i;
  }
  if (name.startsWith('gemini-3.')) return PREFERRED_PREFIXES.length;
  if (name.startsWith('gemini-2.5')) return PREFERRED_PREFIXES.length + 1;
  return PREFERRED_PREFIXES.length + 2;
}

export class GeminiProvider extends BaseTranslationProvider {
  name = 'gemini' as const;
  
  private apiKey: string = '';
  private model: string = '';
  private availableModels: ModelInfo[] = [];
  
  constructor(apiKey: string, model: string = '') {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }
  
  setConfig(apiKey: string, model: string): void {
    this.apiKey = apiKey;
    this.model = model;
    this.availableModels = [];
  }
  
  getModels(): string[] {
    return this.availableModels.map(m => m.name);
  }
  
  getAvailableModels(): ModelInfo[] {
    return this.availableModels;
  }
  
  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    const rawModels: any[] = data.models || [];
    
    const filtered = rawModels
      .filter((m: any) => {
        const methods = m.supportedGenerationMethods || [];
        if (!methods.includes('generateContent')) return false;
        
        const name: string = m.name || '';
        if (isExcludedModel(name)) return false;
        
        return true;
      })
      .map((m: any) => {
        const fullName: string = m.name || '';
        const shortName = fullName.startsWith('models/') ? fullName.slice(7) : fullName;
        
        return {
          name: shortName,
          displayName: m.displayName || shortName,
          description: m.description || '',
          supportedMethods: m.supportedGenerationMethods || [],
          inputTokenLimit: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit,
        };
      })
      .sort((a: ModelInfo, b: ModelInfo) => modelSortScore(a.name) - modelSortScore(b.name));
    
    return filtered;
  }
  
  private async testModel(apiKey: string, modelName: string): Promise<boolean> {
    try {
      const url = `${GEMINI_API_BASE}/models/${modelName}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  
  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    let models: ModelInfo[] = [];
    
    try {
      models = await this.listModels(config.apiKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: 'Failed to list models', details: msg };
    }
    
    if (models.length === 0) {
      return {
        success: false,
        message: 'No compatible models found',
        details: 'No text-generation models available for this API key.',
      };
    }
    
    this.availableModels = models;
    
    let workingModel: ModelInfo | null = null;
    for (const m of models) {
      const ok = await this.testModel(config.apiKey, m.name);
      if (ok) {
        workingModel = m;
        break;
      }
    }
    
    if (!workingModel) {
      return {
        success: false,
        message: 'No working models found',
        details: `Tested ${models.length} models, all failed.`,
        availableModels: models,
      };
    }
    
    this.model = workingModel.name;
    
    return {
      success: true,
      message: `Connection successful! Using: ${workingModel.displayName}`,
      availableModels: models,
    };
  }
  
  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.apiKey) {
      return { translatedText: '', success: false, error: 'API key not configured' };
    }
    if (!this.model) {
      return { translatedText: '', success: false, error: 'No model selected' };
    }
    
    try {
      const prompt = this.buildPrompt(request);
      const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        return { translatedText: '', success: false, error: `Gemini API error: ${errorMessage}` };
      }
      
      const data = await response.json();
      const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      
      if (!translatedText) {
        return { translatedText: '', success: false, error: 'Empty response from Gemini' };
      }
      
      return { translatedText, success: true };
    } catch (error) {
      return {
        translatedText: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown translation error',
      };
    }
  }
}