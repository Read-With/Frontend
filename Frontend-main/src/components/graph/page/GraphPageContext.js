/**
 * 그래프 전용 페이지(GraphPage) 공유 값. 값 구성은 GraphPage 참고.
 * 소비자별로 나눔: 검색 입력처럼 레이아웃만 바뀌는 갱신에 상세 사이드바가 다시 그려지지 않도록.
 */

import { createContext, useContext } from 'react';

/** 상단바·캔버스 (GraphPageLayout) */
export const GraphPageContext = createContext(null);
/** 오른쪽 상세 사이드바 (GraphPageSidebar) */
export const GraphPageSidebarContext = createContext(null);

function useRequiredContext(context, name) {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used inside its Provider`);
  return value;
}

export const useGraphPage = () => useRequiredContext(GraphPageContext, 'useGraphPage');
export const useGraphPageSidebar = () => useRequiredContext(GraphPageSidebarContext, 'useGraphPageSidebar');
