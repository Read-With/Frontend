/** Cytoscape: 인스턴스·레이아웃 실행·elements 동기화 + 강조·검색 + 키보드 탐색 */

import { errorUtils, compareKo, cycleIndex } from '../common/valueUtils';
import {
  undirectedPairKey,
  uniqueStrings,
  normalizeElementId,
  isGraphEdgeElement,
  isGraphNodeElement,
  GRAPH_ZOOM,
  pickCharacterDisplayName,
  normalizeRelationArray,
} from './graphCore';
import {
  expandConnectedSubgraph,
  buildElementsStructureFingerprint,
  visualElementSignature,
  visualSignatureImagePart,
} from './graphElements';
import {
  FLOATING_TOOLTIP_ESTIMATE,
  getCyClientRect,
  getSelectionFocusElements,
  placeTooltipInCanvasAwayFromFocus,
  centerSelectionOnElementId,
  fitGraphToNodes,
  zoomGraphByFactor,
  hasOverlappingNodes,
  collectNeighborhoodNodeIds,
  OVERLAP_RESOLVE,
  OVERLAP_PROFILES,
  readNodeRadius,
  detectAndResolveOverlap,
  calculateAnchorAwarePlacement,
  ensureElementsInBounds,
  isGraphContainerSizeReady,
  isElementsFitInViewport,
  fitGraphViewportInContainer,
} from './graphLayout';
import { isTypingTarget } from '../common/domUtils';
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';

/* ─── 그래프 강조: reciprocal junction·선택 하이라이트·검색(필터·제안·페이드) ─── */

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
/**
 * 검색 결과 밖 요소를 흐리게. 기존 하이라이트 클래스를 먼저 지운다.
 * alreadyCleared: 호출 직전에 clearHighlightClassesOn을 이미 했으면 true (같은 정리를 두 번 하지 않음)
 */
