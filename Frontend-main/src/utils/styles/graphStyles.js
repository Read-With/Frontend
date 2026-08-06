/** Cytoscape 스타일시트·레이아웃·노드 크기·긍정성 색/라벨 */

import { isValidNodeWeight } from '../graph/graphModel.js';
import { clampPositivity } from '../common/valueUtils';

// styles.js가 이 모듈을 re-export하므로 styles.js를 import하지 않는다.

export { clampPositivity };

export const STYLE_DURATION = {
  NORMAL: '0.3s',
  SLOW: '0.4s',
};

/** --rg-* / --brand-* 와 동일 hex (Cytoscape는 CSS var 미지원) */
export const BRAND_RGB = '62, 79, 47';

export function brandAlpha(alpha) {
  return `rgba(${BRAND_RGB}, ${alpha})`;
}

const RG = {
  brand: '#3E4F2F',
  brandTint: '#E8F0E4',
  brandTintSoft: '#F4F7F2',
  surface: '#ffffff',
  surfaceSlate: '#f8fafc',
  surfaceIndigo: '#f8f9fc',
  border: '#e5e7eb',
  borderSoft: '#e3e6ef',
  borderMuted: '#e2e8f0',
  textSubtle: '#6c757d',
  textBrand: '#2f3b2f',
  textMutedBrand: '#3d4f3d',
  textGray: '#374151',
  danger: '#ef4444',
  progressTrack: '#e8f0e8',
  surfaceGlass: 'rgba(255, 255, 255, 0.96)',
};

/** 그래프·UI 공유 팔레트 — relation-graph/tokens.css :root 와 동기화 */
export const GRAPH_COLORS = {
  backgroundLighter: RG.surfaceSlate,
  backgroundLight: RG.surfaceIndigo,
  border: RG.border,
  borderLight: RG.borderSoft,
  borderMuted: RG.borderMuted,
  primary: RG.brand,
  primaryLight: RG.brandTint,
  primaryTintSoft: RG.brandTintSoft,
  textSecondary: RG.textSubtle,
  white: RG.surface,
  nodeBackground: '#f3f5f3',
  nodeText: RG.textBrand,
  edgeText: RG.textMutedBrand,
  textGray: RG.textGray,
  progressTrack: RG.progressTrack,
  danger: RG.danger,
  surfaceGlass: RG.surfaceGlass,
};

export const NODE_SIZE_MIN = 30;
export const NODE_SIZE_MAX = 80;

const RESPONSIVE_NODE_SIZE_RANGES = Object.freeze([
  { maxWidth: 420, min: 22, max: 54 },
  { maxWidth: 768, min: 25, max: 64 },
  { maxWidth: 1200, min: NODE_SIZE_MIN, max: NODE_SIZE_MAX },
  { maxWidth: Number.POSITIVE_INFINITY, min: 34, max: 88 },
]);

/** 그래프 컨테이너 폭에 맞는 노드 지름 범위. 분할 뷰에서도 실제 캔버스 폭을 사용한다. */
export function getResponsiveNodeSizeRange(containerWidth) {
  const width = Number(containerWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return { min: NODE_SIZE_MIN, max: NODE_SIZE_MAX };
  }

  const range = RESPONSIVE_NODE_SIZE_RANGES.find(({ maxWidth }) => width <= maxWidth);
  return { min: range.min, max: range.max };
}

function computeWeightRange(weights) {
  const valid = (Array.isArray(weights) ? weights : []).filter(isValidNodeWeight);
  if (valid.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...valid), max: Math.max(...valid) };
}

function normalizeWeightToUnit(weight, minWeight, maxWeight) {
  if (!isValidNodeWeight(weight)) return 0;
  if (typeof minWeight !== 'number' || typeof maxWeight !== 'number') return 0;
  if (minWeight >= maxWeight) return 1;
  return (weight - minWeight) / (maxWeight - minWeight);
}

function calculateNodeSizeFromNormalized(normalized, minPx = NODE_SIZE_MIN, maxPx = NODE_SIZE_MAX) {
  const ratio = Math.max(0, Math.min(1, Number(normalized) || 0));
  return Math.round(minPx + ratio * (maxPx - minPx));
}

function calculateNodeSizeFromWeight(weight, weightMin, weightMax, minPx = NODE_SIZE_MIN, maxPx = NODE_SIZE_MAX) {
  return calculateNodeSizeFromNormalized(
    normalizeWeightToUnit(weight, weightMin, weightMax),
    minPx,
    maxPx,
  );
}

