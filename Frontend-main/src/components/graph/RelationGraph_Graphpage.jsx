import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useParams } from "react-router-dom";
import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import GraphSidebar from "./tooltip/GraphSidebar";
import "./RelationGraph.css";
import { createGraphStylesheet, getNodeSize as getNodeSizeUtil, getEdgeStyle as getEdgeStyleUtil, getWideLayout } from "../../utils/graphStyles";
import { applySearchHighlight } from "../../utils/searchUtils";
import useGraphInteractions from "../../hooks/useGraphInteractions";

const getNodeSize = () => getNodeSizeUtil('graph');
const getEdgeStyle = () => getEdgeStyleUtil('graph');

// 공통 스타일 정의
const commonStyles = {
  emptyState: {
    width: '100%', 
    height: '100%', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '16px'
  },
  emptyStateTitle: {
    fontSize: '20px',
    color: '#6C8EFF',
    fontWeight: '600',
    textAlign: 'center'
  },
  emptyStateDescription: {
    fontSize: '14px',
    color: '#64748b',
    textAlign: 'center',
    maxWidth: '300px',
    lineHeight: '1.5'
  },
  ripple: {
    width: 120,
    height: 120,
  },
  graphContainer: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f8fafc'
  }
};

function StandaloneRelationGraph({ 
  elements, 
  inViewer = false, 
  fullScreen = false, 
  chapterNum, 
  eventNum, 
  newNodeIds, 
  maxChapter, 
  edgeLabelVisible = true,
  fitNodeIds = [],
  searchTerm = "",
  isSearchActive = false,
  filteredElements = null,
}) {
  const cyRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const { filename } = useParams();
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const prevChapterNum = useRef();
  const prevEventNum = useRef();
  const [ripples, setRipples] = useState([]);
  const prevNodeIdsRef = useRef([]);
  const prevEdgeIdsRef = useRef([]);

  const isGraphPage = inViewer && fullScreen;
  const isStandaloneGraphPage = !inViewer;

  const onShowNodeTooltip = useCallback(({ node, nodeCenter, mouseX, mouseY }) => {
    setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
  }, []);

  const onShowEdgeTooltip = useCallback(({ edge, absoluteX, absoluteY }) => {
    setActiveTooltip({
      type: 'edge',
      id: edge.id(),
      x: absoluteX,
      y: absoluteY,
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target(),
    });
  }, []);

  const onClearTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  const { tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, clearSelection, clearSelectionOnly, clearAll } = useGraphInteractions({
    cyRef,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
    isSearchActive,
    filteredElements,
    onClearTooltip,
    onShowNodeTooltip,
    onShowEdgeTooltip,
  });

  const handleCloseTooltip = useCallback(() => {
    setActiveTooltip(null);
    if (isStandaloneGraphPage) {
      clearSelectionOnly();
    } else {
      clearAll();
    }
  }, [clearAll, clearSelectionOnly, isStandaloneGraphPage]);

  // elements 정렬 및 필터링
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  const finalElements = useMemo(() => {
    if (isSearchActive && filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    return sortedElements;
  }, [isSearchActive, filteredElements, sortedElements]);

  const nodeSize = getNodeSize();
  const edgeStyle = getEdgeStyle();

  const stylesheet = useMemo(
    () => createGraphStylesheet(nodeSize, edgeStyle, edgeLabelVisible, 15),
    [nodeSize, edgeStyle, edgeLabelVisible]
  );

  const layout = useMemo(() => getWideLayout(), []);

  // 로딩 상태 관리
  useEffect(() => {
    if (chapterNum !== prevChapterNum.current || eventNum !== prevEventNum.current) {
      setIsGraphLoading(true);
      prevChapterNum.current = chapterNum;
      prevEventNum.current = eventNum;
    }
  }, [chapterNum, eventNum]);

  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
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
  }, [elements, activeTooltip, isSearchActive, filteredElements]);

  const processSelectionEffects = useCallback((newNodeIds, newEdgeIds) => {
    if (!cyRef.current) return;

    if (selectedNodeIdRef.current) {
      const selectedNode = cyRef.current.getElementById(selectedNodeIdRef.current);
      if (selectedNode && selectedNode.length > 0) {
        cyRef.current.batch(() => {
          if (isSearchActive && filteredElements && filteredElements.length > 0) {
            applySearchHighlight(cyRef.current, selectedNode, filteredElements);
          } else {
            applyNodeSelectionEffects(selectedNode, newNodeIds, newEdgeIds);
          }
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
  }, [isSearchActive, filteredElements]);

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
          }, 900);
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
    }, 900);

    if (isStandaloneGraphPage && activeTooltip) {
      const target = e.target;
      if (target === container || target.classList.contains('graph-canvas-area')) {
        handleCloseTooltip();
      }
    }
  }, [isStandaloneGraphPage, activeTooltip, handleCloseTooltip]);

  // 공통 그래프 렌더링 컴포넌트
  const renderGraph = useCallback(() => (
    <div
      className="graph-canvas-area"
      onClick={handleCanvasClick}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {finalElements.length === 0 ? (
        <div style={commonStyles.emptyState}>
          <div style={commonStyles.emptyStateTitle}>
            관계가 없습니다
          </div>
          <div style={commonStyles.emptyStateDescription}>
            현재 챕터에서 선택한 이벤트에는<br />
            등장 인물 간의 관계 정보가 없습니다.
          </div>
        </div>
      ) : (
        <>
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
          <CytoscapeGraphUnified
            elements={finalElements}
            stylesheet={stylesheet}
            layout={layout}
            tapNodeHandler={tapNodeHandler}
            tapEdgeHandler={tapEdgeHandler}
            tapBackgroundHandler={tapBackgroundHandler}
            fitNodeIds={fitNodeIds}
            style={commonStyles.graphContainer}
            cyRef={cyRef}
            newNodeIds={newNodeIds}
            nodeSize={nodeSize}
            searchTerm={searchTerm}
            isSearchActive={isSearchActive}
            filteredElements={filteredElements}
            onLayoutComplete={() => {}}
          />
        </>
      )}
    </div>
  ), [finalElements, ripples, handleCanvasClick, stylesheet, layout, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, fitNodeIds, newNodeIds, nodeSize, searchTerm, isSearchActive, filteredElements]);

  if (fullScreen && inViewer) {
    return (
      <div className="graph-page-container" style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999
      }}>
        <div className="flex-1 relative overflow-hidden w-full h-full">
          <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
            {renderGraph()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden ${fullScreen ? 'graph-container-wrapper' : ''}`} style={{ width: '100%', height: '100%' }}>
      <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
        {renderGraph()}
      </div>

      {isStandaloneGraphPage && (
        <GraphSidebar
          activeTooltip={activeTooltip}
          onClose={handleCloseTooltip}
          chapterNum={chapterNum}
          eventNum={eventNum}
          maxChapter={maxChapter}
          hasNoRelations={!finalElements || finalElements.length === 0}
          filename={filename}
          elements={finalElements}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          searchTerm={searchTerm}
        />
      )}
    </div>
  );
}

export default StandaloneRelationGraph;