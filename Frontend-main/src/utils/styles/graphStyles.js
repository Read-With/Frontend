export const DEFAULT_LAYOUT = {
  name: "preset",
  padding: 40,
  nodeRepulsion: 20000,
  idealEdgeLength: 300,
  animate: false,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 60,
  randomSeed: 42,
  componentSpacing: 300,
  boundingBox: undefined // 컨테이너 크기에 맞춰 자동 조정
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

// [와이드 레이아웃 설정]
export const getWideLayout = () => {
  return { name: 'preset' };
};

// [페이지 위치와 관계 값에 따라 그래프 스타일 조절]
export const getNodeSize = (context = 'default') => {
  if (typeof window === 'undefined' || !window.location) {
    return 40; // SSR 환경 고려
  }
  
  const path = window.location.pathname || '';
  if (path.includes('/user/viewer/')) return 40;
  if (path.includes('/user/graph/')) {
    return context === 'viewer' ? 45 : 40;
  }

  return context === 'viewer' ? 40 : 40;
};

export const getEdgeStyle = (context = 'default') => {
  if (typeof window === 'undefined' || !window.location) {
    return {
      width: 'data(weight)',
      fontSize: context === 'viewer' ? 8 : 9,
    };
  }
  
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

  return {
    width: 'data(weight)',
    fontSize: context === 'viewer' ? 8 : 9,
  };
};

// 통합된 관계 색상 계산 함수 (relationStyles.js와 중복 제거)
export const getRelationColor = (positivity) => {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
};

// [공통 스타일시트 생성 함수]
export const createGraphStylesheet = (nodeSize, edgeStyle, edgeLabelVisible, maxEdgeLabelLength = null) => [
  {
    selector: "node[image]",
    style: {
      "background-color": "#eee",
      "background-image": "data(image)",
      "background-fit": "cover",
      "background-clip": "node",
      "border-width": (ele) => (ele.data("main") ? 2 : 1),
      "border-color": "#5B7BA0",
      "border-opacity": 1,
      width: nodeSize,
      height: nodeSize,
      shape: "ellipse",
      label: "data(label)",
      "text-valign": "bottom",
      "text-halign": "center",
      "font-size": 12,
      "font-weight": (ele) => (ele.data("main") ? 700 : 400),
      color: "#444",
      "text-margin-y": 2,
      "text-background-color": "#fff",
      "text-background-opacity": 0.8,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 2,
    },
  },
  {
    selector: "edge",
    style: {
      width: edgeStyle.width,
      "line-color": (ele) => getRelationColor(ele.data("positivity")),
      "curve-style": "bezier",
      label: (ele) => {
        const label = ele.data('label') || '';
        if (!edgeLabelVisible) return '';
        return maxEdgeLabelLength && label.length > maxEdgeLabelLength ? label.slice(0, maxEdgeLabelLength) + '...' : label;
      },
      "font-size": edgeStyle.fontSize,
      "text-rotation": "autorotate",
      color: "#42506b",
      "text-background-color": "#fff",
      "text-background-opacity": 0.8,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 2,
      "text-outline-color": "#fff",
      "text-outline-width": 2,
      opacity: "mapData(weight, 0, 1, 0.55, 1)",
      "target-arrow-shape": "none",
    },
  },
  {
    selector: "node.cytoscape-node-appear",
    style: {
      "border-color": "#22c55e",
      "border-width": 16,
      "border-opacity": 1,
      "transition-property": "border-width, border-color, border-opacity",
      "transition-duration": "700ms",
    },
  },
  {
    selector: ".faded",
    style: {
      opacity: 0.25,
      "text-opacity": 0.12,
    },
  },
  {
    selector: ".highlighted",
    style: {
      "border-color": "#3b82f6",
      "border-width": 2,
      "border-opacity": 1,
      "border-style": "solid",
    },
  },
];

/**
 * 그래프 관련 공통 스타일
 */
export const graphStyles = {
  container: {
    width: '100%', 
    height: '100%', 
    position: 'relative' 
  },
  tooltipContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 9998,
  },
  tooltipStyle: {
    pointerEvents: 'auto' 
  },
  graphArea: {
    position: 'relative', 
    width: '100%', 
    height: '100%' 
  },

  graphPageContainer: {
    width: '100%', 
    height: '100vh', 
    overflow: 'hidden', 
    position: 'relative', 
    backgroundColor: '#f8fafc',
    display: 'flex',
    flexDirection: 'column'
  },
  graphPageInner: {
    position: 'relative', 
    width: '100%', 
    height: '100%',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  },
};

/**
 * GraphControls 컴포넌트 스타일
 */
export const graphControlsStyles = {
  input: {
    width: '180px',
    minWidth: '150px',
    maxWidth: '220px',
    border: '1px solid #e3e6ef',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#42506b',
    background: '#f8f9fc',
    transition: 'all 0.2s',
    outline: 'none',
    height: '28px',
    padding: '0 8px',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    width: '80px',
    height: '28px',
    padding: '0 12px',
    flexShrink: 0,
  },
  searchButton: {
    background: '#6C8EFF',
    color: '#fff',
  },
  resetButton: {
    background: '#f8f9fc',
    color: '#6c757d',
    border: '1px solid #e3e6ef',
  },
  form: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: '0',
    right: '0',
    background: '#fff',
    border: '1px solid #e3e6ef',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    zIndex: 1,
    maxHeight: '300px',
    overflowY: 'auto',
    marginTop: '4px',
    minWidth: '200px',
    width: '100%',
    display: 'block',
  },
  suggestionItem: (isSelected) => ({
    padding: '12px 14px',
    cursor: 'pointer',
    borderBottom: '1px solid #f1f3f4',
    background: isSelected ? '#f8f9fc' : '#fff',
    transition: 'background 0.2s',
  }),
  noResults: {
    padding: '16px 14px',
    textAlign: 'center',
    color: '#6c757d',
    fontSize: '12px',
    fontStyle: 'italic'
  },
  header: {
    padding: '8px 14px', 
    fontSize: '11px', 
    color: '#6c757d', 
    background: '#f8f9fc',
    borderBottom: '1px solid #e3e6ef',
    fontWeight: '500'
  },
  container: {
    position: 'relative', 
    display: 'inline-block',
    width: 'auto',
    minWidth: '200px',
    zIndex: 1000
  }
};