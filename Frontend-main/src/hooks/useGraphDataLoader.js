import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  getCharactersData, 
  getEventDataByIndex, 
  getLastEventIndexForChapter, 
  getFolderKeyFromFilename, 
  getDetectedMaxChapter,
  getSafeMaxChapter,
  createCharacterMaps
} from '../utils/graphData';
import { convertRelationsToElements, calcGraphDiff } from '../utils/graphDataUtils';
import { normalizeRelation, isValidRelation } from '../utils/relationUtils';

export function useGraphDataLoader(filename, chapter, eventIndex = null) {
  const [elements, setElements] = useState([]);
  const [newNodeIds, setNewNodeIds] = useState([]);
  const [currentChapterData, setCurrentChapterData] = useState(null);
  const [maxEventNum, setMaxEventNum] = useState(0);
  const [eventNum, setEventNum] = useState(0);
  const [maxChapter, setMaxChapter] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const chapterElementsRef = useRef(new Map());
  const currentFilenameRef = useRef(null);

  const resetState = useCallback(() => {
    setElements([]);
    setNewNodeIds([]);
    setCurrentChapterData(null);
    setMaxEventNum(0);
    setEventNum(0);
    setError(null);
    chapterElementsRef.current.clear();
  }, []);

  useEffect(() => {
    if (filename !== currentFilenameRef.current) {
      currentFilenameRef.current = filename;
      resetState();
    }
  }, [filename, resetState]);

  useEffect(() => {
    if (!filename) return;
    
    const folderKey = getFolderKeyFromFilename(filename);
    const detectedMaxChapter = getSafeMaxChapter(folderKey, 1);
    setMaxChapter(detectedMaxChapter);
  }, [filename]);

  const loadData = useCallback(async (folderKey, chapter, targetEventIndex) => {
    if (targetEventIndex === 0) {
      return;
    }

    try {
      const eventData = getEventDataByIndex(folderKey, chapter, targetEventIndex);
      
      if (!eventData) {
        return;
      }

      const charData = getCharactersData(folderKey, chapter);
      
      if (!charData) {
        setError('캐릭터 데이터를 찾을 수 없습니다.');
        return;
      }
      
      setCurrentChapterData(charData);
      
      const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(charData);
      
      const normalizedRelations = (eventData.relations || [])
        .map(rel => normalizeRelation(rel))
        .filter(rel => isValidRelation(rel));
      
      const convertedElements = convertRelationsToElements(
        normalizedRelations,
        idToName,
        idToDesc,
        idToMain,
        idToNames
      );
      
      const chapterKey = `${folderKey}-${chapter}`;
      
      chapterElementsRef.current.set(chapterKey, convertedElements);
      
      const allElements = [];
      for (const [key, elements] of chapterElementsRef.current.entries()) {
        const keyChapter = parseInt(key.split('-')[1]);
        if (keyChapter <= chapter) {
          allElements.push(...elements);
        }
      }
      
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
      
      const previousAllElements = [];
      for (const [key, elements] of chapterElementsRef.current.entries()) {
        const keyChapter = parseInt(key.split('-')[1]);
        if (keyChapter < chapter) { 
          previousAllElements.push(...elements);
        }
      }
      
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

