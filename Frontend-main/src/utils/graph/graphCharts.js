/** 그래프 차트 데이터: 레이더(관계 분석)·관계 타임라인·노드 상세 데이터 */

import { asArray, clampPositivity, toNumberOrNull } from '../common/valueUtils';
import {
  processRelations,
  buildNodeIdentityContext,
  isSameNodeIdentifier,
  collectUndirectedRelations,
  NODE_TOOLTIP_VIEW_STATUS,
  isGraphEdgeElement,
  isGraphNodeElement,
  pickCharacterDisplayName,
} from './graphCore';
import { hasGraphPayload } from '../api/graphApi';
import { getEventDataByIndex } from './graphChapters';

const extractRadarChartData = (nodeId, relations, elements, maxDisplay = 8) => {
  if (!nodeId || !relations || !Array.isArray(relations)) return [];

  const targetNodeId = String(nodeId);
  const radarDataMap = new Map();
  const nodeById = new Map();
  for (const el of asArray(elements)) {
    // find()와 같게 첫 번째 일치 유지
    if (isGraphNodeElement(el) && !nodeById.has(String(el.data.id))) nodeById.set(String(el.data.id), el);
  }

  relations.forEach((rel) => {
    const id1 = String(rel.id1);
    const id2 = String(rel.id2);
    let connectedNodeId = null;
    if (id1 === targetNodeId) connectedNodeId = id2;
    else if (id2 === targetNodeId) connectedNodeId = id1;

    if (!connectedNodeId) return;

    const existingData = radarDataMap.get(connectedNodeId);
    const positivity = toNumberOrNull(rel.positivity);
    if (!existingData || Math.abs(positivity) > Math.abs(existingData.positivity)) {
      const connectedNode = nodeById.get(connectedNodeId);
      if (connectedNode && Number.isFinite(positivity)) {
        const name = pickCharacterDisplayName(connectedNode.data) || `인물 ${connectedNodeId}`;
        radarDataMap.set(connectedNodeId, {
          id: connectedNodeId,
          name,
          positivity,
          normalizedValue: ((positivity + 1) / 2) * 100,
          relationTags: rel.relation || [],
        });
      }
    }
  });

  const radarData = Array.from(radarDataMap.values());
  radarData.sort((a, b) => Math.abs(b.positivity) - Math.abs(a.positivity));
  return radarData.slice(0, maxDisplay);
};

export function padSingleEvent(points, labels) {
  if (!Array.isArray(points) || !Array.isArray(labels) || points.length !== 1) {
    return { points, labels };
  }

  return {
    points: Array.from({ length: 11 }, (_, index) => (index === 5 ? points[0] : null)),
    labels: Array.from({ length: 11 }, (_, index) => (index === 5 ? labels[0] : '')),
  };
}

/** 간선 관계 타임라인 차트 UX */
const EDGE_CHART_UX = {
  LONG_THRESHOLD: 12,
  /** positivity -1~1 기준 유의미 변화 */
  SIGNIFICANT_DELTA: 0.15,
};

export function isLongEdgeTimeline(pointCount) {
  return pointCount >= EDGE_CHART_UX.LONG_THRESHOLD;
}

/** 변곡·시작점에 isSignificant 표시 */
function annotateSignificantEdgePoints(pairs, delta = EDGE_CHART_UX.SIGNIFICANT_DELTA) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((pair, i) => {
    if (i === 0 || i === pairs.length - 1) {
      return { ...pair, isSignificant: true };
    }
    const prev = pairs[i - 1]?.value;
    const cur = pair?.value;
    if (typeof prev !== 'number' || typeof cur !== 'number') {
      return { ...pair, isSignificant: false };
    }
    return {
      ...pair,
      isSignificant: Math.abs(cur - prev) >= delta,
    };
  });
}

/**
 * X축 라벨용 tick.
 * 챕터가 많아도 겹치지 않도록 개수를 제한하고 간격을 유지한다.
 * (항상: 첫·끝·현재 / 챕터는 균등 샘플)
 */
