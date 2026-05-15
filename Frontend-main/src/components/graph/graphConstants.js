/**
 * 그래프 레이아웃에 관련된 공유 상수
 * GraphCanvas, GraphTopBar, RelationGraphWrapper에서 공통으로 사용합니다.
 */
export const GRAPH_LAYOUT_CONSTANTS = {
  SIDEBAR: { OPEN_WIDTH: 360, CLOSED_WIDTH: 60 },
  TOP_BAR_HEIGHT: 54,
  TOOLTIP_SIDEBAR_WIDTH: 450,
};

/** 인물 필터 단계 (ViewerTopBar, GraphTopBar 공통) */
export const GRAPH_CHARACTER_FILTER_STAGE_OPTIONS = [
  { value: 0, label: '모두 보기' },
  { value: 1, label: '주요 인물만 보기' },
  { value: 2, label: '주요 인물과 보기' },
];
