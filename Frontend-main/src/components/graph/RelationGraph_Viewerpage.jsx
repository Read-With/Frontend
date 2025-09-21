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
import useGraphInteractions from "../../hooks/useGraphInteractions";


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
}) => {
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);

  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY, evt }) => {
    if (!onSetActiveTooltip) return;
    
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
    
    onSetActiveTooltip({
      type: "node",
      ...nodeData,
      names,
      main,
      nodeCenter,
      x: finalX,
      y: finalY,
    });
  }, [onSetActiveTooltip]);

  const onShowEdgeTooltip = useCallback(({ edge, absoluteX, absoluteY, evt }) => {
    if (!onSetActiveTooltip) return;
    
    // 마우스 위치를 우선 사용하되, 없으면 계산된 간선 중심 위치 사용
    const finalX = absoluteX !== undefined ? absoluteX : 0;
    const finalY = absoluteY !== undefined ? absoluteY : 0;
    
    onSetActiveTooltip({
      type: "edge",
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
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

  const {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
    clearAll,
  } = useGraphInteractions({
    cyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip: clearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
    isSearchActive,
    filteredElements,
  });

  // graphClearRef에 그래프 스타일 초기화 함수 설정
  useEffect(() => {
    if (graphClearRef) {
      graphClearRef.current = clearAll;
    }
  }, [graphClearRef, clearAll]);

  const edgeStyle = getEdgeStyle('viewer');

  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );

  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.center();
    }
  }, [elements]);

  return (
    <div className="relation-graph-container" style={graphStyles.container}>
      <div 
        style={graphStyles.tooltipContainer}
        onClick={(e) => e.stopPropagation()}
      >
        {activeTooltip?.type === "node" && (
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
            // ViewerTopBar와 동일한 이벤트 정보 전달
            currentEvent={currentEvent}
            prevValidEvent={prevValidEvent}
            events={events}
          />
        )}
        {activeTooltip?.type === "edge" && (
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
          />
        )}
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
        />
      </div>
    </div>
  );
};

export default React.memo(ViewerRelationGraph);