export function getSparseEdgeTickValues(lineData, { maxTicks = 6 } = {}) {
  if (!Array.isArray(lineData) || lineData.length === 0) return [];
  if (lineData.length <= maxTicks) {
    return lineData.map((d) => d.x);
  }

  const byX = new Map(lineData.map((d) => [d.x, d]));
  const chosen = new Set();

  chosen.add(lineData[0].x);
  chosen.add(lineData[lineData.length - 1].x);
  lineData.forEach((d) => {
    if (d.isCurrent) chosen.add(d.x);
  });

  const chapters = lineData.filter((d) => d.isChapter);
  if (chapters.length > 0) {
    const chapterBudget = Math.max(2, maxTicks - chosen.size);
    if (chapters.length <= chapterBudget) {
      chapters.forEach((d) => chosen.add(d.x));
    } else {
      chosen.add(chapters[0].x);
      chosen.add(chapters[chapters.length - 1].x);
      const innerSlots = Math.max(0, chapterBudget - 2);
      for (let i = 1; i <= innerSlots; i += 1) {
        const idx = Math.round((i * (chapters.length - 1)) / (innerSlots + 1));
        chosen.add(chapters[idx].x);
      }
    }
  }

  if (chosen.size < 3) {
    chosen.add(lineData[Math.floor(lineData.length / 2)].x);
  }

  const sorted = [...chosen].sort((a, b) => a - b);
  const minGap = Math.max(1, Math.floor(lineData.length / maxTicks));
  const thinned = [];

  sorted.forEach((x) => {
    const point = byX.get(x);
    if (thinned.length === 0) {
      thinned.push(x);
      return;
    }
    const prevX = thinned[thinned.length - 1];
    if (x - prevX >= minGap) {
      thinned.push(x);
      return;
    }
    const prev = byX.get(prevX);
    const preferCurrent = point?.isCurrent && !prev?.isCurrent;
    const preferEnd =
      x === lineData[lineData.length - 1].x && prevX !== lineData[lineData.length - 1].x;
    if (preferCurrent || preferEnd) {
      thinned[thinned.length - 1] = x;
    }
  });

  if (thinned[0] !== lineData[0].x) thinned.unshift(lineData[0].x);
  const lastX = lineData[lineData.length - 1].x;
  if (thinned[thinned.length - 1] !== lastX) thinned.push(lastX);

  return [...new Set(thinned)].sort((a, b) => a - b);
}

/**
 * 차트 표시용 라벨. E12 → event 12, Ch는 유지.
 */
function formatEdgeTimelineDisplayLabel(label, numericLabel, fallbackIndex = 0) {
  if (typeof label === 'string') {
    const trimmed = label.trim();
    if (isEdgeChapterLabel(trimmed)) return trimmed;
    const eventMatch = trimmed.match(/^E(\d+)$/i);
    if (eventMatch) return `event ${eventMatch[1]}`;
  }
  if (Number.isFinite(numericLabel) && numericLabel > 0) {
    return `event ${numericLabel}`;
  }
  return `event ${fallbackIndex + 1}`;
}

