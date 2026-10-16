/** 캔버스 배치(겹침 해소·앵커 배치) + 뷰포트(툴팁 좌표·fit/zoom·선택 포커스) */

import { errorUtils, asArray, toPositiveNumberOrNull } from '../common/valueUtils';
import { estimateNodeSizePx } from './graphStyles';
import { GRAPH_ZOOM } from './graphCore';

/* ─── 캔버스 배치: 노드 겹침 해소 + 신규 노드 앵커 기반 배치 ─── */

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

// 라벨 원 반경이 최대 72px라 셀이 작으면 조회 상자가 셀 수십 개로 커짐 → 반경 합 정도 크기로
const PLACEMENT_GRID_CELL = 128;

/**
 * 원 격자 색인. 후보 원 a와 겹칠 수 있는 원 b는 중심 거리 < a.r + b.r + pad 이므로,
 * 반경 (a.r + pad + 색인 내 최대 반경) 상자 안의 셀만 보면 빠짐없이 찾는다 (정확한 판정은 discsOverlap).
 * 배치된 노드 전부와 비교하던 O(P)를 주변 셀의 원 수로 줄임 — 결과는 동일
 */
function createDiscGrid() {
  const columns = new Map(); // gx → (gy → disc[]) 숫자 키 (문자열 키 생성 비용 회피)
  let maxRadius = 0;
  const cellOf = (v) => Math.floor(v / PLACEMENT_GRID_CELL);
  return {
    add(disc) {
      if (disc.radius > maxRadius) maxRadius = disc.radius; // NaN이 최대 반경을 오염시키지 않도록
      const gx = cellOf(disc.x);
      const gy = cellOf(disc.y);
      let column = columns.get(gx);
      if (!column) columns.set(gx, (column = new Map()));
      const bucket = column.get(gy);
      if (bucket) bucket.push(disc);
      else column.set(gy, [disc]);
    },
    /** probe와 겹칠 수 있는 원마다 visit(disc). visit이 true를 반환하면 중단하고 true 반환 */
    some(probe, padding, visit) {
      const reach = probe.radius + padding + maxRadius;
      const x1 = cellOf(probe.x + reach);
      const y0 = cellOf(probe.y - reach);
      const y1 = cellOf(probe.y + reach);
      for (let gx = cellOf(probe.x - reach); gx <= x1; gx += 1) {
        const column = columns.get(gx);
        if (!column) continue;
        for (let gy = y0; gy <= y1; gy += 1) {
          const bucket = column.get(gy);
          if (!bucket) continue;
          for (const disc of bucket) {
            if (visit(disc)) return true;
          }
        }
      }
      return false;
    },
  };
}

function countOverlaps(grid, probe, padding) {
  let n = 0;
  grid.some(probe, padding, (o) => {
    if (discsOverlap(probe, o, padding)) n += 1;
    return false;
  });
  return n;
}

function addOccupiedDisc(occupied, p) {
  occupied.bodies.add(placementBodyDisc(p.x, p.y, p.radius));
  occupied.labels.add(placementLabelDisc(p.x, p.y, p.radius, p.label));
}

function buildOccupiedDiscs(placedList) {
  const occupied = { bodies: createDiscGrid(), labels: createDiscGrid() };
  for (const p of placedList) addOccupiedDisc(occupied, p);
  return occupied;
}

/** body-body만 hard collision */
function candidateBodyCollides(cx, cy, newR, occupied, padding) {
  const body = placementBodyDisc(cx, cy, newR);
  return occupied.bodies.some(body, padding, (o) => discsOverlap(body, o, padding));
}

/** body↔label / label↔label soft penalty */
function candidateLabelPenalty(cx, cy, newR, label, occupied, padding) {
  const body = placementBodyDisc(cx, cy, newR);
  const lab = placementLabelDisc(cx, cy, newR, label);
  const softPad = padding * 0.5;
  const hits =
    countOverlaps(occupied.labels, body, softPad)
    + countOverlaps(occupied.bodies, lab, softPad)
    + countOverlaps(occupied.labels, lab, softPad) * 0.5;
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

/* ─── 그래프 뷰포트: 툴팁 좌표·캔버스 경계·fit/zoom·선택 포커스 ─── */


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
function constrainToWindow(x, y, elementWidth, elementHeight) {
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
