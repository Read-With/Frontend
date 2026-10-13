/** 그래프 강조: reciprocal junction·선택 하이라이트·검색(필터·제안·페이드) */

import { errorUtils } from '../common/valueUtils';
import {
  undirectedPairKey,
  uniqueStrings,
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
} from './graphCore';
import { expandConnectedSubgraph } from './graphModel';
import {
  FLOATING_TOOLTIP_ESTIMATE,
  getCyClientRect,
  getSelectionFocusElements,
  placeTooltipInCanvasAwayFromFocus,
} from './graphViewport';

/** reciprocalPair junction: target-endpoint bypass로 중점 고정. highlighted면 bypass 제거(일반 0→0). */
const pendingJunctionSyncRaf = new WeakMap();

function clearReciprocalEndpointBypass(edge) {
  edge.removeStyle("target-endpoint");
  edge.removeStyle("curve-style");
}

function runSyncReciprocalPairJunctionOffsets(cy, nodes) {
  if (!cy || typeof cy.edges !== "function") return;
  let edges = null;
  try {
    edges =
      nodes && typeof nodes.connectedEdges === "function"
        ? nodes.connectedEdges("[?reciprocalPair]")
        : cy.edges("[?reciprocalPair]");
  } catch {
    return;
  }
  if (!edges || edges.length === 0) return;

  const pairMap = new Map();
  edges.forEach((e) => {
    const key = undirectedPairKey(e.data("source"), e.data("target"));
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key).push(e);
  });

  pairMap.forEach((list, key) => {
    if (list.length >= 2) return;
    const sample = list[0];
    if (!sample) return;
    try {
      sample
        .source()
        .edgesWith(sample.target())
        .filter("[?reciprocalPair]")
        .forEach((e) => {
          if (!list.some((x) => x.id() === e.id())) list.push(e);
        });
      pairMap.set(key, list);
    } catch {
      /* ignore */
    }
  });

  cy.batch(() => {
    pairMap.forEach((list) => {
      if (list.length !== 2) {
        list.forEach(clearReciprocalEndpointBypass);
        return;
      }
      const e0 = list[0];
      const s = e0.source();
      const t = e0.target();
      if (!s || !t || s.empty?.() || t.empty?.()) return;
      const mx = (s.position("x") + t.position("x")) / 2;
      const my = (s.position("y") + t.position("y")) / 2;
      list.forEach((edge) => {
        if (edge.hasClass("highlighted")) {
          clearReciprocalEndpointBypass(edge);
          return;
        }
        const tgt = edge.target();
        if (!tgt || tgt.empty?.()) return;
        edge.style(
          "target-endpoint",
          `${mx - tgt.position("x")} ${my - tgt.position("y")}`
        );
      });
    });
  });
}

/**
 * @param {object} cy
 * @param {{ immediate?: boolean, nodes?: object }} [opts]
 */
export function syncReciprocalPairJunctionOffsets(cy, opts = {}) {
  if (!cy || typeof cy.edges !== "function") return;
  const immediate = opts.immediate === true;
  const nodes = opts.nodes;
  const pending = pendingJunctionSyncRaf.get(cy);

  if (immediate) {
    if (pending != null) {
      cancelAnimationFrame(pending);
      pendingJunctionSyncRaf.delete(cy);
    }
    runSyncReciprocalPairJunctionOffsets(cy, nodes);
    return;
  }

  if (pending != null) return;
  const rafId = requestAnimationFrame(() => {
    pendingJunctionSyncRaf.delete(cy);
    runSyncReciprocalPairJunctionOffsets(cy, nodes);
  });
  pendingJunctionSyncRaf.set(cy, rafId);
}

