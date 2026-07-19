/** 그래프 요소 정규화·Cytoscape 좌표·뷰포트·툴팁·공통 상수·관계 유틸 */

import {
  resolveLastEventIdxForChapter,
  getLastEventIdxFromChapterData,
  getChapterData,
} from '../common/cache/manifestCache.js';
import {
  toPositiveNumberOrNull,
  toFiniteNumber,
} from '../common/valueUtils';
import { PRESET_LAYOUT } from '../styles/graphStyles.js';
import { stripRedundantBookTitlePrefix } from '../viewer/viewerCoreStateUtils';
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from '../common/cache/cacheManager';
import { clearStyleCache } from '../styles/relationStyles';

/* ─── 요소 ID · 타입 판별 ─── */

const API_PREFIX = 'api:';

export const extractApiBookId = (folderKeyOrFilename) => {
  if (!folderKeyOrFilename) return null;
  if (typeof folderKeyOrFilename === 'number') {
    return toPositiveNumberOrNull(folderKeyOrFilename);
  }
  const key = String(folderKeyOrFilename).trim();
  if (!key) return null;
  return toPositiveNumberOrNull(key.startsWith(API_PREFIX) ? key.slice(API_PREFIX.length) : key);
};

export const normalizeElementId = (element) => element?.id ?? element?.data?.id ?? null;

export const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

export const isGraphNodeElement = (element) =>
  Boolean(element?.data && element.data.id !== undefined && !isGraphEdgeElement(element));

/** 무방향 노드 쌍 키 (순서 무관) */
export function undirectedPairKey(s, t) {
  const a = String(s);
  const b = String(t);
  return a < b ? `${a}\x1e${b}` : `${b}\x1e${a}`;
}

export const sortElementsByDataId = (elements) => {
  if (!Array.isArray(elements)) return [];
  return [...elements].sort((a, b) =>
    String(a?.data?.id ?? '').localeCompare(String(b?.data?.id ?? ''))
  );
};

export const uniqueStrings = (values, { caseInsensitive = false } = {}) => {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const str = String(value ?? '').trim();
    const key = caseInsensitive ? str.toLowerCase() : str;
    if (!str || seen.has(key)) continue;
    seen.add(key);
    result.push(str);
  }
  return result;
};

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

/* ─── 툴팁 좌표 · 캔버스 배치 ─── */

/** 플로팅 간선 툴팁 추정 크기 (.edge-tooltip-container) */
const EDGE_TOOLTIP_ESTIMATE = { width: 420, height: 360 };
const TOOLTIP_CANVAS_PAD = 8;
const TOOLTIP_FOCUS_GAP = 16;

function rectOverlapArea(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

function constrainToWindow(x, y, elementWidth, elementHeight) {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const maxX = Math.max(0, window.innerWidth - elementWidth);
  const maxY = Math.max(0, window.innerHeight - elementHeight);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

/** 가장 넓은 .graph-canvas-area (중첩 시 패널 기준) */
function getPrimaryGraphCanvasRect() {
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll('.graph-canvas-area');
  let best = null;
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (!best || r.width * r.height > best.width * best.height) {
      best = r;
    }
  }
  return best;
}

function getCyClientRect(cy) {
  try {
    const el = typeof cy?.container === 'function' ? cy.container() : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
  } catch {
    /* fall through */
  }
  return getPrimaryGraphCanvasRect();
}

/** cy collection → client(fixed) 좌표 bbox */
function getElesClientBoundingRect(cy, eles) {
  if (!cy || !eles?.length) return null;
  const containerRect = getCyClientRect(cy);
  if (!containerRect) return null;
  try {
    const bb = eles.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
    if (!bb || !Number.isFinite(bb.x1) || !Number.isFinite(bb.y1)) return null;
    return {
      left: containerRect.left + bb.x1,
      top: containerRect.top + bb.y1,
      right: containerRect.left + bb.x2,
      bottom: containerRect.top + bb.y2,
      width: bb.x2 - bb.x1,
      height: bb.y2 - bb.y1,
    };
  } catch {
    return null;
  }
}

/** fixed 좌표를 그래프 캔버스 안으로 클램프 */
export function constrainToGraphCanvas(
  x,
  y,
  elementWidth = 0,
  elementHeight = 0,
  canvasRect = null,
  pad = TOOLTIP_CANVAS_PAD,
) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { x: 0, y: 0 };
  }
  const canvas = canvasRect || getPrimaryGraphCanvasRect();
  if (!canvas) {
    return constrainToWindow(x, y, elementWidth, elementHeight);
  }
  const minX = canvas.left + pad;
  const minY = canvas.top + pad;
  const maxX = Math.max(minX, canvas.right - elementWidth - pad);
  const maxY = Math.max(minY, canvas.bottom - elementHeight - pad);
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

