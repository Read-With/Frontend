// [그래프 레이아웃 설정]
export const DEFAULT_LAYOUT = {
  name: "preset",
  padding: 20,
  nodeRepulsion: 15000,
  idealEdgeLength: 400,
  animate: false,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 50,
  randomSeed: 42,
  componentSpacing: 400
};

export const SEARCH_LAYOUT = {
  name: "cose",
  padding: 5,
  nodeRepulsion: 2500,
  idealEdgeLength: 135,
  animate: true,
  animationDuration: 200,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 20,
  randomSeed: 42,
  gravity: 0.3,
  refresh: 10,
  componentSpacing: 110,
  coolingFactor: 0.8,
  initialTemp: 100
};

// [페이지 위치와 관계 값에 따라 그래프 스타일 조절]
export const getNodeSize = (context = 'default') => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    if (path.includes('/user/viewer/')) return 40;
    if (path.includes('/user/graph/')) {
      return context === 'viewer' ? 45 : 40;
    }
  }

  return context === 'viewer' ? 40 : 40;
};

export const getEdgeStyle = (context = 'default') => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    if (path.includes('/user/viewer/')) {
      return {
        width: 'data(weight)',
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

  return {
    width: 'data(weight)',
    fontSize: context === 'viewer' ? 8 : 9,
  };
};

export const getRelationColor = (positivity) => {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
};


