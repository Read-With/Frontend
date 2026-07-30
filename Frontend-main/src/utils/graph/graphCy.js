/** Cytoscape 뷰포트·인터랙션·검색·타임라인 차트 UX */

import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { PRESET_LAYOUT, COSE_BILKENT_LAYOUT } from '../styles/graphStyles.js';
import {
  undirectedPairKey,
  GRAPH_ZOOM,
  normalizeRelationArray,
  uniqueStrings,
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
} from './graphCore';
import { expandConnectedSubgraph, OVERLAP_RESOLVE } from './graphModel';

let coseBilkentRegistered = false;
function ensureCoseBilkentRegistered() {
  if (coseBilkentRegistered) return;
  cytoscape.use(coseBilkent);
  coseBilkentRegistered = true;
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

/** 최초/전체 재배치용 cose-bilkent (실패 시 preset) */
export function runCoseBilkentLayout(cy) {
  if (!cy) return;
  ensureCoseBilkentRegistered();
  try {
    cy.layout({ ...COSE_BILKENT_LAYOUT }).run();
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

/* ─── 툴팁 좌표 · 캔버스 배치 ─── */

/** 플로팅 툴팁 추정 크기 (.graph-node-tooltip / .edge-tooltip-container ≈ 26.25rem) */
const FLOATING_TOOLTIP_ESTIMATE = { width: 420, height: 400 };
const TOOLTIP_CANVAS_PAD = 8;
const TOOLTIP_FOCUS_GAP = 20;

function rectOverlapArea(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/** fixed 좌표를 브라우저 viewport 안으로 클램프 */
export function constrainToWindow(x, y, elementWidth, elementHeight) {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { x: 0, y: 0 };
  }
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
function placeTooltipInCanvasAwayFromFocus({
  cy,
  focusEles,
  width = FLOATING_TOOLTIP_ESTIMATE.width,
  height = FLOATING_TOOLTIP_ESTIMATE.height,
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
    runPresetLayout(cy);
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
      renderedPosition: {
        x: cy.width() / 2,
        y: cy.height() / 2,
      },
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
function getSelectionFocusElements(cy, element) {
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
 * focus 묶음이 가용 뷰포트 안에 모두 들어오도록 pan(+필요 시 zoom out).
 * @param {{
 *   duration?: number,
 *   padding?: number,
 *   reserveRight?: number,
 *   reserveLeft?: number,
 *   reserveTop?: number,
 *   reserveBottom?: number,
 * }} [options]
 */
function animateCenterOnFocusElements(cy, focusEles, options = {}) {
  if (!cy || !focusEles?.length) return false;
  const duration = options.duration ?? 500;

  try {
    cy.stop();

    const padding = Number.isFinite(options.padding) ? options.padding : 28;
    const reserveRight = Math.max(0, Number(options.reserveRight) || 0);
    const reserveLeft = Math.max(0, Number(options.reserveLeft) || 0);
    const reserveTop = Math.max(0, Number(options.reserveTop) || 0);
    const reserveBottom = Math.max(0, Number(options.reserveBottom) || 0);

    const viewW = typeof cy.width === 'function' ? cy.width() : 0;
    const viewH = typeof cy.height === 'function' ? cy.height() : 0;
    if (!(viewW > 0) || !(viewH > 0)) return false;

    const usable = {
      x1: padding + reserveLeft,
      y1: padding + reserveTop,
      x2: viewW - padding - reserveRight,
      y2: viewH - padding - reserveBottom,
    };
    const usableW = Math.max(usable.x2 - usable.x1, 1);
    const usableH = Math.max(usable.y2 - usable.y1, 1);
    const targetCx = (usable.x1 + usable.x2) / 2;
    const targetCy = (usable.y1 + usable.y2) / 2;

    let bb;
    try {
      bb = focusEles.boundingBox({ includeLabels: true, includeOverlays: false });
    } catch {
      bb = null;
    }
    if (!bb || !Number.isFinite(bb.x1) || !Number.isFinite(bb.x2)) {
      const center = getFocusElementsModelCenter(focusEles);
      if (!center) return false;
      const zoom = cy.zoom();
      cy.animate({
        pan: {
          x: targetCx - center.x * zoom,
          y: targetCy - center.y * zoom,
        },
        duration,
        easing: 'ease-in-out',
      });
      return true;
    }

    const modelW = Math.max(bb.w, bb.x2 - bb.x1, 1);
    const modelH = Math.max(bb.h, bb.y2 - bb.y1, 1);
    const center = {
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2,
    };

    const currentZoom = cy.zoom();
    const minZoom = typeof cy.minZoom === 'function' ? cy.minZoom() : GRAPH_ZOOM.MIN;
    const maxZoom = typeof cy.maxZoom === 'function' ? cy.maxZoom() : GRAPH_ZOOM.MAX;
    const renderedW = modelW * currentZoom;
    const renderedH = modelH * currentZoom;

    let nextZoom = currentZoom;
    if (renderedW > usableW || renderedH > usableH) {
      const fitZoom = Math.min(usableW / modelW, usableH / modelH);
      nextZoom = Math.min(Math.max(fitZoom, minZoom), maxZoom);
    }

    cy.animate({
      zoom: nextZoom,
      pan: {
        x: targetCx - center.x * nextZoom,
        y: targetCy - center.y * nextZoom,
      },
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


export const isGraphContainerSizeReady = (container) => {
  if (!container) return false;
  const w = Number(container.clientWidth ?? 0);
  const h = Number(container.clientHeight ?? 0);
  return w > 0 && h > 0;
};

/* ─── 툴팁 payload ─── */

function tooltipEndpointInfo(cyNode) {
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
export function openTooltipFromTap(tapPayload, type) {
  if (!tapPayload) return null;
  const isNode = type === 'node';
  const element = isNode ? tapPayload.node : tapPayload.edge;
  if (!element) return null;

  try {
    const center = isNode ? tapPayload.nodeCenter : tapPayload.edgeCenter;
    const x = tapPayload.mouseX ?? center?.x ?? 0;
    const y = tapPayload.mouseY ?? center?.y ?? 0;
    const base = {
      type,
      id: element.id(),
      x,
      y,
      data: element.data(),
    };

    if (isNode) {
      const nodeFields = base.data ?? {};
      return {
        ...base,
        ...nodeFields,
        nodeCenter: center,
        names: parseJsonSafely(nodeFields.names),
        isMainCharacter: !!nodeFields.isMainCharacter,
        common_name: nodeFields.common_name || nodeFields.name || nodeFields.label,
        description: nodeFields.description || '',
        personalityText: nodeFields.personalityText || '',
        image: nodeFields.image || '',
        weight: nodeFields.weight || 1,
      };
    }

    const relation = normalizeRelationArray(parseJsonSafely(base.data?.relation));
    const latestLabels = normalizeRelationArray(parseJsonSafely(base.data?.latestLabels));
    const labelHistory = parseJsonSafely(base.data?.labelHistory);
    return {
      ...base,
      sourceEndpoint: tooltipEndpointInfo(element.source()),
      targetEndpoint: tooltipEndpointInfo(element.target()),
      edgeCenter: center,
      data: {
        ...base.data,
        relation,
        latestLabels,
        labelHistory:
          labelHistory && typeof labelHistory === 'object' && !Array.isArray(labelHistory)
            ? labelHistory
            : {},
        label: base.data?.label || relation[relation.length - 1] || '',
        // positivity는 서버/그래프 값만 유지 — 없으면 null (0과 '없음' 구분)
        positivity:
          base.data?.positivity == null || base.data?.positivity === ''
            ? null
            : base.data.positivity,
        count: base.data?.count ?? 1,
      },
    };
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

export function isGraphDragEndEvent(event) {
  const type = event?.detail?.type;
  return type === 'graphDragEnd' || type === 'dragend';
}

/* ─── reciprocal junction · 하이라이트 ─── */

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

/* ─── 신규 노드 배치 · 레이아웃 상수 ─── */

const PLACEMENT_PADDING = 80;
/** 황금각 스파이럴 — 다수 노드 동시 배치 시 각도 충돌이 적음 */
const PLACEMENT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PLACEMENT_BASE_NODE_RADIUS = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE;

/** 신규 노드 스파이럴 배치 (이웃 기반 배치 없음 — 중심 기준 빈 자리 탐색) */
export function calculateSpiralPlacement(newNodes, placedPositions, containerWidth, containerHeight) {
  if (!newNodes?.length) return newNodes;

  const batch = newNodes.length;
  const minDist = PLACEMENT_BASE_NODE_RADIUS * (batch > 6 ? 3.6 : 3.2);
  const minDistSq = minDist * minDist;
  const radiusStep = Math.max(2.5, Math.min(6, 1.8 + batch * 0.15));
  const maxRadius = Math.min(containerWidth, containerHeight) / 2 - PLACEMENT_PADDING;
  const updatedPositions = [...placedPositions];
  const halfW = containerWidth / 2 - PLACEMENT_PADDING;
  const halfH = containerHeight / 2 - PLACEMENT_PADDING;
  const maxAttempts = Math.min(400, 160 + batch * 20);

  newNodes.forEach((node, index) => {
    let found = false;
    let x = 0;
    let y = 0;
    let attempts = 0;
    // 배치 시작 위상만 어긋나게 해 동시 등장 노드끼리 같은 궤적을 덜 밟게 함
    const phase = index * PLACEMENT_GOLDEN_ANGLE;

    while (!found && attempts < maxAttempts) {
      const angle = phase + attempts * PLACEMENT_GOLDEN_ANGLE;
      const radius = Math.min(48 + attempts * radiusStep, maxRadius);
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;

      if (Math.abs(x) < halfW && Math.abs(y) < halfH) {
        found = updatedPositions.every((pos) => {
          const dx = x - pos.x;
          const dy = y - pos.y;
          return dx * dx + dy * dy > minDistSq;
        });
      }
      attempts += 1;
    }

    if (!found) {
      const fallbackAngle = phase + batch;
      const fallbackR = Math.min(80 + index * minDist * 0.35, maxRadius);
      x = Math.cos(fallbackAngle) * fallbackR;
      y = Math.sin(fallbackAngle) * fallbackR;
    }

    node.position = { x, y };
    updatedPositions.push({ x, y });
  });

  return newNodes;
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
    console.error('getNodeMatchType 실패:', error, { node, searchLower });
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
    console.warn('buildSuggestions: 유효하지 않은 elements 배열입니다', {
      elements,
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
    console.error('buildSuggestions 실패:', error, { 
      elementsLength: elements?.length, 
      query, 
      hasChapterData: !!currentChapterData 
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
    console.warn('filterGraphElements: 유효하지 않은 elements 배열입니다', { 
      elements, 
      type: typeof elements 
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
    console.error('filterGraphElements 실패:', error, { 
      elementsLength: elements?.length, 
      searchTerm, 
      hasChapterData: !!currentChapterData 
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
        console.warn('createFilteredElementIds: 유효하지 않은 요소입니다', { element });
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
    console.error('createFilteredElementIds 실패:', error, { 
      filteredElementsLength: filteredElements?.length 
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
    console.warn('applySearchFadeEffect: 유효하지 않은 Cytoscape 인스턴스입니다', { cy });
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
    console.error('applySearchFadeEffect 실패:', error, { 
      filteredElementsLength: filteredElements?.length 
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
    console.warn('shouldShowNoSearchResults: isSearchActive이 boolean이 아닙니다', { isSearchActive });
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
    console.warn('getNoSearchResultsMessage: 유효하지 않은 검색어입니다', { searchTerm, type: typeof searchTerm });
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
export function annotateSignificantEdgePoints(pairs, delta = EDGE_CHART_UX.SIGNIFICANT_DELTA) {
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
export function formatEdgeTimelineDisplayLabel(label, numericLabel, fallbackIndex = 0) {
  if (typeof label === 'string') {
    const trimmed = label.trim();
    if (/^Ch\d+/i.test(trimmed)) return trimmed;
    const eventMatch = trimmed.match(/^E(\d+)$/i);
    if (eventMatch) return `event ${eventMatch[1]}`;
  }
  if (Number.isFinite(numericLabel) && numericLabel > 0) {
    return `event ${numericLabel}`;
  }
  return `event ${fallbackIndex + 1}`;
}
