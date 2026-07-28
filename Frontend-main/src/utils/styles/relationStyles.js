import { clampPositivity, getRelationColor } from './graphStyles';

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

/** @returns {{ color: string, text: string }} */
export function getRelationStyle(positivity) {
  if (positivity === undefined || positivity === null || Number.isNaN(positivity)) {
    return { color: getRelationColor(0), text: '정보 없음' };
  }

  const value = clampPositivity(positivity);
  const key = Math.round(value * 100) / 100;

  if (styleCache.has(key)) {
    return styleCache.get(key);
  }

  const result = {
    color: getRelationColor(value),
    text: resolvePositivityLabel(value),
  };
  styleCache.set(key, result);
  return result;
}

export function clearStyleCache() {
  styleCache.clear();
}
