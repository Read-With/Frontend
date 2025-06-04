import "./RelationGraph.css";
import React, { useEffect, useRef, useCallback, useState, useLayoutEffect, useMemo } from "react";
import cytoscape from "cytoscape";
import { useRecoilState } from 'recoil';
import { graphElementsState, graphLayoutState, graphNewNodeIdsState } from '../../recoil/graphState';
import { createPortal } from 'react-dom';

// Cytoscape 인스턴스를 전역적으로 유지
const globalState = {
  cy: null,
  container: null,
  isInitialized: false,
  lastElements: null,
  lastNewNodeIds: null,
  lastLayout: null,
  isRendering: false,
  currentGraphId: null,
  globalElements: null,
  isFirstRender: true,
  globalStylesheet: null,
  containerRef: null,
  portalContainer: null,
  isMounted: false,
  isTransitioning: false,
  transitionTimeout: null,
  currentRoute: null,
  isUnmounting: false,
  pendingUpdates: null,
  lastPosition: null,
  lastZoom: null,
  isVisible: true,
  lastChapterNum: null,
};

// 전역 스타일 정의
const globalStyles = {
  container: {
    position: "fixed",
    width: "100%",
    height: "100%",
    overflow: 'hidden',
    background: "#f8fafc",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    willChange: 'transform',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
    perspective: '1000px',
    visibility: 'visible',
    opacity: 1,
    transition: 'opacity 0.3s ease-in-out, visibility 0.3s ease-in-out'
  },
  graph: {
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  }
};

const areElementsEqual = (prevElements, nextElements) => {
  if (!prevElements || !nextElements) return false;
  if (prevElements.length !== nextElements.length) return false;
  
  // 노드와 엣지를 분리하여 비교
  const prevNodes = prevElements.filter(el => el.data && !el.data.source);
  const prevEdges = prevElements.filter(el => el.data && el.data.source);
  const nextNodes = nextElements.filter(el => el.data && !el.data.source);
  const nextEdges = nextElements.filter(el => el.data && el.data.source);

  // 노드 개수 비교
  if (prevNodes.length !== nextNodes.length) return false;
  
  // 엣지 개수 비교
  if (prevEdges.length !== nextEdges.length) return false;

  // 노드 데이터 비교
  const prevNodeMap = new Map(prevNodes.map(node => [node.data.id, node.data]));
  const nextNodeMap = new Map(nextNodes.map(node => [node.data.id, node.data]));

  for (const [id, prevData] of prevNodeMap) {
    const nextData = nextNodeMap.get(id);
    if (!nextData) return false;
    if (JSON.stringify(prevData) !== JSON.stringify(nextData)) return false;
  }

  // 엣지 데이터 비교
  const prevEdgeMap = new Map(prevEdges.map(edge => [edge.data.id, edge.data]));
  const nextEdgeMap = new Map(nextEdges.map(edge => [edge.data.id, edge.data]));

  for (const [id, prevData] of prevEdgeMap) {
    const nextData = nextEdgeMap.get(id);
    if (!nextData) return false;
    if (JSON.stringify(prevData) !== JSON.stringify(nextData)) return false;
  }

  return true;
};

// Portal을 사용하여 DOM 요소를 재사용
const GraphPortal = React.memo(({ children }) => {
  const [portalContainer, setPortalContainer] = useState(null);

  useEffect(() => {
    if (!globalState.portalContainer) {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.zIndex = '1000';
      container.style.opacity = '1';
      container.style.visibility = 'visible';
      container.style.transition = 'opacity 0.3s ease-in-out, visibility 0.3s ease-in-out';
      document.body.appendChild(container);
      globalState.portalContainer = container;
    }
    setPortalContainer(globalState.portalContainer);
    globalState.isMounted = true;
    globalState.isVisible = true;

    return () => {
      if (!globalState.isUnmounting) {
        globalState.isUnmounting = true;
        if (globalState.portalContainer) {
          globalState.portalContainer.style.opacity = '0';
          globalState.portalContainer.style.visibility = 'hidden';
          setTimeout(() => {
            globalState.isVisible = false;
          }, 300);
        }
      }
      globalState.isMounted = false;
      if (globalState.transitionTimeout) {
        clearTimeout(globalState.transitionTimeout);
      }
    };
  }, []);

  if (!portalContainer) return null;
  return createPortal(children, portalContainer);
});

