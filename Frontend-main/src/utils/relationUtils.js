/**
 * 관계 데이터 처리 유틸리티 (Relation Utils)
 * 1. 데이터 정규화 및 검증
 *    - safeNum: 안전한 숫자 변환 (타입 검증 포함)
 *    - normalizeRelation: 관계 데이터 정규화 (id1/id2 또는 source/target 지원)
 *    - isValidRelation: 정규화된 관계 데이터 유효성 검사
 *    - isValidRelationData/isValidRelationsArray: 기본 유효성 검사
 * 
 * 2. 관계 처리
 *    - processRelations: 관계 배열을 정규화하고 필터링
 *    - isSamePair: 두 관계가 동일한 쌍인지 확인 (단방향 지원)
 * 
 * 3. 관계 태그 처리
 *    - processRelationTags: 관계 태그 배열 중복 제거 (완전 일치 기반)
 *    - processRelationTagsCached: 캐시를 활용한 태그 처리 (성능 최적화)
 * 
 * 4. 리소스 관리
 *    - clearRelationCache: 관계 태그 캐시 정리
 *    - cleanupRelationResources: 모든 관계 관련 리소스 정리
 * 
 * 특징:
 * - 다양한 데이터 형식 지원 (id1/id2, source/target)
 * - 완전한 에러 처리 및 입력 검증
 * - 캐시 관리 시스템 통합 (최대 1000개, TTL 10분)
 * - null 안전성 보장
 * - cleanup 함수 패턴으로 메모리 관리
 * 
 * 개선 사항 (최근):
 * - explanation 필드 제거 (미사용 필드)
 * - 접두사 기반 중복 제거 로직 제거 → 완전 일치 기반으로 단순화
 * - 캐시 키 생성 최적화 (JSON.stringify → 문자열 결합)
 * - 불필요한 Set to Array 변환 제거
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

    return { id1, id2, positivity, weight, count, relation: relationArray, label };
  } catch (error) {
    console.error('normalizeRelation 실패:', error, { raw });
    return null;
  }
}

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

export function processRelationTags(relation, label) {
  try {
    if (!relation && !label) {
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
        continue;
      }
      
      if (!seen.has(rel)) {
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

export function processRelationTagsCached(relation, label) {
  try {
    if (relation === undefined && label === undefined) {
      console.warn('processRelationTagsCached: relation과 label이 모두 undefined입니다');
      return [];
    }
    
    const relationStr = Array.isArray(relation) ? relation.join('|') : String(relation || '');
    const labelStr = String(label || '');
    const cacheKey = `${relationStr}::${labelStr}`;
    
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
    return processRelationTags(relation, label);
  }
}

export function clearRelationCache() {
  try {
    relationCache.clear();
    // 개발 환경에서만 로그 출력
    if (process.env.NODE_ENV === 'development') {
      console.info('relationCache 정리 완료');
    }
  } catch (error) {
    // 에러는 개발 환경에서만 출력
    if (process.env.NODE_ENV === 'development') {
      console.error('clearRelationCache 실패:', error);
    }
  }
}

export function cleanupRelationResources() {
  try {
    clearRelationCache();
    // 개발 환경에서만 로그 출력
    if (process.env.NODE_ENV === 'development') {
      console.info('관계 관련 리소스 정리 완료');
    }
  } catch (error) {
    // 에러는 항상 출력
    console.error('cleanupRelationResources 실패:', error);
  }
}

export function isValidRelationData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const hasId1 = data.id1 !== undefined || data.source !== undefined;
  const hasId2 = data.id2 !== undefined || data.target !== undefined;
  
  return hasId1 && hasId2;
}

export function isValidRelationsArray(relations) {
  if (!Array.isArray(relations)) {
    return false;
  }
  
  if (relations.length === 0) {
    return true;
  }
  
  return isValidRelationData(relations[0]);
}
