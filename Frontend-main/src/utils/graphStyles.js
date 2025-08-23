// 공용 그래프 스타일 유틸
// 기능 유지: 컴포넌트별 기존 동작 보존을 위해 context 인자를 추가
// context: 'viewer' | 'graph' | 'default'

export const getNodeSize = (context = 'default') => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    if (path.includes('/user/viewer/')) return 40;
    if (path.includes('/user/graph/')) {
      // 기존 동작 보존: RelationGraph.jsx(viewer 컨텍스트)에서는 45, RelationGraphMain.jsx(graph 컨텍스트)에서는 40
      return context === 'viewer' ? 45 : 40;
    }
  }
  // 기본값: 각 컨텍스트의 기존 기본값을 따름
  return context === 'viewer' ? 40 : 40;
};

export const getEdgeStyle = (context = 'default') => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    if (path.includes('/user/viewer/')) {
      return {
        width: 'data(weight)',
        // 기존 동작 보존: RelationGraph.jsx(viewer) 8, RelationGraphMain.jsx(graph) 9
        fontSize: context === 'viewer' ? 8 : 9,
      };
    }
    if (path.includes('/user/graph/')) {
      return {
        width: 'data(weight)',
        fontSize: 11,
      };
    }
  }
  // 기본값: 각 컨텍스트의 기존 기본값을 따름
  return {
    width: 'data(weight)',
    fontSize: context === 'viewer' ? 8 : 9,
  };
};

export const getRelationColor = (positivity) => {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
};


