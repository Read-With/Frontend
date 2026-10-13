/** 캔버스 배치: 노드 겹침 해소 + 신규 노드 앵커 기반 배치 (graphModel·graphCy에서 분리) */

import { errorUtils, asArray, toPositiveNumberOrNull } from '../common/valueUtils';
import { estimateNodeSizePx } from '../styles/graphStyles.js';

export function readNodeRadius(node, fallbackSize = 40) {
  try {
    const w = typeof node.outerWidth === 'function' ? node.outerWidth() : 0;
    const h = typeof node.outerHeight === 'function' ? node.outerHeight() : 0;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return Math.max(w, h) / 2;
    }
  } catch {
    /* ignore */
  }
  const size = typeof fallbackSize === 'number' && fallbackSize > 0 ? fallbackSize : 40;
  return size / 2;
}

/** detectAndResolveOverlap / 호출부 공용 기본값 */
export const OVERLAP_RESOLVE = Object.freeze({
  FALLBACK_NODE_SIZE: 40,
  PADDING: 8,
  MAX_ITERATIONS: 8,
  MAX_ITERATIONS_LIGHT: 3,
  /** 메인 반복 후에도 겹치면 추가 패스 */
  EXTRA_PASSES: 1,
  /** 양측·편측 밀어내기 공통 여유(px) */
  PUSH_EXTRA: 2,
  /** 이 깊이(px) 이하의 본체 겹침은 시각적 안정성을 위해 허용 */
  OVERLAP_TOLERANCE: 3,
  /** 이 깊이(px) 이상이면 완전한 여유 간격까지 강하게 분리 */
  SEVERE_OVERLAP: 12,
});

export const OVERLAP_PROFILES = Object.freeze({
  /** 최초 로딩·전체 재배치: 본체 겹침 허용 없음. 정착 상태이므로 여유 간격을 크게 둔다 */
  INITIAL: Object.freeze({ padding: 16, tolerance: 0, maxIterations: 16, extraPasses: 3 }),
  /** 동시 등장 신규 노드끼리: 본체 겹침 허용 없음. INITIAL과 동일한 여유로 배치 밀도를 맞춘다 */
  APPEAR: Object.freeze({ padding: 16, tolerance: 0, maxIterations: 12, extraPasses: 2 }),
  INCREMENTAL: Object.freeze({ padding: 6, tolerance: 3, maxIterations: 4, extraPasses: 1 }),
  RESIZE: Object.freeze({ padding: 5, tolerance: 3, maxIterations: 2, extraPasses: 0 }),
  /** 사용자 드래그: 본체 겹침 즉시 반응, 드래그 노드는 movableIds에서 제외해 자유 배치 유지 */
  USER_DRAG: Object.freeze({
    padding: 10,
    tolerance: 0,
    maxIterations: 8,
    extraPasses: 1,
    pushExtra: 2,
    severeOverlap: 1,
  }),
});

/**
 * spatial hash 인접 셀 쌍 (i < j) 순회. visit이 true를 반환하면 중단.
 * 쌍 배열을 만들지 않아 추가 메모리 O(n) (기존 O(n + 쌍 수)).
 * 버킷은 호출 시점 좌표 기준 — 순회 중 이동해도 같은 쌍 집합을 본다.
 */