/**
 * focus(간선+노드)를 최대한 가리지 않으면서 캔버스 안에 툴팁 배치.
 * 반환값은 position:fixed 용 client 좌표.
 */
export function placeTooltipInCanvasAwayFromFocus({
  cy,
  focusEles,
  width = EDGE_TOOLTIP_ESTIMATE.width,
  height = EDGE_TOOLTIP_ESTIMATE.height,
  gap = TOOLTIP_FOCUS_GAP,
} = {}) {
  const canvas = getCyClientRect(cy);
  if (!canvas) {
    return { x: 200, y: 200 };
  }

  let focus = getElesClientBoundingRect(cy, focusEles);
  if (!focus) {
    const cx = (canvas.left + canvas.right) / 2;
    const cyMid = (canvas.top + canvas.bottom) / 2;
    focus = { left: cx, top: cyMid, right: cx, bottom: cyMid, width: 0, height: 0 };
  }

  const midY = focus.top + focus.height / 2 - height / 2;
  const midX = focus.left + focus.width / 2 - width / 2;
  const candidates = [
    { x: focus.right + gap, y: midY },
    { x: focus.left - gap - width, y: midY },
    { x: midX, y: focus.bottom + gap },
    { x: midX, y: focus.top - gap - height },
    { x: focus.right + gap, y: focus.top },
    { x: focus.left - gap - width, y: focus.top },
    { x: canvas.right - width - TOOLTIP_CANVAS_PAD, y: canvas.top + TOOLTIP_CANVAS_PAD },
    { x: canvas.left + TOOLTIP_CANVAS_PAD, y: canvas.top + TOOLTIP_CANVAS_PAD },
    { x: canvas.right - width - TOOLTIP_CANVAS_PAD, y: canvas.bottom - height - TOOLTIP_CANVAS_PAD },
    { x: canvas.left + TOOLTIP_CANVAS_PAD, y: canvas.bottom - height - TOOLTIP_CANVAS_PAD },
  ];

  const canvasBox = {
    left: canvas.left,
    top: canvas.top,
    right: canvas.right,
    bottom: canvas.bottom,
  };
  const focusArea = Math.max(focus.width * focus.height, 1);
  let best = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const p = constrainToGraphCanvas(c.x, c.y, width, height, canvas);
    const tip = { left: p.x, top: p.y, right: p.x + width, bottom: p.y + height };
    const overlap = rectOverlapArea(tip, focus) / focusArea;
    const inside = rectOverlapArea(tip, canvasBox) / (width * height);
    const drift = Math.abs(p.x - c.x) + Math.abs(p.y - c.y);
    const score = inside * 1000 - overlap * 500 - drift;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best || constrainToGraphCanvas(
    focus.right + gap,
    focus.top,
    width,
    height,
    canvas,
  );
}