/** weight → 지름(px). weightsForRange로 min/max 정규화(없으면 MIN). */
export function estimateNodeSizePx(weight, weightsForRange = []) {
  const range = computeWeightRange(weightsForRange);
  return calculateNodeSizeFromWeight(weight, range.min, range.max);
}

export function applyNormalizedNodeSizes(
  cy,
  { scaledNodes = null, scale = 1, containerWidth = null } = {},
) {
  if (!cy) return;

  const allNodes = cy.nodes();
  if (!allNodes.length) return;

  const weightRange = computeWeightRange(allNodes.map((node) => node.data('weight')));
  const sizeRange = getResponsiveNodeSizeRange(containerWidth);
  const scaledIds =
    scale !== 1 && scaledNodes
      ? new Set(scaledNodes.map((node) => node.id()))
      : null;

  allNodes.forEach((node) => {
    const baseSize = calculateNodeSizeFromWeight(
      node.data('weight'),
      weightRange.min,
      weightRange.max,
      sizeRange.min,
      sizeRange.max,
    );
    const size = scaledIds?.has(node.id()) ? Math.round(baseSize * scale) : baseSize;
    node.style({ width: size, height: size });
  });
}

export const PRESET_LAYOUT = Object.freeze({
  name: 'preset',
  fit: false,
  animate: false,
});

/** 최초 로딩·전체 재배치용. animate:false로 동기 완료 */
export const COSE_BILKENT_LAYOUT = Object.freeze({
  name: 'cose-bilkent',
  fit: false,
  animate: false,
  randomize: false,
  nodeDimensionsIncludeLabels: true,
  nodeRepulsion: 4500,
  idealEdgeLength: 100,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 2500,
  tile: true,
  tilingPaddingVertical: 20,
  tilingPaddingHorizontal: 20,
});

/** @param {'graph'|'viewer'|'default'} [context='default'] viewer는 분할 밀도용 얇은 간선 */
export const getEdgeStyle = (context = 'default') => ({
  width: context === 'viewer' ? 3.5 : 5,
  fontSize: context === 'graph' ? 12 : 10,
});

/* ─── 긍정성 (−1~+1) 색·라벨 ─── */

/** 관계 존재 구간의 긍정도. 없/비정상이면 0. UI에서 null(정보 없음)과 구분할 때는 쓰지 말 것. */
export const finitePositivityOrZero = clampPositivity;

export const getRelationColor = (positivity) => {
  const value = clampPositivity(positivity);
  const normalized = (value + 1) / 2;
  const eased = 0.5 + 0.5 * Math.sin((normalized - 0.5) * Math.PI);
  const hue = 120 * eased;
  const saturation = 55 + 30 * Math.abs(value);
  const lightness = 52 - 10 * Math.abs(value);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

/**
 * 간선·태그 색(getRelationColor)과 동일한 −1→+1 스케일 그라데이션.
 * CSS `--rg-positivity-gradient` / 범례·스케일 바에 사용.
 */
export function getPositivityGradientCss({ steps = 9, angle = '90deg' } = {}) {
  const n = Math.max(2, Math.trunc(steps));
  const stops = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const pct = Math.round(t * 1000) / 10;
    stops.push(`${getRelationColor(t * 2 - 1)} ${pct}%`);
  }
  return `linear-gradient(${angle}, ${stops.join(', ')})`;
}

const relationStyleCache = new Map();

const POSITIVITY_LABELS = [
  { min: 0.6, text: '매우 긍정적' },
  { min: 0.2, text: '긍정적' },
  { min: -0.2, text: '중립적' },
  { min: -0.6, text: '부정적' },
];

function resolvePositivityLabel(value) {
  const match = POSITIVITY_LABELS.find((entry) => value >= entry.min);
  return match?.text ?? '매우 부정적';
}

function isMissingPositivity(positivity) {
  return positivity === undefined || positivity === null || Number.isNaN(Number(positivity));
}

/** @returns {{ color: string, text: string }} */
export function getRelationStyle(positivity) {
  if (isMissingPositivity(positivity)) {
    return { color: getRelationColor(0), text: '정보 없음' };
  }

  const value = clampPositivity(positivity);
  const key = Math.round(value * 100) / 100;

  if (relationStyleCache.has(key)) {
    return relationStyleCache.get(key);
  }

  const result = {
    color: getRelationColor(value),
    text: resolvePositivityLabel(value),
  };
  relationStyleCache.set(key, result);
  return result;
}

