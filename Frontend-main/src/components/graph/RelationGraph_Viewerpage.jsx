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
import { getNodeSize, getEdgeStyle, createGraphStylesheet } from "../../utils/styles/graphStyles";
import { graphStyles } from "../../utils/styles/styles";
import { rippleUtils } from "../../utils/styles/animations";
import useGraphInteractions from "../../hooks/useGraphInteractions";

// 상수 정의
const MAX_EDGE_LABEL_LENGTH = 15;

const ViewerRelationGraph = ({
  elements,
  chapterNum,
  eventNum,
  edgeLabelVisible = true,
  maxChapter,
  filename,
  fitNodeIds,
  searchTerm,
  isSearchActive,
  filteredElements,
}) => {
  const cyRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const [ripples, setRipples] = useState([]);

  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    const nodeData = node.data();
    let names = nodeData.names;
    if (typeof names === "string") {
      try { names = JSON.parse(names); } catch { names = [names]; }
    }
    let main = nodeData.main;
    if (typeof main === "string") main = main === "true";
    setActiveTooltip({
      type: "node",
      ...nodeData,
      names,
      main,
      nodeCenter,
      x: mouseX,
      y: mouseY,
    });
  }, []);

  const onShowEdgeTooltip = useCallback(({ edge, absoluteX, absoluteY }) => {
    setActiveTooltip({
      type: "edge",
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
      x: absoluteX,
      y: absoluteY,
    });
  }, []);

  const onClearTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  // useGraphInteractions 훅 사용
  const {
    tapNodeHandler,
    tapEdgeHandler,
    tapBackgroundHandler,
    clearSelection,
  } = useGraphInteractions({
    cyRef,
    onShowNodeTooltip,
    onShowEdgeTooltip,
    onClearTooltip,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
    isSearchActive,
    filteredElements,
  });

  const nodeSize = getNodeSize('viewer');
  const edgeStyle = getEdgeStyle('viewer');

  const stylesheet = useMemo(
    () => createGraphStylesheet(nodeSize, edgeStyle, edgeLabelVisible, MAX_EDGE_LABEL_LENGTH),
    [nodeSize, edgeStyle, edgeLabelVisible]
  );

  // 그래프 중앙 정렬
  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.center();
    }
  }, [elements]);

  const handleCanvasClick = useCallback((e) => {
    const container = e.currentTarget;
    const ripple = rippleUtils.createRipple(e, container);
    setRipples((prev) => [...prev, ripple]);
    rippleUtils.removeRippleAfter(setRipples, ripple.id);
  }, []);

  return (
    <div className="relation-graph-container" style={graphStyles.container}>
      <div style={graphStyles.tooltipContainer}>
        {activeTooltip?.type === "node" && (
          <UnifiedNodeInfo
            key={`node-tooltip-${activeTooltip.id}`}
            displayMode="tooltip"
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            nodeCenter={activeTooltip.nodeCenter}
            onClose={onClearTooltip}
            inViewer={true}
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            filename={filename}
            elements={elements}
            style={graphStyles.tooltipStyle}
          />
        )}
        {activeTooltip?.type === "edge" && (
          <UnifiedEdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={onClearTooltip}
            sourceNode={activeTooltip.sourceNode}
            targetNode={activeTooltip.targetNode}
            mode="viewer"
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            filename={filename}
            style={graphStyles.tooltipStyle}
          />
        )}
      </div>
      <div className="graph-canvas-area" onClick={handleCanvasClick} style={graphStyles.graphArea}>
        <CytoscapeGraphUnified
          elements={elements}
          stylesheet={stylesheet}
          layout={{ name: 'preset' }}
          cyRef={cyRef}
          nodeSize={nodeSize}
          fitNodeIds={fitNodeIds}
          searchTerm={searchTerm}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          onShowNodeTooltip={onShowNodeTooltip}
          onShowEdgeTooltip={onShowEdgeTooltip}
          onClearTooltip={onClearTooltip}
          selectedNodeIdRef={selectedNodeIdRef}
          selectedEdgeIdRef={selectedEdgeIdRef}
          strictBackgroundClear={true}
        />
        {ripples.map((ripple) => (
          <div
            key={ripple.id}
            className="cytoscape-ripple"
            style={rippleUtils.getRippleStyle(ripple)}
          />
        ))}
      </div>
    </div>
  );
};

export default React.memo(ViewerRelationGraph);
