/**
 * 관계 데이터 처리 유틸리티 함수들
 * 관계 데이터의 정규화, 유효성 검사, 중복 제거 등을 담당
 */

/**
 * 안전한 숫자 변환 함수
 * @param {any} value - 변환할 값
 * @returns {number} 변환된 숫자 또는 NaN
 */
export function safeNum(value) {
  try {
    if (value === undefined || value === null) {
      return NaN;
    }
    
    if (typeof value === "number") {
      return value;
    }
    
    if (typeof value === "string") {
      const parsed = Number(value);
      if (isNaN(parsed)) {
        console.warn(`safeNum: 문자열을 숫자로 변환할 수 없습니다 (${value})`);
        return NaN;
      }
      return parsed;
    }
    
    const converted = Number(String(value));
    if (isNaN(converted)) {
      console.warn(`safeNum: 값을 숫자로 변환할 수 없습니다 (${typeof value}: ${value})`);
      return NaN;
    }
    
    return converted;
  } catch (error) {
    console.error('safeNum 변환 실패:', error, { value, type: typeof value });
    return NaN;
  }
}

/**
 * 관계 데이터를 정규화하는 함수
 * @param {Object} raw - 원본 관계 데이터 객체
 * @returns {Object|null} 정규화된 관계 데이터 또는 null
 */
export function normalizeRelation(raw) {
  if (!raw || typeof raw !== 'object') {
    console.warn('normalizeRelation: 유효하지 않은 입력 데이터입니다', { raw, type: typeof raw });
    return null;
  }
  
  try {
    // Accept various shapes (id1/id2 or source/target)
    const id1 = safeNum(raw.id1 ?? raw.source);
    const id2 = safeNum(raw.id2 ?? raw.target);
    
    if (isNaN(id1) || isNaN(id2)) {
      console.warn('normalizeRelation: ID 변환 실패', { 
        id1: raw.id1 ?? raw.source, 
        id2: raw.id2 ?? raw.target,
        convertedId1: id1,
        convertedId2: id2
      });
      return null;
    }
    
    const positivity = raw.positivity;
    const weight = raw.weight ?? 1;
    const count = raw.count;
    let relationArray = [];
    
    if (Array.isArray(raw.relation)) {
      relationArray = raw.relation;
    } else if (typeof raw.relation === "string") {
      relationArray = [raw.relation];
    } else if (raw.relation !== undefined && raw.relation !== null) {
      console.warn('normalizeRelation: 유효하지 않은 relation 타입', { 
        relation: raw.relation, 
        type: typeof raw.relation 
      });
    }

    const label = relationArray[0] || (typeof raw.label === "string" ? raw.label : "");
    const explanation = raw.explanation;

    return { id1, id2, positivity, weight, count, relation: relationArray, label, explanation };
  } catch (error) {
    console.error('normalizeRelation 실패:', error, { raw });
    return null;
  }
}

/**
 * 정규화된 관계 데이터의 유효성을 검사하는 함수
 * @param {Object} normalized - 정규화된 관계 데이터 객체
 * @returns {boolean} 유효성 여부
 */
export function isValidRelation(normalized) {
  if (!normalized || typeof normalized !== 'object') {
    console.warn('isValidRelation: 유효하지 않은 normalized 객체입니다', { normalized });
    return false;
  }
  
  const { id1, id2 } = normalized;
  
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) {
    console.warn('isValidRelation: ID가 유한한 숫자가 아닙니다', { id1, id2 });
    return false;
  }
  
  if (id1 === 0 || id2 === 0) {
    console.warn('isValidRelation: ID가 0입니다', { id1, id2 });
    return false;
  }
  
  if (id1 === id2) {
    console.warn('isValidRelation: 동일한 ID입니다', { id1, id2 });
    return false;
  }
  
  return true;
}

/**
 * 두 관계가 동일한 쌍인지 확인하는 함수
 * @param {Object} rel - 관계 객체
 * @param {any} a - 첫 번째 ID
 * @param {any} b - 두 번째 ID
 * @returns {boolean} 동일한 쌍 여부
 */
export function isSamePair(rel, a, b) {
  if (!rel || typeof rel !== 'object') {
    console.warn('isSamePair: 유효하지 않은 관계 객체입니다', { rel });
    return false;
  }
  
  const r1 = safeNum(rel.id1);
  const r2 = safeNum(rel.id2);
  const s1 = safeNum(a);
  const s2 = safeNum(b);
  
  if (isNaN(r1) || isNaN(r2) || isNaN(s1) || isNaN(s2)) {
    console.warn('isSamePair: ID 변환 실패', { 
      relId1: rel.id1, 
      relId2: rel.id2, 
      a, 
      b,
      converted: { r1, r2, s1, s2 }
    });
    return false;
  }
  
  return (r1 === s1 && r2 === s2) || (r1 === s2 && r2 === s1);
}

/**
 * 관계 데이터를 정규화하고 유효성을 검사하여 처리
 * @param {Array} relations - 원본 관계 데이터 배열
 * @returns {Array} 처리된 관계 데이터 배열
 */
