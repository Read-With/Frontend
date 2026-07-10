/** Cytoscape 스타일시트·레이아웃·노드 크기 유틸 */

import { isValidNodeWeight } from '../graph/characterUtils.js';

// styles.js가 graphStyles를 re-export하므로 styles.js를 import하지 않는다.
const DURATION = { FAST: '0.18s', SLOW: '0.4s' };

const COLORS = {
  backgroundLighter: '#f8fafc',
  backgroundLight: '#f8f9fc',
  border: '#e5e7eb',
  borderLight: '#e3e6ef',
  textPrimary: '#5C6F5C',
  textSecondary: '#6c757d',
  primary: '#5C6F5C',
  white: '#ffffff',
  nodeBackground: '#eee',
  nodeBorder: '#5B7BA0',
  nodeText: '#444',
  edgeText: '#42506b',
  successGreen: '#22c55e',
  highlightBlue: '#5C6F5C',
};

export const NODE_SIZE_MIN = 30;
export const NODE_SIZE_MAX = 80;

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

const graphControlActionButtonStyle = {
  background: COLORS.white,
  color: COLORS.textPrimary,
  border: `1px solid ${COLORS.border}`,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  '&:hover': {
    background: COLORS.backgroundLight,
    transform: 'translateY(-1px)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
};

export const getWideLayout = () => ({ name: 'preset' });

export const getEdgeStyle = (_context = 'default') => {
  const isGraphPage =
    typeof window !== 'undefined' && window.location?.pathname?.includes('/user/graph/');

  return {
    width: 5,
    fontSize: isGraphPage ? 12 : 10,
  };
};

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

export function computeWeightRange(weights) {
  const valid = (Array.isArray(weights) ? weights : []).filter(isValidNodeWeight);
  if (valid.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...valid), max: Math.max(...valid) };
}

export function normalizeWeightToUnit(weight, minWeight, maxWeight) {
  if (!isValidNodeWeight(weight)) return 0;
  if (typeof minWeight !== 'number' || typeof maxWeight !== 'number') return 0;
  if (minWeight >= maxWeight) return 1;
  return (weight - minWeight) / (maxWeight - minWeight);
}

export function calculateNodeSizeFromNormalized(
  normalized,
  minPx = NODE_SIZE_MIN,
  maxPx = NODE_SIZE_MAX
) {
  const ratio = Math.max(0, Math.min(1, Number(normalized) || 0));
  return Math.round(minPx + ratio * (maxPx - minPx));
}

export function calculateNodeSizeFromWeight(
  weight,
  weightMin,
  weightMax,
  minPx = NODE_SIZE_MIN,
  maxPx = NODE_SIZE_MAX
) {
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

function reciprocalPairTargetEndpoint(ele) {
  try {
    const ox = ele.data('_rjOx');
    const oy = ele.data('_rjOy');
    if (typeof ox === 'number' && typeof oy === 'number' && Number.isFinite(ox) && Number.isFinite(oy)) {
      return `${ox} ${oy}`;
    }

    const source = ele.source();
    const target = ele.target();
    if (!source || !target || source.empty?.() || target.empty?.()) return undefined;

    const sx = source.position('x');
    const sy = source.position('y');
    const tx = target.position('x');
    const ty = target.position('y');
    return `${(sx - tx) / 2} ${(sy - ty) / 2}`;
  } catch {
    return undefined;
  }
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
    selector: 'edge[?reciprocalPair]',
    style: {
      'curve-style': 'straight',
      'target-endpoint': reciprocalPairTargetEndpoint,
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
    selector: 'node.cytoscape-node-appear',
    style: {
      'border-color': COLORS.successGreen,
      'border-width': 16,
      'border-opacity': 1,
      'transition-property': 'border-width, border-color, border-opacity',
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
  tooltipStyle: { pointerEvents: 'auto' },
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

export const graphControlsStyles = {
  input: {
    width: '220px',
    minWidth: '220px',
    maxWidth: '220px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    fontSize: '15px',
    color: COLORS.textPrimary,
    background: COLORS.backgroundLight,
    transition: `all ${DURATION.FAST}`,
    outline: 'none',
    height: '36px',
    padding: '0 12px',
    fontWeight: '500',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: `all ${DURATION.FAST}`,
    width: '88px',
    height: '36px',
    padding: '0 12px',
    flexShrink: 0,
  },
  searchButton: graphControlActionButtonStyle,
  resetButton: graphControlActionButtonStyle,
  form: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: '0',
    right: '0',
    background: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
    zIndex: 1,
    maxHeight: '300px',
    overflowY: 'auto',
    marginTop: '4px',
    minWidth: '200px',
    width: '100%',
    display: 'block',
  },
  suggestionItem: (isSelected) => ({
    padding: '12px 14px',
    cursor: 'pointer',
    borderBottom: `1px solid ${COLORS.borderLight}`,
    background: isSelected ? COLORS.backgroundLight : COLORS.white,
    transition: `background ${DURATION.FAST}`,
  }),
  noResults: {
    padding: '16px 14px',
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: '12px',
    fontStyle: 'italic',
  },
  header: {
    padding: '8px 14px',
    fontSize: '11px',
    color: COLORS.textSecondary,
    background: COLORS.backgroundLight,
    borderBottom: `1px solid ${COLORS.border}`,
    fontWeight: '700',
  },
  container: {
    position: 'relative',
    display: 'inline-block',
    width: 'auto',
    minWidth: '200px',
    zIndex: 1000,
  },
};
