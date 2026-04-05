/**
 * ViewerRelationGraph
 *
 * 뷰어 분할 화면에 표시되는 관계 그래프 컴포넌트입니다.
 *
 * @note 파일명(RelationGraph_Viewerpage.jsx)과 컴포넌트명(ViewerRelationGraph)이
 *       불일치합니다. 추후 ViewerRelationGraph.jsx로 파일명 변경을 권장합니다.
 */
import React, {
  useRef,
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

// ─── useAutoFit ────────────────────────────────────────────────────────────────
/**
 * 챕터/elements 변경 시 그래프를 자동으로 fit합니다.
 * 동일 챕터는 최초 1회만 fit하고 이후에는 사용자 뷰를 유지합니다.
 */
function useAutoFit(cyRef, elements, chapterNum, isSearchActive) {
  const fittedChaptersRef = useRef(new Set());
  const hasFittedOnceRef = useRef(false);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    try { cy.resize(); } catch {}

    if (isSearchActive) return;

    const nodes = cy.nodes();
    if (!nodes || nodes.length === 0) return;

    const chapterKey = chapterNum ?? '__default__';
    if (hasFittedOnceRef.current && fittedChaptersRef.current.has(chapterKey)) return;

    fittedChaptersRef.current.add(chapterKey);
    hasFittedOnceRef.current = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { cy.fit(nodes, 80); } catch {}
      });
    });
  }, [elements, chapterNum, isSearchActive]);
}

// ─── useCytoscapeReset ─────────────────────────────────────────────────────────
/**
 * graphClearRef에 Cytoscape 스타일 초기화 함수를 등록합니다.
 * 툴팁을 닫을 때 노드/엣지 강조 스타일을 원래대로 되돌리는 데 사용됩니다.
 */
function useCytoscapeReset(cyRef, graphClearRef, selectedNodeIdRef, selectedEdgeIdRef) {
  useEffect(() => {
    if (!graphClearRef) return;

    graphClearRef.current = () => {
      const cy = cyRef.current;
      if (!cy) return;

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
          try { cy.style().update(); } catch {}
        }
      } catch {}

      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    };
  }, [graphClearRef, cyRef, selectedNodeIdRef, selectedEdgeIdRef]);
}

// ─── ViewerRelationGraph ───────────────────────────────────────────────────────
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
  currentEvent = null,
  prevValidEvent = null,
  events = [],
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition: _isEventTransition = false,
  bookId = null,
}) => {
  const cyRef = useRef(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const containerRef = useRef(null);

  // ─── 커스텀 훅 ──────────────────────────────────────────────────────────
  useAutoFit(cyRef, elements, chapterNum, isSearchActive);
  useCytoscapeReset(cyRef, graphClearRef, selectedNodeIdRef, selectedEdgeIdRef);

  // ─── 툴팁 닫기 ─────────────────────────────────────────────────────────
  // 툴팁 팝업과 그래프 강조 스타일을 동시에 초기화합니다.
  const clearTooltipAndGraph = useCallback(() => {
    onClearTooltip?.();
    graphClearRef?.current?.();
  }, [onClearTooltip, graphClearRef]);

  // ─── 툴팁 표시 핸들러 ──────────────────────────────────────────────────
  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    if (!onSetActiveTooltip) return;

    const nodeData = node.data();

    let names = nodeData.names;
    if (typeof names === "string") {
      try { names = JSON.parse(names); } catch { names = [names]; }
    }

    let main = nodeData.main;
    if (typeof main === "string") main = main === "true";

    onSetActiveTooltip({
      type: "node",
      ...nodeData,
      names,
      main,
      nodeCenter,
      x: mouseX ?? nodeCenter?.x ?? 0,
      y: mouseY ?? nodeCenter?.y ?? 0,
    });
  }, [onSetActiveTooltip]);

  const onShowEdgeTooltip = useCallback(({ edge, edgeCenter, mouseX, mouseY }) => {
    if (!onSetActiveTooltip) return;

    onSetActiveTooltip({
      type: "edge",
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
      edgeCenter,
      x: mouseX ?? edgeCenter?.x ?? 0,
      y: mouseY ?? edgeCenter?.y ?? 0,
    });
  }, [onSetActiveTooltip]);

  // ─── 그래프 외부 클릭 시 툴팁 닫기 ────────────────────────────────────
  useEffect(() => {
    if (!activeTooltip) return;

    const handleDocumentClick = (event) => {
      const isInsideTooltip =
        !!event.target.closest(".graph-node-tooltip") ||
        !!event.target.closest(".edge-tooltip-container");
      if (isInsideTooltip) return;

      const isInsideGraph =
        containerRef.current && containerRef.current.contains(event.target);
      if (isInsideGraph) return;

      const isDragEnd = event?.detail?.type === 'graphDragEnd';
      if (isDragEnd) return;

      clearTooltipAndGraph();
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
  }, [activeTooltip, clearTooltipAndGraph]);

  const edgeStyle = getEdgeStyle('viewer');
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyle, edgeLabelVisible),
    [edgeStyle, edgeLabelVisible]
  );

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
            bookId={bookId}
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
          onClearTooltip={clearTooltipAndGraph}
          selectedNodeIdRef={selectedNodeIdRef}
          selectedEdgeIdRef={selectedEdgeIdRef}
          strictBackgroundClear={true}
          showRippleEffect={true}
        />
      </div>
    </div>
  );
};

export default React.memo(ViewerRelationGraph);
