// 그래프 검색/필터링 공통 유틸
// elements: 노드/엣지 배열, search: 검색어
export function filterGraphElements(elements, search) {
  let filteredElements = elements;
  let fitNodeIds = null;
  if (search) {
    // 1. 검색어 포함 노드 찾기
    const matchedNodes = elements.filter(
      (el) =>
        !el.data.source &&
        (el.data.label?.toLowerCase().includes(search.toLowerCase()) ||
          (el.data.names &&
            el.data.names.some((n) =>
              n.toLowerCase().includes(search.toLowerCase())
            )))
    );
    if (matchedNodes.length > 0) {
      // 2. 관련 엣지 찾기
      const matchedNodeIds = matchedNodes.map((node) => node.data.id);
      const relatedEdges = elements.filter(
        (el) =>
          el.data.source &&
          (matchedNodeIds.includes(el.data.source) ||
            matchedNodeIds.includes(el.data.target))
      );
      // 3. 관련 노드 ID 수집
      const relatedNodeIds = [
        ...new Set(
          relatedEdges.flatMap((e) => [e.data.source, e.data.target])
        ),
      ];
      // 4. 관련 노드 찾기
      const relatedNodes = elements.filter(
        (el) =>
          !el.data.source &&
          (matchedNodeIds.includes(el.data.id) || relatedNodeIds.includes(el.data.id))
      );
      filteredElements = [...relatedNodes, ...relatedEdges];
      fitNodeIds = [...matchedNodeIds, ...relatedNodeIds];
    } else {
      filteredElements = [];
      fitNodeIds = [];
    }
  } else {
    filteredElements = elements;
  }
  return { filteredElements, fitNodeIds };
} 