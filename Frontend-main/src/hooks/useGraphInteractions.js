import { useCallback } from "react";

/**
 * 공용 그래프 상호작용 훅
 * - 노드/엣지 클릭 시 강조(faded/highlighted) 처리
 * - 배경 클릭 시 선택 해제
 * - 툴팁 표시 로직은 콜백으로 주입하여 컴포넌트별 차이를 허용
 */
export default function useGraphInteractions({
  cyRef,
  onShowNodeTooltip, // ({ node, evt, nodeCenter, mouseX, mouseY }) => void
  onShowEdgeTooltip, // ({ edge, evt, absoluteX, absoluteY }) => void
  selectedNodeIdRef,
  selectedEdgeIdRef,
  activeTooltip,
  strictBackgroundClear = false,
}) {
  const clearSelection = useCallback(() => {
    if (!cyRef?.current) return;
    const cy = cyRef.current;
    cy.nodes().removeClass("faded highlighted");
    cy.edges().removeClass("faded");
  }, [cyRef]);

  const tapNodeHandler = useCallback(
    (evt) => {
      if (!cyRef?.current) return;
      const cy = cyRef.current;
      const node = evt.target;
      const nodeData = node?.data?.();
      if (!node || !nodeData) return;

      const pos = node.renderedPosition();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const container = document.querySelector('.graph-canvas-area');
      const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const nodeCenter = {
        x: pos.x * zoom + pan.x + containerRect.left,
        y: pos.y * zoom + pan.y + containerRect.top,
      };

      cy.batch(() => {
        cy.nodes().removeClass("highlighted");
        cy.edges().removeClass("highlighted");
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        node.removeClass("faded").addClass("highlighted");
        node.connectedEdges().removeClass("faded");
        node.neighborhood().nodes().removeClass("faded");
      });

      const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
      const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;

      // 컴포넌트별 툴팁 생성 로직 실행
      onShowNodeTooltip?.({ node, evt, nodeCenter, mouseX, mouseY });
      if (selectedNodeIdRef) selectedNodeIdRef.current = node.id();
    },
    [cyRef, onShowNodeTooltip, selectedNodeIdRef]
  );

  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef?.current) return;
      const cy = cyRef.current;
      const edge = evt.target;
      const edgeData = edge?.data?.();
      if (!edge || !edgeData) return;

      const container = document.querySelector('.graph-canvas-area');
      const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const pos = edge.midpoint();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const absoluteX = pos.x * zoom + pan.x + containerRect.left;
      const absoluteY = pos.y * zoom + pan.y + containerRect.top;

      // 컴포넌트별 툴팁 생성 로직 실행
      onShowEdgeTooltip?.({ edge, evt, absoluteX, absoluteY });

      cy.batch(() => {
        cy.nodes().removeClass("highlighted");
        cy.edges().removeClass("highlighted");
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        edge.removeClass("faded");
        edge.source().removeClass("faded").addClass("highlighted");
        edge.target().removeClass("faded").addClass("highlighted");
      });

      if (selectedEdgeIdRef) selectedEdgeIdRef.current = edge.id();
    },
    [cyRef, onShowEdgeTooltip, selectedEdgeIdRef]
  );

  const tapBackgroundHandler = useCallback(
    (evt) => {
      if (evt.target === cyRef?.current) {
        if (strictBackgroundClear) {
          const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current || activeTooltip);
          if (!hasSelection) return;
        }
        clearSelection();
      }
    },
    [cyRef, clearSelection, strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, activeTooltip]
  );

  const rebindTapListeners = useCallback(() => {
    if (!cyRef?.current) return;
    const cy = cyRef.current;
    cy.removeListener("tap", "node");
    cy.removeListener("tap", "edge");
    cy.removeListener("tap");
    cy.on("tap", "node", tapNodeHandler);
    cy.on("tap", "edge", tapEdgeHandler);
    cy.on("tap", tapBackgroundHandler);
  }, [cyRef, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  const clearSelectionAndRebind = useCallback(() => {
    clearSelection();
    if (selectedNodeIdRef) selectedNodeIdRef.current = null;
    if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    rebindTapListeners();
  }, [clearSelection, rebindTapListeners, selectedNodeIdRef, selectedEdgeIdRef]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection: clearSelectionAndRebind,
  };
}


