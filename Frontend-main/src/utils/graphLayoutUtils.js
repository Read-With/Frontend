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
import { createStorageKey } from '../hooks/common/useLocalStorage';
import { extractEventNodesAndEdges } from './viewerUtils';
import { 
  getDetectedMaxChapter, 
  getCharactersDataFromMaxChapter, 
  getEventsForChapter 
} from './graphData';
import { createCharacterMaps } from './characterUtils';
import { convertRelationsToElements } from './graphDataUtils';
import { errorUtils } from './common/errorUtils';

/**
 * 그래프 레이아웃 복원
 * @param {Object} currentEvent - 현재 이벤트 객체
 * @param {number} currentChapter - 현재 챕터 번호
 * @returns {Object|null} 복원된 레이아웃 객체 (실패 시 null)
 */
export function restoreGraphLayout(currentEvent, currentChapter) {
  if (!currentEvent || !currentChapter) {
    return null;
  }

  try {
    const mergedLayout = {};
    const currentEventNum = currentEvent.eventNum || 0;
    
    for (let eventNum = 0; eventNum <= currentEventNum; eventNum++) {
      const eventKey = createStorageKey.graphEventLayout(currentChapter, eventNum);
      const eventLayoutStr = localStorage.getItem(eventKey);
      
      if (eventLayoutStr) {
        try {
          const eventLayout = JSON.parse(eventLayoutStr);
          Object.assign(mergedLayout, eventLayout);
        } catch (e) {
          errorUtils.logWarning('[graphLayoutUtils] 레이아웃 파싱 오류', e.message);
        }
      }
    }
    
    const { nodes: currentNodes, edges: currentEdges } = extractEventNodesAndEdges(currentEvent);
    
    const finalLayout = {};
    Object.entries(mergedLayout).forEach(([key, value]) => {
      if (currentNodes.has(key) || currentEdges.has(key)) {
        finalLayout[key] = value;
      }
    });
    
    return finalLayout;
  } catch (e) {
    errorUtils.logWarning('[graphLayoutUtils] 그래프 레이아웃 복원 오류', e.message);
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

  const storageKey = createStorageKey.chapterNodePositions(bookKey, chapterNum);
  if (localStorage.getItem(storageKey)) {
    return null;
  }
  
  try {
    if (!folderKey) {
      return null;
    }
    
    const characterDataObj = getCharactersDataFromMaxChapter(folderKey);
    if (!characterDataObj) return null;
    
    const charactersData = characterDataObj.characters || characterDataObj;
    if (!charactersData || !Array.isArray(charactersData) || charactersData.length === 0) return null;
    
    const events = getEventsForChapter(chapterNum, folderKey);
    if (!events || events.length === 0) return null;
    
    const lastEvent = events[events.length - 1];
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
    
    const cy = cytoscape({
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
    
    await new Promise(resolve => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      layout.one('layoutstop', resolve);
      layout.run();
    });
    
    if (signal?.aborted) {
      cy.destroy();
      return null;
    }
    
    const layoutObj = {};
    cy.nodes().forEach((node) => {
      layoutObj[node.id()] = node.position();
    });
    
    try {
      localStorage.setItem(storageKey, JSON.stringify(layoutObj));
    } catch (e) {
      errorUtils.logWarning('[graphLayoutUtils] 레이아웃 저장 실패', e.message);
    }
    
    cy.destroy();
    return layoutObj;
  } catch (error) {
    if (!signal?.aborted) {
      errorUtils.logWarning('[graphLayoutUtils] 챕터 레이아웃 생성 실패', error.message);
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
  if (!folderKey || !bookKey) {
    return;
  }

  const maxChapterCount = getDetectedMaxChapter(folderKey);
  if (maxChapterCount === 0) return;
  
  const chapterNums = Array.from({ length: maxChapterCount }, (_, i) => i + 1);
  
  try {
    for (let i = 0; i < chapterNums.length; i += 3) {
      if (signal?.aborted) break;
      
      const batch = chapterNums.slice(i, i + 3);
      const promises = batch.map(async (chapterNum) => {
        if (signal?.aborted) return;
        await generateChapterLayout({ folderKey, bookKey, chapterNum, signal });
      });
      
      await Promise.all(promises);
      
      if (onProgress) {
        onProgress({ processed: Math.min(i + 3, chapterNums.length), total: chapterNums.length });
      }
      
      if (i + 3 < chapterNums.length && !signal?.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      errorUtils.logWarning('[graphLayoutUtils] 레이아웃 사전 로드 실패', error.message);
    }
  }
}