export function clearHighlightClassesOn(cy) {
  if (!cy) return;
  let hadTouched = false;
  try {
    const touched = cy
      .collection()
      .union(cy.nodes(".highlighted"))
      .union(cy.nodes(".faded"))
      .union(cy.nodes(".kb-focus"))
      .union(cy.edges(".highlighted"))
      .union(cy.edges(".faded"))
      .union(cy.edges(".kb-focus"));
    if (touched.length === 0) return;
    hadTouched = true;
    cy.batch(() => {
      touched.removeClass("highlighted faded kb-focus");
      touched.nodes().forEach((node) => {
        node.removeStyle("opacity");
        node.removeStyle("text-opacity");
        node.removeStyle("border-color");
        node.removeStyle("border-width");
        node.removeStyle("border-opacity");
        node.removeStyle("border-style");
      });
      touched.edges().forEach((edge) => {
        edge.removeStyle("opacity");
        edge.removeStyle("text-opacity");
        edge.removeStyle("width");
        clearReciprocalEndpointBypass(edge);
      });
    });
  } catch {
    /* ignore */
  }
  if (hadTouched) {
    syncReciprocalPairJunctionOffsets(cy, { immediate: true });
  }
}

const isCyNode = (element) => typeof element?.isNode === 'function' && element.isNode();