export function applySearchFadeEffect(cy, filteredElements, { alreadyCleared = false } = {}) {
  if (!cy || typeof cy.elements !== 'function') {
    errorUtils.logDebug('applySearchFadeEffect', '유효하지 않은 Cytoscape 인스턴스');
    return;
  }
  
  try {
    if (!alreadyCleared) clearHighlightClassesOn(cy);

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

/* ─── 그래프 캔버스 키보드 탐색: 화살표로 노드·간선 이동, Enter로 선택, Escape로 해제, +/-/0 줌 ─── */


function graphElementLabel(ele) {
  if (!ele?.length) return '';
  const data = ele.data?.() || {};
  if (isCyNode(ele)) {
    return pickCharacterDisplayName(data) || String(data.id || '이름 없음');
  }
  const sn = pickCharacterDisplayName(ele.source?.()?.data?.()) || '인물';
  const tn = pickCharacterDisplayName(ele.target?.()?.data?.()) || '인물';
  return `${sn}와 ${tn}의 관계`;
}

function isNavigableGraphElement(ele) {
  if (!ele?.length) return false;
  if (typeof ele.visible === 'function' && !ele.visible()) return false;
  if (typeof ele.hasClass === 'function' && ele.hasClass('faded')) return false;
  return true;
}

function compareByGraphLabelKo(a, b) {
  return compareKo(graphElementLabel(a), graphElementLabel(b));
}

function listNavigableGraphNodes(cy) {
  if (!cy || cy.destroyed?.()) return [];
  try {
    return cy
      .nodes()
      .filter((n) => isNavigableGraphElement(n))
      .sort(compareByGraphLabelKo)
      .toArray();
  } catch {
    return [];
  }
}

function listNavigableGraphEdgesForNode(node) {
  if (!node?.length) return [];
  try {
    return node
      .connectedEdges()
      .filter((e) => isNavigableGraphElement(e))
      .sort(compareByGraphLabelKo)
      .toArray();
  } catch {
    return [];
  }
}

function setKeyboardFocusElement(cy, element) {
  if (!cy || cy.destroyed?.()) return;
  try {
    cy.batch(() => {
      cy.nodes('.kb-focus').removeClass('kb-focus');
      cy.edges('.kb-focus').removeClass('kb-focus');
      if (element?.length) element.addClass('kb-focus');
    });
  } catch {
    /* ignore */
  }
}

function commitKeyboardFocus(cy, focusRef, kind, ele) {
  setKeyboardFocusElement(cy, ele);
  if (!focusRef) return;
  focusRef.current = ele?.length ? { kind, id: String(ele.id()) } : null;
}

function announceFocus(kind, ele, index, total) {
  const pos = `${index + 1}/${total}`;
  const label = graphElementLabel(ele);
  return kind === 'edge'
    ? `${label} 포커스. ${pos}. Enter로 상세.`
    : `인물 ${label} 포커스. ${pos}. Enter로 상세, 선택 후 좌우로 관계.`;
}

function moveKeyboardFocus(cy, {
  list,
  kind,
  delta,
  focusRef,
  currentId,
  fallbackId = null,
  onAnnounce,
  center = false,
}) {
  if (!list.length) {
    onAnnounce?.(kind === 'edge' ? '연결된 관계가 없습니다.' : '탐색할 인물이 없습니다.');
    return true;
  }
  let idx = list.findIndex((el) => String(el.id()) === String(currentId));
  if (idx < 0 && fallbackId != null) {
    idx = list.findIndex((el) => String(el.id()) === String(fallbackId));
  }
  idx = cycleIndex(idx, list.length, delta);
  const ele = list[idx];
  commitKeyboardFocus(cy, focusRef, kind, ele);
  if (center) {
    try {
      centerSelectionOnElementId(cy, ele.id(), {
        duration: 220,
        padding: 48,
        reserveRight: 24,
      });
    } catch {
      /* ignore */
    }
  }
  onAnnounce?.(announceFocus(kind, ele, idx, list.length));
  return true;
}

const ZOOM_KEY_FACTORS = new Map([
  ['+', GRAPH_ZOOM.STEP],
  ['=', GRAPH_ZOOM.STEP],
  ['-', 1 / GRAPH_ZOOM.STEP],
  ['_', 1 / GRAPH_ZOOM.STEP],
]);

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);


function clearGraphKeyboardFocus(cy, { onClearSelection, keyboardFocusRef, onAnnounce }) {
  onClearSelection?.();
  setKeyboardFocusElement(cy, null);
  if (keyboardFocusRef) keyboardFocusRef.current = null;
  onAnnounce?.('선택과 포커스를 해제했습니다.');
  return true;
}

/** 화살표: 인물 순환. 노드 선택 중 좌우는 그 인물의 연결 관계 순환 */
function moveFocusByArrow(cy, key, { keyboardFocusRef, onAnnounce, selectedKind, selectedId }) {
  const focus = keyboardFocusRef?.current;
  const delta = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
  const isHorizontal = key === 'ArrowLeft' || key === 'ArrowRight';

  if (selectedKind === 'node' && selectedId && isHorizontal) {
    return moveKeyboardFocus(cy, {
      list: listNavigableGraphEdgesForNode(cy.getElementById(String(selectedId))),
      kind: 'edge',
      delta,
      focusRef: keyboardFocusRef,
      currentId: focus?.kind === 'edge' ? focus.id : null,
      onAnnounce,
    });
  }

  return moveKeyboardFocus(cy, {
    list: listNavigableGraphNodes(cy),
    kind: 'node',
    delta,
    focusRef: keyboardFocusRef,
    currentId: focus?.kind === 'node' ? focus.id : null,
    fallbackId: selectedId,
    onAnnounce,
    center: true,
  });
}

/** Enter/Space: 포커스 요소 선택 (포커스가 없으면 첫 인물) */
function activateKeyboardFocus(cy, { keyboardFocusRef, onSelectById, onAnnounce }) {
  let kind = keyboardFocusRef?.current?.kind;
  let id = keyboardFocusRef?.current?.id;
  if (!id) {
    const nodes = listNavigableGraphNodes(cy);
    if (!nodes.length) {
      onAnnounce?.('선택할 인물이 없습니다.');
      return true;
    }
    kind = 'node';
    id = String(nodes[0].id());
    commitKeyboardFocus(cy, keyboardFocusRef, 'node', nodes[0]);
  }

  if (!onSelectById?.(kind, id)) {
    onAnnounce?.('선택을 적용하지 못했습니다.');
    return true;
  }
  const label = graphElementLabel(cy.getElementById(String(id)));
  onAnnounce?.(kind === 'edge' ? `${label} 상세를 열었습니다.` : `인물 ${label} 상세를 열었습니다.`);
  return true;
}

/**
 * 그래프 캔버스 region 포커스 단축키.
 * +/= 확대, - 축소, 0 맞춤, Escape 선택·포커스 해제.
 * 화살표: 인물 순환(선택 중 좌우는 연결 관계). Enter/Space: 포커스 선택.
 * @returns {boolean} 처리 여부
 */
export function handleGraphCanvasHotkeys(event, options = {}) {
  if (!event || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;

  const { cy } = options;
  const { key } = event;

  if (key === 'Escape') {
    event.preventDefault();
    return clearGraphKeyboardFocus(cy, options);
  }

  if (!cy || cy.destroyed?.()) return false;

  if (ZOOM_KEY_FACTORS.has(key)) {
    event.preventDefault();
    return zoomGraphByFactor(cy, ZOOM_KEY_FACTORS.get(key));
  }
  if (key === '0') {
    event.preventDefault();
    return fitGraphToNodes(cy, { duration: GRAPH_ZOOM.FIT_DURATION_MS });
  }
  if (ARROW_KEYS.has(key)) {
    event.preventDefault();
    return moveFocusByArrow(cy, key, options);
  }
  if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    return activateKeyboardFocus(cy, options);
  }
  return false;
}

/* ─── Cytoscape 인스턴스·레이아웃 실행·elements 동기화·툴팁 payload ─── */


let coseBilkentRegistered = false;

function ensureCoseBilkentRegistered() {
  if (coseBilkentRegistered) return;
  cytoscape.use(coseBilkent);
  coseBilkentRegistered = true;
}

/** cy 파괴·컨테이너 detach 중 호출해도 throw 하지 않음 */
export function safeCyCall(cy, operation, context = 'cy') {
  if (!cy || cy.destroyed?.()) return null;
  try {
    return operation();
  } catch (error) {
    errorUtils.logDebug(context, 'cy operation failed', {
      message: error?.message,
    });
    return null;
  }
}

/** element 정의 배열의 data를 기존 cy 노드/엣지에 동기화 */
function syncCyElementData(cy, defs) {
  if (!cy || !defs?.length) return;
  for (const def of defs) {
    const rawId = def?.data?.id;
    if (rawId == null || rawId === '') continue;
    const el = cy.getElementById(String(rawId));
    if (!el || el.length === 0) continue;
    try {
      el.data(def.data);
    } catch {
      /* ignore */
    }
  }
}

/** props 정의에서 id Set */
function elementDefIdSet(defs) {
  return new Set(
    (defs || [])
      .map((d) => (d?.data?.id != null ? String(d.data.id) : ''))
      .filter(Boolean),
  );
}

/**
 * 다음 그래프에도 남는 기존 노드의 위치·반지름·weight (증분 배치 시드)
 * @param {Set<string>} prevNodeIds
 * @param {Set<string>} nextNodeIds
 */
function collectContinuingNodeLayoutSeed(cy, prevNodeIds, nextNodeIds) {
  const placedPositions = [];
  const placedWeights = [];
  if (!cy || !prevNodeIds?.size) return { placedPositions, placedWeights };
  prevNodeIds.forEach((id) => {
    if (!nextNodeIds.has(id)) return;
    const n = cy.getElementById(id);
    if (!n || n.length === 0) return;
    try {
      const pos = n.position();
      placedPositions.push({
        id,
        x: pos.x,
        y: pos.y,
        radius: readNodeRadius(n, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE),
        label: n.data('label') || '',
      });
      const w = n.data('weight');
      if (w != null) placedWeights.push(w);
    } catch {
      /* ignore */
    }
  });
  return { placedPositions, placedWeights };
}

/** id 목록을 안정적인 비교 키로 */
export function stableIdListKey(ids) {
  if (!ids?.length) return '';
  return [...ids].map(String).filter(Boolean).sort().join('\x1f');
}

const PRESET_LAYOUT = Object.freeze({
  name: 'preset',
  fit: false,
  animate: false,
});

/** 최초 로딩·전체 재배치용. animate:false로 동기 완료
 *  노드 반지름이 최대 40px(graphStyles NODE_SIZE_MAX/2)까지 나오므로, 인접 노드가 맞닿아 보이지 않도록
 *  idealEdgeLength·nodeRepulsion·tilingPadding을 노드 크기 대비 여유 있게 잡는다. */
const COSE_BILKENT_LAYOUT = Object.freeze({
  name: 'cose-bilkent',
  fit: false,
  animate: false,
  randomize: false,
  nodeDimensionsIncludeLabels: true,
  nodeRepulsion: 5500,
  idealEdgeLength: 130,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 2500,
  tile: true,
  tilingPaddingVertical: 32,
  tilingPaddingHorizontal: 32,
});

/** 노드가 몇 개뿐인 그래프에 COSE_BILKENT_LAYOUT 기본값(넓은 그래프 기준)을 그대로 쓰면
 *  서로 당겨줄 간선·중력이 약해 과도하게 퍼진다. 노드 수가 적을수록 간선 길이·반발력을
 *  줄이고 중력을 높여 촘촘하게 모은다. */
const LAYOUT_DENSITY_RANGE = {
  MIN_NODES: 3,
  MAX_NODES: 20,
  SPARSE: { idealEdgeLength: 70, nodeRepulsion: 2200, gravity: 0.5 },
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 노드 수에 맞춰 idealEdgeLength·nodeRepulsion·gravity를 보간한 cose-bilkent 레이아웃 옵션 */
function resolveCoseBilkentLayout(nodeCount) {
  const { MIN_NODES, MAX_NODES, SPARSE } = LAYOUT_DENSITY_RANGE;
  const count = Number(nodeCount);

  if (!Number.isFinite(count) || count <= MIN_NODES) {
    return { ...COSE_BILKENT_LAYOUT, ...SPARSE };
  }
  if (count >= MAX_NODES) {
    return { ...COSE_BILKENT_LAYOUT };
  }

  const t = (count - MIN_NODES) / (MAX_NODES - MIN_NODES);
  return {
    ...COSE_BILKENT_LAYOUT,
    idealEdgeLength: lerp(SPARSE.idealEdgeLength, COSE_BILKENT_LAYOUT.idealEdgeLength, t),
    nodeRepulsion: lerp(SPARSE.nodeRepulsion, COSE_BILKENT_LAYOUT.nodeRepulsion, t),
    gravity: lerp(SPARSE.gravity, COSE_BILKENT_LAYOUT.gravity, t),
  };
}

/** preset 레이아웃 (eles 지정 시 해당 컬렉션만) */
export function runPresetLayout(cy, eles) {
  if (!cy) return;
  if (eles?.length > 0) {
    try {
      cy.layout({ ...PRESET_LAYOUT, eles }).run();
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    cy.layout({ ...PRESET_LAYOUT }).run();
  } catch {
    /* ignore */
  }
}

/** 최초/전체 재배치용 cose-bilkent (실패 시 preset). 노드 수가 적으면 간격을 촘촘하게 스케일. */
export function runCoseBilkentLayout(cy) {
  if (!cy) return;
  ensureCoseBilkentRegistered();
  try {
    cy.layout(resolveCoseBilkentLayout(cy.nodes().length)).run();
  } catch {
    runPresetLayout(cy);
  }
}

const parseJsonSafely = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

function tooltipEndpointInfo(cyNode) {
  if (!cyNode || typeof cyNode.data !== 'function') {
    return { id: null, label: '', image: '' };
  }
  const d = cyNode.data() || {};
  return {
    id: d.id ?? (typeof cyNode.id === 'function' ? cyNode.id() : null),
    label: pickCharacterDisplayName(d),
    image: d.image || '',
  };
}

function buildNodeTooltip(base, center) {
  const fields = base.data ?? {};
  return {
    ...base,
    ...fields,
    nodeCenter: center,
    names: parseJsonSafely(fields.names),
    isMainCharacter: !!fields.isMainCharacter,
    common_name: pickCharacterDisplayName(fields),
    description: fields.description || '',
    personalityText: fields.personalityText || '',
    image: fields.image || '',
    weight: fields.weight || 1,
  };
}

/** labelHistory는 객체({라벨: 메타})만 허용 */
function parseLabelHistory(value) {
  const parsed = parseJsonSafely(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function buildEdgeTooltip(base, element, center) {
  const data = base.data ?? {};
  const relation = normalizeRelationArray(parseJsonSafely(data.relation));
  return {
    ...base,
    sourceEndpoint: tooltipEndpointInfo(element.source()),
    targetEndpoint: tooltipEndpointInfo(element.target()),
    edgeCenter: center,
    data: {
      ...base.data,
      relation,
      latestLabels: normalizeRelationArray(parseJsonSafely(data.latestLabels)),
      labelHistory: parseLabelHistory(data.labelHistory),
      label: data.label || relation[relation.length - 1] || '',
      // positivity는 서버/그래프 값만 유지 — 없으면 null (0과 '없음' 구분)
      positivity: data.positivity == null || data.positivity === '' ? null : data.positivity,
      count: data.count ?? 1,
    },
  };
}

/** 탭 이벤트 → 툴팁용 payload */
export function openTooltipFromTap(tapPayload, type) {
  if (!tapPayload) return null;
  const isNode = type === 'node';
  const element = isNode ? tapPayload.node : tapPayload.edge;
  if (!element) return null;

  try {
    const center = isNode ? tapPayload.nodeCenter : tapPayload.edgeCenter;
    const base = {
      type,
      id: element.id(),
      x: tapPayload.mouseX ?? center?.x ?? 0,
      y: tapPayload.mouseY ?? center?.y ?? 0,
      data: element.data(),
    };
    return isNode ? buildNodeTooltip(base, center) : buildEdgeTooltip(base, element, center);
  } catch {
    return tapPayload;
  }
}

export const isSidebarElement = (event) => {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(
    target.closest('[data-testid="graph-sidebar"]') ||
    target.closest('[data-testid="chapter-sidebar"]') ||
    target.closest('.graph-sidebar')
  );
};

/** 드래그 노드 좌표는 고정, 겹친 주변만 밀어냄 (앵커 배치 로직 미적용) */
export function resolveUserDragCollisions(cyInstance, container, draggedNode, { clampBounds = false } = {}) {
  if (!draggedNode || draggedNode.length === 0) return;
  if (clampBounds && isGraphContainerSizeReady(container)) {
    ensureElementsInBounds(cyInstance, container, { nodes: draggedNode });
  }
  const profile = OVERLAP_PROFILES.USER_DRAG;
  const draggedPos = draggedNode.position();
  const draggedRadius = readNodeRadius(draggedNode, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
  const proximity = Math.max(0, (profile.padding ?? 0) - (profile.tolerance ?? 0));
  const movableIds = [];
  cyInstance.nodes(':visible').forEach((node) => {
    if (node.id() === draggedNode.id()) return;
    const pos = node.position();
    const radius = readNodeRadius(node, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
    const activationDistance = draggedRadius + radius + proximity;
    if (Math.hypot(pos.x - draggedPos.x, pos.y - draggedPos.y) < activationDistance) {
      movableIds.push(node.id());
    }
  });
  if (movableIds.length === 0) return;
  detectAndResolveOverlap(cyInstance, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
    ...profile,
    movableIds,
  });
  syncReciprocalPairJunctionOffsets(cyInstance, { immediate: true });
}

/** 기존 인스턴스가 살아 있으면 재마운트, 아니면 생성. 실패 시 null */
export function mountCytoscape(container, externalCyRef, initialStylesheet) {
  try {
    const existing = externalCyRef?.current;
    const isLive =
      existing &&
      typeof existing.container === "function" &&
      !existing.destroyed?.();
    if (isLive) {
      if (existing.container() !== container) existing.mount(container);
      return { cyInstance: existing, didCreateInstance: false };
    }
    const cyInstance = cytoscape({
      container,
      elements: [],
      style: initialStylesheet,
      layout: PRESET_LAYOUT,
      pixelRatio: 'auto',
      userZoomingEnabled: true,
      userPanningEnabled: true,
      wheelSensitivity: GRAPH_ZOOM.WHEEL_SENSITIVITY,
      minZoom: GRAPH_ZOOM.MIN,
      maxZoom: GRAPH_ZOOM.MAX,
      autoungrabify: false,
      autolock: false,
      autounselectify: false,
      selectionType: "single",
      touchTapThreshold: 8,
      desktopTapThreshold: 4,
    });
    if (externalCyRef) externalCyRef.current = cyInstance;
    return { cyInstance, didCreateInstance: true };
  } catch (err) {
    errorUtils.logDebug('graphCy', 'cy init failed', {
      message: err?.message,
    });
    return null;
  }
}

/**
 * 시각 시그니처 diff. 신규 요소는 제외하고,
 * 골격(structure)이 이전과 같고 추가가 없으면 이미지 변경만 남긴다 (라벨 등 변경은 펄스 생략).
 */
function diffVisualSignatures(elements, prevSig, newIdSet, { sameStructureNoAdds }) {
  const nextSig = new Map();
  const changed = [];
  for (const el of elements) {
    const rawId = el?.data?.id;
    if (rawId == null || rawId === "") continue;
    const sid = String(rawId);
    const sig = visualElementSignature(el);
    nextSig.set(sid, sig);
    if (prevSig.size > 0 && prevSig.has(sid) && prevSig.get(sid) !== sig && !newIdSet.has(sid)) {
      changed.push(sid);
    }
  }
  const dataChangedIds = sameStructureNoAdds
    ? changed.filter(
        (sid) => visualSignatureImagePart(prevSig.get(sid)) !== visualSignatureImagePart(nextSig.get(sid)),
      )
    : changed;
  return { nextSig, dataChangedIds };
}

/**
 * props elements를 cy에 반영 (cy.batch 안에서 호출).
 * 사라진 요소 제거 → 유지 요소 data 동기화(좌표 보존) → 신규 노드 앵커 배치 후 추가.
 * @returns {{ update: object, nextSig: Map, structureFp: string }} update는 useGraphLayout이 소비
 */
export function syncElementsIntoCy(cy, elements, { prevSig, prevStructureFp, containerWidth, containerHeight }) {
  const nodes = elements.filter((el) => el?.data && !isGraphEdgeElement(el));
  const edges = elements.filter(isGraphEdgeElement);
  const prevNodeIds = new Set(cy.nodes().map((n) => String(n.id())));
  const prevEdgeIds = new Set(cy.edges().map((e) => String(e.id())));
  const hadExistingGraph = prevNodeIds.size > 0;
  const nextNodeIds = elementDefIdSet(nodes);
  const nextEdgeIds = elementDefIdSet(edges);

  // 이미 그려진 id가 다음 props에도 모두 있으면 "순증가"만 → 제거 루프 생략(전체 깜빡임·불필요한 재구성 방지)
  const pureAdditive =
    prevNodeIds.size > 0 &&
    [...prevNodeIds].every((id) => nextNodeIds.has(id)) &&
    [...prevEdgeIds].every((id) => nextEdgeIds.has(id));

  let removedNodeCount = 0;
  if (!pureAdditive) {
    cy.nodes().forEach((n) => {
      if (nextNodeIds.has(String(n.id()))) return;
      n.remove();
      removedNodeCount += 1;
    });
    cy.edges().forEach((e) => {
      if (!nextEdgeIds.has(String(e.id()))) e.remove();
    });
  }

  // 유지되는 요소는 data만 동기화. 좌표는 Cytoscape에 유지(이벤트 전환 시 기존 배치 보존)
  syncCyElementData(cy, nodes);
  syncCyElementData(cy, edges);

  const { placedPositions, placedWeights } = collectContinuingNodeLayoutSeed(
    cy,
    prevNodeIds,
    nextNodeIds,
  );
  const nodesToAdd = nodes.filter(
    (node) => node?.data?.id != null && !prevNodeIds.has(String(node.data.id))
  );
  const edgesToAdd = edges.filter(
    (edge) => edge?.data?.id != null && !prevEdgeIds.has(String(edge.data.id))
  );

  let needsLocalReorder = false;
  // 유지되는 기존 노드가 있을 때만 증분 앵커 배치. 전부 교체면 cose 시드 유지
  const canIncrementalPlace = hadExistingGraph && placedPositions.length > 0;
  if (nodesToAdd.length > 0) {
    if (canIncrementalPlace) {
      const placed = calculateAnchorAwarePlacement(
        nodesToAdd,
        placedPositions,
        edges,
        containerWidth,
        containerHeight,
        {
          padding: OVERLAP_RESOLVE.PADDING,
          weightsForRange: placedWeights,
        },
      );
      needsLocalReorder = Boolean(placed?.needsLocalReorder);
    }
    cy.add(nodesToAdd);
  }
  if (edgesToAdd.length > 0) {
    cy.add(edgesToAdd);
  }

  const newIdSet = new Set(
    [...nodesToAdd.map((n) => n?.data?.id), ...edgesToAdd.map((e) => e?.data?.id)]
      .filter((id) => id != null && id !== "")
      .map((id) => String(id)),
  );
  const structureFp = buildElementsStructureFingerprint(elements);
  const hasAdds = nodesToAdd.length > 0 || edgesToAdd.length > 0;
  const { nextSig, dataChangedIds } = diffVisualSignatures(elements, prevSig, newIdSet, {
    sameStructureNoAdds: Boolean(structureFp) && structureFp === prevStructureFp && !hasAdds,
  });

  return {
    update: {
      nodesToAdd,
      edgesToAdd,
      hasChanges: hasAdds,
      dataChangedIds,
      incrementalLayoutScope: canIncrementalPlace && nodesToAdd.length > 0,
      needsLocalReorder,
      // 노드 제거만 있어도 가중치 범위가 바뀔 수 있음 → 레이아웃에서 크기 재정규화
      nodesRemoved: removedNodeCount > 0,
    },
    nextSig,
    structureFp: structureFp || "",
  };
}

// ── 레이아웃 마무리 (useGraphLayout에서 호출) ──

/**
 * 레이아웃 직후 마무리: (증분인데 뷰포트를 벗어나면 refit) → 경계 제약 → 겹침 해소 → (fitViewport면 전체 fit) → junction 동기화.
 * movableIds가 있으면 그 노드만 경계·겹침 처리 대상으로 삼아 기존 배치를 보존한다.
 * @returns {boolean} 전체 fit을 적용했으면 true
 */
export function finalizeGraphLayout(cy, container, {
  fitViewport = false,
  skipOverlap = false,
  skipEnsureBounds = false,
  movableIds = null,
  canFit = () => true,
} = {}) {
  if (!cy) return false;

  // 전체 재배치(초기·챕터 전환)가 아닌 증분 갱신(이벤트 확정 등)에서는 기존 배치를
  // 흔들지 않는 게 원칙이지만, 늘어난 노드·간선(라벨 포함)이 현재 팬·줌 뷰포트를
  // 벗어나면 좁은 화면 안으로 욱여넣어(cramping) 겹치는 대신 카메라를 재조정한다.
  if (!fitViewport && isGraphContainerSizeReady(container)) {
    const visible = cy.elements(':visible');
    if (
      visible.length > 0 &&
      !isElementsFitInViewport(cy, visible, GRAPH_ZOOM.FIT_PADDING)
    ) {
      // fitGraphViewportInContainer는 fit 직후 동기적으로 ensureElementsInBounds를
      // 돌리므로(애니메이션 중 팬·줌 값을 기준으로 하면 어긋남) duration 0(즉시)을 유지한다.
      const refit = fitGraphViewportInContainer(cy, container, {
        eles: visible,
      });
      if (refit) {
        syncReciprocalPairJunctionOffsets(cy);
        return false;
      }
    }
  }

  const runBounds = () => {
    if (skipEnsureBounds || !isGraphContainerSizeReady(container)) return;
    if (!movableIds) {
      ensureElementsInBounds(cy, container);
      return;
    }
    // 전체 fit이 없는 증분 추가: 새로 들어온 노드만 캔버스 안으로 제약하고
    // 기존 노드는 사용자가 기억한 배치를 그대로 유지한다.
    const idSet = movableIds instanceof Set ? movableIds : new Set([...movableIds].map(String));
    if (idSet.size === 0) return;
    const scopedNodes = cy.nodes().filter((n) => idSet.has(String(n.id())));
    if (scopedNodes.length > 0) {
      ensureElementsInBounds(cy, container, { nodes: scopedNodes });
    }
  };

  runBounds();
  if (!skipOverlap) {
    const profile = fitViewport
      ? OVERLAP_PROFILES.INITIAL
      : OVERLAP_PROFILES.INCREMENTAL;
    detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
      ...(movableIds ? { movableIds } : {}),
      ...profile,
    });
    // 밀어내기 후 화면 밖 노드 재제약 → 경계에서 생긴 겹침 경량 재해결
    runBounds();
    if (!skipEnsureBounds && isGraphContainerSizeReady(container)) {
      detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
        ...(movableIds ? { movableIds } : {}),
        ...OVERLAP_PROFILES.RESIZE,
      });
    }
    // 최초 로딩: bounds/resize 후에도 본체 겹침이 남으면 제거
    if (
      fitViewport &&
      hasOverlappingNodes(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
        ...OVERLAP_PROFILES.APPEAR,
      })
    ) {
      detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
        ...OVERLAP_PROFILES.APPEAR,
      });
      runBounds();
    }
  }
  // 컨테이너 미준비거나 canFit()이 false면 fit 생략 → 호출부가 pending 유지 후 resize에서 재시도
  const fitted = fitViewport && canFit() && fitGraphViewportInContainer(cy, container);
  syncReciprocalPairJunctionOffsets(cy);
  return Boolean(fitted);
}

