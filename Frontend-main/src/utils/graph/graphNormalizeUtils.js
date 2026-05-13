const API_PREFIX = 'api:';

export const toFiniteNumber = (value) => {
  if (value === undefined || value === null) return NaN;
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(converted) ? converted : NaN;
};

export const toPositiveNumber = (value) => {
  const parsed = toFiniteNumber(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const toPositiveInt = (value, fallback = null) => {
  const parsed = toFiniteNumber(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : fallback;
};

export const extractApiBookId = (folderKeyOrFilename) => {
  if (!folderKeyOrFilename) return null;
  if (typeof folderKeyOrFilename === 'number') {
    return toPositiveNumber(folderKeyOrFilename);
  }

  const key = String(folderKeyOrFilename).trim();
  if (!key) return null;
  return toPositiveNumber(key.startsWith(API_PREFIX) ? key.slice(API_PREFIX.length) : key);
};

export const toApiFolderKey = (folderKeyOrFilename) => {
  const bookId = extractApiBookId(folderKeyOrFilename);
  return bookId ? `${API_PREFIX}${bookId}` : null;
};

export const normalizeElementId = (element) => element?.id ?? element?.data?.id ?? null;

export const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

export const isGraphNodeElement = (element) =>
  Boolean(element?.data && element.data.id !== undefined && !isGraphEdgeElement(element));

export const sortElementsByDataId = (elements) => {
  if (!Array.isArray(elements)) return [];
  return [...elements].sort((a, b) =>
    String(a?.data?.id ?? '').localeCompare(String(b?.data?.id ?? ''))
  );
};

export const uniqueStrings = (values, { caseInsensitive = false } = {}) => {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const str = String(value ?? '').trim();
    const key = caseInsensitive ? str.toLowerCase() : str;
    if (!str || seen.has(key)) continue;
    seen.add(key);
    result.push(str);
  }
  return result;
};

export const getEventIndexFromObject = (value, fields = []) => {
  if (!value || typeof value !== 'object') return NaN;
  const nested = value.event && typeof value.event === 'object' ? value.event : null;
  const defaultFields = ['eventNum', 'eventIdx', 'resolvedEventIdx', 'idx', 'event_id', 'event_idx'];
  for (const field of [...fields, ...defaultFields]) {
    const direct = toFiniteNumber(value[field]);
    if (Number.isFinite(direct)) return direct;
    if (nested) {
      const nestedValue = toFiniteNumber(nested[field]);
      if (Number.isFinite(nestedValue)) return nestedValue;
    }
  }
  return NaN;
};