export const createRippleEffect = (container, x, y, duration = 500) => {
  if (!container) return () => {};
  if (typeof x !== 'number' || typeof y !== 'number') return () => {};

  const ripple = document.createElement('div');
  ripple.className = 'ripple-effect';
  ripple.style.position = 'absolute';
  ripple.style.left = `${x - 50}px`;
  ripple.style.top = `${y - 50}px`;
  ripple.style.pointerEvents = 'none';
  ripple.style.zIndex = '1000';
  
  container.appendChild(ripple);

  let timeoutId = null;
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    if (ripple.parentNode) {
      ripple.parentNode.removeChild(ripple);
    }
  };

  timeoutId = setTimeout(cleanup, duration);
  
  return cleanup;
};

export const ensureElementsInBounds = (cy, container, maxNodes = 1000) => {
  if (!cy || !container) return;
  
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  
  if (containerWidth <= 0 || containerHeight <= 0) return;
  
  const padding = 100;
  
  const bounds = {
    left: -containerWidth / 2 + padding,
    right: containerWidth / 2 - padding,
    top: -containerHeight / 2 + padding,
    bottom: containerHeight / 2 - padding
  };
  
  let needsAdjustment = false;
  const nodes = cy.nodes();
  const nodeCount = nodes.length;

  cy.batch(() => {
    const nodesToProcess = nodeCount > maxNodes ? nodes.slice(0, maxNodes) : nodes;

    nodesToProcess.forEach(node => {
      const pos = node.position();
      const constrainedX = Math.max(bounds.left, Math.min(pos.x, bounds.right));
      const constrainedY = Math.max(bounds.top, Math.min(pos.y, bounds.bottom));

      if (constrainedX !== pos.x || constrainedY !== pos.y) {
        needsAdjustment = true;
        node.position({ x: constrainedX, y: constrainedY });
      }
    });
  });

  // 조정이 필요한 경우 좌표만 재적용 (fit 하면 사용자 휠 줌이 풀림)
  if (needsAdjustment) {
    cy.layout({ ...PRESET_LAYOUT }).run();
  }
};

/* ─── 뷰포트 · 선택 포커스 ─── */

/**
 * 뷰포트 fit (즉시 또는 애니메이션).
 * @param {object} cy
 * @param {{ padding?: number, duration?: number, eles?: object } | number} [opts]
 *   number면 padding으로 처리. eles 없으면 visible(없으면 전체) 노드.
 */
export function fitGraphToNodes(cy, opts = {}) {
  if (!cy) return false;
  const options = typeof opts === 'number' ? { padding: opts } : (opts || {});
  const padding = options.padding ?? GRAPH_ZOOM.FIT_PADDING;
  const duration = options.duration ?? 0;
  try {
    const nodes = options.eles?.length
      ? options.eles
      : (() => {
          const visible = cy.nodes(':visible');
          return visible.length > 0 ? visible : cy.nodes();
        })();
    if (!nodes.length) return false;
    cy.stop();
    if (duration <= 0) {
      cy.fit(nodes, padding);
      return true;
    }
    cy.animate({
      fit: { eles: nodes, padding },
      duration,
      easing: 'ease-in-out',
    });
    return true;
  } catch {
    return false;
  }
}

