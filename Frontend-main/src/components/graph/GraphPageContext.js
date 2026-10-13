/** 그래프 전용 페이지(GraphPage) → 캔버스·상세 사이드바 공유 값. 값 구성은 GraphPage 참고 */

import { createContext, useContext } from 'react';

export const GraphPageContext = createContext(null);

export function useGraphPage() {
  const value = useContext(GraphPageContext);
  if (!value) throw new Error('useGraphPage must be used inside GraphPageContext.Provider');
  return value;
}
