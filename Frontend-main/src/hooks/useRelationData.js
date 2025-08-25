import { useState, useEffect, useCallback, useMemo } from 'react';
import { safeNum } from '../utils/relationUtils';
import { 
  getChapterLastEventNums, 
  getEventDataByIndex,
  getMaxEventCount as getMaxEventCountFromGraphData,
  getFolderKeyFromFilename
} from '../utils/graphData';

// 상수 정의
const MIN_POSITIVITY = 1;

// 관계 찾기 유틸리티 함수
function findRelation(relations, id1, id2) {
  if (!Array.isArray(relations)) return null;
  
  const sid1 = safeNum(id1);
  const sid2 = safeNum(id2);
  
  return relations
    .filter(r => {
      const rid1 = safeNum(r.id1 ?? r.source);
      const rid2 = safeNum(r.id2 ?? r.target);
      return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
    })
    .find(r => {
      const rid1 = safeNum(r.id1 ?? r.source);
      const rid2 = safeNum(r.id2 ?? r.target);
      
      return (
        (rid1 === sid1 && rid2 === sid2) ||
        (rid1 === sid2 && rid2 === sid1)
      );
    });
}

// 전체 챕터에서 최대 이벤트 수 계산 (graphData.js 함수 활용)
function getMaxEventCount(folderKey, maxChapter = 10) {
  const lastEventNums = getChapterLastEventNums(folderKey);
  
  if (maxChapter >= lastEventNums.length) {
    return getMaxEventCountFromGraphData(folderKey);
  }
  
  const limitedEventNums = lastEventNums.slice(0, maxChapter);
  return Math.max(...limitedEventNums, MIN_POSITIVITY);
}

// 관계 변화 데이터: 그래프 단독 페이지용 (전체 챕터)
function fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey) {
  const lastEventNums = getChapterLastEventNums(folderKey).slice(0, maxChapter);
  const points = [];
  const labelInfo = [];
  
  // 처음 등장한 시점 찾기
  let firstAppearance = null;
  for (let ch = 1; ch <= chapterNum && !firstAppearance; ch++) {
    const lastEv = lastEventNums[ch - 1];
    for (let i = 1; i <= lastEv && !firstAppearance; i++) {
      const json = getEventDataByIndex(folderKey, ch, i);
      if (!json) continue;
      
      const found = findRelation(json.relations, id1, id2);
      if (found) {
        firstAppearance = { chapter: ch, event: i };
      }
    }
  }
  
  // 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
  if (firstAppearance) {
    for (let ch = firstAppearance.chapter; ch <= chapterNum; ch++) {
      const lastEv = ch === chapterNum ? eventNum : lastEventNums[ch - 1];
      const startEv = ch === firstAppearance.chapter ? firstAppearance.event : 1;
      
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
  }
  
  return { points, labelInfo };
}

// 관계 변화 데이터: 뷰어 페이지 전용 (현재 챕터만)
function fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey) {
  const points = [];
  const labelInfo = [];
  
  // 현재 챕터에서 처음 등장한 시점 찾기
  let firstAppearanceInChapter = null;
  for (let i = 1; i <= eventNum && !firstAppearanceInChapter; i++) {
    const json = getEventDataByIndex(folderKey, chapterNum, i);
    if (!json) continue;
    
    const found = findRelation(json.relations, id1, id2);
    if (found) {
      firstAppearanceInChapter = i;
    }
  }
  
  // 관계가 현재 챕터에서 전혀 등장하지 않은 경우
  if (!firstAppearanceInChapter) {
    return { points: [], labelInfo: [], noRelation: true };
  }
  
  // 현재 챕터에서 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
  for (let i = firstAppearanceInChapter; i <= eventNum; i++) {
    const json = getEventDataByIndex(folderKey, chapterNum, i);
    
    if (!json) {
      points.push(0);
      labelInfo.push(`이벤트 ${i}`);
      continue;
    }
    
    const found = findRelation(json.relations, id1, id2);
    points.push(found ? found.positivity : 0);
    labelInfo.push(`E${i}`);
  }
  
  return { points, labelInfo };
}

// 단일 이벤트 패딩 함수
function padSingleEvent(points, labels) {
  if (points.length !== 1) return { points, labels };
  
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
 * @param {number} maxChapter - 최대 챕터 수 (standalone 모드에서만 사용)
 * @param {string} filename - 파일명 (예: "gatsby.epub", "alice.epub")
 * @returns {object} 차트 데이터와 로딩 상태
 */
export function useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter = 10, filename) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);

  // filename을 기반으로 folderKey 결정
  const folderKey = useMemo(() => getFolderKeyFromFilename(filename), [filename]);

  // 메모이제이션된 최대 이벤트 수
  const maxEventCount = useMemo(() => getMaxEventCount(folderKey, maxChapter), [folderKey, maxChapter]);

  const fetchData = useCallback(() => {
    setLoading(true);
    
    const result = mode === 'viewer' 
      ? fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey)
      : fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey);
    
    const { points, labels } = padSingleEvent(result.points, result.labelInfo);
    
    setTimeline(points);
    setLabels(labels);
    setNoRelation(result.noRelation || false);
    setLoading(false);
  }, [mode, id1, id2, chapterNum, eventNum, maxChapter, folderKey]);

  return {
    timeline,
    labels,
    loading,
    noRelation,
    fetchData,
    getMaxEventCount: () => maxEventCount,
  };
}
