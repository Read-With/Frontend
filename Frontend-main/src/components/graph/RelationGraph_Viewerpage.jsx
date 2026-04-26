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
import { buildElementsGraphFingerprint } from "../../utils/graph/graphDataUtils.js";
import { ensureElementsInBounds, clearHighlightClassesOn } from "../../utils/graph/graphUtils";
import { applySearchFadeEffect } from "../../utils/graph/searchUtils.jsx";

function useAutoFit(cyRef, elements, chapterNum, isSearchActive) {
  const elementsFp = useMemo(
    () => (elements?.length ? buildElementsGraphFingerprint(elements) : ""),
    [elements]
  );

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || isSearchActive) return;

    const nodes = cy.nodes();
    if (!nodes || nodes.length === 0) return;

    const container = typeof cy.container === "function" ? cy.container() : null;
    let cancelled = false;

    const runFit = () => {
      if (cancelled) return;
      const cyLive = cyRef.current;
      if (!cyLive) return;
      try {
        cyLive.resize();
      } catch {
        /* ignore */
      }
      try {
        if (container) ensureElementsInBounds(cyLive, container);
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() => {
        if (cancelled) return;
        const cy2 = cyRef.current;
        if (!cy2) return;
        try {
          const eles = cy2.elements();
          if (eles.length > 0) {
            cy2.fit(eles, 80);
          }
        } catch {
          try {
            const n = cy2.nodes();
            if (n.length > 0) cy2.fit(n, 80);
          } catch {
            /* ignore */
          }
        }
      });
    };

    const id = requestAnimationFrame(runFit);

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [elementsFp, chapterNum, isSearchActive]);
}

function useCytoscapeReset(cyRef, graphClearRef, selectedNodeIdRef, selectedEdgeIdRef) {
  useEffect(() => {
    if (!graphClearRef) return;

    graphClearRef.current = () => {
      const cy = cyRef.current;
      if (!cy) return;
      clearHighlightClassesOn(cy);
      try {
        if (typeof cy.style === "function") cy.style().update();
      } catch {}
      if (selectedNodeIdRef) selectedNodeIdRef.current = null;
      if (selectedEdgeIdRef) selectedEdgeIdRef.current = null;
    };
  }, [graphClearRef, cyRef, selectedNodeIdRef, selectedEdgeIdRef]);
}

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

  useAutoFit(cyRef, elements, chapterNum, isSearchActive);
  useCytoscapeReset(cyRef, graphClearRef, selectedNodeIdRef, selectedEdgeIdRef);

  // Used by useGraphInteractions (background tap): graph is already cleared by resetAllStyles, only clear tooltip
  const onClearTooltipOnly = useCallback(() => {
    onClearTooltip?.();
  }, [onClearTooltip]);

  // Used by external triggers (tooltip close button, document click): must clear both
  const clearTooltipAndGraph = useCallback(() => {
    onClearTooltip?.();
    graphClearRef?.current?.();
    if (isSearchActive && filteredElements?.length > 0 && cyRef.current) {
      applySearchFadeEffect(cyRef.current, filteredElements, isSearchActive);
    }
  }, [onClearTooltip, graphClearRef, isSearchActive, filteredElements, cyRef]);

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

  const edgeStyleViewer = useMemo(() => getEdgeStyle('viewer'), []);
  const stylesheet = useMemo(
    () => createGraphStylesheet(edgeStyleViewer, edgeLabelVisible),
    [edgeStyleViewer, edgeLabelVisible]
  );
  const presetLayout = useMemo(() => ({ name: "preset" }), []);

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
          layout={presetLayout}
          cyRef={cyRef}
          nodeSize={10}
          fitNodeIds={fitNodeIds}
          searchTerm={searchTerm}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          isResetFromSearch={isResetFromSearch}
          onShowNodeTooltip={onShowNodeTooltip}
          onShowEdgeTooltip={onShowEdgeTooltip}
          onClearTooltip={onClearTooltipOnly}
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
