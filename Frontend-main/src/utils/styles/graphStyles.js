/** Cytoscape 스타일시트·레이아웃·노드 크기 유틸 */

import { isValidNodeWeight } from '../graph/graphModel.js';

// styles.js가 이 모듈을 re-export하므로 styles.js를 import하지 않는다.
// DURATION/공유 팔레트는 여기서 export하고 styles.js가 확장한다.

export const STYLE_DURATION = {
  FAST: '0.18s',
  NORMAL: '0.3s',
  SLOW: '0.4s',
};

/** 그래프·UI 공유 팔레트 — :root --rg-* 토큰과 동기화 (Cytoscape는 CSS var 미지원) */
export const GRAPH_COLORS = {
  backgroundLighter: '#f8fafc', // --rg-surface-slate
  backgroundLight: '#f8f9fc', // --rg-surface-indigo
  border: '#e5e7eb', // --rg-border
  borderLight: '#e3e6ef', // --rg-border-soft
  textPrimary: '#5C6F5C', // --rg-brand
  textSecondary: '#6c757d', // --rg-text-subtle
  primary: '#5C6F5C', // --rg-brand
  white: '#ffffff', // --rg-surface
  nodeBackground: '#f3f5f3',
  nodeBorder: '#5C6F5C', // --rg-brand
  nodeText: '#2f3b2f', // --rg-text-brand
  edgeText: '#3d4f3d',
  highlightBlue: '#5C6F5C', // --rg-brand
};

const COLORS = GRAPH_COLORS;
const DURATION = STYLE_DURATION;

const NODE_SIZE_MIN = 30;
const NODE_SIZE_MAX = 80;

const EDGE_TEXT_STYLE = {
  color: COLORS.edgeText,
  'text-background-color': COLORS.white,
  'text-background-opacity': 0.85,
  'text-background-shape': 'roundrectangle',
  'text-background-padding': 2,
  'text-outline-color': COLORS.white,
  'text-outline-width': 2,
};

const baseNodeGraphStyle = {
  'background-color': COLORS.nodeBackground,
  'border-width': (ele) => (ele.data('isMainCharacter') ? 2 : 1),
  'border-color': COLORS.nodeBorder,
  'border-opacity': 1,
  width: NODE_SIZE_MIN,
  height: NODE_SIZE_MIN,
  shape: 'ellipse',
  label: 'data(label)',
  'text-valign': 'bottom',
  'text-halign': 'center',
  'font-size': 12,
  'font-weight': (ele) => (ele.data('isMainCharacter') ? 600 : 400),
  color: COLORS.nodeText,
  'text-margin-y': 2,
  'text-background-opacity': 0,
  'text-outline-color': COLORS.white,
  'text-outline-width': 2,
};

export const PRESET_LAYOUT = Object.freeze({
  name: 'preset',
  fit: false,
  animate: false,
});

/** @param {'graph'|'viewer'|'default'} [context='default'] viewer는 분할 밀도용 얇은 간선 */
export const getEdgeStyle = (context = 'default') => ({
  width: context === 'viewer' ? 3.5 : 5,
  fontSize: context === 'graph' ? 12 : 10,
});

export function clampPositivity(positivity) {
  const value = Number(positivity);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export const getRelationColor = (positivity) => {
  const value = clampPositivity(positivity);
  const normalized = (value + 1) / 2;
  const eased = 0.5 + 0.5 * Math.sin((normalized - 0.5) * Math.PI);
  const hue = 120 * eased;
  const saturation = 55 + 30 * Math.abs(value);
  const lightness = 52 - 10 * Math.abs(value);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

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
    maxPx
  );
}

export function applyNormalizedNodeSizes(cy, { scaledNodes = null, scale = 1 } = {}) {
  if (!cy) return;

  const allNodes = cy.nodes();
  if (!allNodes.length) return;

  const weightRange = computeWeightRange(allNodes.map((node) => node.data('weight')));
  const scaledIds =
    scale !== 1 && scaledNodes
      ? new Set(scaledNodes.map((node) => node.id()))
      : null;

  allNodes.forEach((node) => {
    const baseSize = calculateNodeSizeFromWeight(
      node.data('weight'),
      weightRange.min,
      weightRange.max
    );
    const size = scaledIds?.has(node.id()) ? Math.round(baseSize * scale) : baseSize;
    node.style({ width: size, height: size });
  });
}

function formatEdgeLabel(ele, edgeLabelVisible, maxEdgeLabelLength) {
  const label = ele.data('label') || '';
  if (!edgeLabelVisible) return '';
  if (maxEdgeLabelLength && label.length > maxEdgeLabelLength) {
    return `${label.slice(0, maxEdgeLabelLength)}...`;
  }
  return label;
}

function edgePositivityColor(ele) {
  return getRelationColor(ele.data('positivity'));
}

export const createGraphStylesheet = (edgeStyle, edgeLabelVisible, maxEdgeLabelLength = null) => [
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
      label: (ele) => formatEdgeLabel(ele, edgeLabelVisible, maxEdgeLabelLength),
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
    selector: 'edge.cytoscape-edge-appear',
    style: {
      opacity: 0.35,
      'transition-property': 'opacity, width',
      'transition-duration': DURATION.SLOW,
    },
  },
  {
    selector: 'node.highlighted',
    style: {
      'border-color': COLORS.highlightBlue,
      'border-width': 4,
      'border-opacity': 1,
      'border-style': 'solid',
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

export const graphStyles = {
  container: { width: '100%', height: '100%', position: 'relative' },
  tooltipContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 9998,
  },
  graphArea: { position: 'relative', width: '100%', height: '100%' },
  graphPageContainer: {
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: COLORS.backgroundLighter,
    display: 'flex',
    flexDirection: 'column',
  },
  graphPageInner: {
    position: 'relative',
    width: '100%',
    height: '100%',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
};