/** UI용: 색·라벨·퍼센트 (툴팁/관계 분석 모달) */
export function getPositivityDisplay(positivity) {
  const { color, text } = getRelationStyle(positivity);
  return {
    color,
    label: text,
    percent: isMissingPositivity(positivity) ? 0 : Math.round(clampPositivity(positivity) * 100),
  };
}

export function clearStyleCache() {
  relationStyleCache.clear();
}

/* ─── Cytoscape stylesheet ─── */

const EDGE_TEXT_STYLE = {
  color: GRAPH_COLORS.edgeText,
  'text-background-color': GRAPH_COLORS.white,
  'text-background-opacity': 0.85,
  'text-background-shape': 'roundrectangle',
  'text-background-padding': 2,
  'text-outline-color': GRAPH_COLORS.white,
  'text-outline-width': 2,
};

const baseNodeGraphStyle = {
  'background-color': GRAPH_COLORS.nodeBackground,
  'border-width': (ele) => (ele.data('isMainCharacter') ? 2 : 1),
  'border-color': GRAPH_COLORS.primary,
  'border-opacity': 1,
  width: NODE_SIZE_MIN,
  height: NODE_SIZE_MIN,
  shape: 'ellipse',
  label: 'data(label)',
  'text-valign': 'bottom',
  'text-halign': 'center',
  'font-size': 12,
  'font-weight': (ele) => (ele.data('isMainCharacter') ? 600 : 400),
  color: GRAPH_COLORS.nodeText,
  'text-margin-y': 2,
  'text-background-opacity': 0,
  'text-outline-color': GRAPH_COLORS.white,
  'text-outline-width': 2,
};

function nodePrimaryBorder(width, borderStyle = 'solid') {
  return {
    'border-color': GRAPH_COLORS.primary,
    'border-width': width,
    'border-opacity': 1,
    'border-style': borderStyle,
  };
}

function formatEdgeLabel(ele, edgeLabelVisible) {
  if (!edgeLabelVisible) return '';
  return ele.data('label') || '';
}

function edgePositivityColor(ele) {
  return getRelationColor(ele.data('positivity'));
}

export const createGraphStylesheet = (edgeStyle, edgeLabelVisible) => [
  { selector: 'node', style: baseNodeGraphStyle },
  {
    selector: 'node[image]',
    style: {
      'background-image': 'data(image)',
      'background-fit': 'cover',
      'background-clip': 'node',
    },
  },
  {
    selector: 'edge',
    style: {
      width: edgeStyle.width,
      'line-color': edgePositivityColor,
      'curve-style': 'bezier',
      label: (ele) => formatEdgeLabel(ele, edgeLabelVisible),
      'font-size': edgeStyle.fontSize,
      'text-rotation': 'autorotate',
      ...EDGE_TEXT_STYLE,
      opacity: 0.85,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': edgePositivityColor,
      'arrow-scale': 1.05,
      'source-arrow-shape': 'none',
      'overlay-padding': 8,
    },
  },
  {
    selector: 'edge[?bidirectional]',
    style: {
      'curve-style': 'straight',
      'target-arrow-shape': 'none',
      'source-arrow-shape': 'none',
    },
  },
  {
    // target-endpoint는 syncReciprocalPairJunctionOffsets bypass가 담당
    selector: 'edge[?reciprocalPair]',
    style: {
      'curve-style': 'straight',
    },
  },
  {
    selector: 'edge.highlighted',
    style: {
      width: 8,
      opacity: 1,
      'target-endpoint': 'outside-to-node',
      'z-index-compare': 'manual',
      'z-index': 9999,
    },
  },
  {
    selector: 'edge.highlighted[?reciprocalPair]',
    style: {
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'node.highlighted',
    style: nodePrimaryBorder(4),
  },
  {
    selector: 'node.kb-focus',
    style: nodePrimaryBorder(3, 'dashed'),
  },
  {
    selector: 'node.kb-focus.highlighted',
    style: {
      'border-width': 4,
      'border-style': 'solid',
    },
  },
  {
    selector: 'edge.kb-focus',
    style: {
      width: 6,
      opacity: 1,
      'line-style': 'dashed',
      'z-index-compare': 'manual',
      'z-index': 9998,
    },
  },
  {
    selector: 'node.faded',
    style: { opacity: 0.14, 'text-opacity': 0.1 },
  },
  {
    selector: 'edge.faded',
    style: { opacity: 0.1 },
  },
];