const CytoscapeGraph = React.memo(
  React.forwardRef(
    ({ 
      elements: initialElements, 
      stylesheet, 
      layout, 
      fitNodeIds,
      tapNodeHandler,
      tapEdgeHandler,
      tapBackgroundHandler,
      ripples = [],
      style = {},
      onLayoutReady,
      newNodeIds: initialNewNodeIds,
      currentRoute,
    }, ref) => {
      const cyRef = useRef(null);
      const containerRef = useRef(null);
      const prevElementsRef = useRef([]);
      const [elements, setElements] = useRecoilState(graphElementsState);
      const [graphLayout, setGraphLayout] = useRecoilState(graphLayoutState);
      const [newNodeIds, setNewNodeIds] = useRecoilState(graphNewNodeIdsState);

      // 마운트/언마운트 시점 로그
      useEffect(() => {
      }, []);

      // elements의 id 배열이 바뀔 때마다 로그
      useEffect(() => {
        if (!initialElements) {
        } else {
          const ids = initialElements.map(el => el.data && el.data.id).filter(Boolean);
        }
      }, [initialElements]);

      // 현재 그래프의 고유 ID 생성
      const currentElementsId = useMemo(() => {
        if (!initialElements) return null;
        return initialElements.map(el => el.data.id).join(',');
      }, [initialElements]);

      // 메모이제이션된 elements 비교
      const memoizedElements = useMemo(() => {
        if (!initialElements) return elements;
        
        // 첫 렌더링이거나 이전 요소가 없는 경우
        if (globalState.isFirstRender || !globalState.globalElements) {
          globalState.isFirstRender = false;
          globalState.globalElements = initialElements;
          return initialElements;
        }

        // 이전 요소와 완전히 동일하면 이전 요소를 그대로 사용
        if (areElementsEqual(globalState.globalElements, initialElements)) {
          return globalState.globalElements;
        }

        // 실제로 다른 그래프인 경우에만 업데이트
        globalState.globalElements = initialElements;
        return initialElements;
      }, [initialElements, elements]);

      // 메모이제이션된 newNodeIds
      const memoizedNewNodeIds = useMemo(() => {
        if (!initialNewNodeIds) return newNodeIds;
        return initialNewNodeIds.length > 0 ? initialNewNodeIds : newNodeIds;
      }, [initialNewNodeIds, newNodeIds]);

      // 메모이제이션된 스타일시트
      const memoizedStylesheet = useMemo(() => {
        if (!stylesheet) return globalState.globalStylesheet;
        if (globalState.globalStylesheet && JSON.stringify(globalState.globalStylesheet) === JSON.stringify(stylesheet)) {
          return globalState.globalStylesheet;
        }
        globalState.globalStylesheet = stylesheet;
        return stylesheet;
      }, [stylesheet]);

      // Cytoscape 인스턴스 초기화
      const initializeCytoscape = useCallback((container) => {
        if (!container) return;
        // chapterNum이 바뀔 때만 destroy/new
        if (globalState.cy && globalState.lastChapterNum !== currentRoute?.chapterNum) {
          globalState.cy.removeAllListeners && globalState.cy.removeAllListeners();
          globalState.cy.destroy && globalState.cy.destroy();
          globalState.cy = null;
          globalState.isInitialized = false;
        }
        // 인스턴스가 없으면 생성
        if (!globalState.cy) {
        const cy = cytoscape({
          container: container,
          elements: memoizedElements,
          style: memoizedStylesheet,
          layout: { name: 'preset' },
          userZoomingEnabled: true,
          userPanningEnabled: true,
          minZoom: 0.05,
          maxZoom: 2.5,
        });
        globalState.cy = cy;
        globalState.container = container;
          globalState.lastChapterNum = currentRoute?.chapterNum;
        
        if (!globalState.isInitialized) {
          // 저장된 레이아웃 상태 복원
          if (globalState.lastLayout) {
            cy.zoom(globalState.lastLayout.zoom);
            cy.pan(globalState.lastLayout.pan);
          } else if (graphLayout) {
            cy.zoom(graphLayout.zoom);
            cy.pan(graphLayout.pan);
            globalState.lastLayout = graphLayout;
          }

          // 레이아웃 변경 이벤트 핸들러
          cy.on('zoom pan', () => {
            const newLayout = {
              zoom: cy.zoom(),
              pan: cy.pan()
            };
            globalState.lastLayout = newLayout;
            globalState.lastZoom = cy.zoom();
            globalState.lastPosition = cy.pan();
            setGraphLayout(newLayout);
          });

          if (tapNodeHandler) {
            cy.on('tap', 'node', tapNodeHandler);
          }
          
          if (tapEdgeHandler) {
            cy.on('tap', 'edge', tapEdgeHandler);
          }
          
          if (tapBackgroundHandler) {
            cy.on('tap', tapBackgroundHandler);
          }

          globalState.isInitialized = true;
          }
        }
        return globalState.cy;
      }, [graphLayout, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, setGraphLayout, memoizedElements, memoizedStylesheet, currentRoute]);

      // Cytoscape 인스턴스 설정
      useLayoutEffect(() => {
        if (containerRef.current) {
          const cy = initializeCytoscape(containerRef.current);
          if (cy) {
            cyRef.current = cy;
            if (typeof ref === 'function') {
              ref(cy);
            } else if (ref) {
              ref.current = cy;
            }
          }
        }
      }, [initializeCytoscape]);

      // elements 업데이트
      useLayoutEffect(() => {
        if (!cyRef.current || globalState.isRendering || !globalState.isMounted) {
          return;
        }
        
        const cy = cyRef.current;
        const prevElements = prevElementsRef.current;

        // 요소가 완전히 동일하면 아예 업데이트하지 않음
        if (areElementsEqual(prevElements, memoizedElements)) {
          return;
        }

        // 실제로 변경된 요소만 찾아서 업데이트
        const prevNodeIds = new Set(prevElements.filter(el => el.data && !el.data.source).map(el => el.data.id));
        const prevEdgeIds = new Set(prevElements.filter(el => el.data && el.data.source).map(el => el.data.id));
        const currNodeIds = new Set(memoizedElements.filter(el => el.data && !el.data.source).map(el => el.data.id));
        const currEdgeIds = new Set(memoizedElements.filter(el => el.data && el.data.source).map(el => el.data.id));
        
        const addedNodes = memoizedElements.filter(el => el.data && !el.data.source && !prevNodeIds.has(el.data.id));
        const addedEdges = memoizedElements.filter(el => el.data && el.data.source && !prevEdgeIds.has(el.data.id));
        const removedNodeIds = [...prevNodeIds].filter(id => !currNodeIds.has(id));
        const removedEdgeIds = [...prevEdgeIds].filter(id => !currEdgeIds.has(id));

        // 변경사항이 있는 경우에만 업데이트
        if (addedNodes.length > 0 || addedEdges.length > 0 || removedNodeIds.length > 0 || removedEdgeIds.length > 0) {
          globalState.isRendering = true;

          // 노드 추가/제거인 경우
          if (addedNodes.length > 0 || removedNodeIds.length > 0) {
            // 기존 노드들의 스타일을 미리 설정
            cy.nodes().forEach(node => {
              if (!addedNodes.some(n => n.data.id === node.id())) {
                node.style({
                  'opacity': 0.4,
                  'transition-property': 'opacity',
                  'transition-duration': '0.5s',
                  'transition-timing-function': 'ease-in-out'
                });
              }
            });

            // 새 노드 추가
            if (addedNodes.length > 0) {
              cy.add(addedNodes);
              // 새 노드들에 강조 효과 적용
              addedNodes.forEach(node => {
                const cyNode = cy.getElementById(node.data.id);
                if (cyNode.length > 0) {
                  cyNode.style({
                    'opacity': 0,
                    'transition-property': 'opacity, background-color, border-color, border-width',
                    'transition-duration': '0.8s',
                    'transition-timing-function': 'ease-in-out'
                  });
                  
                  cyNode.animate({
                    style: {
                      'opacity': 1,
                      'background-color': '#ffd700',
                      'border-width': '4px',
                      'border-color': '#ff4500',
                      'border-opacity': 1,
                      'z-index': 999
                    },
                    duration: 800,
                    easing: 'ease-in-out'
                  }).promise('complete').then(() => {
                    cyNode.animate({
                      style: {
                        'background-color': '#ffffff',
                        'border-width': '2px',
                        'border-color': '#666666',
                        'border-opacity': 0.8
                      },
                      duration: 800,
                      easing: 'ease-in-out'
                    });
                  });
                }
              });

              // 다른 노드들의 스타일 복원
              setTimeout(() => {
                cy.nodes().forEach(n => {
                  if (!addedNodes.some(added => added.data.id === n.id())) {
                    n.animate({
                      style: {
                        'opacity': 1
                      },
                      duration: 500,
                      easing: 'ease-in-out'
                    });
                  }
                });
              }, 1000);
            }

            // 노드 제거
            if (removedNodeIds.length > 0) {
              removedNodeIds.forEach(id => {
                const cyNode = cy.getElementById(id);
                if (cyNode.length > 0) {
                  cyNode.animate({
                    style: {
                      'opacity': 0,
                      'scale': 0.8
                    },
                    duration: 500,
                    easing: 'ease-in-out'
                  }).promise('complete').then(() => {
                    cy.remove(cyNode);
                  });
                }
              });
            }
          }

          // 엣지 추가/제거
          if (addedEdges.length > 0) {
            cy.add(addedEdges);
            addedEdges.forEach(edge => {
              const cyEdge = cy.getElementById(edge.data.id);
              if (cyEdge.length > 0) {
                cyEdge.style({
                  'opacity': 0,
                  'transition-property': 'opacity',
                  'transition-duration': '0.5s'
                });
                cyEdge.animate({
                  style: {
                    'opacity': 1
                  },
                  duration: 500,
                  easing: 'ease-in-out'
                });
              }
            });
          }
          
          if (removedEdgeIds.length > 0) {
            removedEdgeIds.forEach(id => {
              const cyEdge = cy.getElementById(id);
              if (cyEdge.length > 0) {
                cyEdge.animate({
                  style: {
                    'opacity': 0
                  },
                  duration: 500,
                  easing: 'ease-in-out'
                }).promise('complete').then(() => {
                  cy.remove(cyEdge);
                });
              }
            });
          }

          // 기존 요소 업데이트 (데이터가 변경된 경우에만)
          memoizedElements.forEach(element => {
            const existingElement = cy.getElementById(element.data.id);
            if (existingElement.length > 0) {
              const currentData = existingElement.data();
              const newData = element.data;
              if (JSON.stringify(currentData) !== JSON.stringify(newData)) {
                existingElement.data(newData);
                if (element.position) {
                  existingElement.position(element.position);
                }
              }
            }
          });
          
          globalState.isRendering = false;
        }
        
        prevElementsRef.current = memoizedElements;
      }, [memoizedElements]);

      const handleWheel = useCallback(e => {
        if (!cyRef.current) return;
        const cy = cyRef.current;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.99995 : 1.000005;
        cy.zoom({
          level: cy.zoom() * factor,
          renderedPosition: { x, y },
          animate: true,
          duration: 220,
          easing: 'ease-in-out',
        });
      }, []);

      if (graphDiff.added && graphDiff.added.length > 0) {
        // ... 기존 깜빡임 코드 ...
      }

      return (
        <GraphPortal>
          <div
            ref={containerRef}
            className="graph-canvas-area"
            onWheel={handleWheel}
            style={{
              ...globalStyles.container,
              opacity: globalState.isUnmounting ? 0 : 1,
              transition: 'opacity 0.3s ease-in-out'
            }}
          />
        </GraphPortal>
      );
    }
  ),
  (prevProps, nextProps) => {
    // 실제로 다른 그래프인 경우에만 리렌더링
    if (!areElementsEqual(prevProps.elements, nextProps.elements)) {
      return false;
    }
    if (prevProps.newNodeIds !== nextProps.newNodeIds) {
      return false;
    }
    if (prevProps.stylesheet !== nextProps.stylesheet) {
      return false;
    }
    return true;
  }
);

export default CytoscapeGraph;