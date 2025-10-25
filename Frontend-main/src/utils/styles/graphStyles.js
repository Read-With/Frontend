// 순환 참조 방지를 위해 하드코딩된 값 사용
const COLORS = {
  backgroundLighter: '#f8fafc',
  border: '#e5e7eb',
  textPrimary: '#5C6F5C',
  backgroundLight: '#f8f9fc',
  primary: '#5C6F5C',
  white: '#ffffff',
  textSecondary: '#6c757d',
  borderLight: '#e3e6ef',
  nodeBackground: '#eee',
  nodeBorder: '#5B7BA0',
  nodeText: '#444',
  edgeText: '#42506b',
  successGreen: '#22c55e',
  highlightBlue: '#5C6F5C',
};

const ANIMATION_VALUES = {
  DURATION: {
    FAST: '0.18s',
    SLOW: '0.4s',
  }
};

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

export const getEdgeStyle = (context = 'default') => {
  const edgeWidth = 5;
  const isViewer = context === 'viewer';
  const isGraphPage = typeof window !== 'undefined' && window.location?.pathname?.includes('/user/graph/');
  
  return {
    width: edgeWidth,
    fontSize: isGraphPage ? 12 : (isViewer ? 10 : 10)
  };
};

// 통합된 관계 색상 계산 함수 (relationStyles.js와 중복 제거)
export const getRelationColor = (positivity) => {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
};

// 노드 크기 계산 함수 (기본 크기 10 × 가중치, 최소값 보장)
export const calculateNodeSize = (baseSize, weight) => {
  const defaultSize = 40;
  if (!weight || weight <= 0) return defaultSize;
  const calculatedSize = Math.round(10 * weight);
  return Math.max(calculatedSize, 30);
};

// [공통 스타일시트 생성 함수 - 가중치 기반 노드 크기만 사용]
export const createGraphStylesheet = (edgeStyle, edgeLabelVisible, maxEdgeLabelLength = null) => [
  {
    selector: "node[image]",
    style: {
      "background-color": COLORS.nodeBackground,
      "background-image": "data(image)",
      "background-fit": "cover",
      "background-clip": "node",
      "border-width": (ele) => (ele.data("main_character") ? 2 : 1),
      "border-color": COLORS.nodeBorder,
      "border-opacity": 1,
      width: (ele) => calculateNodeSize(8, ele.data("weight")),
      height: (ele) => calculateNodeSize(8, ele.data("weight")),
      shape: "ellipse",
      label: "data(label)",
      "text-valign": "bottom",
      "text-halign": "center",
      "font-size": 12,
      "font-weight": (ele) => (ele.data("main_character") ? 600 : 400),
      color: COLORS.nodeText,
      "text-margin-y": 2,
      "text-background-color": COLORS.white,
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
      color: COLORS.edgeText,
      "text-background-color": COLORS.white,
      "text-background-opacity": 0.85,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 2,
      "text-outline-color": COLORS.white,
      "text-outline-width": 2,
      opacity: 0.85,
      "target-arrow-shape": "none",
    },
  },
  {
    selector: "node.cytoscape-node-appear",
    style: {
      "border-color": COLORS.successGreen,
      "border-width": 16,
      "border-opacity": 1,
      "transition-property": "border-width, border-color, border-opacity",
      "transition-duration": ANIMATION_VALUES.DURATION.SLOW,
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
      "border-color": COLORS.highlightBlue,
      "border-width": 2,
      "border-opacity": 1,
      "border-style": "solid",
    },
  },
];

/**
 * 그래프 관련 공통 스타일
 */
export const getGraphStyles = () => ({
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
    backgroundColor: COLORS.backgroundLighter,
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
});

// 하위 호환성을 위한 별칭
export const graphStyles = getGraphStyles();

/**
 * GraphControls 컴포넌트 스타일
 */
export const getGraphControlsStyles = () => ({
  input: {
    width: '180px',
    minWidth: '150px',
    maxWidth: '220px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    fontSize: '14px',
    color: COLORS.textPrimary,
    background: COLORS.backgroundLight,
    transition: `all ${ANIMATION_VALUES.DURATION.FAST}`,
    outline: 'none',
    height: '32px',
    padding: '0 12px',
    fontWeight: '500',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: `all ${ANIMATION_VALUES.DURATION.FAST}`,
    width: '84px',
    height: '32px',
    padding: '0 12px',
    flexShrink: 0,
  },
  searchButton: {
    background: '#ffffff',
    color: COLORS.textPrimary,
    border: `1px solid ${COLORS.border}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    '&:hover': {
      background: '#f8f9fc',
      transform: 'translateY(-1px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }
  },
  resetButton: {
    background: '#ffffff',
    color: COLORS.textPrimary,
    border: `1px solid ${COLORS.border}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    '&:hover': {
      background: '#f8f9fc',
      transform: 'translateY(-1px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }
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
    background: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
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
    borderBottom: `1px solid ${COLORS.borderLight}`,
    background: isSelected ? COLORS.backgroundLight : COLORS.white,
    transition: `background ${ANIMATION_VALUES.DURATION.FAST}`,
  }),
  noResults: {
    padding: '16px 14px',
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: '12px',
    fontStyle: 'italic'
  },
  header: {
    padding: '8px 14px', 
    fontSize: '11px', 
    color: COLORS.textSecondary, 
    background: COLORS.backgroundLight,
    borderBottom: `1px solid ${COLORS.border}`,
    fontWeight: '700'
  },
  container: {
    position: 'relative', 
    display: 'inline-block',
    width: 'auto',
    minWidth: '200px',
    zIndex: 1000
  }
});

// 하위 호환성을 위한 별칭
export const graphControlsStyles = getGraphControlsStyles();
