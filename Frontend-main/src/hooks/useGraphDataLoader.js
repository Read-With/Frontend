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
  
  // 이전 elements 참조 (diff 계산용)
  const prevElementsRef = useRef([]);

  // 상태 초기화 함수
  const resetState = useCallback(() => {
    setElements([]);
    setNewNodeIds([]);
    setCurrentChapterData(null);
    setMaxEventNum(0);
    setEventNum(0);
    setError(null);
  }, []);

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
      resetState();
      setLoading(false);
      return;
    }

    try {
      // 이벤트 데이터 로드
      const eventData = getEventDataByIndex(folderKey, chapter, targetEventIndex);
      
      if (!eventData) {
        resetState();
        setLoading(false);
        return;
      }

      // 캐릭터 데이터 로드
      const charData = getCharactersData(folderKey, chapter);
      
      if (!charData) {
        setError('캐릭터 데이터를 찾을 수 없습니다.');
        resetState();
        setLoading(false);
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
      
      // 변경사항 계산
      const diff = calcGraphDiff(prevElementsRef.current, convertedElements);
      prevElementsRef.current = convertedElements;
      
      setElements(convertedElements);
      setNewNodeIds(diff.added.filter(el => !el.data?.source).map(el => el.data.id));
      setMaxEventNum(targetEventIndex);
      setEventNum(targetEventIndex);
      setError(null);
      
    } catch (err) {
      setError('데이터 처리 중 오류 발생: ' + err.message);
      resetState();
    } finally {
      setLoading(false);
    }
  }, [resetState]);

  // 챕터 변경 시 데이터 로딩
  useEffect(() => {
    if (!filename || !chapter) {
      resetState();
      setLoading(false);
      return;
    }

    setLoading(true);
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