export function processRelations(relations) {
  if (!Array.isArray(relations)) {
    console.warn('processRelations: 유효하지 않은 relations 배열입니다', { 
      relations, 
      type: typeof relations 
    });
    return [];
  }
  
  if (relations.length === 0) {
    return [];
  }
  
  try {
    const processed = relations
      .map(normalizeRelation)
      .filter(relation => relation !== null && isValidRelation(relation))
      .map(r => ({
        id1: r.id1,
        id2: r.id2,
        positivity: r.positivity,
        relation: r.relation,
        weight: r.weight,
        count: r.count,
      }));
    
    return processed;
  } catch (error) {
    console.error('processRelations 실패:', error, { relationsLength: relations.length });
    return [];
  }
}

/**
 * 관계 태그 배열을 중복 제거하여 처리
 * @param {Array|string} relation - 관계 데이터 (배열 또는 문자열)
 * @param {string} label - 백업용 라벨 문자열
 * @returns {Array} 중복이 제거된 관계 태그 배열
 */
export function processRelationTags(relation, label) {
  try {
    if (!relation && !label) {
      console.warn('processRelationTags: relation과 label이 모두 없습니다');
      return [];
    }
    
    const relArr = Array.isArray(relation)
      ? relation
      : (typeof label === 'string' ? label.split(',').map(s => s.trim()).filter(Boolean) : []);
    
    if (relArr.length === 0) {
      return [];
    }
    
    const uniqueRelations = [];
    const seen = new Set();
    
    for (const rel of relArr) {
      if (typeof rel !== 'string' || rel.length === 0) {
        console.warn('processRelationTags: 유효하지 않은 관계 태그입니다', { rel, type: typeof rel });
        continue;
      }
      
      if (rel.includes(' ')) {
        // 공백이 포함된 관계는 완전히 동일한 경우만 중복 제거
        if (!seen.has(rel)) {
          uniqueRelations.push(rel);
          seen.add(rel);
        }
        continue;
      }
      
      // 공백이 없는 관계는 접두사 기반 중복 제거
      const base = rel.length > 3 ? rel.slice(0, -1) : rel;
      if (![...seen].some(s => s.startsWith(base))) {
        uniqueRelations.push(rel);
        seen.add(rel);
      }
    }
    
    return uniqueRelations;
  } catch (error) {
    console.error('processRelationTags 실패:', error, { relation, label });
    return [];
  }
}

// 관계 태그 처리 캐시 (캐시 관리 시스템 통합)
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from './common/cacheManager';

const relationCache = new Map();
registerCache('relationCache', relationCache, { maxSize: 1000, ttl: 600000 }); // 10분 TTL

/**
 * 캐시를 활용한 관계 태그 처리 (성능 최적화)
 * @param {Array|string} relation - 관계 데이터 (배열 또는 문자열)
 * @param {string} label - 백업용 라벨 문자열
 * @returns {Array} 중복이 제거된 관계 태그 배열
 */
export function processRelationTagsCached(relation, label) {
  try {
    const cacheKey = JSON.stringify({ relation, label });
    recordCacheAccess('relationCache');
    
    if (relationCache.has(cacheKey)) {
      return relationCache.get(cacheKey);
    }
    
    const result = processRelationTags(relation, label);
    relationCache.set(cacheKey, result);
    enforceCacheSizeLimit('relationCache');
    return result;
  } catch (error) {
    console.error('processRelationTagsCached 실패:', error, { relation, label });
    // 캐시 실패 시 직접 처리
    return processRelationTags(relation, label);
  }
}

/**
 * 관계 태그 캐시 정리 함수
 * @description relationCache의 모든 항목을 제거하여 메모리를 정리
 * @returns {void}
 */
export function clearRelationCache() {
  try {
    relationCache.clear();
    console.info('relationCache 정리 완료');
  } catch (error) {
    console.error('clearRelationCache 실패:', error);
  }
}

/**
 * 모든 관계 관련 리소스 정리 함수
 * @description 관계 처리와 관련된 모든 캐시와 리소스를 정리
 * @returns {void}
 */
export function cleanupRelationResources() {
  try {
    clearRelationCache();
    console.info('관계 관련 리소스 정리 완료');
  } catch (error) {
    console.error('cleanupRelationResources 실패:', error);
  }
}

/**
 * 관계 데이터의 기본 유효성을 검사하는 함수
 * @param {any} data - 검사할 데이터
 * @returns {boolean} 기본 유효성 여부
 */
export function isValidRelationData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  // 최소한의 필수 필드 확인
  const hasId1 = data.id1 !== undefined || data.source !== undefined;
  const hasId2 = data.id2 !== undefined || data.target !== undefined;
  
  return hasId1 && hasId2;
}

/**
 * 관계 배열의 기본 유효성을 검사하는 함수
 * @param {any} relations - 검사할 관계 배열
 * @returns {boolean} 기본 유효성 여부
 */
export function isValidRelationsArray(relations) {
  if (!Array.isArray(relations)) {
    return false;
  }
  
  if (relations.length === 0) {
    return true; // 빈 배열은 유효함
  }
  
  // 첫 번째 요소의 기본 유효성 확인
  return isValidRelationData(relations[0]);
}
