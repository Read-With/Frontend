import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  getCharactersData, 
  getEventDataByIndex, 
  getLastEventIndexForChapter, 
  getFolderKeyFromFilename, 
  getDetectedMaxChapter,
  createCharacterMaps
} from '../utils/graphData';
import { convertRelationsToElements, calcGraphDiff } from '../utils/graphDataUtils';
import { normalizeRelation, isValidRelation } from '../utils/relationUtils';

/**
 * 통합 그래프 데이터 로딩 훅
 * @param {string} filename - 파일명
 * @param {number} chapter - 챕터 번호
 * @param {number} eventIndex - 이벤트 인덱스 (선택사항, 없으면 마지막 이벤트 사용)
 * @returns {object} 로딩된 데이터와 상태
 */
export function useGraphDataLoader(filename, chapter, eventIndex = null) {
  const [elements, setElements] = useState([]);
  const [newNodeIds, setNewNodeIds] = useState([]);
  const [currentChapterData, setCurrentChapterData] = useState(null);
  const [maxEventNum, setMaxEventNum] = useState(0);
  const [eventNum, setEventNum] = useState(0);
  const [maxChapter, setMaxChapter] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // 챕터별 누적 elements 저장
  const chapterElementsRef = useRef(new Map());
  // 현재 파일명 추적 (filename 변경 시에만 초기화)
  const currentFilenameRef = useRef(null);

  // 상태 초기화 함수 (filename 변경 시에만 호출)
  const resetState = useCallback(() => {
    setElements([]);
    setNewNodeIds([]);
    setCurrentChapterData(null);
    setMaxEventNum(0);
    setEventNum(0);
    setError(null);
    chapterElementsRef.current.clear();
  }, []);

  // filename 변경 시에만 상태 초기화
  useEffect(() => {
    if (filename !== currentFilenameRef.current) {
      currentFilenameRef.current = filename;
      resetState();
    }
  }, [filename, resetState]);

  // maxChapter를 동적으로 설정
  useEffect(() => {
    if (!filename) return;
    
    const folderKey = getFolderKeyFromFilename(filename);
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    setMaxChapter(detectedMaxChapter);
  }, [filename]);

  // 데이터 로딩 함수
  const loadData = useCallback(async (folderKey, chapter, targetEventIndex) => {
    if (targetEventIndex === 0) {
      return;
    }

    try {
      // 이벤트 데이터 로드
      const eventData = getEventDataByIndex(folderKey, chapter, targetEventIndex);
      
      if (!eventData) {
        return;
      }

      // 캐릭터 데이터 로드
      const charData = getCharactersData(folderKey, chapter);
      
      if (!charData) {
        setError('캐릭터 데이터를 찾을 수 없습니다.');
        return;
      }
      
      // 현재 챕터 데이터 저장
      setCurrentChapterData(charData);
      
      // createCharacterMaps 유틸리티 사용
      const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(charData);
      
      // 관계 데이터 정규화 및 검증
      const normalizedRelations = (eventData.relations || [])
        .map(rel => normalizeRelation(rel))
        .filter(rel => isValidRelation(rel));
      
      // 요소 변환
      const convertedElements = convertRelationsToElements(
        normalizedRelations,
        idToName,
        idToDesc,
        idToMain,
        idToNames
      );
      
      // 챕터별 누적 elements 관리
      const chapterKey = `${folderKey}-${chapter}`;
      
      // 현재 챕터의 elements 저장
      chapterElementsRef.current.set(chapterKey, convertedElements);
      
      // 전체 elements 업데이트 (이전 챕터들 + 현재 챕터)
      const allElements = [];
      for (const [key, elements] of chapterElementsRef.current.entries()) {
        const keyChapter = parseInt(key.split('-')[1]);
        if (keyChapter <= chapter) {
          allElements.push(...elements);
        }
      }
      
      // 중복 제거 (같은 ID를 가진 노드는 마지막에 추가된 것만 유지)
      const uniqueElements = [];
      const seenIds = new Set();
      for (let i = allElements.length - 1; i >= 0; i--) {
        const element = allElements[i];
        const elementId = element.data?.id || element.data?.source + '-' + element.data?.target;
        if (!seenIds.has(elementId)) {
          seenIds.add(elementId);
          uniqueElements.unshift(element);
        }
      }
      
      // 이전 누적 elements와 비교하여 새로운 노드 감지
      const previousAllElements = [];
      for (const [key, elements] of chapterElementsRef.current.entries()) {
        const keyChapter = parseInt(key.split('-')[1]);
        if (keyChapter < chapter) { 
          previousAllElements.push(...elements);
        }
      }
      
      // 이전 누적 elements에서 중복 제거
      const previousUniqueElements = [];
      const previousSeenIds = new Set();
      for (let i = previousAllElements.length - 1; i >= 0; i--) {
        const element = previousAllElements[i];
        const elementId = element.data?.id || element.data?.source + '-' + element.data?.target;
        if (!previousSeenIds.has(elementId)) {
          previousSeenIds.add(elementId);
          previousUniqueElements.unshift(element);
        }
      }
      
      // 변경사항 계산 (이전 누적 elements와 현재 누적 elements 비교)
      const diff = calcGraphDiff(previousUniqueElements, uniqueElements);
      
      setElements(uniqueElements);
      const newNodes = diff.added.filter(el => !el.data?.source).map(el => el.data.id);
      setNewNodeIds(newNodes);
      setMaxEventNum(targetEventIndex);
      setEventNum(targetEventIndex);
      setError(null);
      
    } catch (err) {
      setError('데이터 처리 중 오류 발생: ' + err.message);
    }
  }, []);

  // 챕터 변경 시 데이터 로딩 (상태 초기화 없이)
  useEffect(() => {
    if (!filename || !chapter) {
      setLoading(false);
      return;
    }

    setError(null);

    const folderKey = getFolderKeyFromFilename(filename);
    const targetEventIndex = eventIndex || getLastEventIndexForChapter(folderKey, chapter);
    
    loadData(folderKey, chapter, targetEventIndex);
  }, [filename, chapter, eventIndex, loadData]);

  return {
    elements,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum,
    maxChapter,
    loading,
    error
  };
}

