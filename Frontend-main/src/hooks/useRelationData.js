import { useState, useEffect, useCallback, useMemo } from 'react';
import { safeNum, isSamePair } from '../utils/relationUtils';
import { 
  getChapterLastEventNums, 
  getEventDataByIndex,
  getMaxEventCount,
  getDetectedMaxChapter,
  getFolderKeyFromFilename
} from '../utils/graphData';

const MIN_POSITIVITY = 1;

function findRelation(relations, id1, id2) {
  if (!Array.isArray(relations) || relations.length === 0) return null;
  
  return relations
    .filter(r => {
      if (!r) return false;
      const rid1 = safeNum(r.id1 ?? r.source);
      const rid2 = safeNum(r.id2 ?? r.target);
      return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
    })
    .find(r => isSamePair(r, id1, id2));
}

/**
 * 제한된 최대 이벤트 수를 계산하는 함수
 * @param {string} folderKey - 폴더 키
 * @param {number} maxChapter - 최대 챕터 수
 * @returns {number} 최대 이벤트 수
 */
function getMaxEventCountLimited(folderKey, maxChapter) {
  if (!folderKey) return MIN_POSITIVITY;
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    const lastEventNums = getChapterLastEventNums(folderKey);
    
    if (!Array.isArray(lastEventNums) || lastEventNums.length === 0) {
      return MIN_POSITIVITY;
    }
    
    if (actualMaxChapter >= lastEventNums.length) {
      return Math.max(getMaxEventCount(folderKey), MIN_POSITIVITY);
    }
    
    const limitedEventNums = lastEventNums.slice(0, actualMaxChapter);
    return Math.max(...limitedEventNums, MIN_POSITIVITY);
  } catch (error) {
    console.error('Error calculating max event count:', error);
    return MIN_POSITIVITY;
  }
}

/**
 * 공통 데이터 수집 함수
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} startChapter - 시작 챕터
 * @param {number} endChapter - 끝 챕터
 * @param {number} startEvent - 시작 이벤트
 * @param {number} endEvent - 끝 이벤트
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 포인트와 라벨 정보
 */
function collectRelationData(id1, id2, startChapter, endChapter, startEvent, endEvent, folderKey) {
  if (!folderKey || startChapter > endChapter || startEvent > endEvent) {
    return { points: [], labelInfo: [] };
  }
  
  const points = [];
  const labelInfo = [];
  
  try {
    const lastEventNums = getChapterLastEventNums(folderKey);
    
    for (let ch = startChapter; ch <= endChapter; ch++) {
      const lastEv = ch === endChapter ? endEvent : (lastEventNums[ch - 1] || 0);
      const startEv = ch === startChapter ? startEvent : 1;
      
      for (let i = startEv; i <= lastEv; i++) {
        const json = getEventDataByIndex(folderKey, ch, i);
        
        if (!json) {
          points.push(0);
          labelInfo.push(`챕터${ch} 이벤트${i}`);
          continue;
        }
        
        const found = findRelation(json.relations, id1, id2);
        points.push(found ? found.positivity : 0);
        labelInfo.push(`E${i}`);
      }
    }
  } catch (error) {
    console.error('Error collecting relation data:', error);
  }
  
  return { points, labelInfo };
}

/**
 * 처음 등장 시점 찾기 함수
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} maxChapter - 최대 챕터 수
 * @param {string} folderKey - 폴더 키
 * @returns {Object|null} 첫 등장 정보 또는 null
 */
function findFirstAppearance(id1, id2, maxChapter, folderKey) {
  if (!folderKey || maxChapter < 1) return null;
  
  try {
    const lastEventNums = getChapterLastEventNums(folderKey);
    
    for (let ch = 1; ch <= maxChapter; ch++) {
      const lastEv = lastEventNums[ch - 1] || 0;
      for (let i = 1; i <= lastEv; i++) {
        const json = getEventDataByIndex(folderKey, ch, i);
        if (!json) continue;
        
        const found = findRelation(json.relations, id1, id2);
        if (found) {
          return { chapter: ch, event: i };
        }
      }
    }
  } catch (error) {
    console.error('Error finding first appearance:', error);
  }
  
  return null;
}

/**
 * 독립 실행 모드용 관계 타임라인 데이터 가져오기
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호
 * @param {number} maxChapter - 최대 챕터 수
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 타임라인 데이터
 */
function fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey) {
  if (!folderKey || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    // 처음 등장한 시점 찾기
    const firstAppearance = findFirstAppearance(id1, id2, Math.min(chapterNum, actualMaxChapter), folderKey);
    
    if (!firstAppearance) {
      return { points: [], labelInfo: [] };
    }
    
    // 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
    return collectRelationData(
      id1, id2, 
      firstAppearance.chapter, chapterNum, 
      firstAppearance.event, eventNum, 
      folderKey
    );
  } catch (error) {
    console.error('Error fetching standalone timeline:', error);
    return { points: [], labelInfo: [] };
  }
}

