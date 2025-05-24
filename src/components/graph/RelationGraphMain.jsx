import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import GraphControls from "./GraphControls";
import CytoscapeGraph from "./CytoscapeGraph";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";
import { FaTimes, FaClock } from 'react-icons/fa';

function getRelationColor(positivity) {
  if (positivity > 0.6) return '#15803d';
  if (positivity > 0.3) return '#059669';
  if (positivity > -0.3) return '#6b7280';
  if (positivity > -0.6) return '#dc2626';
  return '#991b1b';
}

function RelationGraphMain({ elements, inViewer = false, fullScreen = false, onFullScreen, onExitFullScreen, graphViewState, setGraphViewState, chapterNum, eventNum, hideIsolated, maxEventNum }) {
  const cyRef = useRef(null);
  const hasCenteredRef = useRef(false); // 최초 1회만 중앙정렬
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
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

  // gatsby.epub 단독 그래프 페이지에서만 간격을 더 넓게
  const isGraphPage = inViewer && fullScreen;

  // 타임라인으로 이동하는 함수
  const handleViewTimeline = () => {
    navigate(`/viewer/${filename}/timeline`, { state: location.state });
  };

  // 노드 클릭 시 툴팁 표시
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const pos = node.renderedPosition();
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const container = document.querySelector('.graph-canvas-area');
    const containerRect = container.getBoundingClientRect();
    // 노드 중심의 화면 좌표 계산
    const nodeCenter = {
      x: pos.x * zoom + pan.x + containerRect.left,
      y: pos.y * zoom + pan.y + containerRect.top,
    };
    setActiveTooltip(null);
    cy.batch(() => {
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");
      node.removeClass("faded").addClass("highlighted");
    });
    // 마우스 포인터 위치를 툴팁에 넘김
    const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
    const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;
    setTimeout(() => {
      setActiveTooltip({ type: 'node', id: node.id(), x: mouseX, y: mouseY, data: node.data(), nodeCenter });
    }, 0);
  }, []);

  // 간선 클릭 시 툴팁 표시 (좌표 변환)
  const tapEdgeHandler = useCallback(
    (evt) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const edge = evt.target;
      const container = document.querySelector(".graph-canvas-area");
      const containerRect = container.getBoundingClientRect();

      // Cytoscape의 midpoint는 그래프 내부 좌표계이므로, 화면 좌표로 변환
      const pos = edge.midpoint();
      const pan = cy.pan();
      const zoom = cy.zoom();

      // 절대 좌표 계산 (컨테이너 기준)
      const absoluteX = pos.x * zoom + pan.x + containerRect.left;
      const absoluteY = pos.y * zoom + pan.y + containerRect.top;

      setActiveTooltip(null);
      setActiveTooltip({
        type: 'edge',
        id: edge.id(),
        x: absoluteX,
        y: absoluteY,
        data: edge.data(),
        sourceNode: edge.source(),
        targetNode: edge.target(),
      });

      cy.batch(() => {
        cy.nodes().addClass("faded");
        cy.edges().addClass("faded");
        edge.removeClass("faded");
        edge.source().removeClass("faded").addClass("highlighted");
        edge.target().removeClass("faded").addClass("highlighted");
        // 나머지 노드/간선은 faded 유지
      });

      selectedEdgeIdRef.current = edge.id();
    },
    []
  );

  // 배경 클릭 시 선택 해제
  const tapBackgroundHandler = useCallback((evt) => {
    if (evt.target === cyRef.current) {
      clearSelection();
    }
  }, []);

  // 선택 해제
  const clearSelection = useCallback(() => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.nodes().removeClass("faded");
      cy.edges().removeClass("faded");
      cy.removeListener("tap", "node");
      cy.removeListener("tap", "edge");
      cy.removeListener("tap");
      cy.on("tap", "node", tapNodeHandler);
      cy.on("tap", "edge", tapEdgeHandler);
      cy.on("tap", tapBackgroundHandler);
    }
    setActiveTooltip(null);
    selectedEdgeIdRef.current = null;
    selectedNodeIdRef.current = null;
  }, [tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  const handleCloseTooltip = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // elements/filteredElements를 id 기준으로 정렬해서 비교 및 전달
  const sortedElements = useMemo(() => {
    if (!elements) return [];
    return [...elements].sort((a, b) => {
      const aId = a.data?.id || '';
      const bId = b.data?.id || '';
      return aId.localeCompare(bId);
    });
  }, [elements]);

  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = sortedElements;
    let fitNodeIds = null;
    if (search) {
      // 모든 일치하는 노드 찾기
      const matchedNodes = sortedElements.filter(
        (el) =>
          !el.data.source &&
          (el.data.label?.toLowerCase().includes(search.toLowerCase()) ||
            (el.data.names &&
              el.data.names.some((n) =>
                n.toLowerCase().includes(search.toLowerCase())
              )))
      );
      
      if (matchedNodes.length > 0) {
        // 모든 일치하는 노드와 관련된 엣지 찾기
        const matchedNodeIds = matchedNodes.map(node => node.data.id);
        
        const relatedEdges = sortedElements.filter(
          (el) =>
            el.data.source &&
            (matchedNodeIds.includes(el.data.source) ||
             matchedNodeIds.includes(el.data.target))
        );
        
        // 관련 노드 ID 수집
        const relatedNodeIds = [
          ...new Set(
            relatedEdges.flatMap((e) => [e.data.source, e.data.target])
          ),
        ];
        
        // 모든 관련 노드 찾기
        const relatedNodes = sortedElements.filter(
          (el) => !el.data.source && 
                 (matchedNodeIds.includes(el.data.id) || relatedNodeIds.includes(el.data.id))
        );
        
        filteredElements = [...relatedNodes, ...relatedEdges];
        fitNodeIds = [...matchedNodeIds, ...relatedNodeIds];
      } else {
        filteredElements = [];
        fitNodeIds = [];
      }
    } else {
      filteredElements = sortedElements;
    }
    return { filteredElements, fitNodeIds };
  }, [sortedElements, search]);

  // currentEventJson이 내용이 같으면 참조도 같게 useMemo로 캐싱
  const stableEventJson = useMemo(() => graphViewState ? JSON.stringify(graphViewState) : '', [graphViewState]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node[img]",
        style: {
          "background-image": "data(img)",
          "background-fit": "cover",
          "background-color": "#eee",
          "border-width": (ele) => ele.data("main") ? 2 : 1,
          "border-color": "#5B7BA0",
          "width": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "height": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "shape": "ellipse",
          "label": "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": inViewer ? 14 : 12,
          "font-weight": (ele) => ele.data("main") ? 700 : 400,
          "color": "#444",
          "text-margin-y": inViewer ? 9 : 8,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
        },
      },
      {
        selector: "node",
        style: {
          "background-color": "#eee",
          "border-width": (ele) => ele.data("main") ? 2 : 1,
          "border-color": "#5B7BA0",
          "width": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "height": inViewer ? (ele => ele.data("main") ? 68 : 54) : 36,
          "shape": "ellipse",
          "label": "data(label)",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": inViewer ? 14 : 13,
          "font-weight": (ele) => ele.data("main") ? 700 : 400,
          "color": "#444",
          "text-margin-y": inViewer ? 9 : 8,
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
        },
      },
      {
        selector: "edge",
        style: {
          width: inViewer ? "mapData(weight, 0, 1, 1.8, 4.5)" : "mapData(weight, 0, 1, 1.5, 4)",
          "line-color": (ele) => getRelationColor(ele.data("positivity")),
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": inViewer ? 13 : 11,
          "text-rotation": "autorotate",
          color: "#42506b",
          "text-background-color": "#fff",
          "text-background-opacity": 0.8,
          "text-background-shape": "roundrectangle",
          "text-background-padding": 2,
          "text-outline-color": "#fff",
          "text-outline-width": 2,
          opacity: "mapData(weight, 0, 1, 0.55, 1)",
          "target-arrow-shape": "none"
        },
      },
      {
        selector: ".faded",
        style: {
          opacity: 0.25,
          "text-opacity": 0.12,
        },
      },
    ],
    [inViewer]
  );

  const layout = useMemo(
    () => ({
      name: "cose",
      padding: inViewer ? 90 : 150,
      nodeRepulsion: inViewer ? 1800 : 6000,
      idealEdgeLength: inViewer ? 120 : 150,
      animate: false,
      fit: true,
      randomize: false,
      nodeOverlap: inViewer ? 12 : 30,
      avoidOverlap: true,
      nodeSeparation: inViewer ? 10 : 20,
      randomSeed: 42,
      gravity: 0.25,
      componentSpacing: inViewer ? 90 : 120
    }),
    [inViewer, isGraphPage]
  );

  // 검색 결과에 따라 다른 레이아웃 옵션 적용
  const searchLayout = useMemo(
    () => ({
      name: "cose",
      padding: 110,
      nodeRepulsion: inViewer ? 2500 : 5000,
      idealEdgeLength: inViewer ? 135 : 180,
      animate: true,
      animationDuration: 800,
      fit: true,
      randomize: false,
      nodeOverlap: inViewer ? 14 : 40,
      avoidOverlap: true,
      nodeSeparation: inViewer ? 11 : 30,
      randomSeed: 42,
      gravity: 0.3,
      refresh: 20,
      componentSpacing: 110,
      coolingFactor: 0.95,
      initialTemp: 200
    }),
    [inViewer]
  );

  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    
    // 그래프 초기화
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().removeClass("faded");
      cy.elements().removeClass("highlighted");
      cy.fit(undefined, 15);
      cy.center();
    }
  }, [setSearch, setSearchInput]);

  const handleSearch = useCallback(() => {
    if (searchInput.trim()) {
      setSearch(searchInput.trim());
    }
  }, [searchInput]);

  const handleFitView = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.fit();
      cyRef.current.center();
    }
  }, []);

  const handleClose = useCallback(() => {
    // 뒤로 이동이 아니라 해당 파일의 뷰어로 이동
    navigate(`/viewer/${filename}`);
  }, [navigate, filename]);

  const eventKey = `chapter_${chapterNum}_event_${eventNum}_hideIsolated_${hideIsolated}`;

  // === graphViewState를 항상 localStorage에 저장 ===
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    // 저장 함수
    const saveGraphState = () => {
      const nodes = cy.nodes().map(n => ({
        id: n.id(),
        pos: n.position(),
        data: n.data(),
        classes: n.classes(),
        selected: n.selected()
      }));
      const edges = cy.edges().map(e => ({
        id: e.id(),
        source: e.source().id(),
        target: e.target().id(),
        data: e.data(),
        classes: e.classes(),
        selected: e.selected()
      }));
      const state = {
        pan: cy.pan(),
        zoom: cy.zoom(),
        nodes,
        edges
      };
      try {
        localStorage.setItem(`graph_${eventKey}`, JSON.stringify(state));
      } catch (e) {}
    };
    // 최초 mount/업데이트 시 저장
    saveGraphState();
    // cleanup(언마운트/이벤트 변경 직전)에도 저장
    return () => {
      saveGraphState();
    };
  }, [filteredElements, chapterNum, eventNum, hideIsolated]);

  // === graphViewState가 없을 때 localStorage에서 복원 ===
  useEffect(() => {
    if (!cyRef.current) return;
    if (graphViewState) return; // 이미 상위에서 복원됨
    const saved = localStorage.getItem(`graph_${eventKey}`);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        const cy = cyRef.current;
        cy.elements().remove();
        cy.add([
          ...(Array.isArray(state.nodes) ? state.nodes.map(n => ({
            group: 'nodes',
            data: n.data,
            position: n.pos,
            classes: n.classes
          })) : []),
          ...(Array.isArray(state.edges) ? state.edges.map(e => ({
            group: 'edges',
            data: e.data,
            classes: e.classes
          })) : [])
        ]);
        if (state.pan) cy.pan(state.pan);
        if (state.zoom) cy.zoom(state.zoom);
        // 복원 성공 시 layout을 절대 실행하지 않음
        return;
      } catch (e) {}
    }
    // 복원 실패 시에만 layout 실행 (기존 로직)
    const cy = cyRef.current;
    cy.elements().unlock();
    cy.resize();
    cy.elements().remove();
    cy.add(filteredElements);
    const currentLayout = cy.layout(search ? searchLayout : layout);
    currentLayout.run();
    cy.fit(undefined, 120);
    cy.center();
  }, [filteredElements, chapterNum, eventNum, hideIsolated, graphViewState]);

  // 그래프 데이터 준비
  useEffect(() => {
    const prevElements = prevElementsRef.current;
    const prevEventJson = prevEventJsonRef.current;
    const isSameElements = prevElements &&
      prevElements.length === filteredElements.length &&
      prevElements.every((el, i) => JSON.stringify(el) === JSON.stringify(filteredElements[i]));
    const isEventChanged = prevEventJson &&
      prevEventJson !== stableEventJson;

    if (!filteredElements || filteredElements.length === 0) return;

    if (cyRef.current) {
      const cy = cyRef.current;

      // === graphViewState가 있으면 항상 복원 ===
      if (graphViewState) {
        cy.elements().unlock();
        cy.resize();
        cy.elements().remove();
        cy.add(filteredElements);
        if (graphViewState.pan) cy.pan(graphViewState.pan);
        if (graphViewState.zoom) cy.zoom(graphViewState.zoom);
        if (Array.isArray(graphViewState.positions)) {
          graphViewState.positions.forEach(({ id, pos }) => {
            const node = cy.getElementById(id);
            if (node) node.position(pos);
          });
        }
        prevElementsRef.current = filteredElements;
        prevEventJsonRef.current = stableEventJson;
        return; // layout.run() 실행하지 않음!
      }

      // === graphViewState가 없을 때만 layout 새로 실행 ===
      cy.elements().unlock();
      cy.resize();
      cy.elements().remove();
      cy.add(filteredElements);

      const currentLayout = cy.layout(search ? searchLayout : layout);
      currentLayout.run();
      cy.fit(undefined, 120);
      cy.center();

      prevElementsRef.current = filteredElements;
      prevEventJsonRef.current = stableEventJson;
    }
  }, [filteredElements, search, searchLayout, layout, stableEventJson, graphViewState]);

  // 최초 1회만 그래프 중앙정렬 (챕터 이동/새로고침 시)
  useEffect(() => {
    if (cyRef.current && !hasCenteredRef.current) {
      const cy = cyRef.current;
      // layout 실행 전에 노드 초기 위치를 배치
      const nodes = cy.nodes();
      const centerX = cy.width() / 2;
      const centerY = cy.height() / 2;
      const radius = Math.min(centerX, centerY) * 0.6;
      const mainNodes = nodes.filter(n => n.data('main'));
      const otherNodes = nodes.filter(n => !n.data('main'));
      if (mainNodes.length > 0) {
        // 메인 노드가 여러 개면 중앙 영역에 분산
        mainNodes.forEach((node, i) => {
          const angle = (2 * Math.PI * i) / mainNodes.length;
          const x = centerX + (mainNodes.length === 1 ? 0 : radius * 0.25 * Math.cos(angle));
          const y = centerY + (mainNodes.length === 1 ? 0 : radius * 0.25 * Math.sin(angle));
          node.position({ x, y });
        });
        // 나머지 노드는 랜덤 배치
        otherNodes.forEach((node) => {
          const x = centerX + (Math.random() - 0.5) * radius * 2;
          const y = centerY + (Math.random() - 0.5) * radius * 2;
          node.position({ x, y });
        });
      } else if (nodes.length === 1) {
        nodes[0].position({ x: centerX, y: centerY });
      } else if (nodes.length > 1) {
        // 메인 노드가 없을 때: 간선이 가장 많이 연결된 노드를 중앙에 배치
        let maxDegree = -1;
        let centerNode = null;
        nodes.forEach((node) => {
          const degree = node.connectedEdges().length;
          if (degree > maxDegree) {
            maxDegree = degree;
            centerNode = node;
          }
        });
        if (centerNode) {
          centerNode.position({ x: centerX, y: centerY });
        }
        // 나머지 노드는 원형 분산
        let i = 0;
        nodes.forEach((node) => {
          if (node === centerNode) return;
          const angle = (2 * Math.PI * i) / (nodes.length - 1);
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          node.position({ x, y });
          i++;
        });
      }
      // layout 실행
      const layoutInstance = cy.layout(search ? searchLayout : layout);
      layoutInstance.run();
      // layoutstop 이벤트에서 충돌 방지를 여러 번 반복 실행
      function preventNodeOverlap(cy, repeat = 20) {
        const nodes = cy.nodes();
        const nodePositions = {};
        nodes.forEach((node) => {
          nodePositions[node.id()] = {
            x: node.position("x"),
            y: node.position("y"),
          };
        });
        for (let iteration = 0; iteration < repeat; iteration++) {
          let moved = false;
          nodes.forEach((node1) => {
            nodes.forEach((node2) => {
              if (node1.id() === node2.id()) return;
              const pos1 = nodePositions[node1.id()];
              const pos2 = nodePositions[node2.id()];
              const dx = pos1.x - pos2.x;
              const dy = pos1.y - pos2.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const size1 = node1.data("main") ? 60 : 40;
              const size2 = node2.data("main") ? 60 : 40;
              const minDistance = (size1 + size2) / 2 + 100;
              if (distance < minDistance && distance > 0) {
                moved = true;
                const pushFactor = ((minDistance - distance) / distance) * 1.0;
                nodePositions[node1.id()].x += dx * pushFactor;
                nodePositions[node1.id()].y += dy * pushFactor;
                nodePositions[node2.id()].x -= dx * pushFactor;
                nodePositions[node2.id()].y -= dy * pushFactor;
              }
            });
          });
          if (!moved) break;
        }
        nodes.forEach((node) => {
          const pos = nodePositions[node.id()];
          node.position({ x: pos.x, y: pos.y });
        });
      }
      const onLayoutStop = () => {
        // 충돌 방지 여러 번 반복 실행 (예: 5회)
        preventNodeOverlap(cy, 20);
        cy.fit(undefined, 30);
        cy.center();
        hasCenteredRef.current = true;
        cy.off('layoutstop', onLayoutStop);
      };
      cy.on('layoutstop', onLayoutStop);
    }
  }, [elements, inViewer, search, searchLayout, layout]);

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.on("tap", "node", tapNodeHandler);
    cy.on("tap", "edge", tapEdgeHandler);
    cy.on("tap", tapBackgroundHandler);
    return () => {
      cy.removeListener("tap", "node", tapNodeHandler);
      cy.removeListener("tap", "edge", tapEdgeHandler);
      cy.removeListener("tap", tapBackgroundHandler);
    };
  }, [tapNodeHandler, tapEdgeHandler, tapBackgroundHandler]);

  // < 버튼 클릭 시
  const handleFullScreenToggle = () => {
    if (onFullScreen) onFullScreen();
  };
  // > 버튼 클릭 시
  const handleExitFullScreen = () => {
    if (onExitFullScreen) onExitFullScreen();
  };

  // 전체화면 전환 시 Cytoscape 강제 리사이즈/fit/center
  useEffect(() => {
    if (fullScreen && cyRef.current) {
      const cy = cyRef.current;
      setTimeout(() => {
        cy.resize();
        cy.fit(undefined, 120);
        cy.center();
      }, 0);
    }
  }, [fullScreen]);

  // ★★★ 노드 드래그 시 겹침 방지 로직 추가 ★★★
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    const handleDragFree = function () {
      const nodes = cy.nodes();
      const nodePositions = {};
      nodes.forEach((node) => {
        nodePositions[node.id()] = {
          x: node.position("x"),
          y: node.position("y"),
        };
      });
      for (let iteration = 0; iteration < 3; iteration++) {
        let moved = false;
        nodes.forEach((node1) => {
          nodes.forEach((node2) => {
            if (node1.id() === node2.id()) return;
            const pos1 = nodePositions[node1.id()];
            const pos2 = nodePositions[node2.id()];
            const dx = pos1.x - pos2.x;
            const dy = pos1.y - pos2.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const size1 = node1.data("main") ? 60 : 40;
            const size2 = node2.data("main") ? 60 : 40;
            const minDistance = (size1 + size2) / 2 + 30;
            if (distance < minDistance && distance > 0) {
              moved = true;
              const pushFactor = ((minDistance - distance) / distance) * 0.5;
              nodePositions[node1.id()].x += dx * pushFactor;
              nodePositions[node1.id()].y += dy * pushFactor;
              nodePositions[node2.id()].x -= dx * pushFactor;
              nodePositions[node2.id()].y -= dy * pushFactor;
            }
          });
        });
        if (!moved) break;
      }
      nodes.forEach((node) => {
        const pos = nodePositions[node.id()];
        node.position({ x: pos.x, y: pos.y });
      });
    };

    cy.on("dragfree", "node", handleDragFree);
    return () => {
      cy.removeListener("dragfree", "node", handleDragFree);
    };
  }, []);

  // 노드 충돌 방지 함수 (컴포넌트 내부에 선언)
  function preventNodeOverlap(cy, repeat = 20) {
    const nodes = cy.nodes();
    const nodePositions = {};
    nodes.forEach((node) => {
      nodePositions[node.id()] = {
        x: node.position("x"),
        y: node.position("y"),
      };
    });
    for (let iteration = 0; iteration < repeat; iteration++) {
      let moved = false;
      nodes.forEach((node1) => {
        nodes.forEach((node2) => {
          if (node1.id() === node2.id()) return;
          const pos1 = nodePositions[node1.id()];
          const pos2 = nodePositions[node2.id()];
          const dx = pos1.x - pos2.x;
          const dy = pos1.y - pos2.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const size1 = node1.data("main") ? 60 : 40;
          const size2 = node2.data("main") ? 60 : 40;
          const minDistance = (size1 + size2) / 2 + 100;
          if (distance < minDistance && distance > 0) {
            moved = true;
            const pushFactor = ((minDistance - distance) / distance) * 1.0;
            nodePositions[node1.id()].x += dx * pushFactor;
            nodePositions[node1.id()].y += dy * pushFactor;
            nodePositions[node2.id()].x -= dx * pushFactor;
            nodePositions[node2.id()].y -= dy * pushFactor;
          }
        });
      });
      if (!moved) break;
    }
    nodes.forEach((node) => {
      const pos = nodePositions[node.id()];
      node.position({ x: pos.x, y: pos.y });
    });
  }

  // filteredElements가 바뀔 때마다 항상 충돌 방지 및 분산 배치 실행
  useEffect(() => {
    if (cyRef.current && filteredElements && filteredElements.length > 1) {
      const cy = cyRef.current;
      // 노드 초기 위치를 랜덤하게 분산 (원형이 아니라도 됨)
      const nodes = cy.nodes();
      const centerX = cy.width() / 2;
      const centerY = cy.height() / 2;
      const radius = Math.min(centerX, centerY) * 0.6;
      nodes.forEach((node) => {
        const x = centerX + (Math.random() - 0.5) * radius * 2;
        const y = centerY + (Math.random() - 0.5) * radius * 2;
        node.position({ x, y });
      });
      // 더 넓은 간격, 더 강한 충돌 방지
      preventNodeOverlap(cy, 20);
      cy.fit(undefined, 60, { animate: false });
      cy.center({ animate: false });
    }
  }, [filteredElements]);

  // 모든 이벤트에 대해 localStorage에서 노드 위치 복원/저장
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const storageKey = `fixed_graph_${chapterNum}_${eventNum}`; // 이벤트별로 저장
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const positions = JSON.parse(saved);
        positions.forEach(({ id, pos }) => {
          const node = cy.getElementById(id);
          if (node) node.position(pos);
        });
        // fit으로 전체 그래프(노드+간선)가 영역 안에 오도록 보정
        cy.fit(undefined); // padding 40px
        // bounding box 중심이 컨테이너 중심에 오도록 pan 보정
        const bb = cy.elements().boundingBox();
        const graphCenter = {
          x: (bb.x1 + bb.x2) / 2,
          y: (bb.y1 + bb.y2) / 2
        };
        const containerCenter = {
          x: cy.width() / 2,
          y: cy.height() / 2
        };
        cy.pan({
          x: containerCenter.x - graphCenter.x,
          y: containerCenter.y - graphCenter.y
        });
        // fit 후 zoom을 0.98~1.0배로 미세하게 조정
        const z = cy.zoom();
        if (z > 1.05) cy.zoom(1.0);
        else if (z < 0.95) cy.zoom(0.98);
        return;
      } catch (e) {}
    }
    // 저장된 위치가 없으면, 메인 노드가 중앙에 오고 나머지는 랜덤 배치 후 저장
    const nodes = cy.nodes();
    const centerX = cy.width() / 2;
    const centerY = cy.height() / 2;
    const radius = Math.min(centerX, centerY) * 0.6;
    const mainNodes = nodes.filter(n => n.data('main'));
    const otherNodes = nodes.filter(n => !n.data('main'));
    if (mainNodes.length > 0) {
      // 메인 노드가 여러 개면 중앙 영역에 분산
      mainNodes.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / mainNodes.length;
        const x = centerX + (mainNodes.length === 1 ? 0 : radius * 0.25 * Math.cos(angle));
        const y = centerY + (mainNodes.length === 1 ? 0 : radius * 0.25 * Math.sin(angle));
        node.position({ x, y });
      });
      // 나머지 노드는 랜덤 배치
      otherNodes.forEach((node) => {
        const x = centerX + (Math.random() - 0.5) * radius * 2;
        const y = centerY + (Math.random() - 0.5) * radius * 2;
        node.position({ x, y });
      });
    } else if (nodes.length === 1) {
      nodes[0].position({ x: centerX, y: centerY });
    } else if (nodes.length > 1) {
      // 메인 노드가 없을 때: 간선이 가장 많이 연결된 노드를 중앙에 배치
      let maxDegree = -1;
      let centerNode = null;
      nodes.forEach((node) => {
        const degree = node.connectedEdges().length;
        if (degree > maxDegree) {
          maxDegree = degree;
          centerNode = node;
        }
      });
      if (centerNode) {
        centerNode.position({ x: centerX, y: centerY });
      }
      // 나머지 노드는 원형 분산
      let i = 0;
      nodes.forEach((node) => {
        if (node === centerNode) return;
        const angle = (2 * Math.PI * i) / (nodes.length - 1);
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        node.position({ x, y });
        i++;
      });
    }
    // 충돌 방지 항상 적용
    preventNodeOverlap(cy, 20);
    // 모든 노드가 영역 안에 들어오도록 보정
    clampNodePositionsToBounds(cy);
    // 메인 노드(들) 중심이 그래프 영역 중앙에 오도록 pan 보정
    function getMainNodesCenter(cy) {
      const mainNodes = cy.nodes().filter(n => n.data('main'));
      if (mainNodes.length === 0) return { x: centerX, y: centerY };
      const sum = mainNodes.reduce((acc, n) => {
        const pos = n.position();
        acc.x += pos.x;
        acc.y += pos.y;
        return acc;
      }, { x: 0, y: 0 });
      return {
        x: sum.x / mainNodes.length,
        y: sum.y / mainNodes.length
      };
    }
    const mainCenter = getMainNodesCenter(cy);
    cy.pan({
      x: centerX - mainCenter.x,
      y: centerY - mainCenter.y
    });
    // fit으로 전체 그래프(노드+간선)가 영역 안에 오도록 보정
    cy.fit(undefined); // padding 40px
    // bounding box 중심이 컨테이너 중심에 오도록 pan 보정
    const bb = cy.elements().boundingBox();
    const graphCenter = {
      x: (bb.x1 + bb.x2) / 2,
      y: (bb.y1 + bb.y2) / 2
    };
    const containerCenter = {
      x: cy.width() / 2,
      y: cy.height() / 2
    };
    cy.pan({
      x: containerCenter.x - graphCenter.x,
      y: containerCenter.y - graphCenter.y
    });
    // fit 후 zoom을 0.98~1.0배로 미세하게 조정
    const z = cy.zoom();
    if (z > 1.05) cy.zoom(1.0);
    else if (z < 0.95) cy.zoom(0.98);
    // 저장
    const positions = cy.nodes().map(n => ({
      id: n.id(),
      pos: n.position()
    }));
    localStorage.setItem(storageKey, JSON.stringify(positions));
    // 저장 후에도 zoom, center 고정
    cy.center();
    cy.zoom(1.0);

    // 마지막 이벤트일 때, zoom/pan을 챕터별로 저장 (zoom은 0.9배로 더 멀리)
    if (typeof maxEventNum !== 'undefined' && eventNum === maxEventNum) {
      const baseZoom = cy.zoom();
      const fartherZoom = baseZoom * 0.7; // 10% 더 멀리
      localStorage.setItem(`chapter_view_${chapterNum}`, JSON.stringify({
        zoom: fartherZoom,
        pan: cy.pan()
      }));
    } else {
      // 마지막 이벤트가 아니면, 챕터별 zoom/pan을 불러와서 적용
      const view = localStorage.getItem(`chapter_view_${chapterNum}`);
      if (view) {
        try {
          const { zoom, pan } = JSON.parse(view);
          cy.zoom(zoom);
          cy.pan(pan);
        } catch (e) {}
      }
    }
  }, [filteredElements, chapterNum, eventNum, maxEventNum]);

  // 모든 노드가 영역 안에 들어오도록 보정하는 함수
  function clampNodePositionsToBounds(cy) {
    const width = cy.width();
    const height = cy.height();
    cy.nodes().forEach((node) => {
      const pos = node.position();
      const size = node.data('main') ? 40 : 32; // 노드+여유 (간선까지 고려)
      const minX = size;
      const maxX = width - size;
      const minY = size;
      const maxY = height - size;
      node.position({
        x: Math.max(minX, Math.min(maxX, pos.x)),
        y: Math.max(minY, Math.min(maxY, pos.y)),
      });
    });
  }

  useEffect(() => {
    const elementsStr = JSON.stringify(elements);
    const isSame =
      prevChapterNum.current === chapterNum &&
      prevEventNum.current === eventNum &&
      prevElementsStr.current === elementsStr;

    if (!isSame) {
      setIsGraphLoading(true);
    }
    prevChapterNum.current = chapterNum;
    prevEventNum.current = eventNum;
    prevElementsStr.current = elementsStr;
  }, [elements, chapterNum, eventNum]);

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
        {/* 상단바: > 버튼(복귀)만 왼쪽 끝에, 가운데 > 버튼은 완전히 제거 */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: 60,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 0,
          paddingLeft: 12,
          paddingRight: 90,
          paddingTop: 0,
          justifyContent: 'flex-start',
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          borderBottom: '1px solid #e5e7eb',
          zIndex: 10001,
        }}>
          {/* 눈에 띄는 복귀(>) 버튼 */}
          <button
            onClick={handleExitFullScreen}
            style={{
              height: 40,
              width: 40,
              minWidth: 40,
              minHeight: 40,
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              marginRight: 18,
              marginLeft: 4,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(79,109,222,0.13)',
              fontWeight: 700,
              outline: 'none',
              transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
            }}
            title='분할화면으로'
            onMouseOver={e => e.currentTarget.style.background = 'linear-gradient(100deg, #6fa7ff 0%, #4F6DDE 100%)'}
            onMouseOut={e => e.currentTarget.style.background = 'linear-gradient(100deg, #4F6DDE 0%, #6fa7ff 100%)'}
          >
            {'>'}
          </button>
          {/* 그래프 본문, 컨트롤, 툴팁 등만 렌더링 (재귀 X) */}
          <div className="flex-1 relative overflow-hidden w-full h-full">
            {/* 검색 폼 추가 */}
            {!inViewer && (
              <div className="search-container" style={{ justifyContent: 'flex-start', paddingLeft: '20px' }}>
                <GraphControls
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  handleSearch={handleSearch}
                  handleReset={handleReset}
                  handleFitView={handleFitView}
                  search={search}
                  setSearch={setSearch}
                />
              </div>
            )}
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
                    style={{ pointerEvents: 'auto' }}
                  />
                )}
                {activeTooltip?.type === 'edge' && (
                  <EdgeTooltip
                    key={`edge-tooltip-${activeTooltip.id}`}
                    data={activeTooltip.data}
                    x={activeTooltip.x}
                    y={activeTooltip.y}
                    onClose={handleCloseTooltip}
                    sourceNode={activeTooltip.sourceNode}
                    targetNode={activeTooltip.targetNode}
                    style={{ pointerEvents: 'auto' }}
                  />
                )}
              </div>
              {/* 그래프 영역 */}
              <div className="graph-canvas-area w-full h-full" style={{ zIndex: 1, width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
                {/* 로딩 중 표시 */}
                {isGraphLoading && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6C8EFF',
                    fontSize: 22,
                    fontWeight: 600,
                    pointerEvents: 'none',
                  }}>
                    <span className="graph-loading-spinner" style={{
                      width: 40,
                      height: 40,
                      border: '4px solid #e3e6ef',
                      borderTop: '4px solid #6C8EFF',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      marginBottom: 12,
                      display: 'inline-block',
                    }} />
                    로딩 중...
                  </div>
                )}
                {elements && elements.length > 0 && (
                  <CytoscapeGraph
                    ref={cyRef}
                    elements={filteredElements}
                    stylesheet={stylesheet}
                    layout={search ? searchLayout : layout}
                    tapNodeHandler={tapNodeHandler}
                    tapEdgeHandler={tapEdgeHandler}
                    tapBackgroundHandler={tapBackgroundHandler}
                    fitNodeIds={fitNodeIds}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      overflow: 'hidden', 
                      position: 'relative',
                      backgroundColor: '#f8fafc' // 배경색 추가
                    }}
                  />
                )}
              </div>
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

      {/* 검색 폼 추가 */}
      {!inViewer && (
        <div className="search-container" style={{ justifyContent: 'flex-start', paddingLeft: '20px' }}>
          <GraphControls
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            handleSearch={handleSearch}
            handleReset={handleReset}
            handleFitView={handleFitView}
            search={search}
            setSearch={setSearch}
          />
        </div>
      )}

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
              style={{ pointerEvents: 'auto' }}
            />
          )}
          {activeTooltip?.type === 'edge' && (
            <EdgeTooltip
              key={`edge-tooltip-${activeTooltip.id}`}
              data={activeTooltip.data}
              x={activeTooltip.x}
              y={activeTooltip.y}
              onClose={handleCloseTooltip}
              sourceNode={activeTooltip.sourceNode}
              targetNode={activeTooltip.targetNode}
              style={{ pointerEvents: 'auto' }}
            />
          )}
        </div>

        {/* 그래프 영역 */}
        <div className="graph-canvas-area w-full h-full" style={{ zIndex: 1, width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
          {/* 로딩 중 표시 */}
          {isGraphLoading && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10000,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6C8EFF',
              fontSize: 22,
              fontWeight: 600,
              pointerEvents: 'none',
            }}>
              <span className="graph-loading-spinner" style={{
                width: 40,
                height: 40,
                border: '4px solid #e3e6ef',
                borderTop: '4px solid #6C8EFF',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: 12,
                display: 'inline-block',
              }} />
              로딩 중...
            </div>
          )}
          {elements && elements.length > 0 && (
            <CytoscapeGraph
              ref={cyRef}
              elements={filteredElements}
              stylesheet={stylesheet}
              layout={search ? searchLayout : layout}
              tapNodeHandler={tapNodeHandler}
              tapEdgeHandler={tapEdgeHandler}
              tapBackgroundHandler={tapBackgroundHandler}
              fitNodeIds={fitNodeIds}
              style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default RelationGraphMain;