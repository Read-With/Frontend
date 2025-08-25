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

// [공통 스타일시트 생성 함수]
export const createGraphStylesheet = (nodeSize, edgeStyle, edgeLabelVisible, maxEdgeLabelLength = 15) => [
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
        return label.length > maxEdgeLabelLength ? label.slice(0, maxEdgeLabelLength) + '...' : label;
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


