import { useCallback, useRef, useEffect } from "react";
import { applySearchHighlight } from '../utils/searchUtils.jsx';

export default function useGraphInteractions({
  cyRef,
  onShowNodeTooltip, // ({ node, evt, nodeCenter, mouseX, mouseY }) => void
  onShowEdgeTooltip, // ({ edge, evt, absoluteX, absoluteY }) => void
  onClearTooltip, // () => void - 툴팁 초기화 콜백
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
  isSearchActive = false, // 검색 상태 추가
  filteredElements = [], // 검색된 요소들 추가
}) {
  const onShowNodeTooltipRef = useRef(onShowNodeTooltip);
  const onShowEdgeTooltipRef = useRef(onShowEdgeTooltip);
  const onClearTooltipRef = useRef(onClearTooltip);

  useEffect(() => {
    onShowNodeTooltipRef.current = onShowNodeTooltip;
  }, [onShowNodeTooltip]);

  useEffect(() => {
    onShowEdgeTooltipRef.current = onShowEdgeTooltip;
  }, [onShowEdgeTooltip]);

  useEffect(() => {
    onClearTooltipRef.current = onClearTooltip;
  }, [onClearTooltip]);

  // 선택 상태만 초기화하는 함수 (툴팁은 유지)
  const clearSelectionOnly = useCallback(() => {
    if (!cyRef?.current) {
      return;
    }
    const cy = cyRef.current;
    cy.nodes().removeClass("faded highlighted");
    cy.edges().removeClass("faded");
    cy.nodes().ungrabify(); // 모든 노드를 드래그 불가능하게 만들기
  }, [cyRef]);

  // 툴팁을 포함한 모든 상태를 초기화하는 함수
  const clearAll = useCallback(() => {
    clearSelectionOnly();
    if (onClearTooltipRef.current) {
      onClearTooltipRef.current();
    }
  }, [clearSelectionOnly]);

  const tapNodeHandler = useCallback(
    (evt) => {
      if (!cyRef?.current) {
        return;
      }
      const cy = cyRef.current;
      const node = evt.target;
      const nodeData = node?.data?.();
      if (!node || !nodeData) {
        return;
      }

      const pos = node.renderedPosition();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const container = document.querySelector('.graph-canvas-area');
      const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const nodeCenter = {
        x: pos.x * zoom + pan.x + containerRect.left,
        y: pos.y * zoom + pan.y + containerRect.top,
      };

      // 현재 선택된 노드와 클릭한 노드가 같은지 확인
      const isSameNode = selectedNodeIdRef?.current === node.id();
      
      cy.batch(() => {
        cy.nodes().removeClass("highlighted");
        cy.edges().removeClass("highlighted");
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        
        // 검색 상태에서 노드 클릭 시 검색 결과에 포함된 요소들만 하이라이트
        if (isSearchActive && filteredElements.length > 0) {
          // 노드 클릭 하이라이트 효과 적용 (페이드 효과는 CytoscapeGraphUnified에서 처리)
          applySearchHighlight(cy, node, filteredElements);
        } else {
          // 일반 상태에서는 기존 로직 사용
          node.removeClass("faded").addClass("highlighted");
          node.connectedEdges().removeClass("faded");
          node.neighborhood().nodes().removeClass("faded");
        }
        
        // 드래그 상태 관리
        if (isSameNode) {
          // 같은 노드를 다시 클릭한 경우: 드래그 토글
          if (node.grabbable()) {
            node.ungrabify(); // 드래그 비활성화
          } else {
            node.grabify(); // 드래그 활성화
          }
        } else {
          // 다른 노드를 클릭한 경우: 이전 노드 드래그 비활성화, 새 노드 드래그 활성화
          cy.nodes().ungrabify(); // 모든 노드를 드래그 불가능하게 만들기
          node.grabify(); // 클릭된 노드만 드래그 가능하게 만들기
        }
      });

      const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
      const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;

      // 컴포넌트별 툴팁 생성 로직 실행
      if (onShowNodeTooltipRef.current) {
        onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
      }
      
      if (selectedNodeIdRef) selectedNodeIdRef.current = node.id();
    },
    [cyRef, selectedNodeIdRef, isSearchActive, filteredElements]
  );

  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef?.current) {
        return;
      }
      const cy = cyRef.current;
      const edge = evt.target;
      const edgeData = edge?.data?.();
      if (!edge || !edgeData) {
        return;
      }

      const container = document.querySelector('.graph-canvas-area');
      const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const pos = edge.midpoint();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const absoluteX = pos.x * zoom + pan.x + containerRect.left;
      const absoluteY = pos.y * zoom + pan.y + containerRect.top;

      // 컴포넌트별 툴팁 생성 로직 실행
      if (onShowEdgeTooltipRef.current) {
        onShowEdgeTooltipRef.current({ edge, evt, absoluteX, absoluteY });
      }

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
      // evt.target이 DOM Node인지 확인
      if (!(evt.target instanceof Node)) {
        // Cytoscape 요소인 경우 배경 클릭으로 처리
        if (strictBackgroundClear) {
          const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
          if (!hasSelection) return;
        }
        clearSelectionOnly();
        return;
      }

      // 그래프 컨테이너 내의 모든 영역에서 배경 클릭 감지
      const container = document.querySelector('.graph-canvas-area');
      if (container && container.contains(evt.target)) {
        // 노드나 엣지가 아닌 영역을 클릭한 경우
        if (evt.target === cyRef?.current || evt.target === container) {
          if (strictBackgroundClear) {
            const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
            if (!hasSelection) return;
          }
          clearSelectionOnly();
        }
      }
    },
    [cyRef, clearSelectionOnly, strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef]
  );

  const clearSelectionAndRebind = useCallback(() => {
    clearSelectionOnly();
    if (selectedNodeIdRef) selectedNodeIdRef.current = null;
    if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
  }, [clearSelectionOnly, selectedNodeIdRef, selectedEdgeIdRef]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection: clearSelectionAndRebind,
    clearSelectionOnly,
    clearAll,
  };
}