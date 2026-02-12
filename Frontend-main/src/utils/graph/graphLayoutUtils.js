/**
 * graphLayoutUtils.js : 그래프 레이아웃 관련 유틸리티 함수 모음
 * 
 * [주요 기능]
 * 1. 레이아웃 복원: 저장된 그래프 레이아웃을 복원하여 뷰 상태에 적용
 * 2. 레이아웃 사전 로드: 챕터별 그래프 레이아웃을 미리 생성하여 저장
 * 
 * [사용처]
 * - ViewerPage: 그래프 레이아웃 복원 및 사전 로드
 */

import cytoscape from 'cytoscape';
import { createStorageKey } from '../../hooks/common/useLocalStorage';
import { extractEventNodesAndEdges } from '../viewerUtils';
import { 
  getDetectedMaxChapter, 
  getCharactersDataFromMaxChapter, 
  getEventsForChapter 
} from './graphData';
import { createCharacterMaps } from '../characterUtils';
import { convertRelationsToElements } from './graphDataUtils';
import { errorUtils } from '../common/errorUtils';

/**
 * 그래프 레이아웃 복원
 * @param {Object} currentEvent - 현재 이벤트 객체
 * @param {number} currentChapter - 현재 챕터 번호
 * @returns {Object|null} 복원된 레이아웃 객체 (실패 시 null)
 */
export function restoreGraphLayout(currentEvent, currentChapter) {
  if (!currentEvent || typeof currentEvent !== 'object') {
    return null;
  }
  
  if (typeof currentChapter !== 'number' || !Number.isFinite(currentChapter) || currentChapter < 0) {
    return null;
  }

  try {
    const mergedLayout = {};
    const currentEventNum = typeof currentEvent.eventNum === 'number' ? currentEvent.eventNum : 0;
    
    for (let eventNum = 0; eventNum <= currentEventNum; eventNum++) {
      const eventKey = createStorageKey.graphEventLayout(currentChapter, eventNum);
      const eventLayoutStr = localStorage.getItem(eventKey);
      
      if (eventLayoutStr) {
        try {
          const eventLayout = JSON.parse(eventLayoutStr);
          if (eventLayout && typeof eventLayout === 'object') {
            Object.assign(mergedLayout, eventLayout);
          }
        } catch (e) {
          errorUtils.logWarning('[graphLayoutUtils] 레이아웃 파싱 오류', e.message, { chapter: currentChapter, eventNum });
        }
      }
    }
    
    const nodesAndEdges = extractEventNodesAndEdges(currentEvent);
    if (!nodesAndEdges || typeof nodesAndEdges !== 'object') {
      return null;
    }
    
    const { nodes: currentNodes, edges: currentEdges } = nodesAndEdges;
    if (!currentNodes || !currentEdges || typeof currentNodes.has !== 'function' || typeof currentEdges.has !== 'function') {
      return null;
    }
    
    const finalLayout = {};
    Object.entries(mergedLayout).forEach(([key, value]) => {
      if (currentNodes.has(key) || currentEdges.has(key)) {
        finalLayout[key] = value;
      }
    });
    
    return finalLayout;
  } catch (e) {
    errorUtils.logWarning('[graphLayoutUtils] 그래프 레이아웃 복원 오류', e.message, { chapter: currentChapter });
    return null;
  }
}

/**
 * 챕터 레이아웃 생성 및 저장
 * @param {Object} params - 파라미터 객체
 * @param {string} params.folderKey - 폴더 키
 * @param {string} params.bookKey - 책 키
 * @param {number} params.chapterNum - 챕터 번호
 * @param {AbortSignal} params.signal - 취소 신호
 * @returns {Promise<Object|null>} 생성된 레이아웃 객체 (실패 시 null)
 */