/** 뷰포트 중심 기준 비율 줌 */
export function zoomGraphByFactor(cy, factor) {
  if (!cy || cy.destroyed?.()) return false;
  try {
    const current = cy.zoom();
    const next = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), current * factor));
    if (next === current) return false;
    cy.zoom({
      level: next,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 클릭 focus(하이라이트)에 포함되는 노드·간선 컬렉션.
 * 노드: 자신 + 직접 연결 간선 + 그 상대 노드
 * 간선: 자신 + 양끝 노드
 */
export function getSelectionFocusElements(cy, element) {
  if (!cy || !element?.length) return cy?.collection?.() ?? null;

  if (typeof element.isEdge === 'function' && element.isEdge()) {
    return element.union(element.connectedNodes());
  }

  const nodeId = String(element.id());
  const connectedEdges = element.connectedEdges();
  const directEdges = connectedEdges.filter((edge) => {
    const sourceId = String(edge.source().id());
    const targetId = String(edge.target().id());

    if (sourceId === nodeId) return true;

    if (targetId === nodeId) {
      const hasReverseOutgoing = connectedEdges.some((candidate) => {
        const candidateSourceId = String(candidate.source().id());
        const candidateTargetId = String(candidate.target().id());
        return candidateSourceId === nodeId && candidateTargetId === sourceId;
      });
      return !hasReverseOutgoing;
    }

    return false;
  });

  return element.union(directEdges).union(directEdges.connectedNodes());
}

/** focus 요소들의 모델 좌표 중심점 */
function getFocusElementsModelCenter(focusEles) {
  if (!focusEles?.length) return null;
  try {
    const bb = focusEles.boundingBox({ includeLabels: false, includeOverlays: false });
    if (!bb || !Number.isFinite(bb.x1) || !Number.isFinite(bb.x2)) return null;
    return {
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
    };
  } catch {
    return null;
  }
}

/**
 * focus 묶음을 뷰포트 가운데로 이동.
 * @param {{ duration?: number, panTarget?: { x: number, y: number } }} [options]
 * panTarget이 있으면 그 화면 좌표로 모델 중심을 맞춤(사이드바 보정용). 없으면 cy.center 사용.
 */
function animateCenterOnFocusElements(cy, focusEles, options = {}) {
  if (!cy || !focusEles?.length) return false;
  const duration = options.duration ?? 500;
  const panTarget = options.panTarget;

  try {
    cy.stop();
    if (panTarget && Number.isFinite(panTarget.x) && Number.isFinite(panTarget.y)) {
      const center = getFocusElementsModelCenter(focusEles);
      if (!center) return false;
      const zoom = cy.zoom();
      cy.animate({
        pan: {
          x: panTarget.x - center.x * zoom,
          y: panTarget.y - center.y * zoom,
        },
        duration,
        easing: 'ease-in-out',
      });
      return true;
    }

    cy.animate({
      center: { eles: focusEles },
      duration,
      easing: 'ease-in-out',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * elementId로 focus를 구한 뒤 animateCenterOnFocusElements 실행.
 * @returns {boolean}
 */
export function centerSelectionOnElementId(cy, elementId, animateOptions = {}) {
  if (!cy || elementId == null || elementId === '') return false;
  try {
    const element = cy.getElementById(String(elementId));
    if (!element.length) return false;
    const focusEles = getSelectionFocusElements(cy, element);
    if (!focusEles?.length) return false;
    return animateCenterOnFocusElements(cy, focusEles, animateOptions);
  } catch {
    return false;
  }
}

/**
 * 간선 focus를 플로팅 툴팁 반대쪽(왼쪽 가용 영역) 중심에 두는 cy 컨테이너 좌표.
 */
export function getEdgeFocusPanTarget(cy) {
  const w = typeof cy?.width === 'function' ? cy.width() : 0;
  const h = typeof cy?.height === 'function' ? cy.height() : 0;
  if (!(w > 0) || !(h > 0)) {
    return { x: 0, y: 0 };
  }
  const reservedRight = EDGE_TOOLTIP_ESTIMATE.width + TOOLTIP_FOCUS_GAP * 2;
  const usableW = Math.max(w - reservedRight, w * 0.4);
  return {
    x: usableW / 2,
    y: h / 2,
  };
}

export const isGraphContainerSizeReady = (container) => {
  if (!container) return false;
  const w = Number(container.clientWidth ?? 0);
  const h = Number(container.clientHeight ?? 0);
  return w > 0 && h > 0;
};

/* ─── 툴팁 payload ─── */

const processTooltipData = (tooltipData, type) => {
  if (!tooltipData) return null;
  
  try {
    if (type === 'node') {
      const nodeFields = tooltipData.data ?? tooltipData;

      const names = parseJsonSafely(nodeFields.names);

      return {
        ...tooltipData,
        ...nodeFields,
        names,
        isMainCharacter: !!nodeFields.isMainCharacter,
        common_name: nodeFields.common_name || nodeFields.name || nodeFields.label,
        description: nodeFields.description || '',
        personalityText: nodeFields.personalityText || '',
        image: nodeFields.image || '',
        weight: nodeFields.weight || 1,
      };
      
    } else if (type === 'edge') {
      const edgeData = tooltipData;
      
      const relation = parseJsonSafely(edgeData.data?.relation);
      
      const defaultLabel = Array.isArray(relation) && relation.length > 0 
        ? relation[0] 
        : (typeof relation === 'string' ? relation : '');
      
      return {
        ...tooltipData,
        sourceEndpoint: edgeData.sourceEndpoint ?? null,
        targetEndpoint: edgeData.targetEndpoint ?? null,
        data: {
          ...edgeData.data,
          relation: relation,
          label: edgeData.data?.label || defaultLabel,
          positivity: edgeData.data?.positivity ?? 0,
          count: edgeData.data?.count ?? 1
        }
      };
      
    } else {
      return tooltipData;
    }
  } catch {
    return tooltipData;
  }
};

function extractEndpointInfo(cyNode) {
  if (!cyNode || typeof cyNode.data !== 'function') {
    return { id: null, label: '', image: '' };
  }
  const d = cyNode.data() || {};
  return {
    id: d.id ?? (typeof cyNode.id === 'function' ? cyNode.id() : null),
    label: d.common_name || d.name || d.label || '',
    image: d.image || '',
  };
}

/** 탭 이벤트 → 툴팁용 payload */
function buildTooltipPayload(tapPayload, type) {
  const isNode = type === 'node';
  const element = isNode ? tapPayload.node : tapPayload.edge;
  const center = isNode ? tapPayload.nodeCenter : tapPayload.edgeCenter;
  const x = tapPayload.mouseX ?? center?.x ?? 0;
  const y = tapPayload.mouseY ?? center?.y ?? 0;
  const data = element.data();

  return {
    type,
    id: element.id(),
    x,
    y,
    data,
    ...(isNode
      ? { nodeCenter: center }
      : {
          sourceEndpoint: extractEndpointInfo(element.source()),
          targetEndpoint: extractEndpointInfo(element.target()),
          edgeCenter: center,
        }),
  };
}

export function openTooltipFromTap(tapPayload, type) {
  return processTooltipData(buildTooltipPayload(tapPayload, type), type);
}

/** 챕터 마지막 이벤트 인덱스 (manifest 힌트, UI·범위용) */
export const calculateLastEventForChapter = ({
  manifestChapters,
  manifestBookId,
  chapter,
}) => {
  if (manifestBookId != null && Number.isFinite(Number(manifestBookId)) && Number(manifestBookId) > 0) {
    const manifestHint =
      Array.isArray(manifestChapters) && manifestChapters.length > 0
        ? { chapters: manifestChapters }
        : undefined;
    const fromManifest = resolveLastEventIdxForChapter(manifestBookId, chapter, manifestHint);
    if (fromManifest != null) {
      return fromManifest;
    }
  }

  if (!manifestChapters?.length) return 1;

  const chapterNum = Number(chapter);
  const chapterInfo = manifestChapters.find(
    (ch) => ch && typeof ch === 'object' && Number(ch.idx) === chapterNum
  );

  if (!chapterInfo) return 1;

  const resolved = getLastEventIdxFromChapterData(chapterInfo);
  return resolved != null && resolved >= 1 ? resolved : 1;
};

export const isSidebarElement = (event) => {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(
    target.closest('[data-testid="graph-sidebar"]') ||
    target.closest('[data-testid="chapter-sidebar"]') ||
    target.closest('.graph-sidebar')
  );
};

/* ─── reciprocal junction · 하이라이트 ─── */

/** reciprocalPair junction: target-endpoint bypass로 중점 고정. highlighted면 bypass 제거(일반 0→0). */
const pendingJunctionSyncRaf = new WeakMap();

export function clearReciprocalEndpointBypass(edge) {
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
      .union(cy.edges(".highlighted"))
      .union(cy.edges(".faded"));
    if (touched.length === 0) return;
    hadTouched = true;
    cy.batch(() => {
      touched.removeClass("highlighted faded");
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

/* ─── 신규 노드 배치 · 레이아웃 상수 ─── */

const PLACEMENT_PADDING = 80;
const PLACEMENT_MIN_DIST_SQ = (40 * 3.2) * (40 * 3.2);

/** 신규 노드 스파이럴 배치 */
export function calculateSpiralPlacement(newNodes, placedPositions, containerWidth, containerHeight) {
  if (!newNodes?.length) return newNodes;

  const maxRadius = Math.min(containerWidth, containerHeight) / 2 - PLACEMENT_PADDING;
  const updatedPositions = [...placedPositions];
  const halfW = containerWidth / 2 - PLACEMENT_PADDING;
  const halfH = containerHeight / 2 - PLACEMENT_PADDING;

  newNodes.forEach((node) => {
    let found = false;
    let x;
    let y;
    let attempts = 0;
    const maxAttempts = 200;

    while (!found && attempts < maxAttempts) {
      const angle = (attempts * 0.5) % (2 * Math.PI);
      const radius = Math.min(50 + attempts * 2, maxRadius);
      const candidate = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      x = candidate.x;
      y = candidate.y;

      if (Math.abs(x) < halfW && Math.abs(y) < halfH) {
        found = updatedPositions.every((pos) => {
          const dx = x - pos.x;
          const dy = y - pos.y;
          return dx * dx + dy * dy > PLACEMENT_MIN_DIST_SQ;
        });
      }
      attempts += 1;
    }

    if (!found) {
      x = (Math.random() - 0.5) * 100;
      y = (Math.random() - 0.5) * 100;
    }

    node.position = { x, y };
    updatedPositions.push({ x, y });
  });

  return newNodes;
}

export const GRAPH_LAYOUT_CONSTANTS = {
  SIDEBAR: { OPEN_WIDTH: 360, CLOSED_WIDTH: 60 },
  TOP_BAR_HEIGHT: 54,
  /** GraphCanvas 툴팁 사이드바 실제 너비와 동일해야 센터링이 맞음 */
  TOOLTIP_SIDEBAR_WIDTH: 480,
  /** 우측 툴팁 사이드바 slide in/out */
  ANIMATION_MS: 520,
  /** 클릭 focus 영역 이동 */
  FOCUS_PAN_MS: 480,
  /** 사이드바가 어느 정도 열린 뒤 팬 */
  FOCUS_PAN_DELAY_MS: 380,
};

/** Cytoscape 뷰포트 줌 (휠·버튼·초기 fit 공통) */
export const GRAPH_ZOOM = {
  STEP: 1.25,
  MIN: 0.2,
  MAX: 2.4,
  /** cy.fit 여백 — 작을수록 캔버스를 더 채움 */
  FIT_PADDING: 36,
};

/** 표시 순서: 주요 → 주변 → 전체 (value는 filterMainCharacters와 동일) */
export const GRAPH_CHARACTER_FILTER_STAGE_OPTIONS = [
  { value: 1, label: '주요', title: '핵심 인물과 그들 사이 관계만' },
  { value: 2, label: '주변', title: '핵심 + 직접 연결된 인물' },
  { value: 0, label: '전체', title: '모든 인물' },
];

export function resolveChapterSidebarWidth(isSidebarOpen) {
  const { OPEN_WIDTH, CLOSED_WIDTH } = GRAPH_LAYOUT_CONSTANTS.SIDEBAR;
  return isSidebarOpen ? OPEN_WIDTH : CLOSED_WIDTH;
}

/* ─── 챕터 사이드바 라벨 ─── */

/** 챕터 표시용 제목. 없으면 raw/display 모두 빈 문자열 */
function getChapterTitleParts(manifestBookId, chapterNum, bookTitle, manifestHint) {
  if (manifestBookId == null) {
    return { raw: '', display: '' };
  }
  const n = Number(chapterNum);
  if (!Number.isFinite(n) || n < 1) {
    return { raw: '', display: '' };
  }
  const ch = getChapterData(manifestBookId, n, manifestHint ?? undefined);
  const raw = String(ch?.title ?? '').trim();
  if (!raw) {
    return { raw: '', display: '' };
  }
  const display = stripRedundantBookTitlePrefix(raw, bookTitle).trim() || raw;
  return { raw, display };
}

export function resolveChapterDisplayTitle(manifestBookId, chapterNum, bookTitle, manifestHint) {
  return getChapterTitleParts(manifestBookId, chapterNum, bookTitle, manifestHint).display;
}

function collapseWhitespace(value) {
  return String(value ?? '')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toComparable(value) {
  return collapseWhitespace(value).normalize('NFC');
}

function normalizeLabel(value) {
  return toComparable(value).toLowerCase();
}

function fallbackChapterLabel(idx) {
  const n = Number(idx);
  return Number.isFinite(n) && n >= 1 ? `제${n}장` : '제—장';
}

function isFallbackLabel(label) {
  return /^제[\d—]+장$/.test(toComparable(label));
}

/** 목록 라벨용: 책 제목을 전역 제거(prefix만이 아님). display 경로는 stripRedundantBookTitlePrefix 사용. */
function stripLeadingSep(text) {
  return collapseWhitespace(text.replace(/^[-–—:|/]+\s*/, ''));
}

function stripBookTitleFromText(label, bookTitle) {
  let text = toComparable(label);
  const book = toComparable(bookTitle);
  if (!text) return '';
  if (!book) return text;

  text = collapseWhitespace(
    text
      .replace(new RegExp(escapeRegExp(book), 'gi'), ' ')
      .replace(/^[-–—:|/]+\s*|\s*[-–—:|/]+$/g, '')
  );

  const textN = normalizeLabel(text);
  const bookN = normalizeLabel(book);
  if (textN === bookN) return '';
  if (textN.startsWith(bookN)) {
    text = stripLeadingSep(text.slice(book.length));
  }
  return text;
}

function cleanChapterListLabel(rawTitle, bookTitle) {
  const withoutChapterWord = collapseWhitespace(
    String(rawTitle ?? '').replace(/(?:chapter|ch\.?|챕터)\s*\d*\s*[:.-]?\s*/gi, ' ')
  );
  const label = stripBookTitleFromText(withoutChapterWord, bookTitle);
  const bookN = normalizeLabel(bookTitle);
  if (!label || (bookN && normalizeLabel(label) === bookN)) return '';
  return label;
}

function stripSharedListPrefix(labels, bookTitle) {
  const usable = labels
    .map((label) => toComparable(label))
    .filter((label) => label && !isFallbackLabel(label));
  if (usable.length < 2) return labels;

  let prefix = usable[0];
  for (let i = 1; i < usable.length; i += 1) {
    const next = usable[i];
    while (prefix && !next.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) return labels;
  }

  prefix = toComparable(prefix.replace(/[-–—:|/]+\s*$/, ''));
  if (prefix.length < 2) return labels;

  const bookN = normalizeLabel(bookTitle);
  const prefixN = normalizeLabel(prefix);
  const matchesBook =
    !!bookN && (prefixN === bookN || prefixN.startsWith(bookN) || bookN.startsWith(prefixN));
  const hasSepAfterPrefix = usable.every((label) => {
    if (normalizeLabel(label) === prefixN) return true;
    return /^[-–—:|/\s]/.test(label.slice(prefix.length));
  });
  if (!matchesBook && !(prefix.length >= 6 && hasSepAfterPrefix)) return labels;

  return labels.map((label) => {
    const text = toComparable(label);
    if (!text || isFallbackLabel(text)) return text;
    if (normalizeLabel(text) === prefixN) return '';
    if (!text.toLowerCase().startsWith(prefix.toLowerCase())) return text;
    return stripLeadingSep(text.slice(prefix.length));
  });
}

/** 챕터 사이드바 목록용 라벨/툴팁 */
export function buildChapterSidebarItems(chapterList, manifestBookId, bookTitle, manifestHint) {
  const rows = chapterList.map((chapter) => {
    const { raw } = getChapterTitleParts(manifestBookId, chapter, bookTitle, manifestHint);
    const idxStr = Number.isFinite(chapter) && chapter >= 1 ? String(chapter) : '—';
    if (!raw) {
      return {
        chapter,
        label: fallbackChapterLabel(chapter),
        tooltip: manifestBookId == null || !Number.isFinite(chapter) || chapter < 1
          ? idxStr
          : `챕터 ${idxStr}`,
      };
    }
    return {
      chapter,
      label: cleanChapterListLabel(raw, bookTitle) || fallbackChapterLabel(chapter),
      tooltip: `챕터 ${idxStr} — ${raw}`,
    };
  });

  const stripped = stripSharedListPrefix(rows.map((row) => row.label), bookTitle);
  return rows.map((row, index) => ({
    ...row,
    label: stripped[index] || fallbackChapterLabel(row.chapter),
  }));
}

/* ─── 관계 정규화 · 태그 · 레이더 ─── */

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

    if (!Number.isFinite(id1) || !Number.isFinite(id2)) {
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
  } catch {
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

  if (
    !Number.isFinite(r1) ||
    !Number.isFinite(r2) ||
    !Number.isFinite(s1) ||
    !Number.isFinite(s2)
  ) {
    return false;
  }

  return undirectedPairKey(r1, r2) === undirectedPairKey(s1, s2);
}

/** relation 원본의 이벤트 식별자만 전달 */
function pickDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function pickMetaField(raw, nested, keys) {
  for (const key of keys) {
    const v = pickDefined(raw[key]);
    if (v !== undefined) return v;
  }
  if (!nested) return undefined;
  for (const key of keys) {
    const v = pickDefined(nested[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function relationEventMetaPassthrough(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const nested = raw.event && typeof raw.event === 'object' ? raw.event : null;
  const chapterIdx = pickMetaField(raw, nested, ['chapterIdx', 'chapter', 'chapter_idx']);
  const eventNum = pickMetaField(raw, nested, ['eventNum', 'event_num']);
  const eventIdx = pickMetaField(raw, nested, ['eventIdx', 'event_idx']);
  const eventId = pickMetaField(raw, nested, ['eventId', 'event_id', 'id']);
  return {
    ...(chapterIdx !== undefined ? { chapterIdx } : {}),
    ...(eventNum !== undefined ? { eventNum } : {}),
    ...(eventIdx !== undefined ? { eventIdx } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
  };
}

export function processRelations(relations) {
  if (!Array.isArray(relations) || relations.length === 0) {
    return [];
  }

  try {
    return relations
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
  } catch {
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
  } catch {
    return [];
  }
}

/** 관계·스타일 캐시 일괄 정리 (툴팁 닫을 때) */
export function cleanupRelationUtils() {
  try {
    relationCache.clear();
    clearStyleCache();
  } catch {
    /* ignore */
  }
}

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
        const name =
          connectedNode.data.label || connectedNode.data.common_name || `인물 ${connectedNodeId}`;
        radarDataMap.set(connectedNodeId, {
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