/**
 * 뷰어 모드용 관계 타임라인 데이터 가져오기 (관계가 처음 등장하는 이벤트부터 현재 이벤트까지)
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 타임라인 데이터
 */
function fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey) {
  if (!folderKey || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [], noRelation: true };
  }
  
  try {
    // 현재 챕터에서 관계가 처음 등장하는 이벤트 찾기
    let firstAppearanceInChapter = null;
    
    for (let i = 1; i <= eventNum; i++) {
      const json = getEventDataByIndex(folderKey, chapterNum, i);
      if (!json) continue;
      
      const found = findRelation(json.relations, id1, id2);
      if (found) {
        firstAppearanceInChapter = i;
        break; // 첫 번째 등장을 찾으면 중단
      }
    }
    
    // 관계가 현재 챕터에서 전혀 등장하지 않은 경우
    if (!firstAppearanceInChapter) {
      return { points: [], labelInfo: [], noRelation: true };
    }
    
    // 관계가 처음 등장한 이벤트부터 현재 이벤트까지 데이터 수집
    const result = collectRelationData(
      id1, id2, 
      chapterNum, chapterNum, 
      firstAppearanceInChapter, eventNum, // 관계 첫 등장부터 현재 이벤트까지
      folderKey
    );
    
    return {
      points: result.points,
      labelInfo: result.labelInfo,
      noRelation: false
    };
  } catch (error) {
    console.error('Error fetching viewer timeline:', error);
    return { points: [], labelInfo: [], noRelation: true };
  }
}

/**
 * 단일 이벤트 패딩 함수
 * @param {Array} points - 포인트 배열
 * @param {Array} labels - 라벨 배열
 * @returns {Object} 패딩된 데이터
 */
function padSingleEvent(points, labels) {
  if (!Array.isArray(points) || !Array.isArray(labels) || points.length !== 1) {
    return { points, labels };
  }
  
  const paddedLabels = Array(11).fill('').map((_, index) => 
    index === 5 ? labels[0] : ''
  );
  const paddedTimeline = Array(11).fill(null).map((_, index) => 
    index === 5 ? points[0] : null
  );
  
  return { points: paddedTimeline, labels: paddedLabels };
}

/**
 * 간선 관계 데이터를 가져오는 커스텀 훅
 * @param {string} mode - 'standalone' | 'viewer'
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호
 * @param {number} maxChapter - 최대 챕터 수 (standalone 모드에서만 사용, 없으면 자동 감지)
 * @param {string} filename - 파일명 (예: "gatsby.epub", "alice.epub")
 * @returns {object} 차트 데이터와 로딩 상태
 */
export function useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter, filename) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);

  // filename을 기반으로 folderKey 결정
  const folderKey = useMemo(() => {
    try {
      return getFolderKeyFromFilename(filename);
    } catch (error) {
      console.error('Error getting folder key:', error);
      return null;
    }
  }, [filename]);

  // 메모이제이션된 최대 이벤트 수
  const maxEventCount = useMemo(() => 
    getMaxEventCountLimited(folderKey, maxChapter), 
    [folderKey, maxChapter]
  );

  // 데이터 가져오기 함수
  const fetchData = useCallback(() => {
    if (!folderKey || !id1 || !id2 || !chapterNum || !eventNum) {
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
      setError('필수 매개변수가 누락되었습니다.');
      return;
    }

    setLoading(true);
    setError(null);
    
    // 디버깅: 관계 데이터 요청 로그 (개발 환경에서만)
    if (process.env.NODE_ENV === 'development') {
      console.log('=== useRelationData fetchData 호출 ===');
      console.log('mode:', mode);
      console.log('id1:', id1, 'id2:', id2);
      console.log('chapterNum:', chapterNum, 'eventNum:', eventNum);
      console.log('folderKey:', folderKey);
    }
    
    try {
      const result = mode === 'viewer' 
        ? fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey)
        : fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey);
      
      const { points, labels } = padSingleEvent(result.points, result.labelInfo);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('관계 데이터 결과:', { points, labels, noRelation: result.noRelation });
      }
      
      setTimeline(points);
      setLabels(labels);
      setNoRelation(result.noRelation || false);
    } catch (error) {
      console.error('Error in fetchData:', error);
      setError('데이터를 가져오는 중 오류가 발생했습니다.');
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
    } finally {
      setLoading(false);
    }
  }, [mode, id1, id2, chapterNum, eventNum, maxChapter, folderKey]);

  // 의존성이 변경될 때 자동으로 데이터 가져오기
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 메모이제이션된 반환값으로 불필요한 리렌더링 방지
  return useMemo(() => ({
    timeline,
    labels,
    loading,
    noRelation,
    error,
    fetchData,
    getMaxEventCount: () => maxEventCount,
  }), [timeline, labels, loading, noRelation, error, fetchData, maxEventCount]);
}