function isFiniteGraphPoint(point) {
  return (
    point &&
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function getEdgeRenderedCenter(element) {
  try {
    const midpoint = typeof element.midpoint === 'function' ? element.midpoint() : null;
    if (isFiniteGraphPoint(midpoint)) return midpoint;
  } catch {
    /* fall through */
  }

  const source = element.source?.();
  const target = element.target?.();
  if (!source?.length || !target?.length) return null;

  const sourcePos = source.renderedPosition();
  const targetPos = target.renderedPosition();
  if (!isFiniteGraphPoint(sourcePos) || !isFiniteGraphPoint(targetPos)) return null;

  return {
    x: (sourcePos.x + targetPos.x) / 2,
    y: (sourcePos.y + targetPos.y) / 2,
  };
}

function applySelectionFade(
  cy,
  keepNodes,
  keepEdges,
  highlightedNodes = keepNodes,
  highlightedEdges = keepEdges,
) {
  if (!cy) return;
  clearHighlightClassesOn(cy);
  const fadedNodes = cy.nodes().difference(keepNodes);
  const fadedEdges = cy.edges().difference(keepEdges);
  cy.batch(() => {
    highlightedNodes.addClass('highlighted');
    highlightedEdges.addClass('highlighted');
    fadedNodes.addClass('faded');
    fadedEdges.addClass('faded');
    highlightedEdges.forEach((edge) => {
      if (edge.data('reciprocalPair')) clearReciprocalEndpointBypass(edge);
    });
  });
}

export function applySelectionHighlight(cy, element) {
  if (!cy || !element || element.length === 0) return;
  const focus = getSelectionFocusElements(cy, element);
  if (!focus?.length) return;

  if (isCyNode(element)) {
    applySelectionFade(cy, focus.nodes(), focus.edges(), element, focus.edges());
    return;
  }
  applySelectionFade(cy, focus.nodes(), focus.edges());
}

export function calculateGraphTooltipPosition(cy, element) {
  try {
    if (!cy) return { x: 0, y: 0 };

    const basePos = isCyNode(element)
      ? element.renderedPosition()
      : getEdgeRenderedCenter(element);
    if (!isFiniteGraphPoint(basePos)) return { x: 0, y: 0 };

    const rect = getCyClientRect(cy);
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: left + basePos.x,
      y: top + basePos.y,
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

export function buildTapShowArgs(kind, element, evt, center, mouseX, mouseY) {
  if (kind === 'node') {
    return { node: element, evt, nodeCenter: center, mouseX, mouseY };
  }
  return { edge: element, evt, edgeCenter: center, mouseX, mouseY };
}

/** 노드·간선: focus 집합을 가리지 않도록 캔버스 내 배치 */
export function resolveGraphTooltipAnchor(cy, element) {
  const focus = getSelectionFocusElements(cy, element);
  return placeTooltipInCanvasAwayFromFocus({
    cy,
    focusEles: focus,
    width: FLOATING_TOOLTIP_ESTIMATE.width,
    height: FLOATING_TOOLTIP_ESTIMATE.height,
  });
}

const MIN_GRAPH_SEARCH_LENGTH = 2;

export function normalizeGraphSearchTerm(term) {
  const trimmed = typeof term === 'string' ? term.trim() : '';
  return {
    trimmed,
    hasMinLength: trimmed.length >= MIN_GRAPH_SEARCH_LENGTH,
  };
}

/**
 * @returns {{ applied: boolean, filtered: Array }}
 */
export function resolveGraphSearchFilter(sourceElements, term, chapterData = null) {
  const { trimmed } = normalizeGraphSearchTerm(term);
  if (!trimmed || !sourceElements) {
    return { applied: false, filtered: [] };
  }
  const filtered = filterGraphElements(sourceElements, trimmed, chapterData);
  return { applied: true, filtered: filtered || [] };
}

export function extractFitNodeIds(filteredElements, isSearchActive = true) {
  if (!isSearchActive || !filteredElements?.length) return [];
  return filteredElements
    .filter((el) => isGraphNodeElement(el) && el.data?.id != null)
    .map((el) => String(el.data.id));
}

const buildChapterCharacterIdSet = (currentChapterData) => {
  if (!currentChapterData?.characters?.length) return null;
  return new Set(currentChapterData.characters.map(char => String(char.id)));
};

function filterNodesByChapter(nodes, currentChapterData) {
  const chapterCharacterIds = buildChapterCharacterIdSet(currentChapterData);
  if (!chapterCharacterIds) return nodes;
  return nodes.filter((node) => {
    const nodeId = node?.data?.id;
    if (nodeId === undefined || nodeId === null) return false;
    return chapterCharacterIds.has(String(nodeId));
  });
}

function getNodeSearchFields(nodeOrSuggestion) {
  const data = nodeOrSuggestion?.data;
  return {
    label: String((data?.label ?? nodeOrSuggestion?.label) || '').toLowerCase(),
    commonName: String((data?.common_name ?? nodeOrSuggestion?.common_name) || '').toLowerCase(),
    names: Array.isArray(data?.names) ? data.names : (nodeOrSuggestion?.names ?? []),
  };
}

function getNodeMatchType(node, searchLower) {
  if (!node?.data || typeof searchLower !== 'string') return null;
  try {
    const { label, commonName, names } = getNodeSearchFields(node);
    if (label.includes(searchLower)) return 'label';
    if (names.some((name) => String(name).toLowerCase().includes(searchLower))) return 'names';
    if (commonName.includes(searchLower)) return 'common_name';
    return null;
  } catch (error) {
    errorUtils.logDebug('getNodeMatchType', error?.message || '실패', { searchLower });
    return null;
  }
}

function nodeExactMatchesQuery(nodeOrSuggestion, searchLower) {
  const { label, commonName, names } = getNodeSearchFields(nodeOrSuggestion);
  return (
    label === searchLower ||
    commonName === searchLower ||
    names.some((name) => String(name).toLowerCase() === searchLower)
  );
}

/**
 * 입력된 검색어와 관련된 노드(인물 등)를 찾아 최대 8개 추천 리스트 생성
 * @param {Array} elements - 그래프 요소 배열
 * @param {string} query - 검색어
 * @param {Object} [currentChapterData=null] - 현재 챕터 데이터
 * @returns {Array} 추천 리스트
 */
export function buildSuggestions(elements, query, currentChapterData = null) {
  if (!Array.isArray(elements)) {
    errorUtils.logDebug('buildSuggestions', '유효하지 않은 elements 배열', {
      type: typeof elements,
    });
    return [];
  }

  const { trimmed, hasMinLength } = normalizeGraphSearchTerm(query);
  if (!hasMinLength) return [];

  try {
    const searchLower = trimmed.toLowerCase();
    const filteredNodes = filterNodesByChapter(
      elements.filter(isGraphNodeElement),
      currentChapterData
    );

    const byId = new Map();
    for (const node of filteredNodes) {
      const matchType = getNodeMatchType(node, searchLower);
      if (!matchType) continue;

      const uniqueNames = uniqueStrings(node.data.names || [], { caseInsensitive: true });
      const existing = byId.get(node.data.id);
      if (existing) {
        existing.names = uniqueStrings(
          [...(existing.names || []), ...uniqueNames],
          { caseInsensitive: true }
        );
        continue;
      }

      byId.set(node.data.id, {
        id: node.data.id,
        label: node.data.label,
        names: uniqueNames,
        common_name: node.data.common_name,
        matchType,
      });
    }

    return Array.from(byId.values()).slice(0, 8);
  } catch (error) {
    errorUtils.logDebug('buildSuggestions', error?.message || '실패', {
      elementsLength: elements?.length,
      query,
      hasChapterData: !!currentChapterData,
    });
    return [];
  }
}

/**
 * 제안 목록에서 검색어와 대소문자 무시 완전 일치 항목
 * @param {Array} suggestions
 * @param {string} trimmedTerm 공백 제거된 검색어
 */
export function findExactSuggestionMatch(suggestions, trimmedTerm) {
  if (!Array.isArray(suggestions) || !trimmedTerm) return undefined;
  const t = trimmedTerm.toLowerCase();
  return suggestions.find((suggestion) => nodeExactMatchesQuery(suggestion, t));
}

/**
 * 그래프 요소 필터링 및 연결 관계 처리
 * @param {Array} elements - 그래프 요소 배열
 * @param {string} searchTerm - 검색어
 * @param {Object} [currentChapterData=null] - 현재 챕터 데이터
 * @returns {Array} 필터링된 요소 배열
 */
function filterGraphElements(elements, searchTerm, currentChapterData = null) {
  if (!Array.isArray(elements)) {
    errorUtils.logDebug('filterGraphElements', '유효하지 않은 elements 배열', {
      type: typeof elements,
    });
    return [];
  }
  
  if (!searchTerm || typeof searchTerm !== 'string' || !normalizeGraphSearchTerm(searchTerm).hasMinLength) {
    return elements;
  }
  
  try {
    const searchLower = searchTerm.toLowerCase();
    const candidateNodes = filterNodesByChapter(
      elements.filter((el) => isGraphNodeElement(el) && getNodeMatchType(el, searchLower)),
      currentChapterData
    );
    
    // 정확히 일치하는 인물을 우선적으로 찾기
    let matchingNode = candidateNodes.find((node) => nodeExactMatchesQuery(node, searchLower));

    if (!matchingNode && candidateNodes.length > 0) {
      matchingNode = candidateNodes[0];
    }

    if (!matchingNode) {
      return [];
    }

    return expandConnectedSubgraph(elements, new Set([matchingNode.data.id]), {
      seedEdgeMode: 'any',
      includeIsolatedSeeds: true,
    });
  } catch (error) {
    errorUtils.logDebug('filterGraphElements', error?.message || '실패', {
      elementsLength: elements?.length,
      searchTerm,
      hasChapterData: !!currentChapterData,
    });
    return [];
  }
}

/**
 * 검색된 요소들의 ID 집합을 생성
 * @param {Array} filteredElements - 검색 결과 요소들
 * @returns {{ nodeIds: Set, edgeIds: Set }} 검색된 요소들의 ID 집합
 */
function createFilteredElementIds(filteredElements) {
  if (!Array.isArray(filteredElements) || filteredElements.length === 0) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }
  
  try {
    const nodeIds = new Set();
    const edgeIds = new Set();
    
    filteredElements.forEach((element) => {
      const elementId = normalizeElementId(element);
      if (!element?.data || elementId == null) {
        errorUtils.logDebug('createFilteredElementIds', '유효하지 않은 요소', {
          hasData: !!element?.data,
        });
        return;
      }

      if (isGraphEdgeElement(element)) {
        if (element.data.source != null) nodeIds.add(String(element.data.source));
        if (element.data.target != null) nodeIds.add(String(element.data.target));
        if (element.data.id != null) edgeIds.add(String(element.data.id));
      } else if (element.data.id != null) {
        nodeIds.add(String(element.data.id));
      }
    });
    
    return { nodeIds, edgeIds };
  } catch (error) {
    errorUtils.logDebug('createFilteredElementIds', error?.message || '실패', {
      filteredElementsLength: filteredElements?.length,
    });
    return { nodeIds: new Set(), edgeIds: new Set() };
  }
}

/**
 * 검색 결과에 따라 그래프 요소들에 페이드 효과 적용
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Array} filteredElements - 검색 결과 요소들
 */
export function applySearchFadeEffect(cy, filteredElements) {
  if (!cy || typeof cy.elements !== 'function') {
    errorUtils.logDebug('applySearchFadeEffect', '유효하지 않은 Cytoscape 인스턴스');
    return;
  }
  
  try {
    clearHighlightClassesOn(cy);

    // 검색 활성 + 결과 없음 → 전체 페이드 (결과 없음 UI와 맞춤)
    if (!filteredElements || filteredElements.length === 0) {
      cy.batch(() => {
        const fade = (collection) => collection.forEach((el) => el.addClass('faded'));
        fade(cy.nodes());
        fade(cy.edges());
      });
      return;
    }

    // 검색 결과에 포함된 요소들의 ID 집합 생성
    const { nodeIds: filteredNodeIds, edgeIds: filteredEdgeIds } = createFilteredElementIds(filteredElements);

    cy.batch(() => {
      cy.nodes().forEach(node => {
        if (!filteredNodeIds.has(String(node.id()))) {
          node.addClass("faded");
        }
      });

      cy.edges().forEach(edge => {
        if (!filteredEdgeIds.has(String(edge.id()))) {
          edge.addClass("faded");
        }
      });
    });
  } catch (error) {
    errorUtils.logDebug('applySearchFadeEffect', error?.message || '실패', {
      filteredElementsLength: filteredElements?.length,
    });
  }
}

/**
 * 통일된 검색 결과 없음 조건 확인
 * @param {boolean} isSearchActive - 검색 활성 상태
 * @param {string} searchTerm - 검색어
 * @param {Array} fitNodeIds - 검색된 노드 ID 배열
 * @returns {boolean} 검색 결과 없음 여부
 */
export function shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds = []) {
  if (typeof isSearchActive !== 'boolean') {
    errorUtils.logDebug('shouldShowNoSearchResults', 'isSearchActive이 boolean이 아님', {
      isSearchActive,
    });
    return false;
  }

  const { trimmed } = normalizeGraphSearchTerm(searchTerm);
  return isSearchActive && trimmed.length > 0 && (!fitNodeIds || fitNodeIds.length === 0);
}

/**
 * 검색 결과 없음 메시지 생성
 * @param {string} searchTerm - 검색어
 * @returns {Object} 메시지 객체
 */
export function getNoSearchResultsMessage(searchTerm) {
  const { trimmed } = normalizeGraphSearchTerm(searchTerm);
  if (!trimmed) {
    errorUtils.logDebug('getNoSearchResultsMessage', '유효하지 않은 검색어', {
      type: typeof searchTerm,
    });
    return {
      title: '검색 결과가 없습니다',
      description: '검색어를 입력해주세요.',
    };
  }

  return {
    title: '검색 결과가 없습니다',
    description: `"${trimmed}"와 일치하는 인물을 찾을 수 없습니다.`,
  };
}
