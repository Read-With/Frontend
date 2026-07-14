import { clampPositivity, getRelationColor } from './graphStyles';
import { COLORS, ANIMATION_VALUES } from './styles';

const styleCache = new Map();

const POSITIVITY_THRESHOLDS = {
  veryPositive: 0.6,
  positive: 0.2,
  neutral: -0.2,
  negative: -0.6,
};

const POSITIVITY_LABELS = [
  { min: POSITIVITY_THRESHOLDS.veryPositive, text: '매우 긍정적' },
  { min: POSITIVITY_THRESHOLDS.positive, text: '긍정적' },
  { min: POSITIVITY_THRESHOLDS.neutral, text: '중립적' },
  { min: POSITIVITY_THRESHOLDS.negative, text: '부정적' },
];

function resolvePositivityLabel(value) {
  const match = POSITIVITY_LABELS.find((entry) => value >= entry.min);
  return match?.text ?? '매우 부정적';
}

function calculateStyle(positivity) {
  const value = clampPositivity(positivity);
  return {
    color: getRelationColor(value),
    text: resolvePositivityLabel(value),
  };
}

export function getRelationStyle(positivity) {
  const key = Math.round(clampPositivity(positivity) * 100) / 100;

  if (styleCache.has(key)) {
    return styleCache.get(key);
  }

  const result = calculateStyle(positivity);
  styleCache.set(key, result);
  return result;
}

export function getPositivityColor(positivity) {
  return getRelationStyle(positivity).color;
}

export function getPositivityLabel(positivity) {
  if (positivity === undefined || positivity === null || Number.isNaN(positivity)) {
    return '정보 없음';
  }
  return getRelationStyle(positivity).text;
}

const tooltipFlipFace = {
  backfaceVisibility: 'hidden',
  position: 'absolute',
  width: '100%',
  height: 360,
  minHeight: 360,
  top: 0,
  left: 0,
};

export const tooltipStyles = {
  container: {
    position: 'fixed',
    zIndex: 99999,
    width: '500px',
    perspective: '1200px',
  },
  flipInner: {
    position: 'relative',
    width: '100%',
    minHeight: 360,
    height: 360,
    transition: `transform ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
    transformStyle: 'preserve-3d',
  },
  front: tooltipFlipFace,
  back: {
    ...tooltipFlipFace,
    transform: 'rotateY(180deg)',
  },
  header: {
    background: COLORS.white,
    borderBottom: 'none',
    padding: '0.75rem',
  },
  relationTag: {
    background: COLORS.borderLight,
    color: COLORS.textPrimary,
    borderRadius: '0.5rem',
    padding: '0.25rem 0.75rem',
    fontSize: '0.8125rem',
    fontWeight: 500,
    display: 'inline-block',
    lineHeight: 1.2,
  },
  progressBar: {
    width: 80,
    height: 20,
    borderRadius: '0.375rem',
    opacity: 1,
    transition: `background ${ANIMATION_VALUES.DURATION.NORMAL}`,
    border: `1.5px solid ${COLORS.border}`,
    boxSizing: 'border-box',
    marginBottom: 0,
  },
};

export function clearStyleCache() {
  styleCache.clear();
}
