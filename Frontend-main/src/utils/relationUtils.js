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
        return NaN;
      }
      return parsed;
    }
    
    const converted = Number(String(value));
    if (isNaN(converted)) {
      return NaN;
    }
    
    return converted;
  } catch (error) {
    return NaN;
  }
}

export function normalizeRelation(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  
  try {
    // Accept various shapes (id1/id2 or source/target)
    const id1 = safeNum(raw.id1 ?? raw.source);
    const id2 = safeNum(raw.id2 ?? raw.target);
    
    if (isNaN(id1) || isNaN(id2)) {
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
    }

    const label = relationArray[0] || (typeof raw.label === "string" ? raw.label : "");

    return { id1, id2, positivity, weight, count, relation: relationArray, label };
  } catch (error) {
    return null;
  }
}

export function isValidRelation(normalized) {
  if (!normalized || typeof normalized !== 'object') {
    return false;
  }
  
  const { id1, id2 } = normalized;
  
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) {
    return false;
  }
  
  if (id1 === 0 || id2 === 0) {
    return false;
  }
  
  if (id1 === id2) {
    return false;
  }
  
  return true;
}

export function isSamePair(rel, a, b) {
  if (!rel || typeof rel !== 'object') {
    return false;
  }
  
  const r1 = safeNum(rel.id1);
  const r2 = safeNum(rel.id2);
  const s1 = safeNum(a);
  const s2 = safeNum(b);
  
  if (isNaN(r1) || isNaN(r2) || isNaN(s1) || isNaN(s2)) {
    return false;
  }
  
  return (r1 === s1 && r2 === s2) || (r1 === s2 && r2 === s1);
}

export function processRelations(relations) {
  if (!Array.isArray(relations)) {
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
    return [];
  }
}

// 관계 태그 처리 캐시 (캐시 관리 시스템 통합)
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from './common/cache/cacheManager';

const relationCache = new Map();
registerCache('relationCache', relationCache, { maxSize: 1000, ttl: 600000 }); // 10분 TTL

export function processRelationTagsCached(relation, label) {
  try {
    if (relation === undefined && label === undefined) {
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
    return processRelationTags(relation, label);
  }
}

export function clearRelationCache() {
  try {
    relationCache.clear();
  } catch (error) {
  }
}

export function cleanupRelationResources() {
  try {
    clearRelationCache();
  } catch (error) {
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