async function generateChapterLayout({ folderKey, bookKey, chapterNum, signal }) {
  if (signal?.aborted) return null;

  if (!bookKey || typeof bookKey !== 'string') {
    return null;
  }

  const storageKey = createStorageKey.chapterNodePositions(bookKey, chapterNum);
  if (localStorage.getItem(storageKey)) {
    return null;
  }
  
  let cy = null;
  
  try {
    if (!folderKey || typeof folderKey !== 'string') {
      return null;
    }
    
    if (typeof chapterNum !== 'number' || !Number.isFinite(chapterNum) || chapterNum < 1) {
      return null;
    }
    
    const characterDataObj = getCharactersDataFromMaxChapter(folderKey);
    if (!characterDataObj) return null;
    
    const charactersData = characterDataObj.characters || characterDataObj;
    if (!charactersData || !Array.isArray(charactersData) || charactersData.length === 0) return null;
    
    const events = getEventsForChapter(chapterNum, folderKey);
    if (!events || events.length === 0) return null;
    
    const lastEvent = events[events.length - 1];
    if (!lastEvent || typeof lastEvent !== 'object') return null;
    
    const allRelations = lastEvent.relations || [];
    
    const { idToName, idToDesc, idToDescKo, idToMain, idToNames } = createCharacterMaps({ characters: charactersData });
    
    const elements = convertRelationsToElements(
      allRelations,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      folderKey,
      null,
      null,
      lastEvent
    );
    if (!elements || elements.length === 0) return null;
    
    if (signal?.aborted) return null;
    
    cy = cytoscape({
      elements,
      style: [],
      headless: true,
    });
    
    const layout = cy.layout({
      name: "cose",
      animate: false,
      fit: true,
      padding: 80,
    });
    
    await new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      
      let timeoutId = null;
      let resolved = false;
      
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve();
      };
      
      layout.one('layoutstop', cleanup);
      layout.run();
      
      timeoutId = setTimeout(() => {
        if (!resolved) {
          errorUtils.logWarning('[graphLayoutUtils] 레이아웃 타임아웃', `챕터 ${chapterNum} 레이아웃 생성이 30초 내에 완료되지 않음`);
          cleanup();
        }
      }, 30000);
    });
    
    if (signal?.aborted) {
      if (cy) {
        cy.destroy();
        cy = null;
      }
      return null;
    }
    
    if (!cy) return null;
    
    const layoutObj = {};
    cy.nodes().forEach((node) => {
      const nodeId = node.id();
      const position = node.position();
      if (nodeId && position && typeof position === 'object') {
        layoutObj[nodeId] = position;
      }
    });
    
    if (Object.keys(layoutObj).length === 0) {
      if (cy) {
        cy.destroy();
        cy = null;
      }
      return null;
    }
    
    try {
      localStorage.setItem(storageKey, JSON.stringify(layoutObj));
    } catch (e) {
      const errorInfo = {
        chapter: chapterNum,
        bookKey,
        errorName: e.name,
        errorMessage: e.message,
        storageKeyLength: storageKey.length,
        layoutObjSize: JSON.stringify(layoutObj).length
      };
      
      if (e.name === 'QuotaExceededError') {
        errorUtils.logWarning('[graphLayoutUtils] 레이아웃 저장 실패: 저장 공간 부족', e.message, errorInfo);
      } else {
        errorUtils.logWarning('[graphLayoutUtils] 레이아웃 저장 실패', e.message, errorInfo);
      }
    }
    
    if (cy) {
      cy.destroy();
      cy = null;
    }
    
    return layoutObj;
  } catch (error) {
    if (cy) {
      try {
        cy.destroy();
      } catch (destroyError) {
        errorUtils.logWarning('[graphLayoutUtils] Cytoscape 인스턴스 정리 실패', destroyError.message);
      }
      cy = null;
    }
    
    if (!signal?.aborted) {
      errorUtils.logWarning('[graphLayoutUtils] 챕터 레이아웃 생성 실패', error.message, {
        chapter: chapterNum,
        bookKey,
        folderKey,
        errorName: error.name
      });
    }
    return null;
  }
}

/**
 * 챕터 레이아웃 사전 로드
 * @param {Object} params - 파라미터 객체
 * @param {string} params.folderKey - 폴더 키
 * @param {string} params.bookKey - 책 키
 * @param {AbortSignal} params.signal - 취소 신호
 * @param {Function} params.onProgress - 진행 상황 콜백 (선택사항)
 * @returns {Promise<void>}
 */
export async function preloadChapterLayouts({ folderKey, bookKey, signal, onProgress }) {
  if (!folderKey || typeof folderKey !== 'string' || !bookKey || typeof bookKey !== 'string') {
    return;
  }

  const maxChapterCount = getDetectedMaxChapter(folderKey);
  if (maxChapterCount === 0) {
    if (onProgress) {
      onProgress({ processed: 0, total: 0 });
    }
    return;
  }
  
  const chapterNums = Array.from({ length: maxChapterCount }, (_, i) => i + 1);
  let processedCount = 0;
  
  try {
    for (let i = 0; i < chapterNums.length; i += 3) {
      if (signal?.aborted) {
        if (onProgress) {
          onProgress({ processed: processedCount, total: chapterNums.length });
        }
        break;
      }
      
      const batch = chapterNums.slice(i, i + 3);
      const promises = batch.map(async (chapterNum) => {
        if (signal?.aborted) return null;
        try {
          return await generateChapterLayout({ folderKey, bookKey, chapterNum, signal });
        } catch (error) {
          if (!signal?.aborted) {
            errorUtils.logWarning('[graphLayoutUtils] 배치 레이아웃 생성 실패', error.message, { chapter: chapterNum });
          }
          return null;
        }
      });
      
      const results = await Promise.all(promises);
      processedCount += results.filter(r => r !== null).length;
      
      if (onProgress) {
        onProgress({ processed: Math.min(i + 3, chapterNums.length), total: chapterNums.length });
      }
      
      if (i + 3 < chapterNums.length && !signal?.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    if (onProgress && !signal?.aborted) {
      onProgress({ processed: chapterNums.length, total: chapterNums.length });
    }
  } catch (error) {
    if (!signal?.aborted) {
      errorUtils.logWarning('[graphLayoutUtils] 레이아웃 사전 로드 실패', error.message, {
        folderKey,
        bookKey,
        processed: processedCount,
        total: chapterNums.length,
        errorName: error.name
      });
    }
    
    if (onProgress) {
      onProgress({ processed: processedCount, total: chapterNums.length });
    }
  }
}
