import { BaseTranslationProvider } from './translation-provider';
import { TranslationRequest, TranslationResponse, ProviderConfig, ConnectionTestResult } from '../types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const AVAILABLE_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.0-pro',
];

export class GeminiProvider extends BaseTranslationProvider {
  name = 'gemini' as const;
  
  private apiKey: string;
  private model: string;
  
  constructor(apiKey: string, model: string = 'gemini-1.5-flash') {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }
  
  setConfig(apiKey: string, model: string): void {
    this.apiKey = apiKey;
    this.model = model;
  }
  
  getModels(): string[] {
    return AVAILABLE_MODELS;
  }
  
  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const url = `${GEMINI_API_BASE}/${config.model}:generateContent?key=${config.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        const errorCode = errorData.error?.code;
        const errorStatus = errorData.error?.status;
        
        let userMessage = 'Connection failed';
        let details = errorMessage;
        
        if (response.status === 400) {
          userMessage = 'Invalid request';
          if (errorMessage.includes('API key')) {
            userMessage = 'Invalid API key format';
          } else if (errorMessage.includes('model')) {
            userMessage = 'Unsupported model';
          }
        } else if (response.status === 401) {
          userMessage = 'Invalid or expired API key';
        } else if (response.status === 403) {
          userMessage = 'API key lacks permissions';
        } else if (response.status === 404) {
          userMessage = 'Model not found';
        } else if (response.status === 429) {
          userMessage = 'Rate limit exceeded';
          details = 'Too many requests. Please wait a moment and try again.';
        } else if (response.status >= 500) {
          userMessage = 'Gemini server error';
          details = 'The service is temporarily unavailable. Please try again later.';
        }
        
        return { 
          success: false, 
          message: userMessage,
          details: `${details} (${errorStatus || errorCode || response.status})`
        };
      }
      
      return { success: true, message: 'Connection successful!' };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { 
          success: false, 
          message: 'Network error', 
          details: 'Unable to reach Gemini API. Check your internet connection.' 
        };
      }
      return { 
        success: false, 
        message: 'Connection failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.apiKey) {
      return { translatedText: '', success: false, error: 'API key not configured' };
    }
    
    try {
      const prompt = this.buildPrompt(request);
      const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`;
      
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
        error: error instanceof Error ? error.message : 'Unknown translation error' 
      };
    }
  }
}