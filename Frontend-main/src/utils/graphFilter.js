// 그래프 검색/필터링 공통 유틸
// elements: 노드/엣지 배열, search: 검색어, currentEvent: 현재 이벤트 (id1, id2 포함)
export function filterGraphElements(elements, search, currentEvent = null) {
  let filteredElements = elements;
  let fitNodeIds = null;
  
  console.log('graphFilter Debug:', {
    search,
    currentEvent,
    totalElements: elements.length,
    nodesCount: elements.filter(el => !el.data.source).length,
    allElements: elements.map(el => ({ 
      id: el.data.id, 
      label: el.data.label, 
      source: el.data.source,
      target: el.data.target,
      hasSource: !!el.data.source
    }))
  });
  
  if (search) {
    // 현재 이벤트의 id1, id2에 해당하는 노드들만 검색 대상으로 제한
    let searchableNodes = elements.filter(el => !el.data.source);
    
    console.log('Initial searchableNodes:', searchableNodes.map(n => ({ id: n.data.id, label: n.data.label })));
    
    if (currentEvent && currentEvent.id1 && currentEvent.id2) {
      // id1, id2에 해당하는 노드들만 필터링
      searchableNodes = searchableNodes.filter(node => 
        node.data.id === currentEvent.id1 || node.data.id === currentEvent.id2
      );
      console.log('Filtered searchableNodes (by currentEvent):', searchableNodes.map(n => ({ id: n.data.id, label: n.data.label })));
    }
    
    // 1. 검색어 포함 노드 찾기 (제한된 노드들 중에서)
    const matchedNodes = searchableNodes.filter(
      (el) => {
        const searchLower = search.toLowerCase();
        
        // label에서 검색
        if (el.data.label?.toLowerCase().includes(searchLower)) {
          return true;
        }
        
        // names 배열에서 검색
        if (el.data.names && Array.isArray(el.data.names)) {
          if (el.data.names.some(name => name.toLowerCase().includes(searchLower))) {
            return true;
          }
        }
        
        // common_name에서 검색
        if (el.data.common_name && el.data.common_name.toLowerCase().includes(searchLower)) {
          return true;
        }
        
        return false;
      }
    );
    
    if (matchedNodes.length > 0) {
      // 2. 검색된 노드와 직접 연결된 엣지만 찾기
      const matchedNodeIds = matchedNodes.map((node) => node.data.id);
      const directlyConnectedEdges = elements.filter(
        (el) =>
          el.data.source &&
          (matchedNodeIds.includes(el.data.source) ||
            matchedNodeIds.includes(el.data.target))
      );
      
      // 3. 직접 연결된 노드들만 찾기 (검색된 노드 + 연결된 노드)
      const connectedNodeIds = new Set(matchedNodeIds);
      directlyConnectedEdges.forEach(edge => {
        connectedNodeIds.add(edge.data.source);
        connectedNodeIds.add(edge.data.target);
      });
      
      const connectedNodes = elements.filter(
        (el) =>
          !el.data.source &&
          connectedNodeIds.has(el.data.id)
      );
      
      // 4. 검색된 노드와 직접 연결된 요소들만 반환
      filteredElements = [...connectedNodes, ...directlyConnectedEdges];
      fitNodeIds = Array.from(connectedNodeIds);
    } else {
      filteredElements = [];
      fitNodeIds = [];
    }
  } else {
    filteredElements = elements;
  }
  return { filteredElements, fitNodeIds };
} 