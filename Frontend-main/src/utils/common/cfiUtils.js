/**
 * CFI 처리 공통 유틸리티
 * viewerUtils.js에서 분리하여 공통 모듈로 사용
 */

import { errorUtils } from './errorUtils';

function romanToArabic(roman) {
  if (!roman || typeof roman !== 'string') return 1;
  
  const romanMap = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 
    'C': 100, 'D': 500, 'M': 1000
  };
  
  let result = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = romanMap[roman[i]];
    const next = romanMap[roman[i + 1]];
    
    if (current < next) {
      result -= current;
    } else {
      result += current;
    }
  }
  
  return result || 1;
}

export const cfiUtils = {
  extractChapterNumber(cfi, label = null) {
    const cfiMatch = cfi?.match(/\[chapter-(\d+)\]/);
    if (cfiMatch) return parseInt(cfiMatch[1]);
    
    if (label) {
      const patterns = [
        /Chapter\s+(\d+)/i,
        /(\d+)\s*장/i,
        /^(\d+)$/,
        /Chapter\s+([IVXLCDM]+)/i
      ];
      
      for (const pattern of patterns) {
        const match = label.match(pattern);
        if (match) {
          if (pattern.source.includes('[IVXLCDM]')) {
            return romanToArabic(match[1]);
          }
          return parseInt(match[1]);
        }
      }
    }
    
    return 1;
  },

  isValidCfi(cfi) {
    return cfi && typeof cfi === 'string' && cfi.trim().length > 0;
  },

  extractPageNumber(cfi) {
    if (!this.isValidCfi(cfi)) return null;
    
    const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
    return pageMatch ? parseInt(pageMatch[1]) : null;
  },

  extractParagraphNumber(cfi) {
    if (!this.isValidCfi(cfi)) return null;
    
    const paragraphMatch = cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
    return paragraphMatch ? parseInt(paragraphMatch[1]) : null;
  },

  extractCharOffset(cfi) {
    if (!this.isValidCfi(cfi)) return null;
    
    const offsetMatch = cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
    return offsetMatch ? parseInt(offsetMatch[2]) : null;
  },
  
  async calculateCurrentCfi(book, rendition) {
    try {
      let currentCfi = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && !currentCfi) {
        try {
          const currentLocation = rendition.currentLocation();
          
          if (currentLocation && currentLocation.start && currentLocation.start.cfi) {
            currentCfi = currentLocation.start.cfi;
            break;
          }
          
          if (retryCount < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          retryCount++;
        } catch (error) {
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
      
      return currentCfi;
    } catch (error) {
      return null;
    }
  },
  
  analyzeCfiStructure(cfi) {
    if (!cfi || typeof cfi !== 'string') {
      return {
        isValid: false,
        error: '유효하지 않은 CFI'
      };
    }
    
    const analysis = {
      isValid: true,
      fullCfi: cfi,
      parts: cfi.split('/'),
      hasChapterPattern: false,
      hasPgepubidPattern: false,
      hasPathPattern: false,
      hasPgHeaderPattern: false,
      hasLastNumberPattern: false,
      chapterNumber: null,
      fileId: null,
      pathNumbers: [],
      lastNumber: null,
      patterns: []
    };
    
    const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
      if (chapterMatch) {
      analysis.hasChapterPattern = true;
      analysis.chapterNumber = parseInt(chapterMatch[1]);
      analysis.patterns.push('chapter');
    }
    
    const pgepubidMatch = cfi.match(/\[pgepubid(\d+)\]/);
    if (pgepubidMatch) {
      analysis.hasPgepubidPattern = true;
      analysis.fileId = parseInt(pgepubidMatch[1]);
      analysis.patterns.push('pgepubid');
    }
    
    const pathMatch = cfi.match(/(\d+):(\d+)$/);
    if (pathMatch) {
      analysis.hasPathPattern = true;
      analysis.pathNumbers = [parseInt(pathMatch[1]), parseInt(pathMatch[2])];
      analysis.patterns.push('path');
    }
    
    if (cfi.includes('[pg-header]')) {
      analysis.hasPgHeaderPattern = true;
      analysis.patterns.push('pg-header');
    }
    
    const lastNumberMatch = cfi.match(/(\d+)(?!.*\d)/);
    if (lastNumberMatch) {
      analysis.hasLastNumberPattern = true;
      analysis.lastNumber = parseInt(lastNumberMatch[1]);
      analysis.patterns.push('last-number');
    }
    
    return analysis;
  },
  
  calculateNextCfiVariants(currentCfi, cfiAnalysis) {
    const variants = [];
    
    if (cfiAnalysis.hasChapterPattern) {
      const nextChapter = cfiAnalysis.chapterNumber + 1;
      const chapterVariant = currentCfi.replace(/\[chapter-\d+\]/, `[chapter-${nextChapter}]`);
      variants.push({
        method: 'chapter',
        cfi: chapterVariant,
        confidence: 0.9,
        description: `Chapter ${cfiAnalysis.chapterNumber} → ${nextChapter}`
      });
    }
    
    if (cfiAnalysis.hasPgepubidPattern) {
      const nextFileId = cfiAnalysis.fileId + 1;
      const pgepubidVariant = currentCfi.replace(/\[pgepubid\d+\]/, `[pgepubid${nextFileId}]`);
      variants.push({
        method: 'pgepubid',
        cfi: pgepubidVariant,
        confidence: 0.8,
        description: `File ID ${cfiAnalysis.fileId} → ${nextFileId}`
      });
    }
    
    if (cfiAnalysis.hasPathPattern) {
      const [currentPath, currentOffset] = cfiAnalysis.pathNumbers;
        const nextPath = currentPath + 1;
      const pathVariant = currentCfi.replace(/\d+:\d+$/, `${nextPath}:0`);
      variants.push({
        method: 'path',
        cfi: pathVariant,
        confidence: 0.7,
        description: `Path ${currentPath} → ${nextPath}`
      });
    }
    
    if (cfiAnalysis.hasPgHeaderPattern) {
      const pgHeaderVariants = [
        currentCfi.replace(/\[pg-header\]/, '[pg-start-separator]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-content]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-body]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-text]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-chapter]')
      ];
      
      pgHeaderVariants.forEach((variant, index) => {
        variants.push({
          method: 'pg-header',
          cfi: variant,
          confidence: 0.6 - (index * 0.1),
          description: `Pg-header → Section ${index + 1}`
        });
      });
    }
    
    if (cfiAnalysis.hasLastNumberPattern) {
      const nextNumber = cfiAnalysis.lastNumber + 1;
      const lastNumberVariant = currentCfi.replace(/\d+(?!.*\d)/, nextNumber.toString());
      variants.push({
        method: 'last-number',
        cfi: lastNumberVariant,
        confidence: 0.5,
        description: `Last number ${cfiAnalysis.lastNumber} → ${nextNumber}`
      });
    }
    
    if (cfiAnalysis.patterns.length > 1) {
      const combinedVariant = this.createCombinedVariant(currentCfi, cfiAnalysis);
      if (combinedVariant) {
        variants.push({
          method: 'combined',
          cfi: combinedVariant,
          confidence: 0.85,
          description: 'Combined pattern approach'
        });
      }
    }
    
    return variants.sort((a, b) => b.confidence - a.confidence);
  },
  
  createCombinedVariant(currentCfi, cfiAnalysis) {
    let variant = currentCfi;
    
    if (cfiAnalysis.hasChapterPattern) {
      const nextChapter = cfiAnalysis.chapterNumber + 1;
      variant = variant.replace(/\[chapter-\d+\]/, `[chapter-${nextChapter}]`);
    }
    
    if (cfiAnalysis.hasPgepubidPattern) {
      const nextFileId = cfiAnalysis.fileId + 1;
      variant = variant.replace(/\[pgepubid\d+\]/, `[pgepubid${nextFileId}]`);
    }
    
    if (cfiAnalysis.hasPathPattern) {
      const [currentPath] = cfiAnalysis.pathNumbers;
      const nextPath = currentPath + 1;
      variant = variant.replace(/\d+:\d+$/, `${nextPath}:0`);
    }
    
    return variant !== currentCfi ? variant : null;
  },
  
  async getNextCfi(book, rendition, currentCfi) {
    errorUtils.logInfo('getNextCfi', '다양한 CFI 처리 시작', { currentCfi });
    
    try {
      const cfiAnalysis = this.analyzeCfiStructure(currentCfi);
      errorUtils.logInfo('getNextCfi', 'CFI 구조 상세 분석 완료', cfiAnalysis);
      
      if (!cfiAnalysis.isValid) {
        errorUtils.logError('getNextCfi', 'CFI 분석 실패', cfiAnalysis.error);
        return null;
      }
      
      const cfiVariants = this.calculateNextCfiVariants(currentCfi, cfiAnalysis);
      errorUtils.logInfo('getNextCfi', 'CFI 변형들 생성 완료', { count: cfiVariants.length });
      
      if (cfiAnalysis.hasChapterPattern) {
        const currentChapter = cfiAnalysis.chapterNumber;
        const nextChapter = currentChapter + 1;
        
        errorUtils.logInfo('getNextCfi', '[chapter-X] 패턴 발견', { currentChapter, nextChapter });
        
        if (book.navigation?.toc) {
          const nextChapterItem = book.navigation.toc.find(item => {
            const chapterMatch = item.cfi?.match(/\[chapter-(\d+)\]/);
            return chapterMatch && parseInt(chapterMatch[1]) === nextChapter;
          });
          
          if (nextChapterItem?.href) {
            errorUtils.logSuccess('getNextCfi', 'Navigation Document에서 다음 챕터 href 발견', { href: nextChapterItem.href });
            return nextChapterItem.href;
          }
        }
      }
      
      for (const variant of cfiVariants) {
        errorUtils.logInfo('getNextCfi', `${variant.method} 방법 시도`, {
          cfi: variant.cfi,
          confidence: variant.confidence,
          description: variant.description
        });
        
        if (this.validateCfi(variant.cfi)) {
          errorUtils.logSuccess('getNextCfi', `${variant.method} 방법 유효한 CFI 생성`, { cfi: variant.cfi });
          return variant.cfi;
        } else {
          errorUtils.logWarning('getNextCfi', `${variant.method} 방법 CFI 유효성 검사 실패`, { cfi: variant.cfi });
        }
      }
      
      errorUtils.logWarning('getNextCfi', '모든 CFI 계산 방법 실패');
      return null;
    } catch (error) {
      errorUtils.logError('getNextCfi', error);
      return null;
    }
  },
  
  validateCfi(cfi) {
    if (!this.isValidCfi(cfi)) return false;
    if (!cfi.includes('epubcfi')) return false;
    if (cfi.length < 10 || cfi.length > 1000) return false;
    
    const cfiParts = cfi.split('/');
    if (cfiParts.length < 3) return false;
    
    const hasValidNumbers = /\d+/.test(cfi);
    if (!hasValidNumbers) return false;
    
    const hasInvalidChars = /[<>"']/.test(cfi);
    if (hasInvalidChars) return false;
    
    return true;
  },
  
  calculatePrevCfiVariants(currentCfi, cfiAnalysis) {
    const variants = [];
    
    if (cfiAnalysis.hasChapterPattern && cfiAnalysis.chapterNumber > 1) {
      const prevChapter = cfiAnalysis.chapterNumber - 1;
      const chapterVariant = currentCfi.replace(/\[chapter-\d+\]/, `[chapter-${prevChapter}]`);
      variants.push({
        method: 'chapter',
        cfi: chapterVariant,
        confidence: 0.9,
        description: `Chapter ${cfiAnalysis.chapterNumber} → ${prevChapter}`
      });
    }
    
    if (cfiAnalysis.hasPgepubidPattern && cfiAnalysis.fileId > 0) {
      const prevFileId = cfiAnalysis.fileId - 1;
      const pgepubidVariant = currentCfi.replace(/\[pgepubid\d+\]/, `[pgepubid${prevFileId}]`);
      variants.push({
        method: 'pgepubid',
        cfi: pgepubidVariant,
        confidence: 0.8,
        description: `File ID ${cfiAnalysis.fileId} → ${prevFileId}`
      });
    }
    
    if (cfiAnalysis.hasPathPattern && cfiAnalysis.pathNumbers[0] > 0) {
      const [currentPath] = cfiAnalysis.pathNumbers;
      const prevPath = currentPath - 1;
      const pathVariant = currentCfi.replace(/\d+:\d+$/, `${prevPath}:0`);
      variants.push({
        method: 'path',
        cfi: pathVariant,
        confidence: 0.7,
        description: `Path ${currentPath} → ${prevPath}`
      });
    }
    
    if (cfiAnalysis.hasLastNumberPattern && cfiAnalysis.lastNumber > 0) {
      const prevNumber = cfiAnalysis.lastNumber - 1;
      const lastNumberVariant = currentCfi.replace(/\d+(?!.*\d)/, prevNumber.toString());
      variants.push({
        method: 'last-number',
        cfi: lastNumberVariant,
        confidence: 0.5,
        description: `Last number ${cfiAnalysis.lastNumber} → ${prevNumber}`
      });
    }
    
    return variants.sort((a, b) => b.confidence - a.confidence);
  },
  
  async getPrevCfi(book, rendition, currentCfi) {
    try {
      const cfiAnalysis = this.analyzeCfiStructure(currentCfi);
      
      if (!cfiAnalysis.isValid) {
        console.error('❌ CFI 분석 실패:', cfiAnalysis.error);
          return null;
        }
      
      const cfiVariants = this.calculatePrevCfiVariants(currentCfi, cfiAnalysis);
      
      if (cfiAnalysis.hasChapterPattern && cfiAnalysis.chapterNumber > 1) {
        const currentChapter = cfiAnalysis.chapterNumber;
        const prevChapter = currentChapter - 1;

        if (book.navigation?.toc) {
          const prevChapterItem = book.navigation.toc.find(item => {
            const chapterMatch = item.cfi?.match(/\[chapter-(\d+)\]/);
            return chapterMatch && parseInt(chapterMatch[1]) === prevChapter;
          });
          
          if (prevChapterItem?.href) {
            return prevChapterItem.href;
          }
        }
      }
      
      for (const variant of cfiVariants) {
        if (this.validateCfi(variant.cfi)) {
          return variant.cfi;
        }
      }
      
      console.warn('⚠️ 모든 CFI 계산 방법 실패');
      return null;
    } catch (error) {
      console.error('❌ 이전 CFI 계산 중 오류:', error);
          return null;
        }
  },
  
  async getSpineNavigation(book, rendition, direction) {
    try {
      const currentLocation = rendition.currentLocation();
      if (!currentLocation?.start?.spinePos && currentLocation?.start?.spinePos !== 0) {
        console.warn('⚠️ 현재 spine 위치를 찾을 수 없습니다');
        return null;
      }
      
      const currentSpineIndex = currentLocation.start.spinePos;
      const totalSpineItems = book.spine?.length || 0;
      
      let targetSpineIndex;
      
      if (direction === 'next') {
        targetSpineIndex = currentSpineIndex + 1;
        if (targetSpineIndex >= totalSpineItems) {
          return null;
        }
      } else if (direction === 'prev') {
        targetSpineIndex = currentSpineIndex - 1;
        if (targetSpineIndex < 0) {
          return null;
        }
      } else {
        console.warn('⚠️ 잘못된 방향입니다:', direction);
          return null;
        }
        
      const targetSpineItem = book.spine.get(targetSpineIndex);
      if (!targetSpineItem) {
        console.warn('⚠️ 대상 spine 항목을 찾을 수 없습니다:', targetSpineIndex);
        return null;
      }
      
      return {
        type: 'spine',
        index: targetSpineIndex,
        href: targetSpineItem.href
      };
      
    } catch (error) {
      console.error('❌ Spine 기반 이동 계산 중 오류:', error);
      return null;
    }
  },
  
  async navigateWithFallback(book, rendition, direction) {
    try {
      if (!book || !rendition) {
        return { success: false, error: 'Book 또는 Rendition 없음' };
      }
      
      if (!book.spine || book.spine.length === 0) {
        return { 
          success: false, 
          error: '뷰어가 완전히 로드되지 않았습니다. 새로고침해주세요.' 
        };
      }
      let beforeLocation = null;
      let beforeCfi = null;
      
      try {
        beforeLocation = rendition.currentLocation();
        beforeCfi = beforeLocation?.start?.cfi;
      } catch (error) {
        // ignore
      }
      
      try {
        await (direction === 'next' ? rendition.next() : rendition.prev());
      } catch (navError) {
        return { success: false, error: `이동 실패: ${navError.message}` };
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
      let afterLocation = null;
      let afterCfi = null;
      let verified = false;
      
      for (let i = 0; i < 5; i++) {
        try {
          afterLocation = rendition.currentLocation();
          afterCfi = afterLocation?.start?.cfi;
          
            if (afterCfi && afterCfi !== beforeCfi) {
              verified = true;
              break;
            }
        } catch (error) {
          // retry
        }
        
        if (i < 4) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      if (!verified) {
        const isAtStart = beforeLocation?.start?.spinePos === 0 && direction === 'prev';
        const isAtEnd = beforeLocation?.start?.spinePos === (book.spine.length - 1) && direction === 'next';
        
        let errorMessage = '페이지가 이동하지 않았습니다.';
        if (isAtStart) {
          errorMessage = '첫 페이지입니다.';
        } else if (isAtEnd) {
          errorMessage = '마지막 페이지입니다.';
        }
        
        return { 
          success: false, 
          error: errorMessage,
          isAtStart,
          isAtEnd
        };
      }
      
      return { 
        success: true, 
        method: 'basic', 
        target: direction,
        beforeCfi,
        afterCfi
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

