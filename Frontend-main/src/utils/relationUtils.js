export function safeNum(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number(String(value));
}

export function normalizeRelation(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  
  try {
    // Accept various shapes (id1/id2 or source/target)
    const id1 = safeNum(raw.id1 ?? raw.source);
    const id2 = safeNum(raw.id2 ?? raw.target);
    const positivity = raw.positivity;
    const weight = raw.weight ?? 1;
    const count = raw.count;
    let relationArray = [];
    if (Array.isArray(raw.relation)) relationArray = raw.relation;
    else if (typeof raw.relation === "string") relationArray = [raw.relation];

    const label = relationArray[0] || (typeof raw.label === "string" ? raw.label : "");
    const explanation = raw.explanation;

    return { id1, id2, positivity, weight, count, relation: relationArray, label, explanation };
  } catch (error) {
    return null;
  }
}

export function isValidRelation(normalized) {
  const { id1, id2 } = normalized;
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) return false;
  if (id1 === 0 || id2 === 0) return false;
  if (id1 === id2) return false;
  return true;
}

export function isSamePair(rel, a, b) {
  const r1 = safeNum(rel.id1);
  const r2 = safeNum(rel.id2);
  const s1 = safeNum(a);
  const s2 = safeNum(b);
  return (r1 === s1 && r2 === s2) || (r1 === s2 && r2 === s1);
}

/**
 * 관계 데이터를 정규화하고 유효성을 검사하여 처리
 * @param {Array} relations - 원본 관계 데이터 배열
 * @returns {Array} 처리된 관계 데이터 배열
 */
export function processRelations(relations) {
  if (!Array.isArray(relations)) {
    return [];
  }
  
  return relations
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
}

/**
 * 관계 태그 배열을 중복 제거하여 처리
 * @param {Array|string} relation - 관계 데이터 (배열 또는 문자열)
 * @param {string} label - 백업용 라벨 문자열
 * @returns {Array} 중복이 제거된 관계 태그 배열
 */
export function processRelationTags(relation, label) {
  const relArr = Array.isArray(relation)
    ? relation
    : (typeof label === 'string' ? label.split(',').map(s => s.trim()).filter(Boolean) : []);
  
  const uniqueRelations = [];
  const seen = new Set();
  
  for (const rel of relArr) {
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
}

// 관계 태그 처리 캐시 (캐시 관리 시스템 통합)
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from './cacheManager';

const relationCache = new Map();
registerCache('relationCache', relationCache, { maxSize: 1000, ttl: 600000 }); // 10분 TTL

/**
 * 캐시를 활용한 관계 태그 처리 (성능 최적화)
 * @param {Array|string} relation - 관계 데이터 (배열 또는 문자열)
 * @param {string} label - 백업용 라벨 문자열
 * @returns {Array} 중복이 제거된 관계 태그 배열
 */
export function processRelationTagsCached(relation, label) {
  const cacheKey = JSON.stringify({ relation, label });
  recordCacheAccess('relationCache');
  
  if (relationCache.has(cacheKey)) {
    return relationCache.get(cacheKey);
  }
  
  const result = processRelationTags(relation, label);
  relationCache.set(cacheKey, result);
  enforceCacheSizeLimit('relationCache');
  return result;
}

/**
 * 관계 태그 캐시 정리 함수
 * @returns {void}
 */
export function clearRelationCache() {
  relationCache.clear();
}

/**
 * 모든 관계 관련 리소스 정리 함수
 * @returns {void}
 */
export function cleanupRelationResources() {
  clearRelationCache();
}