/**
 * 증분 추가 후 겹침 해소: 신규끼리 본체 분리 → 기존과의 겹침을 신규만 → 1-hop → 2-hop 순으로 범위를 넓혀 해결.
 * 전체 그래프·cose로는 확대하지 않아 사용자가 기억한 배치를 보존한다.
 */
export function resolveIncrementalOverlap(cy, seedIds, forceExpand = false) {
  const appearOpts = { ...OVERLAP_PROFILES.APPEAR };
  const incrementalOpts = { ...OVERLAP_PROFILES.INCREMENTAL };

  const stillAppearsOverlapping = (movableIds) =>
    hasOverlappingNodes(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
      movableIds,
      ...appearOpts,
    });

  const resolveAppear = (movableIds) => {
    detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
      ...appearOpts,
      movableIds,
    });
    return stillAppearsOverlapping(movableIds);
  };

  const resolveIncremental = (movableIds) => {
    detectAndResolveOverlap(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
      ...incrementalOpts,
      movableIds,
    });
    return hasOverlappingNodes(cy, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, {
      movableIds,
      ...incrementalOpts,
    });
  };

  // 1) 신규 등장 노드끼리: tolerance 0으로 본체 겹침 제거
  if (seedIds.length >= 2) {
    let remain = resolveAppear(seedIds);
    for (let i = 0; remain && i < 2; i += 1) {
      remain = resolveAppear(seedIds);
    }
  }

  // 2) 기존과의 겹침: 신규만 → 필요 시 1·2-hop
  if (!forceExpand && seedIds.length > 0 && !resolveIncremental(seedIds)) return;

  const hop1 = [...collectNeighborhoodNodeIds(cy, seedIds, 1)];
  if (!resolveIncremental(hop1)) return;

  const hop2 = [...collectNeighborhoodNodeIds(cy, seedIds, 2)];
  resolveIncremental(hop2);

  // 신규끼리 잔여가 있으면 마지막으로 한 번 더 분리 (이웃 이동 후 재겹침 방지)
  if (seedIds.length >= 2 && stillAppearsOverlapping(seedIds)) {
    resolveAppear(seedIds);
  }
  // 중간 갱신에서는 사용자가 기억한 전체 배치를 보존한다.
  // 잔여 경미 겹침 때문에 전체 그래프 또는 cose로 확대하지 않는다.
}