function extractEdgeTimelineNumericLabel(label) {
  if (typeof label === 'number' && Number.isFinite(label)) {
    return label;
  }
  if (typeof label === 'string') {
    const match = label.match(/\d+/g);
    if (match?.length > 0) {
      const parsed = Number(match[match.length - 1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isEdgeChapterLabel(label) {
  return typeof label === 'string' && /^Ch\d+/i.test(label.trim());
}

function isEdgePairCurrentEvent(pair, eventIdx) {
  if (!pair || pair.isChapterAggregate) return false;
  if (!Number.isFinite(eventIdx) || eventIdx <= 0) return false;
  return Number.isFinite(pair.numericLabel) && pair.numericLabel === eventIdx;
}

/** 클릭한 간선의 현재 긍정도를 타임라인의 현재 이벤트 점에 맞춤 (gap/미존재 점은 만들지 않음) */
function alignPairsWithEdgePositivity(pairs, edgePositivity, displayEventNum) {
  if (edgePositivity == null || !Number.isFinite(displayEventNum) || displayEventNum <= 0) {
    return pairs;
  }

  const currentIdx = pairs.findIndex(
    (pair) =>
      !pair.isChapterAggregate &&
      Number.isFinite(pair.numericLabel) &&
      pair.numericLabel === displayEventNum,
  );
  if (currentIdx < 0) return pairs;

  const current = pairs[currentIdx];
  // 관계 공백(gap)은 이력 그대로 유지 — 간선 값으로 채우지 않음
  if (current.isGap || typeof current.value !== 'number') return pairs;

  const next = pairs.map((pair) => ({ ...pair }));
  next[currentIdx] = {
    ...next[currentIdx],
    value: edgePositivity,
  };
  return next;
}

const isNumberValue = (value) => typeof value === 'number' && !Number.isNaN(value);

/** 타임라인 한 칸 → 차트 점. 표시하지 않을 칸이면 null */
function timelineEntryToPair(label, value, nextValue, { isViewer, effectiveEventColumns }) {
  const isChapter = isEdgeChapterLabel(label);
  const numericLabel = extractEdgeTimelineNumericLabel(label);
  const hasNumericLabel = Number.isFinite(numericLabel);

  // 뷰어: 현재 이벤트 이후 열은 숨김
  if (isViewer && Number.isFinite(effectiveEventColumns) && hasNumericLabel && numericLabel > effectiveEventColumns) {
    return null;
  }

  // 관계 공백(null) — 축은 유지하고 선은 끊음
  if (value === null) {
    if (!hasNumericLabel && !isChapter) return null;
    return {
      value: null,
      label,
      numericLabel: hasNumericLabel ? numericLabel : null,
      isChapterAggregate: false,
      isGap: true,
    };
  }

  if (!isNumberValue(value)) return null;
  const normalizedValue = clampPositivity(value);

  // 챕터 집계 칸: 뒤에 실제 값이 이어질 때만 표시
  if (isChapter && isNumberValue(nextValue)) {
    return { value: normalizedValue, label, numericLabel: null, isChapterAggregate: true };
  }

  if (!hasNumericLabel) return null;
  return { value: normalizedValue, label, numericLabel, isChapterAggregate: false };
}

/** 그릴 값이 있는지. 뷰어는 현재 이벤트(없으면 그 이전 이벤트)에 값이 있어야 함 */
function hasActiveChartData(pairs, isViewer, displayEventNum) {
  if (!pairs.some((pair) => typeof pair.value === 'number')) return false;
  if (!isViewer || !Number.isFinite(displayEventNum) || displayEventNum <= 0) return true;
  if (pairs.some((pair) => isEdgePairCurrentEvent(pair, displayEventNum))) return true;
  return pairs.some(
    (pair) =>
      !pair.isChapterAggregate &&
      Number.isFinite(pair.numericLabel) &&
      pair.numericLabel <= displayEventNum &&
      typeof pair.value === 'number',
  );
}

/**
 * 관계 타임라인 → Recharts line data
 * @returns {{ rechartsLineData: object[], hasChartData: boolean, numericPointCount: number }}
 */
export function buildEdgeRechartsLineData({
  timeline,
  labels,
  edgePositivity,
  displayEventNum,
  isViewer,
  effectiveEventColumns,
  relationError,
}) {
  const empty = { rechartsLineData: [], hasChartData: false, numericPointCount: 0 };
  if (relationError) return empty;

  const pairs = [];
  const timelineHasValues =
    Array.isArray(timeline) && timeline.some((value) => value === null || isNumberValue(value));

  if (timelineHasValues && Array.isArray(labels) && labels.length > 0) {
    const length = Math.min(labels.length, timeline.length);
    for (let i = 0; i < length; i += 1) {
      const pair = timelineEntryToPair(labels[i], timeline[i], timeline[i + 1], { isViewer, effectiveEventColumns });
      if (pair) pairs.push(pair);
    }
  }

  // 타임라인 없고 로드 에러가 아닐 때만 현재 간선 positivity로 단점 보조
  if (pairs.length === 0 && edgePositivity !== null) {
    pairs.push({
      value: edgePositivity,
      label: `E${displayEventNum || 1}`,
      numericLabel: displayEventNum || 1,
      isChapterAggregate: false,
    });
  }

  const alignedPairs = alignPairsWithEdgePositivity(pairs, edgePositivity, displayEventNum);
  if (!hasActiveChartData(alignedPairs, isViewer, displayEventNum)) return empty;

  const annotated = annotateSignificantEdgePoints(alignedPairs);
  const lineData = annotated.map((pair, i) => {
    const isChapter = pair.isChapterAggregate || isEdgeChapterLabel(pair.label);
    return {
      x: i + 1,
      y: typeof pair.value === 'number' ? pair.value : null,
      label: formatEdgeTimelineDisplayLabel(pair.label, pair.numericLabel, i),
      numericLabel: pair.numericLabel,
      isChapter,
      isCurrent: isEdgePairCurrentEvent(pair, displayEventNum),
      isSignificant: !!pair.isSignificant,
      isGap: !!pair.isGap,
    };
  });

  const numericPointCount = lineData.filter((d) => typeof d.y === 'number').length;
  return {
    rechartsLineData: lineData,
    hasChartData: numericPointCount > 0,
    numericPointCount,
  };
}

const EMPTY_RADAR_RESULT = Object.freeze({ items: [], status: NODE_TOOLTIP_VIEW_STATUS.NO_DATA });

const radarOk = (items) => ({
  items,
  status: items.length > 0 ? NODE_TOOLTIP_VIEW_STATUS.OK : NODE_TOOLTIP_VIEW_STATUS.NO_DATA,
});

const radarError = (message) => ({
  items: [],
  status: NODE_TOOLTIP_VIEW_STATUS.ERROR,
  error: message || '관계 분석 데이터를 만들지 못했습니다.',
});

/** 현재 챕터·이벤트에 인물이 등장했는지 (이벤트 데이터·elements 기준) */
export function checkNodeAppearance({ data, node, currentChapter, bookId, eventNum, elements }) {
  if (!data || !currentChapter || currentChapter <= 0) {
    return { appeared: false, error: null };
  }

  try {
    const json = getEventDataByIndex(bookId, currentChapter, eventNum);
    const idCtx = buildNodeIdentityContext({
      id: node?.id ?? data?.id ?? data?.data?.id,
      common_name: pickCharacterDisplayName(node) || pickCharacterDisplayName(data) || pickCharacterDisplayName(data?.data),
    });

    const inElements = Array.isArray(elements) && elements.some((el) => {
      if (!el || isGraphEdgeElement(el)) return false;
      return isSameNodeIdentifier(el.data ?? el, idCtx);
    });

    if (!json?.relations) {
      return { appeared: inElements, error: null };
    }

    const relations = processRelations(json.relations);
    const inCharacters = Array.isArray(json.characters)
      && json.characters.some((c) => isSameNodeIdentifier(c, idCtx));
    const inRelations = relations.some(
      (rel) =>
        isSameNodeIdentifier({ id: rel.id1, name: rel.name1 }, idCtx) ||
        isSameNodeIdentifier({ id: rel.id2, name: rel.name2 }, idCtx),
    );

    return { appeared: inCharacters || inRelations || inElements, error: null };
  } catch (err) {
    return { appeared: false, error: err.message };
  }
}

/** 노드 관계 분석(레이더) 데이터: API 그래프 → elements 간선 → 이벤트 데이터 순으로 시도 */
export function buildRadarChartData({
  node,
  currentChapter,
  apiBookGraphData,
  elements,
  bookId,
  eventNum,
}) {
  if (!node?.id || !currentChapter) return EMPTY_RADAR_RESULT;

  try {
    // 빈 []도 truthy이므로 hasGraphPayload로 실제 데이터가 있을 때만 API 소스 사용
    if (hasGraphPayload(apiBookGraphData)) {
      const { relations, characters } = apiBookGraphData;
      const bookElements = characters.map((char) => {
        const charName = pickCharacterDisplayName(char);
        return {
          data: {
            id: String(char.id),
            label: charName || `인물 ${char.id}`,
            common_name: charName || `인물 ${char.id}`,
          },
        };
      });

      const targetNodeId = node.id;
      return radarOk(
        extractRadarChartData(
          targetNodeId,
          collectUndirectedRelations(relations, targetNodeId),
          bookElements,
          8,
        ),
      );
    }

    if (!elements?.length) return EMPTY_RADAR_RESULT;

    const edgeRels = elements
      .filter(isGraphEdgeElement)
      .map((el) => ({
        id1: el.data.source,
        id2: el.data.target,
        relation: el.data.relation || ['관계'],
        count: el.data.count || el.data.strength || 1,
        positivity: clampPositivity(el.data.positivity),
      }));

    if (edgeRels.length > 0) {
      const nodeElements = elements.filter(isGraphNodeElement);
      return radarOk(
        extractRadarChartData(
          node.id,
          collectUndirectedRelations(edgeRels, node.id),
          nodeElements,
          8,
        ),
      );
    }

    if (!bookId) return EMPTY_RADAR_RESULT;
    const json = getEventDataByIndex(bookId, currentChapter, eventNum);
    if (!json?.relations) return EMPTY_RADAR_RESULT;

    const relations = collectUndirectedRelations(json.relations);
    const ids = new Set(relations.flatMap((rel) => [String(rel.id1), String(rel.id2)]));
    const filtered = elements.filter(
      (el) => !isGraphEdgeElement(el) && ids.has(String(el.data.id)),
    );
    return radarOk(extractRadarChartData(node.id, relations, filtered, 8));
  } catch (err) {
    return radarError(err?.message);
  }
}
