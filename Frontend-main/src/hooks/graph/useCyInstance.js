import { useMemo } from "react";

/**
 * cyRef와 준비 플래그를 받아 유효한 Cytoscape 인스턴스(또는 null)를 반환.
 * 인스턴스 생성 effect에서 setCyReady(true) 호출 후 cy가 안정적으로 사용 가능.
 */
export function useCyInstance(cyRef, isReady = true) {
  return useMemo(() => {
    if (!isReady) return null;
    const cy = cyRef?.current;
    if (!cy || typeof cy.container !== "function") return null;
    return cy;
  }, [cyRef, isReady]);
}