function forEachNearbyPair(nodePositions, padding, visit) {
  let maxRadius = 1;
  for (const item of nodePositions) maxRadius = Math.max(maxRadius, item.radius);
  const cellSize = Math.max(1, maxRadius * 2 + padding);
  const cells = nodePositions.map((item) => [
    Math.floor(item.pos.x / cellSize),
    Math.floor(item.pos.y / cellSize),
  ]);
  const buckets = new Map();
  cells.forEach(([x, y], index) => {
    const key = `${x}:${y}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  for (let i = 0; i < cells.length; i += 1) {
    const [x, y] = cells[i];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const candidates = buckets.get(`${x + dx}:${y + dy}`);
        if (!candidates) continue;
        for (const j of candidates) {
          if (j > i && visit(i, j)) return true;
        }
      }
    }
  }
  return false;
}

function pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance = 0) {
  return forEachNearbyPair(nodePositions, padding, (i, j) => {
      const a = nodePositions[i];
      const b = nodePositions[j];
      const aMovable = !movableIdSet || movableIdSet.has(a.id);
      const bMovable = !movableIdSet || movableIdSet.has(b.id);
      if (!aMovable && !bMovable) return false;
      const minDistance = Math.max(0, a.radius + b.radius - tolerance);
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      return dx * dx + dy * dy < minDistance * minDistance;
  });
}

function runOverlapPushPasses(
  nodePositions,
  movableIdSet,
  padding,
  pushExtra,
  maxIterations,
  tolerance,
  severeOverlap,
) {
  let hasOverlap = false;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    let movedThisPass = false;

    forEachNearbyPair(nodePositions, padding, (i, j) => {
        const { node: node1, id: id1, pos: pos1, radius: r1 } = nodePositions[i];
        const { node: node2, id: id2, pos: pos2, radius: r2 } = nodePositions[j];

        const node1Movable = !movableIdSet || movableIdSet.has(id1);
        const node2Movable = !movableIdSet || movableIdSet.has(id2);
        if (!node1Movable && !node2Movable) return false;

        const bodyDistance = r1 + r2;
        const activationDistance = Math.max(0, bodyDistance - tolerance);
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared >= activationDistance * activationDistance) return false;

        hasOverlap = true;
        movedThisPass = true;
        const distance = Math.sqrt(distanceSquared);
        const penetration = bodyDistance - distance;
        const severe = penetration >= severeOverlap;
        const targetGap = severe ? padding : Math.min(padding, 2);
        const targetSeparation = bodyDistance + targetGap + (severe ? pushExtra : 0);
        const angle =
          distance < 1e-6
            ? (i + j) * 0.7
            : Math.atan2(dy, dx);
        const pushDistance = targetSeparation - distance;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (node1Movable && node2Movable) {
          const half = pushDistance * 0.5;
          const newPos1 = { x: pos1.x + cos * half, y: pos1.y + sin * half };
          const newPos2 = { x: pos2.x - cos * half, y: pos2.y - sin * half };
          node1.position(newPos1);
          node2.position(newPos2);
          nodePositions[i].pos = newPos1;
          nodePositions[j].pos = newPos2;
        } else if (node1Movable) {
          const newPos1 = {
            x: pos2.x + cos * targetSeparation,
            y: pos2.y + sin * targetSeparation,
          };
          node1.position(newPos1);
          nodePositions[i].pos = newPos1;
        } else {
          const newPos2 = {
            x: pos1.x - cos * targetSeparation,
            y: pos1.y - sin * targetSeparation,
          };
          node2.position(newPos2);
          nodePositions[j].pos = newPos2;
        }
        return false;
    });

    if (!movedThisPass) break;
  }
  return hasOverlap;
}

/** 숫자 옵션: allowZero면 >= 0, 아니면 > 0 일 때만 채택 */
const numOpt = (value, fallback, allowZero = true) =>
  typeof value === 'number' && (allowZero ? value >= 0 : value > 0) ? value : fallback;

function parseOverlapOptions(nodeSize, options = {}) {
  const movableIdSet = options.movableIds
    ? new Set([...options.movableIds].map(String).filter((id) => id !== ''))
    : null;
  return {
    nodeSize: numOpt(nodeSize, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, false),
    movableIdSet,
    padding: numOpt(options.padding, OVERLAP_RESOLVE.PADDING),
    tolerance: numOpt(options.tolerance, OVERLAP_RESOLVE.OVERLAP_TOLERANCE),
    pushExtra: numOpt(options.pushExtra, OVERLAP_RESOLVE.PUSH_EXTRA),
    severeOverlap: numOpt(options.severeOverlap, OVERLAP_RESOLVE.SEVERE_OVERLAP, false),
    maxIterations: numOpt(
      options.maxIterations,
      movableIdSet ? OVERLAP_RESOLVE.MAX_ITERATIONS : OVERLAP_RESOLVE.MAX_ITERATIONS_LIGHT,
      false,
    ),
    extraPasses: numOpt(options.extraPasses, OVERLAP_RESOLVE.EXTRA_PASSES),
  };
}

function buildOverlapNodePositions(cy, nodeSize) {
  // spatial hash로 O(n) 검사라 노드 수 상한 없이 전량 대상
  let nodes = cy.nodes(':visible').toArray();
  if (nodes.length === 0) nodes = cy.nodes().toArray();
  if (nodes.length < 2) return null;
  return nodes.map((node) => ({
    node,
    id: String(node.id()),
    pos: node.position(),
    radius: readNodeRadius(node, nodeSize),
  }));
}

/**
 * 노드 겹침 감지 및 자동 조정
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {number} [nodeSize=OVERLAP_RESOLVE.FALLBACK_NODE_SIZE] - 크기 읽기 실패 시 fallback (지름)
 * @param {Object} [options]
 * @param {Iterable<string>|null} [options.movableIds] - 지정 시 해당 노드만 이동(기존 노드 위치 유지)
 * @param {number} [options.maxIterations] - 밀어내기 반복 횟수
 * @param {number} [options.extraPasses] - 잔여 겹침 시 추가 반복
 * @param {number} [options.padding] - 반경 합에 더하는 여유 간격
 * @returns {boolean} 겹침이 있었는지 여부
 */
export function detectAndResolveOverlap(
  cy,
  nodeSize = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE,
  options = {},
) {
  if (!cy) {
    return false;
  }

  const {
    nodeSize: size,
    movableIdSet,
    padding,
    tolerance,
    pushExtra,
    severeOverlap,
    maxIterations,
    extraPasses,
  } = parseOverlapOptions(nodeSize, options);
  if (movableIdSet && movableIdSet.size === 0) {
    return false;
  }

  const nodePositions = buildOverlapNodePositions(cy, size);
  if (!nodePositions) {
    return false;
  }

  let hasOverlap = false;
  const runPasses = (iterations) =>
    runOverlapPushPasses(nodePositions, movableIdSet, padding, pushExtra, iterations, tolerance, severeOverlap);
  const apply = () => {
    hasOverlap = runPasses(maxIterations) || hasOverlap;
    if (pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance) && extraPasses > 0) {
      hasOverlap = runPasses(extraPasses) || hasOverlap;
    }
  };

  if (typeof cy.batch === 'function') {
    cy.batch(apply);
  } else {
    apply();
  }

  if (
    pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance)
    && import.meta.env?.DEV
  ) {
    errorUtils.logDebug('detectAndResolveOverlap', 'residual overlaps remain', {
      candidates: nodePositions.length,
    });
  }

  return hasOverlap;
}

/**
 * movableIds가 있으면 그중 하나 이상 포함된 쌍만 검사.
 * @returns {boolean} 겹치는 쌍이 있으면 true
 */
export function hasOverlappingNodes(
  cy,
  nodeSize = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE,
  options = {},
) {
  if (!cy) return false;
  const { movableIdSet, padding, tolerance, nodeSize: size } = parseOverlapOptions(nodeSize, options);
  if (movableIdSet && movableIdSet.size === 0) return false;

  const nodePositions = buildOverlapNodePositions(cy, size);
  if (!nodePositions) return false;
  return pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance);
}

/** seedIds 기준 undirected N-hop 이웃(시드 포함) */
export function collectNeighborhoodNodeIds(cy, seedIds, hops = 1) {
  const seeds = [...(seedIds || [])].map(String).filter(Boolean);
  const all = new Set(seeds);
  if (!cy || hops < 1 || seeds.length === 0) return all;

  let frontier = new Set(seeds);
  for (let h = 0; h < hops; h += 1) {
    const next = new Set();
    for (const id of frontier) {
      const node = cy.getElementById(id);
      if (!node || node.length === 0) continue;
      try {
        node.neighborhood('node').forEach((n) => {
          const nid = String(n.id());
          if (!all.has(nid)) {
            all.add(nid);
            next.add(nid);
          }
        });
      } catch {
        /* ignore */
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return all;
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
/** COSE_BILKENT_LAYOUT.idealEdgeLength와 맞춰, 전체 재배치와 증분 배치의 여유 간격을 일치시킨다 */
const PLACEMENT_IDEAL_EDGE = 130;
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

function addOccupiedDisc(occupied, p) {
  occupied.bodies.push(placementBodyDisc(p.x, p.y, p.radius));
  occupied.labels.push(placementLabelDisc(p.x, p.y, p.radius, p.label));
}

function buildOccupiedDiscs(placedList) {
  const occupied = { bodies: [], labels: [] };
  for (const p of placedList) addOccupiedDisc(occupied, p);
  return occupied;
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
  return toPositiveNumberOrNull(edge?.data?.weight ?? edge?.data?.count) ?? 1;
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
  (asArray(edges)).forEach((edge) => {
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

const nodeIdOf = (node) => (node?.data?.id != null ? String(node.data.id) : '');

/** 이웃 중 배치된 노드를 앵커로 (같은 id는 가중치 큰 쪽) */
function collectAnchors(neighbors, placedById) {
  const anchorById = new Map();
  for (const n of neighbors) {
    const p = placedById.get(n.id);
    if (!p) continue;
    const prev = anchorById.get(n.id);
    if (!prev || n.weight > prev.weight) {
      anchorById.set(n.id, { ...p, weight: n.weight });
    }
  }
  return [...anchorById.values()];
}

function preferredDistanceFor(anchors, newR, padding, fallbackRadius) {
  const gap = padding + OVERLAP_RESOLVE.PUSH_EXTRA;
  if (!anchors.length) return Math.max(PLACEMENT_IDEAL_EDGE, newR + fallbackRadius + gap);
  return Math.max(PLACEMENT_IDEAL_EDGE, ...anchors.map((a) => newR + a.radius + gap));
}

/**
 * 신규 노드 한 개 좌표. 1) soft bounds 안 링 → 2) 외곽 링 → 3) 스파이럴 → 4) 최후 분리 배치.
 * crowded: 1)에서 빈자리를 못 찾음 (주변 재배치 필요)
 */
function findPlacementPosition({
  centers,
  preferredDist,
  phase,
  bounds,
  newR,
  label,
  occupied,
  padding,
  anchors,
  graphCentroid,
  placeIndex,
}) {
  const pickFree = (candidates) => pickBestFreeCandidate(
    candidates,
    newR,
    label,
    occupied,
    padding,
    anchors,
    graphCentroid,
    preferredDist,
  ).bestFree;

  const inBounds = pickFree(
    generateRingCandidates(centers, preferredDist, phase, bounds, PLACEMENT_RING_MULTS, true),
  );
  if (inBounds) return { x: inBounds.x, y: inBounds.y, crowded: false };

  // 빈자리 없으면 외곽 링 (bounds 밖 허용) — 신규끼리 겹침 방지
  const outer = pickFree(
    generateRingCandidates(
      centers,
      preferredDist,
      phase,
      bounds,
      [...PLACEMENT_RING_MULTS, ...PLACEMENT_EXPAND_RING_MULTS],
      false,
    ),
  );
  if (outer) return { x: outer.x, y: outer.y, crowded: true };

  // 그래도 없으면 스파이럴로 비겹침 좌표 보장
  const spiral = findFreeSpiralPosition(centers, preferredDist, phase, newR, occupied, padding);
  if (spiral) return { x: spiral.x, y: spiral.y, crowded: true };

  // 최후: 기존 노드와는 겹칠 수 있으나, 방금 배치한 신규끼리만이라도 분리
  const a = anchors[0] || graphCentroid;
  const angle = phase + placeIndex * PLACEMENT_GOLDEN_ANGLE;
  const sep = preferredDist + placeIndex * (newR * 2 + padding + OVERLAP_RESOLVE.PUSH_EXTRA);
  return { x: a.x + Math.cos(angle) * sep, y: a.y + Math.sin(angle) * sep, crowded: true };
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
    ...(asArray(options.weightsForRange)),
    ...newNodes.map((n) => n?.data?.weight),
  ];

  const newNodeRadius = (node) =>
    (typeof node?.placementRadius === 'number' && node.placementRadius > 0
      ? node.placementRadius
      : estimateNodeSizePx(node?.data?.weight, weightsForRange) / 2);

  const placed = placedPositions.map((pos) => ({
    id: pos?.id != null ? String(pos.id) : '',
    x: pos.x,
    y: pos.y,
    radius: typeof pos?.radius === 'number' && pos.radius > 0 ? pos.radius : fallbackRadius,
    label: pos?.label != null ? String(pos.label) : '',
  }));
  const placedById = new Map(placed.filter((p) => p.id).map((p) => [p.id, p]));
  const adj = buildAdjacencyFromEdges(edges);
  const bounds = buildSoftBounds(placed, containerWidth || 800, containerHeight || 600);
  const graphCentroid = centroidOf(placed.length ? placed : [{ x: 0, y: 0, radius: fallbackRadius }]);

  // 기존 그래프와 연결이 많은 노드부터 배치
  // 점수는 정렬 전 1회만 계산 (비교마다 이웃 순회하지 않음)
  const anchorScore = (id) =>
    neighborsOf(adj, id).reduce((sum, n) => sum + (placedById.has(n.id) ? n.weight : 0), 0);
  const scoreByNode = new Map(newNodes.map((node) => [node, anchorScore(nodeIdOf(node))]));
  const pending = [...newNodes].sort((a, b) => scoreByNode.get(b) - scoreByNode.get(a));

  // 배치된 이웃이 있는 노드 id — 배치할 때마다 이웃만 증분 갱신 (라운드마다 이웃 재순회 없음)
  const connected = new Set();
  const markNeighborsConnected = (id) => adj.get(id)?.forEach((_w, nid) => connected.add(nid));
  placedById.forEach((_p, id) => markNeighborsConnected(id));

  let needsLocalReorder = false;
  let placeIndex = 0;
  // 배치마다 전체 재구성하지 않고 증분 추가 (라운드당 O(P) 할당 제거)
  const occupied = buildOccupiedDiscs(placed);

  while (pending.length > 0) {
    // 매 라운드: 이미 배치된 쪽에 연결이 있는 노드 우선, 없으면 맨 앞
    const nextIdx = pending.findIndex((n) => connected.has(nodeIdOf(n)));
    const [node] = pending.splice(nextIdx < 0 ? 0 : nextIdx, 1);
    const nodeId = nodeIdOf(node);
    const newR = newNodeRadius(node);
    const label = node?.data?.label != null ? String(node.data.label) : '';
    const anchors = collectAnchors(neighborsOf(adj, nodeId), placedById);
    const preferredDist = preferredDistanceFor(anchors, newR, padding, fallbackRadius);

    const { x, y, crowded } = findPlacementPosition({
      centers: anchors.length ? [...anchors, centroidOf(anchors)] : [graphCentroid],
      preferredDist,
      phase: placeIndex * 0.7,
      bounds,
      newR,
      label,
      occupied,
      padding,
      anchors,
      graphCentroid,
      placeIndex,
    });
    if (crowded) needsLocalReorder = true;

    node.position = { x, y };
    const placedEntry = { id: nodeId, x, y, radius: newR, label };
    placed.push(placedEntry);
    addOccupiedDisc(occupied, placedEntry);
    if (nodeId) {
      placedById.set(nodeId, placedEntry);
      markNeighborsConnected(nodeId);
    }
    placeIndex += 1;
  }

  return { nodes: newNodes, needsLocalReorder };
}
