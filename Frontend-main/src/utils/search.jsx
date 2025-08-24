// [ 통합 검색/필터링 유틸리티 ]
// 1. highlightParts → 텍스트에서 검색어 부분만 분리해 하이라이트 가능하게 함
// 2. escapeRegExp → 검색어에 특수문자가 있어도 정규식 안전 처리
// 3. buildSuggestions → 입력된 검색어와 관련된 노드(인물 등)를 찾아 최대 8개 추천 리스트 생성
// 4. nodeMatchesQuery → 노드가 검색어와 매칭되는지 확인
// 5. filterGraphElements → 그래프 요소 필터링 및 연결 관계 처리

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
  return (
    label.includes(searchLower) ||
    names.some(name => String(name).toLowerCase().includes(searchLower)) ||
    commonName.includes(searchLower)
  );
}

export function filterGraphElements(elements, searchTerm) {
  if (!searchTerm || searchTerm.trim().length < 2) return elements;
  const searchLower = searchTerm.toLowerCase();
  const matchingNodes = elements.filter(el => !el.data.source && nodeMatchesQuery(el, searchLower));
  const matchingNodeIds = new Set(matchingNodes.map(node => node.data.id));
  const connectedEdges = elements.filter(el => 
    el.data.source && 
    (matchingNodeIds.has(el.data.source) || matchingNodeIds.has(el.data.target))
  );
  return [...matchingNodes, ...connectedEdges];
}

/**
 * 텍스트 하이라이트 렌더링 함수
 * @param {string} text - 원본 텍스트
 * @param {string} term - 검색어
 * @param {Object} highlightStyle - 하이라이트 스타일 (기본값: { fontWeight: 'bold', color: '#6C8EFF' })
 * @returns {Array} React 엘리먼트 배열
 */
export function highlightText(text, term, highlightStyle = { fontWeight: 'bold', color: '#6C8EFF' }) {
  const parts = highlightParts(text, term);
  return parts.map((part, index) =>
    part.toLowerCase && term && part.toLowerCase() === term.toLowerCase() ? (
      <span key={index} style={highlightStyle}>{part}</span>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}


