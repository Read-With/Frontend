/** 관계 정규화·태그 캐시·레이더 차트 데이터 */

import { toFiniteNumber } from '../common/valueUtils';
import { uniqueStrings, isGraphNodeElement, undirectedPairKey } from './graphUtils';
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from '../common/cache/cacheManager';
import { clearStyleCache } from '../styles/relationStyles';

/**
 * @typedef {Object} NormalizedRelation
 * @property {number} id1
 * @property {number} id2
 * @property {*} [positivity]
 * @property {number} [weight]
 * @property {*} [count]
 * @property {string[]} relation
 * @property {string} label
 */

const normalizeRelationArray = (relation, label = '') => {
  const values = Array.isArray(relation)
    ? relation
    : typeof relation === 'string'
      ? [relation]
      : typeof label === 'string'
        ? label.split(',')
        : [];

  return uniqueStrings(values);
};

export function normalizeRelation(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  
  try {
    const id1 = toFiniteNumber(raw.id1);
    const id2 = toFiniteNumber(raw.id2);

    if (isNaN(id1) || isNaN(id2)) {
      return null;
    }
    
    const positivity = raw.positivity;
    const weight = raw.weight ?? 1;
    const count = raw.count;
    const relationSource =
      Array.isArray(raw.relation) && raw.relation.length > 0
        ? raw.relation
        : Array.isArray(raw.latestLabels) && raw.latestLabels.length > 0
          ? raw.latestLabels
          : raw.relation;
    const relationArray = normalizeRelationArray(relationSource);

    const label = relationArray[0] || (typeof raw.label === "string" ? raw.label : "");

    return { id1, id2, positivity, weight, count, relation: relationArray, label };
  } catch (_error) {
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

  const r1 = toFiniteNumber(rel.id1);
  const r2 = toFiniteNumber(rel.id2);
  const s1 = toFiniteNumber(a);
  const s2 = toFiniteNumber(b);
  
  if (isNaN(r1) || isNaN(r2) || isNaN(s1) || isNaN(s2)) {
    return false;
  }
  
  return undirectedPairKey(r1, r2) === undirectedPairKey(s1, s2);
}

/** relation 원본의 이벤트 식별자만 전달 */
export function relationEventMetaPassthrough(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const nested = raw.event && typeof raw.event === 'object' ? raw.event : null;
  const pick = (v) => (v !== undefined && v !== null ? v : undefined);
  const chapterIdx =
    pick(raw.chapterIdx) ??
    pick(raw.chapter) ??
    pick(raw.chapter_idx) ??
    pick(nested?.chapterIdx) ??
    pick(nested?.chapter) ??
    pick(nested?.chapter_idx);
  const eventNum = pick(raw.eventNum) ?? pick(raw.event_num) ?? pick(nested?.eventNum) ?? pick(nested?.event_num);
  const eventIdx = pick(raw.eventIdx) ?? pick(raw.event_idx) ?? pick(nested?.eventIdx) ?? pick(nested?.event_idx);
  const eventId =
    pick(raw.eventId) ??
    pick(raw.event_id) ??
    pick(raw.id) ??
    pick(nested?.eventId) ??
    pick(nested?.event_id) ??
    pick(nested?.id);
  return {
    ...(chapterIdx !== undefined ? { chapterIdx } : {}),
    ...(eventNum !== undefined ? { eventNum } : {}),
    ...(eventIdx !== undefined ? { eventIdx } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
  };
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
      .map((raw) => ({ raw, norm: normalizeRelation(raw) }))
      .filter(({ norm }) => norm !== null && isValidRelation(norm))
      .map(({ raw, norm: r }) => ({
        id1: r.id1,
        id2: r.id2,
        positivity: r.positivity,
        relation: r.relation,
        weight: r.weight,
        count: r.count,
        ...relationEventMetaPassthrough(raw),
      }));
    
    return processed;
  } catch (_error) {
    return [];
  }
}

const relationCache = new Map();
registerCache('relationCache', relationCache, { maxSize: 1000, ttl: 600000 }); // 10분 TTL

/** 관계 태그 정규화 (캐시) */
export function processRelationTags(relation, label) {
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

    const result = normalizeRelationArray(relation, label);
    relationCache.set(cacheKey, result);
    enforceCacheSizeLimit('relationCache');
    return result;
  } catch (_error) {
    try {
      return normalizeRelationArray(relation, label);
    } catch {
      return [];
    }
  }
}

function clearRelationCache() {
  try {
    relationCache.clear();
  } catch (_error) {
    /* ignore */
  }
}

/** 관계·스타일 캐시 일괄 정리 (툴팁 닫을 때) */
export function cleanupRelationUtils() {
  try {
    clearRelationCache();
    clearStyleCache();
  } catch (error) {
    console.error('관계 유틸리티 정리 실패:', error);
  }
}

/** 방향 간선 element id (`id1->id2`) */
export function directedEdgeElementId(fromId, toId) {
  return `${String(fromId)}->${String(toId)}`;
}

const normalizePositivity = (positivity) => {
  const value = toFiniteNumber(positivity);
  if (!Number.isFinite(value)) return 50;
  return ((value + 1) / 2) * 100;
};

export const extractRadarChartData = (nodeId, relations, elements, maxDisplay = 8) => {
  if (!nodeId || !relations || !Array.isArray(relations)) return [];

  const targetNodeId = String(nodeId);
  const radarDataMap = new Map();

  relations.forEach((rel) => {
    const id1 = String(rel.id1);
    const id2 = String(rel.id2);
    let connectedNodeId = null;
    if (id1 === targetNodeId) connectedNodeId = id2;
    else if (id2 === targetNodeId) connectedNodeId = id1;

    if (!connectedNodeId) return;

    const existingData = radarDataMap.get(connectedNodeId);
    const positivity = toFiniteNumber(rel.positivity);
    if (!existingData || Math.abs(positivity) > Math.abs(existingData.positivity)) {
      const connectedNode = elements.find(
        (el) => isGraphNodeElement(el) && String(el.data.id) === connectedNodeId
      );
      if (connectedNode && Number.isFinite(positivity)) {
        const fullName =
          connectedNode.data.label || connectedNode.data.common_name || `인물 ${connectedNodeId}`;
        radarDataMap.set(connectedNodeId, {
          name: fullName,
          fullName,
          positivity,
          normalizedValue: normalizePositivity(positivity),
          relationCount: rel.count || 0,
          relationTags: rel.relation || [],
          connectedNodeId,
        });
      }
    }
  });

  const radarData = Array.from(radarDataMap.values());
  radarData.sort((a, b) => Math.abs(b.positivity) - Math.abs(a.positivity));
  return radarData.slice(0, maxDisplay);
};

export const getConnectionStatus = (radarData) => {
  const connectionCount = radarData.length;
  if (connectionCount === 0) {
    return {
      status: 'no_connections',
      message: '연결된 인물이 없습니다.',
      suggestion: '다른 인물을 선택하거나 다른 챕터를 확인해보세요.',
    };
  }
  if (connectionCount <= 2) {
    return {
      status: 'few_connections',
      message: `연결된 인물이 ${connectionCount}명입니다.`,
      suggestion: '관계가 적은 인물입니다. 다른 인물을 선택하거나 다른 챕터를 확인해보세요.',
      connectionCount,
    };
  }
  return {
    status: 'sufficient_connections',
    message: `연결된 인물이 ${connectionCount}명입니다.`,
    connectionCount,
  };
};
