import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import UnifiedNodeInfo from "./tooltip/UnifiedNodeInfo";
import UnifiedEdgeTooltip from "./tooltip/UnifiedEdgeTooltip";
import "./RelationGraph.css";
import { getEdgeStyle, createGraphStylesheet } from "../../utils/styles/graphStyles";
import { graphStyles } from "../../utils/styles/styles";
import useGraphInteractions from "../../hooks/graph/useGraphInteractions";


const ViewerRelationGraph = ({
  elements,
  newNodeIds = [],
  chapterNum,
  eventNum,
  edgeLabelVisible = true,
  maxChapter,
  filename,
  fitNodeIds,
  searchTerm,
  isSearchActive,
  filteredElements,
  isResetFromSearch,
  // ViewerTopBar와 동일한 이벤트 정보를 받기 위한 새로운 props
  currentEvent = null,
  prevValidEvent = null,
  events = [],
  // 상위에서 전달받은 툴팁 상태
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition = false, // 이벤트 전환 상태
  bookId = null,
}) => {
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const autoFitChapterSetRef = useRef(new Set());
  const hasGlobalFitRef = useRef(false);
  const containerRef = useRef(null);

  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY, evt }) => {
    if (!onSetActiveTooltip) {
      console.warn('⚠️ [ViewerRelationGraph] onSetActiveTooltip이 없습니다');
      return;
    }
    
    const nodeData = node.data();
    let names = nodeData.names;
    if (typeof names === "string") {
      try { names = JSON.parse(names); } catch { names = [names]; }
    }
    let main = nodeData.main;
    if (typeof main === "string") main = main === "true";
    
    // useGraphInteractions에서 이미 정확한 위치를 계산해서 전달하므로 그대로 사용
    const finalX = mouseX !== undefined ? mouseX : nodeCenter?.x || 0;
    const finalY = mouseY !== undefined ? mouseY : nodeCenter?.y || 0;
    
    try {
      onSetActiveTooltip({
        type: "node",
        ...nodeData,
        names,
        main,
        nodeCenter,
        x: finalX,
        y: finalY,
      });
    } catch (error) {
      console.error('❌ [ViewerRelationGraph] onSetActiveTooltip 호출 오류:', error);
    }
  }, [onSetActiveTooltip]);

  const onShowEdgeTooltip = useCallback(({ edge, edgeCenter, mouseX, mouseY, evt }) => {
    if (!onSetActiveTooltip) {
      console.warn('⚠️ [ViewerRelationGraph] onSetActiveTooltip이 없습니다');
      return;
    }
    
    // useGraphInteractions에서 이미 정확한 위치를 계산해서 전달하므로 그대로 사용
    const finalX = mouseX !== undefined ? mouseX : edgeCenter?.x || 0;
    const finalY = mouseY !== undefined ? mouseY : edgeCenter?.y || 0;
    
    onSetActiveTooltip({
      type: "edge",
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
      edgeCenter,
      x: finalX,
      y: finalY,
    });
  }, [onSetActiveTooltip]);

  // 툴팁 닫기 함수 - 외부 클릭이나 배경 클릭 시 호출됨
  const clearTooltip = useCallback(() => {
    if (onClearTooltip) {
      onClearTooltip();
    }
  }, [onClearTooltip]);

  // 툴팁 닫기와 그래프 스타일 초기화를 모두 처리하는 함수
  const clearTooltipAndGraph = useCallback(() => {
    if (onClearTooltip) {
      onClearTooltip();
    }
    if (graphClearRef?.current) {
      graphClearRef.current();
    }
  }, [onClearTooltip, graphClearRef]);

  const edgeStyle = getEdgeStyle('viewer');

  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );

  // 프리워밍은 공용 훅(useGraphInteractions)의 prewarmStyles에 위임

  // graphClearRef에 그래프 스타일 초기화 함수 설정
  useEffect(() => {
    if (graphClearRef && cyRef.current) {
      graphClearRef.current = () => {
        const cy = cyRef.current;
        if (cy) {
          try {
            cy.batch(() => {
              cy.nodes().forEach((node) => {
                node.removeClass("faded highlighted");
                node.removeStyle("opacity");
                node.removeStyle("text-opacity");
                node.removeStyle("border-color");
                node.removeStyle("border-width");
                node.removeStyle("border-opacity");
                node.removeStyle("border-style");
              });

              cy.edges().forEach((edge) => {
                edge.removeClass("faded highlighted");
                edge.removeStyle("opacity");
                edge.removeStyle("text-opacity");
                edge.removeStyle("width");
              });
            });

            if (typeof cy.style === "function") {
              try {
                cy.style().update();
              } catch {}
            }
          } catch {}
        }
        if (selectedNodeIdRef) selectedNodeIdRef.current = null;
        if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
      };
    }
  }, [graphClearRef, cyRef, selectedNodeIdRef, selectedEdgeIdRef]);

  useEffect(() => {
    if (!activeTooltip) return;

    const handleDocumentClick = (event) => {
      const isInsideTooltip =
        !!event.target.closest(".graph-node-tooltip") ||
        !!event.target.closest(".edge-tooltip-container");
      if (isInsideTooltip) {
        return;
      }

      const isInsideGraph =
        containerRef.current && containerRef.current.contains(event.target);
      if (isInsideGraph) {
        return;
      }

      const isDragEndEvent = event?.detail && event.detail.type === 'graphDragEnd';
      if (isDragEndEvent) {
        return;
      }

      clearTooltip();
    };

    const handleGraphDragEnd = (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleDocumentClick, true);
      document.addEventListener('graphDragEnd', handleGraphDragEnd, true);
    }, 20);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('graphDragEnd', handleGraphDragEnd, true);
    };
  }, [activeTooltip, clearTooltip]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    try {
      cy.resize();
    } catch {}

    if (isSearchActive) {
      return;
    }

    const nodes = cy.nodes();
    if (!nodes || nodes.length === 0) {
      return;
    }

    const chapterKey = chapterNum ?? '__default__';
    const hasAutoFitted = autoFitChapterSetRef.current.has(chapterKey);
    const shouldFit =
      !hasGlobalFitRef.current ||
      !hasAutoFitted;

    if (!shouldFit) {
      return;
    }

    autoFitChapterSetRef.current.add(chapterKey);
    hasGlobalFitRef.current = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          cy.fit(nodes, 80);
        } catch {}
      });
    });
  }, [elements, chapterNum, isSearchActive]);

  // activeTooltip 상태 추적 - 제거됨

  return (
    <div
      ref={containerRef}
      className="relation-graph-container"
      style={graphStyles.container}
    >
      <div 
        style={graphStyles.tooltipContainer}
        onClick={(e) => e.stopPropagation()}
      >
        {(() => {
          if (activeTooltip?.type === "node") {
            return (
              <UnifiedNodeInfo
                key={`node-tooltip-${activeTooltip.id}`}
                displayMode="tooltip"
                data={activeTooltip}
                x={activeTooltip.x}
                y={activeTooltip.y}
                nodeCenter={activeTooltip.nodeCenter}
                onClose={clearTooltipAndGraph}
                inViewer={true}
                chapterNum={chapterNum}
                eventNum={eventNum}
                maxChapter={maxChapter}
                filename={filename}
                elements={elements}
                style={graphStyles.tooltipStyle}
                currentEvent={currentEvent}
                prevValidEvent={prevValidEvent}
                events={events}
              />
            );
          }
          return null;
        })()}
        {(() => {
          if (activeTooltip?.type === "edge") {
            return (
              <UnifiedEdgeTooltip
                key={`edge-tooltip-${activeTooltip.id}`}
                data={activeTooltip.data}
                x={activeTooltip.x}
                y={activeTooltip.y}
                onClose={clearTooltipAndGraph}
                sourceNode={activeTooltip.sourceNode}
                targetNode={activeTooltip.targetNode}
                mode="viewer"
                chapterNum={chapterNum}
                eventNum={eventNum}
                maxChapter={maxChapter}
                filename={filename}
                style={graphStyles.tooltipStyle}
                currentEvent={currentEvent}
                prevValidEvent={prevValidEvent}
                events={events}
                bookId={bookId}
              />
            );
          }
          return null;
        })()}
      </div>
      <div className="graph-canvas-area" style={graphStyles.graphArea}>
        <CytoscapeGraphUnified
          elements={elements}
          newNodeIds={newNodeIds}
          stylesheet={stylesheet}
          layout={{ name: 'preset' }}
          cyRef={cyRef}
          nodeSize={10}
          fitNodeIds={fitNodeIds}
          searchTerm={searchTerm}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          isResetFromSearch={isResetFromSearch}
          onShowNodeTooltip={onShowNodeTooltip}
          onShowEdgeTooltip={onShowEdgeTooltip}
          onClearTooltip={clearTooltip}
          selectedNodeIdRef={selectedNodeIdRef}
          selectedEdgeIdRef={selectedEdgeIdRef}
          strictBackgroundClear={true}
          showRippleEffect={true} // 그래프 페이지와 동일하게 항상 ripple 효과 표시
        />
      </div>
    </div>
  );
};

export default React.memo(ViewerRelationGraph);
