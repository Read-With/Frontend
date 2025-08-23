import { useState, useEffect } from 'react';

// === glob import: 반드시 data/gatsby 하위 전체 관계 파일 import ===
const relationshipModules = import.meta.glob(
  "../data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);

// 안전한 id 변환 함수: 1.0 → 1, "1.0" → 1, "1" → 1, 1 → 1, null/undefined → NaN
const safeNum = (v) => {
  if (v === undefined || v === null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return Number(String(v));
};

// 챕터별 마지막 이벤트 번호 구하기 (glob import 기반)
function getChapterLastEventNums(maxChapter = 10) {
  const lastNums = [];
  for (let chapter = 1; chapter <= maxChapter; chapter++) {
    let last = 0;
    for (let i = 1; i < 100; i++) {
      const filePath = `../data/gatsby/chapter${chapter}_relationships_event_${i}.json`;
      if (relationshipModules[filePath]) {
        last = i;
      } else {
        break;
      }
    }
    lastNums.push(last);
  }
  return lastNums;
}

// 전체 챕터에서 최대 이벤트 수 계산
function getMaxEventCount(maxChapter = 10) {
  const lastEventNums = getChapterLastEventNums(maxChapter);
  return Math.max(...lastEventNums, 1); // 최소값 1 보장
}

// 관계 변화 데이터: 그래프 단독 페이지용 (전체 챕터)
function fetchRelationTimelineStandalone(
  id1,
  id2,
  chapterNum,
  eventNum,
  maxChapter = 10
) {
  const lastEventNums = getChapterLastEventNums(maxChapter);

  const points = [];
  const labelInfo = [];
  
  // 그래프 단독 페이지: 전체 챕터에서 처음 등장한 시점부터 현재 이벤트까지
  let firstAppearance = null;
  for (let ch = 1; ch <= chapterNum; ch++) {
    const lastEv = lastEventNums[ch - 1];
    for (let i = 1; i <= lastEv; i++) {
      const filePath = `../data/gatsby/chapter${ch}_relationships_event_${i}.json`;
      const json = relationshipModules[filePath]?.default;
      if (!json) continue;
      
      const found = (json.relations || [])
        .filter(r => {
          const rid1 = safeNum(r.id1 ?? r.source);
          const rid2 = safeNum(r.id2 ?? r.target);
          return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
        })
        .find((r) => {
          const rid1 = safeNum(r.id1 ?? r.source);
          const rid2 = safeNum(r.id2 ?? r.target);
          const sid1 = safeNum(id1);
          const sid2 = safeNum(id2);
          
          const match = (
            (rid1 === sid1 && rid2 === sid2) ||
            (rid1 === sid2 && rid2 === sid1)
          );
          
          return match;
        });
      
      if (found) {
        firstAppearance = { chapter: ch, event: i };
        break;
      }
    }
    if (firstAppearance) break;
  }
  
  // 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
  if (firstAppearance) {
    for (let ch = firstAppearance.chapter; ch <= chapterNum; ch++) {
      const lastEv = ch === chapterNum ? eventNum : lastEventNums[ch - 1];
      const startEv = ch === firstAppearance.chapter ? firstAppearance.event : 1;
      
      for (let i = startEv; i <= lastEv; i++) {
        const filePath = `../data/gatsby/chapter${ch}_relationships_event_${i}.json`;
        const json = relationshipModules[filePath]?.default;
        
        if (!json) {
          points.push(0);
          labelInfo.push(`챕터${ch} 이벤트${i}`);
          continue;
        }
        
        const found = (json.relations || [])
          .filter(r => {
            const rid1 = safeNum(r.id1 ?? r.source);
            const rid2 = safeNum(r.id2 ?? r.target);
            return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
          })
          .find((r) => {
            const rid1 = safeNum(r.id1 ?? r.source);
            const rid2 = safeNum(r.id2 ?? r.target);
            const sid1 = safeNum(id1);
            const sid2 = safeNum(id2);
            
            const match = (
              (rid1 === sid1 && rid2 === sid2) ||
              (rid1 === sid2 && rid2 === sid1)
            );
            
            return match;
          });
        
        points.push(found ? found.positivity : 0);
        labelInfo.push(`E${i}`);
      }
    }
  }
  
  return { points, labelInfo };
}

// 관계 변화 데이터: 뷰어 페이지 전용 (현재 챕터만)
function fetchRelationTimelineViewer(
  id1,
  id2,
  chapterNum,
  eventNum
) {
  const points = [];
  const labelInfo = [];
  
  // 뷰어 모드: 현재 챕터에서 처음 등장한 시점부터 현재 이벤트까지
  let firstAppearanceInChapter = null;
  
  // 현재 챕터에서 처음 등장한 시점 찾기
  for (let i = 1; i <= eventNum; i++) {
    const filePath = `../data/gatsby/chapter${chapterNum}_relationships_event_${i}.json`;
    const json = relationshipModules[filePath]?.default;
    if (!json) continue;
    
    const found = (json.relations || [])
      .filter(r => {
        const rid1 = safeNum(r.id1 ?? r.source);
        const rid2 = safeNum(r.id2 ?? r.target);
        return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
      })
      .find((r) => {
        const rid1 = safeNum(r.id1 ?? r.source);
        const rid2 = safeNum(r.id2 ?? r.target);
        const sid1 = safeNum(id1);
        const sid2 = safeNum(id2);
        
        const match = (
          (rid1 === sid1 && rid2 === sid2) ||
          (rid1 === sid2 && rid2 === sid1)
        );
        
        return match;
      });
    
    if (found) {
      firstAppearanceInChapter = i;
      break;
    }
  }
  
  // 관계가 현재 챕터에서 전혀 등장하지 않은 경우
  if (!firstAppearanceInChapter) {
    return { 
      points: [], 
      labelInfo: [],
      noRelation: true 
    };
  }
  
  // 현재 챕터에서 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
  const startEvent = firstAppearanceInChapter;
  for (let i = startEvent; i <= eventNum; i++) {
    const filePath = `../data/gatsby/chapter${chapterNum}_relationships_event_${i}.json`;
    const json = relationshipModules[filePath]?.default;
    
    if (!json) {
      points.push(0);
      labelInfo.push(`이벤트 ${i}`);
      continue;
    }
    
    const found = (json.relations || [])
      .filter(r => {
        const rid1 = safeNum(r.id1 ?? r.source);
        const rid2 = safeNum(r.id2 ?? r.target);
        return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
      })
      .find((r) => {
        const rid1 = safeNum(r.id1 ?? r.source);
        const rid2 = safeNum(r.id2 ?? r.target);
        const sid1 = safeNum(id1);
        const sid2 = safeNum(id2);
        
        const match = (
          (rid1 === sid1 && rid2 === sid2) ||
          (rid1 === sid2 && rid2 === sid1)
        );
        
        return match;
      });
    
    points.push(found ? found.positivity : 0);
    labelInfo.push(`E${i}`);
  }
  
  return { points, labelInfo };
}

/**
 * 간선 관계 데이터를 가져오는 커스텀 훅
 * @param {string} mode - 'standalone' | 'viewer'
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호
 * @param {number} maxChapter - 최대 챕터 수 (standalone 모드에서만 사용)
 * @returns {object} 차트 데이터와 로딩 상태
 */
export function useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter = 10) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);

  const fetchData = () => {
    setLoading(true);
    
    let result;
    if (mode === 'viewer') {
      result = fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum);
    } else {
      result = fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter);
    }
    
    // 이벤트가 1개일 때 가운데에 위치하도록 패딩 추가
    if (result.points.length === 1) {
      const paddedLabels = Array(11).fill('').map((_, index) => 
        index === 5 ? result.labelInfo[0] : ''
      );
      const paddedTimeline = Array(11).fill(null).map((_, index) => 
        index === 5 ? result.points[0] : null
      );
      setTimeline(paddedTimeline);
      setLabels(paddedLabels);
    } else {
      setTimeline(result.points);
      setLabels(result.labelInfo);
    }
    
    setNoRelation(result.noRelation || false);
    setLoading(false);
  };

  return {
    timeline,
    labels,
    loading,
    noRelation,
    fetchData,
    getMaxEventCount,
  };
}
