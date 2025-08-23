// Utilities for normalizing and validating relation records

export function safeNum(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number(String(value));
}

export function normalizeRelation(raw) {
  // Accept various shapes (id1/id2 or source/target)
  const id1 = safeNum(raw.id1 ?? raw.source);
  const id2 = safeNum(raw.id2 ?? raw.target);
  const positivity = raw.positivity;
  const weight = raw.weight ?? 1;
  const count = raw.count;
  let relationArray = [];
  if (Array.isArray(raw.relation)) relationArray = raw.relation;
  else if (typeof raw.relation === "string") relationArray = [raw.relation];

  const label = relationArray[0] || (typeof raw.label === "string" ? raw.label : "");
  const explanation = raw.explanation;

  return { id1, id2, positivity, weight, count, relation: relationArray, label, explanation };
}

export function isValidRelation(normalized) {
  const { id1, id2 } = normalized;
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) return false;
  if (id1 === 0 || id2 === 0) return false;
  if (id1 === id2) return false;
  return true;
}

export function isSamePair(rel, a, b) {
  const r1 = safeNum(rel.id1);
  const r2 = safeNum(rel.id2);
  const s1 = safeNum(a);
  const s2 = safeNum(b);
  return (r1 === s1 && r2 === s2) || (r1 === s2 && r2 === s1);
}


