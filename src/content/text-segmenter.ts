import { TextBlock, PageContent } from '../types';

export interface TranslationSegment {
  id: string;
  pageNumber: number;
  textBlockId: string;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  priority: number;
}

export class TextSegmenter {
  private static readonly MAX_SEGMENT_LENGTH = 2000;
  private static readonly MIN_SEGMENT_LENGTH = 50;
  
  segmentPage(pageContent: PageContent): TranslationSegment[] {
    const segments: TranslationSegment[] = [];
    
    for (const block of pageContent.textBlocks) {
      const blockSegments = this.segmentTextBlock(block, pageContent.pageNumber);
      segments.push(...blockSegments);
    }
    
    return this.mergeSmallSegments(segments);
  }
  
  private segmentTextBlock(block: TextBlock, pageNumber: number): TranslationSegment[] {
    const text = block.text.trim();
    if (text.length < TextSegmenter.MIN_SEGMENT_LENGTH) {
      return [{
        id: `${block.id}_seg_0`,
        pageNumber,
        textBlockId: block.id,
        text,
        bbox: block.bbox,
        priority: this.calculatePriority(block),
      }];
    }
    
    if (text.length <= TextSegmenter.MAX_SEGMENT_LENGTH) {
      return [{
        id: `${block.id}_seg_0`,
        pageNumber,
        textBlockId: block.id,
        text,
        bbox: block.bbox,
        priority: this.calculatePriority(block),
      }];
    }
    
    return this.splitLongText(text, block, pageNumber);
  }
  
  private splitLongText(text: string, block: TextBlock, pageNumber: number): TranslationSegment[] {
    const segments: TranslationSegment[] = [];
    const sentences = this.splitIntoSentences(text);
    let currentSegment = '';
    let segmentIndex = 0;
    let startY = block.bbox.y;
    
    for (const sentence of sentences) {
      if (currentSegment.length + sentence.length > TextSegmenter.MAX_SEGMENT_LENGTH && currentSegment.length > 0) {
        segments.push({
          id: `${block.id}_seg_${segmentIndex++}`,
          pageNumber,
          textBlockId: block.id,
          text: currentSegment.trim(),
          bbox: { ...block.bbox, y: startY, height: block.bbox.height * (currentSegment.length / text.length) },
          priority: this.calculatePriority(block),
        });
        currentSegment = sentence;
        startY += block.bbox.height * (currentSegment.length / text.length);
      } else {
        currentSegment += (currentSegment ? ' ' : '') + sentence;
      }
    }
    
    if (currentSegment.trim()) {
      segments.push({
        id: `${block.id}_seg_${segmentIndex}`,
        pageNumber,
        textBlockId: block.id,
        text: currentSegment.trim(),
        bbox: { ...block.bbox, y: startY },
        priority: this.calculatePriority(block),
      });
    }
    
    return segments;
  }
  
  private splitIntoSentences(text: string): string[] {
    const abbreviations = ['e.g.', 'i.e.', 'etc.', 'vs.', 'Dr.', 'Mr.', 'Mrs.', 'Prof.', 'Sr.', 'Jr.', 'No.', 'Fig.', 'Eq.', 'Ref.'];
    let modifiedText = text;
    
    for (const abbr of abbreviations) {
      modifiedText = modifiedText.replace(new RegExp(abbr.replace('.', '\\.'), 'g'), abbr.replace('.', '<DOT>'));
    }
    
    const sentences = modifiedText
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map(s => s.replace(/<DOT>/g, '.'))
      .filter(s => s.trim().length > 0);
    
    return sentences.length > 0 ? sentences : [text];
  }
  
  private mergeSmallSegments(segments: TranslationSegment[]): TranslationSegment[] {
    if (segments.length <= 1) return segments;
    
    const merged: TranslationSegment[] = [];
    let current = segments[0];
    
    for (let i = 1; i < segments.length; i++) {
      const next = segments[i];
      
      if (current.text.length < TextSegmenter.MIN_SEGMENT_LENGTH &&
          next.text.length < TextSegmenter.MIN_SEGMENT_LENGTH &&
          current.pageNumber === next.pageNumber &&
          current.textBlockId === next.textBlockId) {
        current = {
          ...current,
          text: current.text + ' ' + next.text,
          bbox: {
            x: Math.min(current.bbox.x, next.bbox.x),
            y: Math.min(current.bbox.y, next.bbox.y),
            width: Math.max(current.bbox.x + current.bbox.width, next.bbox.x + next.bbox.width) - Math.min(current.bbox.x, next.bbox.x),
            height: Math.max(current.bbox.y + current.bbox.height, next.bbox.y + next.bbox.height) - Math.min(current.bbox.y, next.bbox.y),
          },
        };
      } else {
        merged.push(current);
        current = next;
      }
    }
    
    merged.push(current);
    return merged;
  }
  
  private calculatePriority(block: TextBlock): number {
    let priority = 100;
    
    if (block.bbox.y < 200) priority -= 50;
    if (block.text.length > 500) priority += 10;
    if (block.text.match(/^[A-Z][^.!?]*[.!?]$/)) priority -= 10;
    
    return priority;
  }
  
  getContextForSegment(segment: TranslationSegment, allSegments: TranslationSegment[]): string {
    const sameBlock = allSegments.filter(s => 
      s.pageNumber === segment.pageNumber && 
      s.textBlockId === segment.textBlockId &&
      s.id !== segment.id
    );
    
    const before = sameBlock
      .filter(s => s.bbox.y < segment.bbox.y)
      .sort((a, b) => b.bbox.y - a.bbox.y)
      .slice(0, 2)
      .map(s => s.text)
      .reverse()
      .join(' ');
    
    const after = sameBlock
      .filter(s => s.bbox.y > segment.bbox.y)
      .sort((a, b) => a.bbox.y - b.bbox.y)
      .slice(0, 1)
      .map(s => s.text)
      .join(' ');
    
    return [before, after].filter(Boolean).join(' | ');
  }
}

export const textSegmenter = new TextSegmenter();