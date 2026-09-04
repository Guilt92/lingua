import { TranslationProvider, TranslationRequest, TranslationResponse, ProviderConfig, ConnectionTestResult } from '../types';

export abstract class BaseTranslationProvider implements TranslationProvider {
  abstract name: 'gemini';
  
  abstract translate(request: TranslationRequest): Promise<TranslationResponse>;
  abstract testConnection(config: ProviderConfig): Promise<ConnectionTestResult>;
  abstract getModels(): string[];
  
  protected buildPrompt(request: TranslationRequest): string {
    const { text, sourceLanguage, targetLanguage, mode, context } = request;
    
    const languageNames: Record<string, string> = {
      en: 'English',
      fa: 'Persian (Farsi)',
    };
    
    const sourceLangName = languageNames[sourceLanguage] || sourceLanguage;
    const targetLangName = languageNames[targetLanguage] || targetLanguage;
    
    const modeInstructions = mode === 'technical'
      ? `This is a technical document. Preserve technical terminology (e.g., Kubernetes, Docker, API, Linux, Rust, Ingress, Pod, Deployment, Load Balancer, Container, etc.) in English unless there is a well-established Persian equivalent that improves readability. Preserve code snippets, commands, URLs, API names, programming languages, and proper nouns exactly as they appear.`
      : `Translate naturally and fluently. Use natural Persian expressions and idioms where appropriate.`;
    
    const bidiInstructions = `
IMPORTANT - Bidirectional Text Handling:
- The output will be displayed in a right-to-left (RTL) context for Persian
- Technical terms, code, URLs, file paths, and numbers MUST remain in their original left-to-right (LTR) form
- Do NOT translate: Kubernetes, Docker, Linux, Rust, API, Ingress, Pod, Deployment, Load Balancer, Container, HTTP, HTTPS, TCP, UDP, DNS, SSL, TLS, SSH, Git, GitHub, GitLab, CI/CD, YAML, JSON, XML, HTML, CSS, JavaScript, TypeScript, Python, Go, Java, C++, C#, React, Vue, Angular, Node.js, npm, kubectl, helm, istio, prometheus, grafana, elasticsearch, logstash, kibana, fluentd, filebeat, nginx, apache, redis, postgresql, mysql, mongodb, cassandra, kafka, rabbitmq, terraform, ansible, vagrant, packer, vault, consul, nomad
- Do NOT translate URLs (https://...), file paths (/path/to/file, C:\\path\\to\\file), IP addresses (192.168.1.1), version numbers (v1.2.3), or code snippets
- Preserve punctuation placement correctly for mixed RTL/LTR text
- Use proper Persian punctuation (، ؛ ؟) for Persian text, but keep English punctuation for technical terms`;

    const contextSection = context ? `\nContext from surrounding text:\n${context}\n` : '';
    
    return `You are a professional ${sourceLangName} to ${targetLangName} translator specializing in technical documentation.

${modeInstructions}
${bidiInstructions}

Requirements:
- Translate the following text from ${sourceLangName} to ${targetLangName}
- Preserve the original meaning accurately
- Maintain paragraph and sentence structure
- Do not add explanations, notes, or formatting
- Return ONLY the translated text
${contextSection}
Text to translate:
${text}`;
  }
}