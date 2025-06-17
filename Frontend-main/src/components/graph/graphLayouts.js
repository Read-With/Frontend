// cytoscape 레이아웃 공통 상수

export const DEFAULT_LAYOUT = {
  name: "preset",
  padding: 10,
  nodeRepulsion: 10000,
  idealEdgeLength: 400,
  animate: false,
  fit: true,
  randomize: false,
  nodeOverlap: 800,
  avoidOverlap: true,
  nodeSeparation: 400,
  randomSeed: 42,
  componentSpacing: 400
};

export const SEARCH_LAYOUT = {
  name: "cose",
  padding: 5,
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