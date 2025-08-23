// Search helpers for graph elements and suggestions

export function highlightParts(text, query) {
  if (!query || !text) return [text];
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return String(text).split(regex).filter(Boolean);
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSuggestions(elements, query) {
  const trimmed = (query ?? '').trim();
  if (trimmed.length < 2) return [];
  const searchLower = trimmed.toLowerCase();
  const characterNodes = Array.isArray(elements) ? elements.filter(el => !el.data.source) : [];

  const matches = characterNodes
    .filter(node => nodeMatchesQuery(node, searchLower))
    .map(node => {
      const label = node.data.label?.toLowerCase() || '';
      const names = node.data.names || [];
      const commonName = node.data.common_name?.toLowerCase() || '';
      let matchType = 'none';
      if (label.includes(searchLower)) matchType = 'label';
      else if (names.some(name => String(name).toLowerCase().includes(searchLower))) matchType = 'names';
      else if (commonName.includes(searchLower)) matchType = 'common_name';
      return {
        id: node.data.id,
        label: node.data.label,
        names: node.data.names || [],
        common_name: node.data.common_name,
        matchType
      };
    })
    .slice(0, 8);

  return matches;
}

export function nodeMatchesQuery(node, searchLower) {
  if (!node || !node.data) return false;
  const label = node.data.label?.toLowerCase() || '';
  const names = node.data.names || [];
  const commonName = node.data.common_name?.toLowerCase() || '';
  if (label.includes(searchLower)) return true;
  if (Array.isArray(names) && names.some(n => String(n).toLowerCase().includes(searchLower))) return true;
  if (commonName.includes(searchLower)) return true;
  return false;
}


