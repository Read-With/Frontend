import { useCallback, useRef, useEffect } from "react";
import { applySearchHighlight } from '../utils/searchUtils.jsx';
import { getContainerInfo, calculateCytoscapePosition } from '../utils/graphUtils';

export default function useGraphInteractions({
  cyRef,
  onShowNodeTooltip, 
  onShowEdgeTooltip,
  onClearTooltip, 
  selectedNodeIdRef,
  selectedEdgeIdRef,
  strictBackgroundClear = false,
  isSearchActive = false, 
  filteredElements = [], 
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

  // 통합된 스타일 초기화 함수
  const resetAllStyles = useCallback(() => {
    if (!cyRef?.current) return;
    
    const cy = cyRef.current;
    cy.batch(() => {
      cy.nodes().removeClass("highlighted").addClass("faded");
      cy.edges().removeClass("highlighted").addClass("faded");
    });
  }, [cyRef]);

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

  // 그래프 스타일만 초기화하는 함수 (툴팁 닫기는 상위에서 처리)
  const clearAll = useCallback(() => {
    clearSelectionOnly();
  }, [clearSelectionOnly]);

  // getContainerInfo는 이제 공통 유틸리티에서 import하여 사용


  // 노드 하이라이트 처리 함수
  const handleNodeHighlight = useCallback((node) => {
    try {
      if (!cyRef?.current) return;
      
      const cy = cyRef.current;
      
      if (isSearchActive && filteredElements.length > 0) {
        // 검색 상태에서 노드 클릭 시 검색 결과에 포함된 요소들만 하이라이트
        applySearchHighlight(cy, node, filteredElements);
      } else {
        // 일반 상태에서는 기존 로직 사용
        resetAllStyles();
        
        cy.batch(() => {
          node.removeClass("faded").addClass("highlighted");
          node.connectedEdges().removeClass("faded");
          node.neighborhood().nodes().removeClass("faded");
        });
      }
    } catch (error) {
    }
  }, [cyRef, isSearchActive, filteredElements, resetAllStyles]);

  // 노드 위치 계산 함수 - 확대/축소 상태 고려 (상대 좌표)
  const calculateNodePosition = useCallback((node) => {
    try {
      if (!cyRef?.current) return { x: 0, y: 0 };
      
      const cy = cyRef.current;
      const pos = node.renderedPosition();
      const pan = cy.pan();
      const zoom = cy.zoom();
      
      // Cytoscape 좌표를 그래프 컨테이너 기준 상대 좌표로 변환
      const domX = pos.x * zoom + pan.x;
      const domY = pos.y * zoom + pan.y;
      
      return { x: domX, y: domY };
    } catch (error) {
      return { x: 0, y: 0 };
    }
  }, [cyRef]);

  const tapNodeHandler = useCallback(
    (evt) => {
      try {
        if (!cyRef?.current) return;
        
        const node = evt.target;
        const nodeData = node?.data?.();
        if (!node || !nodeData) return;

        const nodeCenter = calculateNodePosition(node);
        
        // 마우스 위치를 그래프 컨테이너 기준의 상대 좌표로 변환
        let mouseX = nodeCenter.x;
        let mouseY = nodeCenter.y;
        
        if (evt.originalEvent) {
          const { containerRect } = getContainerInfo();
          mouseX = evt.originalEvent.clientX - containerRect.left;
          mouseY = evt.originalEvent.clientY - containerRect.top;
        }
        
        // 툴팁을 오른쪽으로 오프셋 추가 (노드 크기 + 여백 고려)
        const nodeSize = node.renderedBoundingBox()?.w || 50;
        const offsetX = nodeSize + 100;
        mouseX += offsetX;
        
        // 위치 계산 완료
        
        // 노드 하이라이트 처리
        handleNodeHighlight(node);

        // 컴포넌트별 툴팁 생성 로직 실행
        if (onShowNodeTooltipRef.current) {
          onShowNodeTooltipRef.current({ node, evt, nodeCenter, mouseX, mouseY });
        }
        
        if (selectedNodeIdRef) selectedNodeIdRef.current = node.id();
      } catch (error) {
        console.error('❌ [useGraphInteractions] 노드 클릭 처리 오류:', error);
      }
    },
    [cyRef, handleNodeHighlight, calculateNodePosition, onShowNodeTooltipRef, selectedNodeIdRef]
  );

  // 노드 드래그 시작 핸들러
  const nodeDragStartHandler = useCallback((evt) => {
    // 드래그 시작 시 필요한 로직이 있다면 여기에 추가
  }, []);

  // 노드 드래그 종료 핸들러  
  const nodeDragEndHandler = useCallback((evt) => {
    // 드래그 종료 이벤트 발생
    const dragEndEvent = new CustomEvent('graphDragEnd', {
      detail: { type: 'graphDragEnd', timestamp: Date.now() }
    });
    document.dispatchEvent(dragEndEvent);
  }, []);

  const tapEdgeHandler = useCallback(
    (evt) => {
      try {
        if (!cyRef?.current) return;
        
        const cy = cyRef.current;
        const edge = evt.target;
        const edgeData = edge?.data?.();
        if (!edge || !edgeData) return;

        // 간선 중점 위치 계산 - 확대/축소 상태 고려 (상대 좌표)
        const edgeMidpoint = edge.midpoint();
        const pan = cy.pan();
        const zoom = cy.zoom();
        
        const domX = edgeMidpoint.x * zoom + pan.x;
        const domY = edgeMidpoint.y * zoom + pan.y;
        
        
        // 마우스 위치를 그래프 컨테이너 기준의 상대 좌표로 변환
        let mouseX = domX;
        let mouseY = domY;
        
        if (evt.originalEvent) {
          const { containerRect } = getContainerInfo();
          mouseX = evt.originalEvent.clientX - containerRect.left;
          mouseY = evt.originalEvent.clientY - containerRect.top;
        }

        // 위치 계산 완료

        // 컴포넌트별 툴팁 생성 로직 실행
        if (onShowEdgeTooltipRef.current) {
          onShowEdgeTooltipRef.current({ edge, evt, absoluteX: mouseX, absoluteY: mouseY });
        }

        resetAllStyles();
        
        cy.batch(() => {
          edge.removeClass("faded");
          edge.source().removeClass("faded").addClass("highlighted");
          edge.target().removeClass("faded").addClass("highlighted");
        });

        if (selectedEdgeIdRef) selectedEdgeIdRef.current = edge.id();
      } catch (error) {
        console.error('❌ [useGraphInteractions] 간선 클릭 처리 오류:', error);
      }
    },
    [cyRef, onShowEdgeTooltipRef, selectedEdgeIdRef, resetAllStyles]
  );

  // 배경 클릭 처리 함수 - 그래프 스타일 초기화 및 툴팁 닫기
  const handleBackgroundClick = useCallback((evt) => {
    try {
      // 드래그 관련 이벤트인지 확인
      const isDragEvent = evt && evt.detail && evt.detail.type === 'dragend';
      
      if (strictBackgroundClear) {
        const hasSelection = !!(selectedNodeIdRef?.current || selectedEdgeIdRef?.current);
        if (!hasSelection) return;
      }
      
      // 스타일 초기화
      clearStyles();
      
      // 드래그가 아닌 실제 클릭인 경우에만 툴팁 닫기
      if (!isDragEvent && onClearTooltipRef.current) {
        onClearTooltipRef.current();
      }
    } catch (error) {
    }
  }, [strictBackgroundClear, selectedNodeIdRef, selectedEdgeIdRef, clearStyles, onClearTooltipRef]);

  const tapBackgroundHandler = useCallback(
    (evt) => {
      try {
        // Cytoscape tap 이벤트에서 evt.target은 Cytoscape 요소 객체
        // 배경 클릭은 evt.target이 Cytoscape core인 경우
        if (evt.target === cyRef?.current) {
          handleBackgroundClick();
        }
      } catch (error) {
      }
    },
    [cyRef, handleBackgroundClick]
  );

  const clearSelectionAndRebind = useCallback(() => {
    try {
      clearSelectionOnly();
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    } catch (error) {
    }
  }, [clearSelectionOnly, selectedNodeIdRef, selectedEdgeIdRef]);

  return {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    nodeDragStartHandler,
    nodeDragEndHandler,
    clearSelection: clearSelectionAndRebind,
    clearSelectionOnly,
    clearAll,
  };
}