/** Cytoscape 뷰포트·인터랙션·검색·타임라인 차트 UX */

import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import {
  PRESET_LAYOUT,
  COSE_BILKENT_LAYOUT,
  estimateNodeSizePx,
} from '../styles/graphStyles.js';
import { clampPositivity } from '../common/valueUtils';
import {
  undirectedPairKey,
  GRAPH_ZOOM,
  normalizeRelationArray,
  uniqueStrings,
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
} from './graphCore';
import { expandConnectedSubgraph, OVERLAP_RESOLVE, readNodeRadius } from './graphModel';
import { errorUtils } from '../common/urlUtils';

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
export function syncCyElementData(cy, defs) {
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
export function elementDefIdSet(defs) {
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
export function collectContinuingNodeLayoutSeed(cy, prevNodeIds, nextNodeIds) {
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

/**
 * 노드를 현재 보이는 캔버스(뷰포트) 안으로만 제한.
 * model 좌표의 원점±container/2로 자르면 줌·팬 후 실제 보이는 영역보다 훨씬 좁아져
 * 사용자가 화면 안에서도 자유롭게 배치하지 못한다.
 *
 * @returns {boolean} 좌표를 바꾼 노드가 있으면 true
 */
export const ensureElementsInBounds = (cy, container, options = {}) => {
  if (!cy || cy.destroyed?.()) return false;

  const zoom = typeof cy.zoom === 'function' ? cy.zoom() : 1;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  let x1;
  let x2;
  let y1;
  let y2;
  try {
    const extent = typeof cy.extent === 'function' ? cy.extent() : null;
    if (
      extent &&
      Number.isFinite(extent.x1) &&
      Number.isFinite(extent.x2) &&
      Number.isFinite(extent.y1) &&
      Number.isFinite(extent.y2)
    ) {
      x1 = extent.x1;
      x2 = extent.x2;
      y1 = extent.y1;
      y2 = extent.y2;
    }
  } catch {
    /* fall through */
  }

  if (![x1, x2, y1, y2].every(Number.isFinite)) {
    const viewW =
      (container && container.clientWidth > 0
        ? container.clientWidth
        : typeof cy.width === 'function'
          ? cy.width()
          : 0) || 0;
    const viewH =
      (container && container.clientHeight > 0
        ? container.clientHeight
        : typeof cy.height === 'function'
          ? cy.height()
          : 0) || 0;
    if (!(viewW > 0) || !(viewH > 0)) return false;
    const pan = typeof cy.pan === 'function' ? cy.pan() : { x: 0, y: 0 };
    const panX = Number.isFinite(pan?.x) ? pan.x : 0;
    const panY = Number.isFinite(pan?.y) ? pan.y : 0;
    // rendered = model * zoom + pan → model = (rendered - pan) / zoom
    x1 = (0 - panX) / safeZoom;
    x2 = (viewW - panX) / safeZoom;
    y1 = (0 - panY) / safeZoom;
    y2 = (viewH - panY) / safeZoom;
  }

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

/* ─── 뷰포트 · 선택 포커스 ─── */

/** fit에 쓸 요소: 노드+간선(+라벨 BB). 지정 eles가 있으면 그대로. */
function resolveFitElements(cy, eles) {
  if (eles?.length) return eles;
  const visible = cy.elements(':visible');
  if (visible.length > 0) return visible;
  return cy.elements();
}

/**
 * 뷰포트 fit (즉시 또는 애니메이션).
 * 기본은 visible 노드·간선 전체 — 최초 등장 시 캔버스 안에 그래프가 들어오도록.
 * @param {object} cy
 * @param {{ padding?: number, duration?: number, eles?: object } | number} [opts]
 *   number면 padding으로 처리. eles 없으면 visible(없으면 전체) elements.
 */
export function fitGraphToNodes(cy, opts = {}) {
  if (!cy || cy.destroyed?.()) return false;
  const options = typeof opts === 'number' ? { padding: opts } : (opts || {});
  const padding = options.padding ?? GRAPH_ZOOM.FIT_PADDING;
  const duration = options.duration ?? 0;
  try {
    if (typeof cy.resize === 'function') cy.resize();

    const viewW = typeof cy.width === 'function' ? cy.width() : 0;
    const viewH = typeof cy.height === 'function' ? cy.height() : 0;
    if (!(viewW > 0) || !(viewH > 0)) return false;

    const fitEles = resolveFitElements(cy, options.eles);
    if (!fitEles.length) return false;

    // 큰 그래프는 minZoom 때문에 잘릴 수 있음 → 필요 시 한시적으로 낮춤
    try {
      const bb = fitEles.boundingBox({ includeLabels: true, includeOverlays: false });
      if (bb && Number.isFinite(bb.w) && Number.isFinite(bb.h)) {
        const modelW = Math.max(bb.w, bb.x2 - bb.x1, 1);
        const modelH = Math.max(bb.h, bb.y2 - bb.y1, 1);
        const pad = Math.max(0, padding) * 2;
        const needZoom = Math.min(
          Math.max(viewW - pad, 1) / modelW,
          Math.max(viewH - pad, 1) / modelH,
        );
        const currentMin = typeof cy.minZoom === 'function' ? cy.minZoom() : GRAPH_ZOOM.MIN;
        if (Number.isFinite(needZoom) && needZoom > 0 && needZoom < currentMin) {
          cy.minZoom(Math.max(0.05, needZoom * 0.98));
        }
      }
    } catch {
      /* ignore bb probe */
    }

    cy.stop();
    if (duration <= 0) {
      cy.fit(fitEles, padding);
      return true;
    }
    cy.animate({
      fit: { eles: fitEles, padding },
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

function graphElementLabel(ele) {
  if (!ele?.length) return '';
  const data = ele.data?.() || {};
  if (typeof ele.isNode === 'function' && ele.isNode()) {
    return data.common_name || data.label || data.name || String(data.id || '이름 없음');
  }
  const src = ele.source?.()?.data?.() || {};
  const tgt = ele.target?.()?.data?.() || {};
  const sn = src.common_name || src.label || src.name || '인물';
  const tn = tgt.common_name || tgt.label || tgt.name || '인물';
  return `${sn}와 ${tn}의 관계`;
}

function isNavigableGraphElement(ele) {
  if (!ele?.length) return false;
  if (typeof ele.visible === 'function' && !ele.visible()) return false;
  if (typeof ele.hasClass === 'function' && ele.hasClass('faded')) return false;
  return true;
}

function compareByGraphLabelKo(a, b) {
  return graphElementLabel(a).localeCompare(graphElementLabel(b), 'ko');
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

function cycleIndex(length, current, delta) {
  if (length <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : length - 1;
  return (current + delta + length * 10) % length;
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
  idx = cycleIndex(list.length, idx, delta);
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

/**
 * 그래프 캔버스 region 포커스 단축키.
 * +/= 확대, - 축소, 0 맞춤, Escape 선택·포커스 해제.
 * 화살표: 인물 순환(선택 중 좌우는 연결 관계). Enter/Space: 포커스 선택.
 * @returns {boolean} 처리 여부
 */
export function handleGraphCanvasHotkeys(event, {
  cy,
  onClearSelection,
  keyboardFocusRef = null,
  onSelectById = null,
  onAnnounce = null,
  selectedKind = null,
  selectedId = null,
} = {}) {
  if (!event || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const target = event.target;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
    return false;
  }

  const key = event.key;

  if (key === 'Escape') {
    event.preventDefault();
    onClearSelection?.();
    setKeyboardFocusElement(cy, null);
    if (keyboardFocusRef) keyboardFocusRef.current = null;
    onAnnounce?.('선택과 포커스를 해제했습니다.');
    return true;
  }

  if (!cy || cy.destroyed?.()) return false;

  if (key === '+' || key === '=') {
    event.preventDefault();
    return zoomGraphByFactor(cy, GRAPH_ZOOM.STEP);
  }
  if (key === '-' || key === '_') {
    event.preventDefault();
    return zoomGraphByFactor(cy, 1 / GRAPH_ZOOM.STEP);
  }
  if (key === '0') {
    event.preventDefault();
    return fitGraphToNodes(cy, { duration: GRAPH_ZOOM.FIT_DURATION_MS });
  }

  const isArrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
  const isActivate = key === 'Enter' || key === ' ';
  if (!isArrow && !isActivate) return false;

  event.preventDefault();
  const focus = keyboardFocusRef?.current;
  const delta = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;

  if (isArrow) {
    const browseEdges =
      selectedKind === 'node'
      && selectedId
      && (key === 'ArrowLeft' || key === 'ArrowRight');

    if (browseEdges) {
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

  // Enter / Space
  let kind = focus?.kind;
  let id = focus?.id;
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

  const ok = onSelectById?.(kind, id);
  if (!ok) {
    onAnnounce?.('선택을 적용하지 못했습니다.');
    return true;
  }
  const label = graphElementLabel(cy.getElementById(String(id)));
  onAnnounce?.(kind === 'edge' ? `${label} 상세를 열었습니다.` : `인물 ${label} 상세를 열었습니다.`);
  return true;
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

/* ─── 신규 노드 앵커 기반 배치 ─── */

/** 앵커 주변 1차 탐색 상한 = idealSep × 이 배수 */
const PLACEMENT_MAX_RING = 2.5;
const PLACEMENT_RING_MULTS = [1.0, 1.2, 1.45, 1.75, 2.1, 2.5];
/** 빈자리 없을 때 확장 탐색 (신규끼리 충돌 방지 우선) */
const PLACEMENT_EXPAND_RING_MULTS = [3.0, 3.5, 4.0, 5.0, 6.0, 8.0];
const PLACEMENT_SPIRAL_MAX = 360;
const PLACEMENT_SPIRAL_STEP = 6;
const PLACEMENT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PLACEMENT_IDEAL_EDGE = 100;
const PLACEMENT_LABEL_GAP = 10;
const PLACEMENT_BOUNDS_PAD = 80;
/** 라벨 겹침은 soft penalty (body-body만 hard reject) */
const PLACEMENT_LABEL_PENALTY = 28;

function placementLabelRadius(label) {
  const len = String(label || '').length;
  return Math.min(72, Math.max(14, len * 5.5));
}

function placementBodyDisc(x, y, radius) {
  return { x, y, radius };
}

function placementLabelDisc(x, y, radius, label) {
  return {
    x,
    y: y + radius + PLACEMENT_LABEL_GAP,
    radius: placementLabelRadius(label),
  };
}

function discsOverlap(a, b, padding) {
  const minDist = a.radius + b.radius + padding;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy < minDist * minDist;
}

function buildOccupiedDiscs(placedList) {
  const bodies = [];
  const labels = [];
  for (const p of placedList) {
    bodies.push(placementBodyDisc(p.x, p.y, p.radius));
    labels.push(placementLabelDisc(p.x, p.y, p.radius, p.label));
  }
  return { bodies, labels };
}

/** body-body만 hard collision */
function candidateBodyCollides(cx, cy, newR, occupied, padding) {
  const body = placementBodyDisc(cx, cy, newR);
  for (const o of occupied.bodies) {
    if (discsOverlap(body, o, padding)) return true;
  }
  return false;
}

/** body↔label / label↔label soft penalty */
function candidateLabelPenalty(cx, cy, newR, label, occupied, padding) {
  const body = placementBodyDisc(cx, cy, newR);
  const lab = placementLabelDisc(cx, cy, newR, label);
  const softPad = padding * 0.5;
  let hits = 0;
  for (const o of occupied.labels) {
    if (discsOverlap(body, o, softPad)) hits += 1;
  }
  for (const o of occupied.bodies) {
    if (discsOverlap(lab, o, softPad)) hits += 1;
  }
  for (const o of occupied.labels) {
    if (discsOverlap(lab, o, softPad)) hits += 0.5;
  }
  return hits * PLACEMENT_LABEL_PENALTY;
}

function edgeWeightOf(edge) {
  const w = Number(edge?.data?.weight ?? edge?.data?.count ?? 1);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

/** @returns {Map<string, Map<string, number>>} */
function buildAdjacencyFromEdges(edges) {
  const adj = new Map();
  const bump = (from, to, weight) => {
    if (!from || !to || from === to) return;
    if (!adj.has(from)) adj.set(from, new Map());
    const m = adj.get(from);
    m.set(to, Math.max(m.get(to) || 0, weight));
  };
  (Array.isArray(edges) ? edges : []).forEach((edge) => {
    const s = edge?.data?.source != null ? String(edge.data.source) : '';
    const t = edge?.data?.target != null ? String(edge.data.target) : '';
    if (!s || !t) return;
    const w = edgeWeightOf(edge);
    bump(s, t, w);
    bump(t, s, w);
  });
  return adj;
}

function neighborsOf(adj, id) {
  const m = adj.get(id);
  if (!m || m.size === 0) return [];
  return [...m.entries()].map(([nid, weight]) => ({ id: nid, weight }));
}

function centroidOf(points) {
  if (!points.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function isInsideSoftBounds(x, y, bounds) {
  if (!bounds) return true;
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

function buildSoftBounds(placedList, containerWidth, containerHeight) {
  if (!placedList.length) {
    const hw = Math.max(120, containerWidth / 2 - PLACEMENT_BOUNDS_PAD);
    const hh = Math.max(120, containerHeight / 2 - PLACEMENT_BOUNDS_PAD);
    return { minX: -hw, maxX: hw, minY: -hh, maxY: hh };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of placedList) {
    minX = Math.min(minX, p.x - p.radius);
    maxX = Math.max(maxX, p.x + p.radius);
    minY = Math.min(minY, p.y - p.radius);
    maxY = Math.max(maxY, p.y + p.radius);
  }
  const pad = Math.max(PLACEMENT_BOUNDS_PAD, PLACEMENT_IDEAL_EDGE * PLACEMENT_MAX_RING);
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

function generateRingCandidates(centers, preferredDist, phase, bounds, ringMults = PLACEMENT_RING_MULTS, respectBounds = true) {
  const out = [];
  const seen = new Set();
  const push = (x0, y0) => {
    if (respectBounds && !isInsideSoftBounds(x0, y0, bounds)) return;
    const key = `${Math.round(x0 * 2)}_${Math.round(y0 * 2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x: x0, y: y0 });
  };

  for (const c of centers) {
    for (const mul of ringMults) {
      const r = preferredDist * mul;
      const nAngles = Math.max(8, Math.round(10 + mul * 8));
      for (let k = 0; k < nAngles; k += 1) {
        const angle = phase + (Math.PI * 2 * k) / nAngles;
        push(c.x + Math.cos(angle) * r, c.y + Math.sin(angle) * r);
      }
    }
  }
  return out;
}

/** soft bounds·링 실패 시: 본체 비겹침 좌표를 스파이럴로 보장 */
function findFreeSpiralPosition(centers, preferredDist, phase, newR, occupied, padding) {
  const origins = centers.length ? centers : [{ x: 0, y: 0 }];
  for (let attempt = 0; attempt < PLACEMENT_SPIRAL_MAX; attempt += 1) {
    const origin = origins[attempt % origins.length];
    const angle = phase + attempt * PLACEMENT_GOLDEN_ANGLE;
    const radius = preferredDist + attempt * PLACEMENT_SPIRAL_STEP;
    const x = origin.x + Math.cos(angle) * radius;
    const y = origin.y + Math.sin(angle) * radius;
    if (!candidateBodyCollides(x, y, newR, occupied, padding)) {
      return { x, y };
    }
  }
  return null;
}

function pickBestFreeCandidate(candidates, newR, label, occupied, padding, anchors, graphCentroid, preferredDist) {
  let bestFree = null;
  let bestFreeScore = Infinity;
  let bestAny = null;
  let bestAnyScore = Infinity;

  for (const cand of candidates) {
    const bodyHit = candidateBodyCollides(cand.x, cand.y, newR, occupied, padding);
    const labelPen = candidateLabelPenalty(cand.x, cand.y, newR, label, occupied, padding);
    const score =
      scoreCandidate(cand.x, cand.y, anchors, newR, padding, graphCentroid) + labelPen;
    if (!bodyHit && score < bestFreeScore) {
      bestFreeScore = score;
      bestFree = cand;
    }
    const anyScore = score + (bodyHit ? preferredDist * 3 : 0);
    if (anyScore < bestAnyScore) {
      bestAnyScore = anyScore;
      bestAny = cand;
    }
  }
  return { bestFree, bestAny };
}

function scoreCandidate(x, y, anchors, newR, padding, fallbackCenter = null) {
  if (!anchors.length) {
    const c = fallbackCenter || { x: 0, y: 0 };
    return Math.hypot(x - c.x, y - c.y);
  }
  let score = 0;
  let weightSum = 0;
  for (const a of anchors) {
    const dist = Math.hypot(x - a.x, y - a.y);
    const ideal = Math.max(
      PLACEMENT_IDEAL_EDGE,
      newR + a.radius + padding + OVERLAP_RESOLVE.PUSH_EXTRA,
    );
    const w = a.weight || 1;
    score += Math.abs(dist - ideal) * w;
    score += Math.max(0, dist - ideal * PLACEMENT_MAX_RING) * 4 * w;
    weightSum += w;
  }
  return score / Math.max(1, weightSum);
}

/**
 * 앵커(연결 기존 노드) 주변 제한 반경 후보로 신규 노드만 배치.
 * 본체 비겹침(신규끼리 포함)을 우선 보장하고, 밀집 시에만 외곽/스파이럴로 확장한다.
 *
 * placedPositions: { id, x, y, radius?, label? }
 * edges: cytoscape element defs (source/target)
 *
 * @returns {{ nodes: Array, needsLocalReorder: boolean }}
 */
export function calculateAnchorAwarePlacement(
  newNodes,
  placedPositions,
  edges,
  containerWidth,
  containerHeight,
  options = {},
) {
  if (!newNodes?.length) {
    return { nodes: newNodes || [], needsLocalReorder: false };
  }

  const padding =
    typeof options.padding === 'number' && options.padding >= 0
      ? options.padding
      : OVERLAP_RESOLVE.PADDING;
  const fallbackRadius = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE / 2;
  const weightsForRange = [
    ...(Array.isArray(options.weightsForRange) ? options.weightsForRange : []),
    ...newNodes.map((n) => n?.data?.weight),
  ];

  const radiusOf = (posOrNode, isNew) => {
    if (isNew) {
      if (typeof posOrNode?.placementRadius === 'number' && posOrNode.placementRadius > 0) {
        return posOrNode.placementRadius;
      }
      return estimateNodeSizePx(posOrNode?.data?.weight, weightsForRange) / 2;
    }
    return typeof posOrNode?.radius === 'number' && posOrNode.radius > 0
      ? posOrNode.radius
      : fallbackRadius;
  };

  const placed = placedPositions.map((pos) => ({
    id: pos?.id != null ? String(pos.id) : '',
    x: pos.x,
    y: pos.y,
    radius: radiusOf(pos, false),
    label: pos?.label != null ? String(pos.label) : '',
  }));
  const placedById = new Map(placed.filter((p) => p.id).map((p) => [p.id, p]));
  const adj = buildAdjacencyFromEdges(edges);
  const bounds = buildSoftBounds(placed, containerWidth || 800, containerHeight || 600);
  const graphCentroid = centroidOf(placed.length ? placed : [{ x: 0, y: 0, radius: fallbackRadius }]);

  const pending = [...newNodes];
  // 기존 그래프와 연결이 많은 노드부터 배치
  pending.sort((a, b) => {
    const idA = a?.data?.id != null ? String(a.data.id) : '';
    const idB = b?.data?.id != null ? String(b.data.id) : '';
    const score = (id) =>
      neighborsOf(adj, id).reduce((s, n) => s + (placedById.has(n.id) ? n.weight : 0), 0);
    return score(idB) - score(idA);
  });

  let needsLocalReorder = false;
  let placeIndex = 0;

  while (pending.length > 0) {
    // 매 라운드: 이미 배치된 쪽에 연결이 있는 노드 우선, 없으면 맨 앞
    let pickAt = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const id = pending[i]?.data?.id != null ? String(pending[i].data.id) : '';
      const hasAnchor = neighborsOf(adj, id).some((n) => placedById.has(n.id));
      if (hasAnchor) {
        pickAt = i;
        break;
      }
    }
    const [node] = pending.splice(pickAt, 1);
    const nodeId = node?.data?.id != null ? String(node.data.id) : '';
    const newR = radiusOf(node, true);
    const label = node?.data?.label != null ? String(node.data.label) : '';
    const neighbors = neighborsOf(adj, nodeId);
    const anchorById = new Map();
    for (const n of neighbors) {
      const p = placedById.get(n.id);
      if (!p) continue;
      const prev = anchorById.get(n.id);
      if (!prev || n.weight > prev.weight) {
        anchorById.set(n.id, { ...p, weight: n.weight });
      }
    }
    const anchors = [...anchorById.values()];

    const preferredDist = anchors.length
      ? Math.max(
          PLACEMENT_IDEAL_EDGE,
          ...anchors.map((a) => newR + a.radius + padding + OVERLAP_RESOLVE.PUSH_EXTRA),
        )
      : Math.max(PLACEMENT_IDEAL_EDGE, newR + fallbackRadius + padding + OVERLAP_RESOLVE.PUSH_EXTRA);

    const centers = anchors.length
      ? [...anchors, centroidOf(anchors)]
      : [graphCentroid];

    const phase = placeIndex * 0.7;
    const occupied = buildOccupiedDiscs(placed);

    // 1) soft bounds 안 1차 링
    let candidates = generateRingCandidates(
      centers,
      preferredDist,
      phase,
      bounds,
      PLACEMENT_RING_MULTS,
      true,
    );
    let { bestFree } = pickBestFreeCandidate(
      candidates,
      newR,
      label,
      occupied,
      padding,
      anchors,
      graphCentroid,
      preferredDist,
    );

    // 2) 빈자리 없으면 외곽 링 (bounds 밖 허용) — 신규끼리 겹침 방지
    if (!bestFree) {
      needsLocalReorder = true;
      candidates = generateRingCandidates(
        centers,
        preferredDist,
        phase,
        bounds,
        [...PLACEMENT_RING_MULTS, ...PLACEMENT_EXPAND_RING_MULTS],
        false,
      );
      ({ bestFree } = pickBestFreeCandidate(
        candidates,
        newR,
        label,
        occupied,
        padding,
        anchors,
        graphCentroid,
        preferredDist,
      ));
    }

    // 3) 그래도 없으면 스파이럴로 비겹침 좌표 보장
    let x;
    let y;
    if (bestFree) {
      x = bestFree.x;
      y = bestFree.y;
    } else {
      needsLocalReorder = true;
      const spiral = findFreeSpiralPosition(
        centers,
        preferredDist,
        phase,
        newR,
        occupied,
        padding,
      );
      if (spiral) {
        x = spiral.x;
        y = spiral.y;
      } else {
        // 최후: 기존 노드와는 겹칠 수 있으나, 방금 배치한 신규끼리만이라도 분리
        const a = anchors[0] || graphCentroid;
        const angle = phase + placeIndex * PLACEMENT_GOLDEN_ANGLE;
        const sep = preferredDist + placeIndex * (newR * 2 + padding + OVERLAP_RESOLVE.PUSH_EXTRA);
        x = a.x + Math.cos(angle) * sep;
        y = a.y + Math.sin(angle) * sep;
      }
    }

    node.position = { x, y };
    const placedEntry = { id: nodeId, x, y, radius: newR, label };
    placed.push(placedEntry);
    if (nodeId) placedById.set(nodeId, placedEntry);
    placeIndex += 1;
  }

  return { nodes: newNodes, needsLocalReorder };
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
  if (relationError) {
    return { rechartsLineData: [], hasChartData: false, numericPointCount: 0 };
  }

  const pairs = [];
  const timelineHasValues =
    Array.isArray(timeline) &&
    timeline.some((value) => value === null || (typeof value === 'number' && !Number.isNaN(value)));

  if (timelineHasValues && Array.isArray(labels) && labels.length > 0) {
    const length = Math.min(labels.length, timeline.length);

    for (let i = 0; i < length; i += 1) {
      const label = labels[i];
      const value = timeline[i];
      const isChapter = isEdgeChapterLabel(label);
      const numericLabel = extractEdgeTimelineNumericLabel(label);

      if (
        isViewer &&
        Number.isFinite(effectiveEventColumns) &&
        Number.isFinite(numericLabel) &&
        numericLabel > effectiveEventColumns
      ) {
        continue;
      }

      // 관계 공백(null) — 축은 유지하고 선은 끊음
      if (value === null) {
        if (!Number.isFinite(numericLabel) && !isChapter) continue;
        pairs.push({
          value: null,
          label,
          numericLabel: Number.isFinite(numericLabel) ? numericLabel : null,
          isChapterAggregate: false,
          isGap: true,
        });
        continue;
      }

      if (typeof value !== 'number' || Number.isNaN(value)) {
        continue;
      }

      const normalizedValue = clampPositivity(value);

      if (
        isChapter &&
        timeline[i + 1] !== undefined &&
        typeof timeline[i + 1] === 'number' &&
        !Number.isNaN(timeline[i + 1])
      ) {
        pairs.push({
          value: normalizedValue,
          label,
          numericLabel: null,
          isChapterAggregate: true,
        });
        continue;
      }

      if (!Number.isFinite(numericLabel)) {
        continue;
      }

      pairs.push({
        value: normalizedValue,
        label,
        numericLabel,
        isChapterAggregate: false,
      });
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

  let active = alignedPairs.some((pair) => typeof pair.value === 'number');
  if (active && isViewer && Number.isFinite(displayEventNum) && displayEventNum > 0) {
    const hasCurrent = alignedPairs.some((pair) => isEdgePairCurrentEvent(pair, displayEventNum));
    if (!hasCurrent) {
      active = alignedPairs.some(
        (pair) =>
          !pair.isChapterAggregate &&
          Number.isFinite(pair.numericLabel) &&
          pair.numericLabel <= displayEventNum &&
          typeof pair.value === 'number',
      );
    }
  }

  if (!active) {
    return { rechartsLineData: [], hasChartData: false, numericPointCount: 0 };
  }

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
