/**
 * useGraphLayout.js : 그래프 레이아웃 및 스타일 적용 커스텀 훅
 * 
 * [주요 기능]
 * 1. 레이아웃 실행 및 완료 처리
 * 2. 스타일시트 업데이트
 * 3. 노드 크기 적용
 * 4. 레이아웃 완료 콜백 처리
 * 
 * [사용처]
 * - CytoscapeGraphUnified: 그래프 레이아웃 및 스타일 관리
 */

import { useEffect, useCallback } from 'react';
import { ensureElementsInBounds } from '../../utils/graph/graphUtils';
import { detectAndResolveOverlap } from '../../utils/graph/graphDataUtils';

export function useGraphLayout({
  cy,
  elements,
  stylesheet,
  layout,
  elementsUpdateRef,
  updateStylesheet,
  applyNodeSizes,
  triggerRippleForAddedNodes,
  onLayoutComplete,
  isInitialLoad,
  setIsInitialLoad,
  containerRef,
}) {
  const handleLayoutComplete = useCallback((cy, triggerRipple) => {
    if (!cy) return;
    
    ensureElementsInBounds(cy, containerRef.current);
    detectAndResolveOverlap(cy);
    if (triggerRipple) triggerRipple();
    if (onLayoutComplete) onLayoutComplete();
  }, [onLayoutComplete, containerRef]);

  useEffect(() => {
    if (!cy || !elements || elements.length === 0) {
      return;
    }

    const { nodesToAdd, edgesToAdd, hasChanges } = elementsUpdateRef.current || {};

    if (hasChanges) {
      cy.layout({ name: 'preset' }).run();
      
      updateStylesheet(cy);
      if (stylesheet && nodesToAdd && nodesToAdd.length > 0) {
        applyNodeSizes(cy, cy.nodes());
      }
      
      const completeCallback = () => {
        handleLayoutComplete(cy, triggerRippleForAddedNodes);
      };
      
      if (layout && layout.name !== 'preset') {
        const layoutInstance = cy.layout({
          ...layout,
          animationDuration: 800,
          animationEasing: 'ease-out'
        });
        layoutInstance.on('layoutstop', () => {
          setTimeout(completeCallback, 200);
        });
        layoutInstance.run();
      } else {
        setTimeout(completeCallback, 150);
      }
    } else {
      updateStylesheet(cy);
      triggerRippleForAddedNodes();
    }

    if (isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [
    cy,
    elements,
    stylesheet,
    layout,
    elementsUpdateRef,
    updateStylesheet,
    applyNodeSizes,
    handleLayoutComplete,
    triggerRippleForAddedNodes,
    isInitialLoad,
    setIsInitialLoad
  ]);
}
