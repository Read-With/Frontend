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
import { getNodeSize, getEdgeStyle, createGraphStylesheet } from "../../utils/graphStyles";
import useGraphInteractions from "../../hooks/useGraphInteractions";

// 상수 정의
const MAX_EDGE_LABEL_LENGTH = 15;

// 공통 스타일 정의
const commonStyles = {
  container: {
    width: "100%", 
    height: "100%", 
    position: "relative" 
  },
  tooltipContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 9999,
  },
  tooltipStyle: {
    pointerEvents: "auto" 
  },
  graphArea: {
    position: "relative", 
    width: "100%", 
    height: "100%" 
  },
  ripple: {
    width: 120,
    height: 120,
  }
};

const ViewerRelationGraph = ({
  elements,
  chapterNum,
  eventNum,
  edgeLabelVisible = true,
  maxChapter,
  filename,
}) => {
  const cyRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const [ripples, setRipples] = useState([]);
  const prevNodeIdsRef = useRef([]);
  const prevEdgeIdsRef = useRef([]);

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

  const { tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, clearSelection } = useGraphInteractions({
    cyRef,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
    isSearchActive: false,
    filteredElements: [],
    onClearTooltip,
    onShowNodeTooltip,
    onShowEdgeTooltip,
  });

  const handleCloseTooltip = useCallback(() => {
    setActiveTooltip(null);
    clearSelection();
  }, [clearSelection]);

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

  // 새로 추가된 요소들 처리
  const processNewElements = useCallback(() => {
    if (!elements || elements.length === 0 || !cyRef.current) {
      prevNodeIdsRef.current = [];
      return;
    }
    
    const currentNodeIds = elements
      .filter((e) => e.data && !e.data.source)
      .map((e) => e.data.id);
    const prevNodeIds = prevNodeIdsRef.current;
    const newNodeIds = currentNodeIds.filter((id) => !prevNodeIds.includes(id));
    prevNodeIdsRef.current = currentNodeIds;
    
    const currentEdgeIds = elements
      .filter((e) => e.data && e.data.source)
      .map((e) => e.data.id);
    const prevEdgeIds = prevEdgeIdsRef.current || [];
    const newEdgeIds = currentEdgeIds.filter((id) => !prevEdgeIds.includes(id));
    prevEdgeIdsRef.current = currentEdgeIds;
    
    const hasSelection = selectedNodeIdRef.current || selectedEdgeIdRef.current || activeTooltip;
    
    if (hasSelection) {
      processSelectionEffects(newNodeIds, newEdgeIds);
    } else {
      applyRippleEffects(newNodeIds);
    }
  }, [elements, activeTooltip]);

  const processSelectionEffects = useCallback((newNodeIds, newEdgeIds) => {
    if (!cyRef.current) return;

    if (selectedNodeIdRef.current) {
      const selectedNode = cyRef.current.getElementById(selectedNodeIdRef.current);
      if (selectedNode && selectedNode.length > 0) {
        cyRef.current.batch(() => {
          applyNodeSelectionEffects(selectedNode, newNodeIds, newEdgeIds);
        });
      }
    }
    
    if (selectedEdgeIdRef.current) {
      const selectedEdge = cyRef.current.getElementById(selectedEdgeIdRef.current);
      if (selectedEdge && selectedEdge.length > 0) {
        cyRef.current.batch(() => {
          applyEdgeSelectionEffects(selectedEdge, newNodeIds, newEdgeIds);
        });
      }
    }
  }, []);

  const applyNodeSelectionEffects = useCallback((selectedNode, newNodeIds, newEdgeIds) => {
    newNodeIds.forEach((id) => {
      const newNode = cyRef.current.getElementById(id);
      if (newNode && newNode.length > 0) {
        const connectedEdges = selectedNode.connectedEdges().intersection(newNode.connectedEdges());
        if (connectedEdges.length > 0) {
          newNode.removeClass("faded");
          const connectedNodes = selectedNode.neighborhood().nodes();
          if (connectedNodes.has(newNode)) {
            newNode.addClass("highlighted");
          }
        } else {
          newNode.addClass("faded");
        }
      }
    });
    
    newEdgeIds.forEach((id) => {
      const newEdge = cyRef.current.getElementById(id);
      if (newEdge && newEdge.length > 0) {
        const sourceNode = newEdge.source();
        const targetNode = newEdge.target();
        
        if (sourceNode.same(selectedNode) || targetNode.same(selectedNode)) {
          newEdge.removeClass("faded");
        } else {
          newEdge.addClass("faded");
        }
      }
    });
  }, []);

  const applyEdgeSelectionEffects = useCallback((selectedEdge, newNodeIds, newEdgeIds) => {
    newNodeIds.forEach((id) => {
      const newNode = cyRef.current.getElementById(id);
      if (newNode && newNode.length > 0) {
        const sourceNode = selectedEdge.source();
        const targetNode = selectedEdge.target();
        
        if (newNode.same(sourceNode) || newNode.same(targetNode)) {
          newNode.removeClass("faded").addClass("highlighted");
        } else {
          newNode.addClass("faded");
        }
      }
    });
    
    newEdgeIds.forEach((id) => {
      const newEdge = cyRef.current.getElementById(id);
      if (newEdge && newEdge.length > 0) {
        const selectedSource = selectedEdge.source();
        const selectedTarget = selectedEdge.target();
        const newSource = newEdge.source();
        const newTarget = newEdge.target();
        
        if (newSource.same(selectedSource) || newSource.same(selectedTarget) ||
            newTarget.same(selectedSource) || newTarget.same(selectedTarget)) {
          newEdge.removeClass("faded");
        } else {
          newEdge.addClass("faded");
        }
      }
    });
  }, []);

  const applyRippleEffects = useCallback((newNodeIds) => {
    newNodeIds.forEach((id) => {
      const node = cyRef.current.getElementById(id);
      if (node && node.length > 0) {
        const pos = node.renderedPosition();
        const container = document.querySelector(".graph-canvas-area");
        if (container && pos) {
          const rect = container.getBoundingClientRect();
          const x = pos.x + rect.left;
          const y = pos.y + rect.top;
          const rippleId = Date.now() + Math.random();
          setRipples((prev) => [...prev, { id: rippleId, x: x - rect.left, y: y - rect.top }]);
          setTimeout(() => {
            setRipples((prev) => prev.filter((r) => r.id !== rippleId));
          }, 700);
        }
      }
    });
  }, []);

  useEffect(() => {
    processNewElements();
  }, [processNewElements]);

  const handleCanvasClick = useCallback((e) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 700);
  }, []);

  return (
    <div className="relation-graph-container" style={commonStyles.container}>
      <div style={commonStyles.tooltipContainer}>
        {activeTooltip?.type === "node" && (
          <UnifiedNodeInfo
            key={`node-tooltip-${activeTooltip.id}`}
            displayMode="tooltip"
            data={activeTooltip}
            x={activeTooltip.x}
            y={activeTooltip.y}
            nodeCenter={activeTooltip.nodeCenter}
            onClose={handleCloseTooltip}
            inViewer={true}
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            filename={filename}
            elements={elements}
            style={commonStyles.tooltipStyle}
          />
        )}
        {activeTooltip?.type === "edge" && (
          <UnifiedEdgeTooltip
            key={`edge-tooltip-${activeTooltip.id}`}
            data={activeTooltip.data}
            x={activeTooltip.x}
            y={activeTooltip.y}
            onClose={handleCloseTooltip}
            sourceNode={activeTooltip.sourceNode}
            targetNode={activeTooltip.targetNode}
            mode="viewer"
            chapterNum={chapterNum}
            eventNum={eventNum}
            maxChapter={maxChapter}
            filename={filename}
            style={commonStyles.tooltipStyle}
          />
        )}
      </div>
      <div className="graph-canvas-area" onClick={handleCanvasClick} style={commonStyles.graphArea}>
        <CytoscapeGraphUnified
          elements={elements}
          stylesheet={stylesheet}
          layout={{ name: 'preset' }}
          tapNodeHandler={tapNodeHandler}
          tapEdgeHandler={tapEdgeHandler}
          tapBackgroundHandler={tapBackgroundHandler}
          cyRef={cyRef}
          nodeSize={nodeSize}
        />
        {ripples.map((ripple) => (
          <div
            key={ripple.id}
            className="cytoscape-ripple"
            style={{
              left: ripple.x - 60,
              top: ripple.y - 60,
              ...commonStyles.ripple
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default React.memo(ViewerRelationGraph);
