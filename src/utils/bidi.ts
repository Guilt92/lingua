const RLM = '\u200F';
const LRM = '\u200E';
const RLE = '\u202B';
const PDF = '\u202C';
const LRE = '\u202A';

const PERSIAN_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_PUNCTUATION = /[\u060C\u061B\u061F\u066A-\u066D]/;

export function hasPersian(text: string): boolean {
  return PERSIAN_RANGE.test(text);
}

export function isMostlyPersian(text: string): boolean {
  const persianChars = (text.match(PERSIAN_RANGE) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  return persianChars / totalChars > 0.3;
}

export function wrapLTR(text: string): string {
  return `${LRE}${text}${PDF}`;
}

export function wrapRTL(text: string): string {
  return `${RLE}${text}${PDF}`;
}

export function addDirectionMarks(text: string): string {
  const segments = splitByDirection(text);
  return segments.map(({ text: t, isRTL }) => 
    isRTL ? `${RLM}${t}${LRM}` : t
  ).join('');
}

interface DirectionSegment {
  text: string;
  isRTL: boolean;
}

function splitByDirection(text: string): DirectionSegment[] {
  const segments: DirectionSegment[] = [];
  let current = '';
  let currentIsRTL = false;
  
  for (const char of text) {
    const charIsRTL = PERSIAN_RANGE.test(char) || ARABIC_PUNCTUATION.test(char);
    
    if (current === '' || charIsRTL === currentIsRTL) {
      current += char;
      currentIsRTL = charIsRTL;
    } else {
      segments.push({ text: current, isRTL: currentIsRTL });
      current = char;
      currentIsRTL = charIsRTL;
    }
  }
  
  if (current) {
    segments.push({ text: current, isRTL: currentIsRTL });
  }
  
  return segments;
}

export function sanitizeForHTML(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

export function renderBidiText(text: string): string {
  const sanitized = sanitizeForHTML(text);
  
  const technicalTerms = [
    'Kubernetes', 'Docker', 'Linux', 'Rust', 'API', 'Ingress', 'Pod', 
    'Deployment', 'Load Balancer', 'Container', 'HTTP', 'HTTPS', 'TCP', 
    'UDP', 'DNS', 'SSL', 'TLS', 'SSH', 'Git', 'GitHub', 'GitLab', 'CI/CD',
    'YAML', 'JSON', 'XML', 'HTML', 'CSS', 'JavaScript', 'TypeScript', 'Python',
    'Go', 'Java', 'C++', 'C#', 'React', 'Vue', 'Angular', 'Node.js', 'npm',
    'kubectl', 'helm', 'istio', 'prometheus', 'grafana', 'elasticsearch',
    'logstash', 'kibana', 'fluentd', 'filebeat', 'nginx', 'apache', 'redis',
    'postgresql', 'mysql', 'mongodb', 'cassandra', 'kafka', 'rabbitmq',
    'terraform', 'ansible', 'vagrant', 'packer', 'vault', 'consul', 'nomad'
  ];
  
  const urlRegex = /https?:\/\/[^\s]+/g;
  const filePathRegex = /(?:[A-Za-z]:\\|~\/|\/)(?:[^<>:"|?*\s]+\\)*[^<>:"|?*\s]*/g;
  const codeSnippetRegex = /`[^`]+`/g;
  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const versionRegex = /\bv?\d+\.\d+\.\d+(?:-[\w.]+)?\b/g;
  
  let result = sanitized;
  
  const protectedParts: Array<{ placeholder: string; content: string }> = [];
  let placeholderIndex = 0;
  
  const protectPattern = (regex: RegExp, prefix = '') => {
    result = result.replace(regex, (match) => {
      const placeholder = `__BIDI_PROTECT_${placeholderIndex++}__`;
      protectedParts.push({ placeholder, content: prefix + match });
      return placeholder;
    });
  };
  
  protectPattern(urlRegex);
  protectPattern(filePathRegex);
  protectPattern(codeSnippetRegex);
  protectPattern(ipRegex);
  protectPattern(versionRegex);
  
  for (const term of technicalTerms) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    protectPattern(regex);
  }
  
  const segments = splitByDirection(result);
  
  let html = '';
  for (const { text: segment, isRTL } of segments) {
    if (protectedParts.some(p => segment.includes(p.placeholder))) {
      let processedSegment = segment;
      for (const { placeholder, content } of protectedParts) {
        if (processedSegment.includes(placeholder)) {
          processedSegment = processedSegment.replace(
            placeholder,
            `<span class="lingua-ltr" dir="ltr">${content}</span>`
          );
        }
      }
      html += processedSegment;
    } else if (isRTL) {
      html += `<span class="lingua-rtl" dir="rtl">${segment}</span>`;
    } else {
      html += `<span class="lingua-ltr" dir="ltr">${segment}</span>`;
    }
  }
  
  return html;
}

export function getBaseDirection(text: string): 'rtl' | 'ltr' {
  return isMostlyPersian(text) ? 'rtl' : 'ltr';
}