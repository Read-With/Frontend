/** 그래프 뷰포트: 툴팁 좌표·캔버스 경계·fit/zoom·선택 포커스 (키보드 탐색은 graphKeyboardNav) */

import { toPositiveNumberOrNull } from '../common/valueUtils';
import { GRAPH_ZOOM } from './graphCore';
import { OVERLAP_RESOLVE, readNodeRadius } from './graphLayout';

/** 플로팅 툴팁 추정 크기 (.graph-node-tooltip / .edge-tooltip-container ≈ 26.25rem) */
export const FLOATING_TOOLTIP_ESTIMATE = { width: 420, height: 400 };

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

export function getCyClientRect(cy) {
  try {
    const el = cy ? cy.container() : null;
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

/** cy 뷰포트 픽셀 크기 */
const readViewportSize = (cy) => ({ viewW: cy.width(), viewH: cy.height() });

/** 가로·세로가 모두 양수인 뷰포트 크기, 아니면 null (fit·포커스 계산 전 가드) */
const readUsableViewportSize = (cy) => {
  const size = readViewportSize(cy);
  return size.viewW > 0 && size.viewH > 0 ? size : null;
};

/** 지금 보이는 영역의 model 좌표. cy.extent() 우선, 없으면 pan·zoom으로 역산. 크기 0이면 null */
function resolveVisibleModelExtent(cy, container, zoom) {
  try {
    const e = cy.extent();
    if (e && [e.x1, e.x2, e.y1, e.y2].every(Number.isFinite)) {
      return { x1: e.x1, x2: e.x2, y1: e.y1, y2: e.y2 };
    }
  } catch {
    /* fall through */
  }

  const { viewW: cyW, viewH: cyH } = readViewportSize(cy);
  const viewW = (container?.clientWidth > 0 ? container.clientWidth : cyW) || 0;
  const viewH = (container?.clientHeight > 0 ? container.clientHeight : cyH) || 0;
  if (!(viewW > 0) || !(viewH > 0)) return null;
  const pan = cy.pan();
  const panX = Number.isFinite(pan?.x) ? pan.x : 0;
  const panY = Number.isFinite(pan?.y) ? pan.y : 0;
  // rendered = model * zoom + pan → model = (rendered - pan) / zoom
  return {
    x1: (0 - panX) / zoom,
    x2: (viewW - panX) / zoom,
    y1: (0 - panY) / zoom,
    y2: (viewH - panY) / zoom,
  };
}

/**
 * 노드를 현재 보이는 캔버스(뷰포트) 안으로만 제한.
 * model 좌표의 원점±container/2로 자르면 줌·팬 후 실제 보이는 영역보다 훨씬 좁아져
 * 사용자가 화면 안에서도 자유롭게 배치하지 못한다.
 *
 * @returns {boolean} 좌표를 바꾼 노드가 있으면 true
 */
export const ensureElementsInBounds = (cy, container, options = {}) => {
  if (!cy || cy.destroyed?.()) return false;

  const safeZoom = toPositiveNumberOrNull(cy.zoom()) ?? 1;

  const extent = resolveVisibleModelExtent(cy, container, safeZoom);
  if (!extent) return false;
  const { x1, x2, y1, y2 } = extent;

  const viewWModel = Math.max(x2 - x1, 1);
  const viewHModel = Math.max(y2 - y1, 1);
  const paddingPx = Math.min(
    48,
    Math.max(8, Math.min(viewWModel, viewHModel) * safeZoom * 0.04),
  );
  const pad = paddingPx / safeZoom;

  const bounds = {
    left: x1 + pad,
    right: x2 - pad,
    top: y1 + pad,
    bottom: y2 - pad,
  };

  let needsAdjustment = false;
  const nodes = options.nodes || cy.nodes();
  const nodeCount = nodes.length;
  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : 2000;

  cy.batch(() => {
    const nodesToProcess = nodeCount > maxNodes ? nodes.slice(0, maxNodes) : nodes;

    nodesToProcess.forEach((node) => {
      const pos = node.position();
      const radius = readNodeRadius(node, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE);
      const minX = Math.min(bounds.left + radius, bounds.right - radius);
      const maxX = Math.max(bounds.left + radius, bounds.right - radius);
      const minY = Math.min(bounds.top + radius, bounds.bottom - radius);
      const maxY = Math.max(bounds.top + radius, bounds.bottom - radius);
      const constrainedX = Math.max(minX, Math.min(pos.x, maxX));
      const constrainedY = Math.max(minY, Math.min(pos.y, maxY));

      if (constrainedX !== pos.x || constrainedY !== pos.y) {
        needsAdjustment = true;
        node.position({ x: constrainedX, y: constrainedY });
      }
    });
  });

  return needsAdjustment;
};

/**
 * 주어진 요소(노드+간선, 라벨 포함)가 현재 팬·줌 뷰포트 안에 padding 여유를 두고
 * 모두 들어와 있는지. 이벤트 확정 등으로 노드·간선이 늘어난 뒤, 뷰포트 재조정(fit)이
 * 필요한지 판단하는 데 쓴다 — 배치 자체는 건드리지 않는 순수 판별 함수.
 * @returns {boolean} 판단 불가(요소·extent 없음 등)한 경우도 true(재조정 불필요로 간주)
 */
export function isElementsFitInViewport(cy, eles, paddingPx = 0) {
  if (!cy || cy.destroyed?.() || !eles || eles.length === 0) return true;

  let bb;
  try {
    bb = eles.boundingBox({ includeLabels: true, includeOverlays: false });
  } catch {
    return true;
  }
  if (!bb || ![bb.x1, bb.x2, bb.y1, bb.y2].every(Number.isFinite)) return true;

  let extent;
  try {
    extent = cy.extent();
  } catch {
    extent = null;
  }
  if (!extent || ![extent.x1, extent.x2, extent.y1, extent.y2].every(Number.isFinite)) {
    return true;
  }

  const safeZoom = toPositiveNumberOrNull(cy.zoom()) ?? 1;
  const pad = Math.max(0, paddingPx) / safeZoom;

  return (
    bb.x1 >= extent.x1 + pad &&
    bb.x2 <= extent.x2 - pad &&
    bb.y1 >= extent.y1 + pad &&
    bb.y2 <= extent.y2 - pad
  );
}

/** fit에 쓸 요소: 노드+간선(+라벨 BB). 지정 eles가 있으면 그대로. */
function resolveFitElements(cy, eles) {
  if (eles?.length) return eles;
  const visible = cy.elements(':visible');
  if (visible.length > 0) return visible;
  return cy.elements();
}

/** 초기 뷰포트용: 노드(+이름 라벨)만 — 간선 라벨 BB로 과도하게 줌아웃되지 않게 */
function resolveInitialFitElements(cy) {
  try {
    const nodes = cy.nodes(':visible');
    if (nodes.length > 0) return nodes;
  } catch {
    /* fall through */
  }
  return resolveFitElements(cy);
}

/**
 * 뷰포트 fit (즉시 또는 애니메이션).
 * 기본은 visible 노드·간선 전체 — 최초 등장 시 캔버스 안에 그래프가 들어오도록.
 * @param {object} cy
 * @param {{ padding?: number, duration?: number, eles?: object, fill?: number } | number} [opts]
 *   number면 padding으로 처리. eles 없으면 visible(없으면 전체) elements.
 *   fill > 1 이면 fit 후 중심 기준 추가 줌인.
 */
export function fitGraphToNodes(cy, opts = {}) {
  if (!cy || cy.destroyed?.()) return false;
  const options = typeof opts === 'number' ? { padding: opts } : (opts || {});
  const padding = options.padding ?? GRAPH_ZOOM.FIT_PADDING;
  const duration = options.duration ?? 0;
  const fill = Number.isFinite(options.fill) ? options.fill : 1;
  const applyFill = () => {
    if (fill > 1) applyFitFillZoom(cy, fill);
  };
  try {
    cy.resize();

    const viewport = readUsableViewportSize(cy);
    if (!viewport) return false;
    const { viewW, viewH } = viewport;

    const fitEles = resolveFitElements(cy, options.eles);
    if (!fitEles.length) return false;

    lowerMinZoomToFit(cy, fitEles, viewW, viewH, padding);

    cy.stop();
    if (duration <= 0) {
      cy.fit(fitEles, padding);
      applyFill();
      return true;
    }
    cy.animate({
      fit: { eles: fitEles, padding },
      duration,
      easing: 'ease-in-out',
      complete: applyFill,
    });
    return true;
  } catch {
    return false;
  }
}

/** 큰 그래프는 minZoom 때문에 잘릴 수 있음 → 전부 들어오는 줌이 minZoom보다 작으면 한시적으로 낮춤 */
function lowerMinZoomToFit(cy, fitEles, viewW, viewH, padding) {
  try {
    const bb = fitEles.boundingBox({ includeLabels: true, includeOverlays: false });
    if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) return;
    const modelW = Math.max(bb.w, bb.x2 - bb.x1, 1);
    const modelH = Math.max(bb.h, bb.y2 - bb.y1, 1);
    const pad = Math.max(0, padding) * 2;
    const needZoom = Math.min(
      Math.max(viewW - pad, 1) / modelW,
      Math.max(viewH - pad, 1) / modelH,
    );
    const currentMin = cy.minZoom();
    if (Number.isFinite(needZoom) && needZoom > 0 && needZoom < currentMin) {
      cy.minZoom(Math.max(0.05, needZoom * 0.98));
    }
  } catch {
    /* ignore bb probe */
  }
}

/** fit 직후 중심 기준 추가 줌인 (소규모 그래프가 멀리 보이지 않게) */
function applyFitFillZoom(cy, fill) {
  if (fill > 1) zoomGraphByFactor(cy, fill);
}

/**
 * 컨테이너 크기가 준비된 뒤 전체 요소를 fit하고 경계 안으로 재제약.
 * 초기/챕터 전환용 — 노드 기준 + 약간 더 가까운 줌.
 * @returns {boolean}
 */
export function fitGraphViewportInContainer(cy, container, opts = {}) {
  if (!isGraphContainerSizeReady(container)) return false;
  const eles = opts.eles ?? resolveInitialFitElements(cy);
  const padding = opts.padding ?? GRAPH_ZOOM.FIT_PADDING_INITIAL ?? GRAPH_ZOOM.FIT_PADDING;
  const fill = opts.fill ?? GRAPH_ZOOM.FIT_FILL ?? 1;
  if (!fitGraphToNodes(cy, { duration: 0, ...opts, eles, padding, fill })) return false;
  // fill로 살짝 잘린 노드를 레이아웃을 깨며 끌어오지 않음 — 패닝만으로 충분
  if (!(fill > 1)) {
    ensureElementsInBounds(cy, container);
  }
  return true;
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

/** 현재 zoom/pan 스냅샷 (선택 포커스 전 복원용) */
export function captureCyViewport(cy) {
  if (!cy || cy.destroyed?.()) return null;
  try {
    const zoom = cy.zoom();
    const pan = cy.pan();
    if (!Number.isFinite(zoom) || !Number.isFinite(pan?.x) || !Number.isFinite(pan?.y)) {
      return null;
    }
    return { zoom, pan: { x: pan.x, y: pan.y } };
  } catch {
    return null;
  }
}

/**
 * 저장된 zoom/pan으로 뷰포트 복원.
 * @param {{ duration?: number }} [opts]
 */
export function restoreCyViewport(cy, snapshot, opts = {}) {
  if (!cy || cy.destroyed?.() || !snapshot) return false;
  const zoom = snapshot.zoom;
  const pan = snapshot.pan;
  if (!Number.isFinite(zoom) || !Number.isFinite(pan?.x) || !Number.isFinite(pan?.y)) {
    return false;
  }
  const duration = Number.isFinite(opts.duration) ? Math.max(0, opts.duration) : 0;
  try {
    cy.stop();
    if (duration > 0) {
      cy.animate({ zoom, pan, duration, easing: 'ease-in-out' });
    } else {
      cy.viewport({ zoom, pan });
    }
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
  // 이 노드에서 나가는 간선의 target id — 역방향 존재 여부를 O(1)로
  const outgoingTargets = new Set();
  connectedEdges.forEach((edge) => {
    if (String(edge.source().id()) === nodeId) outgoingTargets.add(String(edge.target().id()));
  });
  const directEdges = connectedEdges.filter((edge) => {
    const sourceId = String(edge.source().id());
    if (sourceId === nodeId) return true;
    if (String(edge.target().id()) === nodeId) return !outgoingTargets.has(sourceId);
    return false;
  });

  return element.union(directEdges).union(directEdges.connectedNodes());
}

const boundingBoxCenter = (bb) => ({ x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 });

/** focus 요소들의 모델 좌표 중심점 */
function getFocusElementsModelCenter(focusEles) {
  if (!focusEles?.length) return null;
  try {
    const bb = focusEles.boundingBox({ includeLabels: false, includeOverlays: false });
    if (!bb || !Number.isFinite(bb.x1) || !Number.isFinite(bb.x2)) return null;
    return boundingBoxCenter(bb);
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

    const viewport = readUsableViewportSize(cy);
    if (!viewport) return false;
    const { viewW, viewH } = viewport;

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
    const center = boundingBoxCenter(bb);

    const currentZoom = cy.zoom();
    const minZoom = cy.minZoom();
    const maxZoom = cy.maxZoom();
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
