// cytoscape 레이아웃 공통 상수

export const DEFAULT_LAYOUT = {
  name: "preset",
  padding: 90,
  nodeRepulsion: 1800,
  idealEdgeLength: 120,
  animate: false,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 20,
  randomSeed: 42,
  gravity: 0.25,
  componentSpacing: 90
};

export const SEARCH_LAYOUT = {
  name: "cose",
  padding: 110,
  nodeRepulsion: 2500,
  idealEdgeLength: 135,
  animate: true,
  animationDuration: 800,
  fit: true,
  randomize: false,
  nodeOverlap: 0,
  avoidOverlap: true,
  nodeSeparation: 20,
  randomSeed: 42,
  gravity: 0.3,
  refresh: 20,
  componentSpacing: 110,
  coolingFactor: 0.95,
  initialTemp: 200
}; 