import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import CytoscapeGraphUnified from "./CytoscapeGraphUnified";
import GraphNodeTooltip from "./tooltip/NodeTooltip";
import UnifiedEdgeTooltip from "./tooltip/UnifiedEdgeTooltip";
import GraphSidebar from "./GraphSidebar";
import "./RelationGraph.css";
import { DEFAULT_LAYOUT, createGraphStylesheet, getNodeSize as getNodeSizeUtil, getEdgeStyle as getEdgeStyleUtil, getRelationColor, getWideLayout } from "../../utils/graphStyles";
import { applySearchHighlight } from "../../utils/searchUtils";
import useGraphInteractions from "../../hooks/useGraphInteractions";

const getNodeSize = () => getNodeSizeUtil('graph');
const getEdgeStyle = () => getEdgeStyleUtil('graph');

function StandaloneRelationGraph({ 
  elements, 
  inViewer = false, 
  fullScreen = false, 
  onFullScreen, 
  onExitFullScreen, 
  graphViewState, 
  setGraphViewState, 
  chapterNum, 
  eventNum, 
  hideIsolated, 
  maxEventNum, 
  newNodeIds, 
  maxChapter, 
  edgeLabelVisible = true,
  fitNodeIds = [],
  searchTerm = "",
  isSearchActive = false,
  filteredElements = null, // 검색된 요소들 (null이면 elements 사용)
}) {
  const cyRef = useRef(null);
  const hasCenteredRef = useRef(false); // 최초 1회만 중앙정렬
  const [activeTooltip, setActiveTooltip] = useState(null); // 하나의 툴팁만 관리
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { filename } = useParams();
  const prevElementsRef = useRef();
  const prevEventJsonRef = useRef();
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const prevChapterNum = useRef();
  const prevEventNum = useRef();
  const prevElementsStr = useRef();
  const [ripples, setRipples] = useState([]);
  const prevNodeIdsRef = useRef([]);
  const prevEdgeIdsRef = useRef([]);

  // gatsby.epub 단독 그래프 페이지에서만 간격을 더 넓게
  const isGraphPage = inViewer && fullScreen;
  
  // 그래프 단독 페이지 여부 확인
  const isStandaloneGraphPage = !inViewer;

  // activeTooltip 상태 변화 감지
  useEffect(() => {
    // activeTooltip 상태 변화 처리
  }, [activeTooltip]);

  const { tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, clearSelection, clearSelectionOnly, clearAll } = useGraphInteractions({
    cyRef,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    strictBackgroundClear: true,
    isSearchActive,
    filteredElements,
    onClearTooltip: () => {
      setActiveTooltip(null);
    },
    onShowNodeTooltip: ({ node, nodeCenter, mouseX, mouseY }) => {
      const tooltipData = { type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter };
      setActiveTooltip(tooltipData);
    },
    onShowEdgeTooltip: ({ edge, absoluteX, absoluteY }) => {
      setActiveTooltip({
        type: 'edge',
        id: edge.id(),
        x: absoluteX,
        y: absoluteY,
        data: edge.data(),
        sourceNode: edge.source(),
        targetNode: edge.target(),
      });
    },
  });

  const handleCloseTooltip = useCallback(() => {
    setActiveTooltip(null);
    if (isStandaloneGraphPage) {
      // 그래프 단독 페이지에서는 선택 상태만 초기화 (사이드바 닫기)
      clearSelectionOnly();
    } else {
      // 다른 페이지에서는 툴팁도 함께 초기화
      clearAll();
    }
  }, [clearAll, clearSelectionOnly, isStandaloneGraphPage]);

  // elements/filteredElements를 id 기준으로 정렬해서 비교 및 전달
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  // 검색된 요소들 또는 원래 요소들 사용
  const finalElements = useMemo(() => {
    // 검색이 활성화되어 있고 필터된 요소가 있으면 사용
    if (isSearchActive && filteredElements && filteredElements.length > 0) {
      return filteredElements;
    }
    // 그렇지 않으면 원본 elements 사용
    return sortedElements;
  }, [isSearchActive, filteredElements, sortedElements]);

  // currentEventJson이 내용이 같으면 참조도 같게 useMemo로 캐싱
  const stableEventJson = useMemo(() => graphViewState ? JSON.stringify(graphViewState) : '', [graphViewState]);

  const nodeSize = getNodeSize();
  const edgeStyle = getEdgeStyle();

  // utils의 createGraphStylesheet 함수 사용
  const stylesheet = useMemo(
    () => createGraphStylesheet(nodeSize, edgeStyle, edgeLabelVisible, 15),
    [nodeSize, edgeStyle, edgeLabelVisible]
  );

  // === 오직 chapter_node_positions_{chapterNum}만 사용하여 노드 위치 복원 (절대적 위치) ===

  // 개선된 코드: chapterNum, eventNum이 바뀔 때만 로딩 오버레이 표시
  useEffect(() => {
    if (chapterNum !== prevChapterNum.current || eventNum !== prevEventNum.current) {
      setIsGraphLoading(true);
      prevChapterNum.current = chapterNum;
      prevEventNum.current = eventNum;
    }
  }, [chapterNum, eventNum]);

  // elements가 변경될 때 로딩 상태 업데이트
  useEffect(() => {
    if (elements) {
      setIsGraphLoading(false);
    }
  }, [elements]);

  // elements가 변경될 때 새로 등장한 노드와 간선에 선택 효과 적용
  useEffect(() => {
    if (!elements || elements.length === 0 || !cyRef.current) {
      prevNodeIdsRef.current = [];
      return;
    }
    
    // 새로 추가된 노드들 찾기
    const currentNodeIds = elements
      .filter((e) => e.data && !e.data.source)
      .map((e) => e.data.id);
    const prevNodeIds = prevNodeIdsRef.current;
    const newNodeIds = currentNodeIds.filter((id) => !prevNodeIds.includes(id));
    prevNodeIdsRef.current = currentNodeIds;
    
    // 새로 추가된 간선들 찾기
    const currentEdgeIds = elements
      .filter((e) => e.data && e.data.source)
      .map((e) => e.data.id);
    const prevEdgeIds = prevEdgeIdsRef.current || [];
    const newEdgeIds = currentEdgeIds.filter((id) => !prevEdgeIds.includes(id));
    prevEdgeIdsRef.current = currentEdgeIds;
    
    // 현재 선택된 노드나 간선이 있는지 확인
    const hasSelection = selectedNodeIdRef.current || selectedEdgeIdRef.current || activeTooltip;
    
    if (hasSelection) {
      // 선택된 노드가 있는 경우
      if (selectedNodeIdRef.current) {
        const selectedNode = cyRef.current.getElementById(selectedNodeIdRef.current);
        if (selectedNode && selectedNode.length > 0) {
          cyRef.current.batch(() => {
            // utils의 applySearchHighlight 함수 활용
            if (isSearchActive && filteredElements && filteredElements.length > 0) {
              applySearchHighlight(cyRef.current, selectedNode, filteredElements);
            } else {
              // 일반 상태에서는 기존 로직 사용
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
            }
          });
        }
      }
      
      // 선택된 간선이 있는 경우
      if (selectedEdgeIdRef.current) {
        const selectedEdge = cyRef.current.getElementById(selectedEdgeIdRef.current);
        if (selectedEdge && selectedEdge.length > 0) {
          cyRef.current.batch(() => {
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
          });
        }
      }
    } else {
      // 선택이 없는 경우: 새로 등장한 노드에 ripple 효과만 적용
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
    }
  }, [elements, activeTooltip, isSearchActive, filteredElements]);

  // elements, stylesheet, layout, searchLayout, style useMemo 최적화
  const memoizedElements = useMemo(() => finalElements, [finalElements]);
  const memoizedStylesheet = useMemo(() => stylesheet, [stylesheet]);
  const memoizedLayout = useMemo(() => getWideLayout(), []);
  const memoizedStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f8fafc'
  }), []);

  // 디버깅을 위한 로그 추가
  useEffect(() => {
    console.log('StandaloneRelationGraph Debug:', {
      elements: elements?.length,
      finalElements: finalElements?.length,
      memoizedElements: memoizedElements?.length,
      sortedElements: sortedElements?.length,
      isSearchActive,
      filteredElements: filteredElements?.length,
      chapterNum,
      eventNum,
      maxChapter
    });
  }, [elements, finalElements, memoizedElements, sortedElements, isSearchActive, filteredElements, chapterNum, eventNum, maxChapter]);

  const handleCanvasClick = (e) => {
    // 리플 효과만 처리
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 700);

    // 툴팁 닫기는 로직은 useGraphInteractions의 tapBackgroundHandler에서 처리
  };

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
        {/* 그래프 본문만 렌더링 (상단바는 RelationGraphWrapper에서 처리) */}
        <div className="flex-1 relative overflow-hidden w-full h-full">
          <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
                      {/* 툴팁 렌더링 */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>

            {activeTooltip?.type === 'node' && activeTooltip.data && (
                <GraphNodeTooltip
                  key={`node-tooltip-${activeTooltip.id}`}
                  data={activeTooltip.data}
                  x={activeTooltip.x}
                  y={activeTooltip.y}
                  nodeCenter={activeTooltip.nodeCenter}
                  onClose={handleCloseTooltip}
                  inViewer={inViewer}
                  chapterNum={chapterNum}
                  eventNum={eventNum}
                  maxChapter={maxChapter}
                  elements={finalElements}
                  style={{ pointerEvents: 'auto' }}
                />
              )}
              {activeTooltip?.type === 'edge' && activeTooltip.data && (
                inViewer ? (
                  <UnifiedEdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    chapterNum={chapterNum}
                    eventNum={eventNum}
                    style={{ pointerEvents: 'auto' }}
                  />
                ) : (
                  <UnifiedEdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    chapterNum={chapterNum}
                    eventNum={eventNum}
                    style={{ pointerEvents: 'auto' }}
                  />
                )
              )}
            </div>
                         {/* 그래프 영역 */}
             <div
               className="graph-canvas-area"
               onClick={handleCanvasClick}
               style={{ position: "relative", width: "100%", height: "100%" }}
             >
               {memoizedElements.length === 0 ? (
                 <div style={{ 
                   width: '100%', 
                   height: '100%', 
                   display: 'flex', 
                   alignItems: 'center', 
                   justifyContent: 'center',
                   flexDirection: 'column',
                   gap: '16px'
                 }}>
                   <div style={{
                     fontSize: '20px',
                     color: '#6C8EFF',
                     fontWeight: '600',
                     textAlign: 'center'
                   }}>
                     관계가 없습니다
                   </div>
                   <div style={{
                     fontSize: '14px',
                     color: '#64748b',
                     textAlign: 'center',
                     maxWidth: '300px',
                     lineHeight: '1.5'
                   }}>
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
                         width: 120,
                         height: 120,
                       }}
                     />
                   ))}
                   <CytoscapeGraphUnified
                     elements={finalElements}
                     stylesheet={memoizedStylesheet}
                     layout={memoizedLayout}
                     tapNodeHandler={tapNodeHandler}
                     tapEdgeHandler={tapEdgeHandler}
                     tapBackgroundHandler={tapBackgroundHandler}
                     fitNodeIds={fitNodeIds}
                     style={memoizedStyle}
                     cyRef={cyRef}
                     newNodeIds={newNodeIds}
                     nodeSize={nodeSize}
                     searchTerm={searchTerm}
                     isSearchActive={isSearchActive}
                     filteredElements={filteredElements}
                     onLayoutComplete={() => {
                       console.log('Layout completed for fullScreen mode');
                     }}
                   />
                 </>
               )}
             </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden ${fullScreen ? 'graph-container-wrapper' : ''}`} style={{ width: '100%', height: '100%' }}>
      {/* < 버튼은 inViewer && !fullScreen일 때만 보임 */}
      {/* 기존 중앙 고정 < 버튼 완전히 제거 */}

      <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
        {/* 툴팁 렌더링 - 그래프 단독 페이지가 아닐 때만 */}
        {!isStandaloneGraphPage && (
          <>

            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
                {activeTooltip?.type === 'node' && activeTooltip.data && (
                  <GraphNodeTooltip
                    key={`node-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    nodeCenter={activeTooltip.nodeCenter}
                    onClose={handleCloseTooltip}
                    inViewer={inViewer}
                    chapterNum={chapterNum}
                    eventNum={eventNum}
                    maxChapter={maxChapter}
                    elements={finalElements}
                    style={{ pointerEvents: 'auto' }}
                  />
                )}
                {activeTooltip?.type === 'edge' && activeTooltip.data && (
                  <UnifiedEdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    mode={inViewer ? 'viewer' : 'standalone'}
                    chapterNum={chapterNum}
                    eventNum={eventNum}
                    maxChapter={maxChapter}
                    style={{ pointerEvents: 'auto' }}
                  />
                )}
              </div>
          </>
        )}

        {/* 그래프 영역 */}
        <div
          className="graph-canvas-area"
          onClick={handleCanvasClick}
          style={{ position: "relative", width: "100%", height: "100%" }}
        >
          {memoizedElements.length === 0 ? (
            <div style={{ 
              width: '100%', 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{
                fontSize: '20px',
                color: '#6C8EFF',
                fontWeight: '600',
                textAlign: 'center'
              }}>
                관계가 없습니다
              </div>
              <div style={{
                fontSize: '14px',
                color: '#64748b',
                textAlign: 'center',
                maxWidth: '300px',
                lineHeight: '1.5'
              }}>
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
                    width: 120,
                    height: 120,
                  }}
                />
              ))}
              <CytoscapeGraphUnified
                elements={finalElements}
                stylesheet={memoizedStylesheet}
                layout={memoizedLayout}
                tapNodeHandler={tapNodeHandler}
                tapEdgeHandler={tapEdgeHandler}
                tapBackgroundHandler={tapBackgroundHandler}
                fitNodeIds={fitNodeIds}
                style={memoizedStyle}
                cyRef={cyRef}
                newNodeIds={newNodeIds}
                nodeSize={nodeSize}
                searchTerm={searchTerm}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                onLayoutComplete={() => {
                  console.log('Layout completed for normal mode');
                }}
              />
            </>
          )}
        </div>
      </div>

             {/* 그래프 단독 페이지에서 슬라이드바 렌더링 */}
       {isStandaloneGraphPage && (
         <>

           <GraphSidebar
             activeTooltip={activeTooltip}
             onClose={handleCloseTooltip}
             chapterNum={chapterNum}
             eventNum={eventNum}
             maxChapter={maxChapter}
             hasNoRelations={!memoizedElements || memoizedElements.length === 0}
             filename={filename}
             elements={finalElements}
             isSearchActive={isSearchActive}
             filteredElements={filteredElements}
             searchTerm={searchTerm}
           />
         </>
       )}
    </div>
  );
}

export default StandaloneRelationGraph;