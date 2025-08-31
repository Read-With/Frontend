import { useCallback, useRef, useEffect } from "react";
import { applySearchHighlight } from '../utils/searchUtils.jsx';

// 상수 정의
const GRAPH_CONTAINER_SELECTOR = '.graph-canvas-area';

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

  // 공통 스타일 초기화 함수
  const clearStyles = useCallback(() => {
    if (!cyRef?.current) return;
    
    const cy = cyRef.current;
    cy.nodes().removeClass("faded highlighted");
    cy.edges().removeClass("faded");
  }, [cyRef]);

  // 선택 상태만 초기화하는 함수 (툴팁은 유지)
  const clearSelectionOnly = useCallback(() => {
    clearStyles();
  }, [clearStyles]);

  // 툴팁을 포함한 모든 상태를 초기화하는 함수
  const clearAll = useCallback(() => {
    clearSelectionOnly();
    if (onClearTooltipRef.current) {
      onClearTooltipRef.current();
    }
  }, [clearSelectionOnly]);

  // 그래프 컨테이너 정보 가져오기
  const getContainerInfo = useCallback(() => {
    const container = document.querySelector(GRAPH_CONTAINER_SELECTOR);
    const containerRect = container?.getBoundingClientRect?.() || { left: 0, top: 0 };
    return { container, containerRect };
  }, []);

  // 공통 위치 계산 함수
  const calculatePosition = useCallback((pos) => {
    if (!cyRef?.current) return { x: 0, y: 0 };
    
    const pan = cyRef.current.pan();
    const zoom = cyRef.current.zoom();
    const { containerRect } = getContainerInfo();
    
    return {
      x: pos.x * zoom + pan.x + containerRect.left,
      y: pos.y * zoom + pan.y + containerRect.top,
    };
  }, [cyRef, getContainerInfo]);

  // 노드 하이라이트 처리 함수
  const handleNodeHighlight = useCallback((node) => {
    if (!cyRef?.current) return;
    
    const cy = cyRef.current;
    
    if (isSearchActive && filteredElements.length > 0) {
      // 검색 상태에서 노드 클릭 시 검색 결과에 포함된 요소들만 하이라이트
      applySearchHighlight(cy, node, filteredElements);
    } else {
      // 일반 상태에서는 기존 로직 사용
      cy.batch(() => {
        cy.nodes().removeClass("highlighted");
        cy.edges().removeClass("highlighted");
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        
        node.removeClass("faded").addClass("highlighted");
        node.connectedEdges().removeClass("faded");
        node.neighborhood().nodes().removeClass("faded");
      });
    }
  }, [cyRef, isSearchActive, filteredElements]);

  // 노드 위치 계산 함수
  const calculateNodePosition = useCallback((node) => {
    const pos = node.renderedPosition();
    return calculatePosition(pos);
  }, [calculatePosition]);

  const tapNodeHandler = useCallback(
    (evt) => {
      if (!cyRef?.current) return;
      
      const node = evt.target;
      const nodeData = node?.data?.();
      if (!node || !nodeData) return;

      const nodeCenter = calculateNodePosition(node);
      const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
      const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;
      
      // 노드 하이라이트 처리
      handleNodeHighlight(node);

      // 컴포넌트별 툴팁 생성 로직 실행
      if (onShowNodeTooltipRef.current) {
        onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
      }
      
      if (selectedNodeIdRef) selectedNodeIdRef.current = node.id();
    },
    [cyRef, handleNodeHighlight, calculateNodePosition, onShowNodeTooltipRef, selectedNodeIdRef]
  );

  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef?.current) return;
      
      const cy = cyRef.current;
      const edge = evt.target;
      const edgeData = edge?.data?.();
      if (!edge || !edgeData) return;

      const pos = edge.midpoint();
      const { absoluteX, absoluteY } = calculatePosition(pos);

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
    [cyRef, calculatePosition, onShowEdgeTooltipRef, selectedEdgeIdRef]
  );

  // 배경 클릭 처리 함수
  const handleBackgroundClick = useCallback(() => {
    if (strictBackgroundClear) {
      const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
      if (!hasSelection) return;
    }
    // 그래프 온리 페이지에서는 툴팁을 유지하고 선택 상태만 초기화
    clearStyles();
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, clearStyles]);

  const tapBackgroundHandler = useCallback(
    (evt) => {
      // evt.target이 DOM Node인지 확인
      if (!(evt.target instanceof Node)) {
        // Cytoscape 요소인 경우 배경 클릭으로 처리
        handleBackgroundClick();
        return;
      }

      // 그래프 컨테이너 내의 모든 영역에서 배경 클릭 감지
      const { container } = getContainerInfo();
      if (container && container.contains(evt.target)) {
        // 노드나 엣지가 아닌 영역을 클릭한 경우
        if (evt.target === cyRef?.current || evt.target === container) {
          handleBackgroundClick();
        }
      }
    },
    [cyRef, handleBackgroundClick, getContainerInfo]
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