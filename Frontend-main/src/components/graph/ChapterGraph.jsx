import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import charactersData from "../../data/characters.json";
import relationsData from "../../data/relation.json";
import GraphControls from "./GraphControls";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";
import { FaSearch, FaTimes, FaPlus, FaMinus, FaExpand } from 'react-icons/fa';

function getRelationColor(positivity) {
  if (positivity > 0.6) return '#15803d';
  if (positivity > 0.3) return '#059669';
  if (positivity > -0.3) return '#6b7280';
  if (positivity > -0.6) return '#dc2626';
  return '#991b1b';
}

const ChapterGraph = ({ chapterNumber = 1, enableTooltips = true, inViewer = false }) => {
  const cyRef = useRef(null);
  const prevElementsRef = useRef();
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  
  // 데이터 가공
  const elements = React.useMemo(() => {
    const nodes = charactersData.characters.map((char) => ({
      data: {
        id: String(char.id),
        label: char.common_name,
        main: char.main_character,
        description: char.description,
        names: char.names,
      },
    }));

    const edges = relationsData.relations.map((rel, idx) => ({
      data: {
        id: `e${idx}`,
        source: String(rel.id1),
        target: String(rel.id2),
        label: rel.relation.join(", "),
        explanation: rel.explanation,
        positivity: rel.positivity,
        weight: rel.weight,
      },
    }));

    return [...nodes, ...edges];
  }, []);

  // 노드 클릭 시 툴팁 표시
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current || !enableTooltips) return;
    const node = evt.target;
    const pos = node.renderedPosition();
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const container = evt.target.cy.container();
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
      setActiveTooltip({ 
        type: 'node', 
        id: node.id(), 
        x: mouseX, 
        y: mouseY, 
        data: node.data(), 
        nodeCenter,
        inViewer
      });
    }, 0);
    
    selectedNodeIdRef.current = node.id();
  }, [enableTooltips, inViewer]);
  
  // 엣지 클릭 이벤트 핸들러
  const tapEdgeHandler = useCallback((evt) => {
    if (!cyRef.current || !enableTooltips) return;
    const cy = cyRef.current;
    const edge = evt.target;
    const container = evt.target.cy.container();
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
      inViewer
    });

    cy.batch(() => {
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");
      edge.removeClass("faded");
      edge.source().removeClass("faded").addClass("highlighted");
      edge.target().removeClass("faded").addClass("highlighted");
    });
    
    selectedEdgeIdRef.current = edge.id();
  }, [enableTooltips, inViewer]);
  
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
      cy.nodes().removeClass("faded highlighted");
      cy.edges().removeClass("faded");
      
      // 이벤트 리스너 재설정
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

  // 툴팁 닫기 핸들러
  const handleCloseTooltip = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // 검색 기능
  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = elements;
    let fitNodeIds = null;
    
    if (search) {
      // 모든 일치하는 노드 찾기
      const matchedNodes = elements.filter(
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
        
        const relatedEdges = elements.filter(
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
        const relatedNodes = elements.filter(
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
      filteredElements = elements;
    }
    return { filteredElements, fitNodeIds };
  }, [elements, search]);

  // 스타일시트 정의
  const stylesheet = useMemo(() => [
    {
      selector: "node",
      style: {
        "background-fit": "cover",
        "background-color": "#4F6DDE",
        "border-width": (ele) => ele.data("main") ? 3 : 1,
        "border-color": (ele) => ele.data("main") ? "#22336b" : "#5B7BA0",
        "width": (ele) => ele.data("main") ? 40 : 35,
        "height": (ele) => ele.data("main") ? 40 : 35,
        "shape": "ellipse",
        "label": "data(label)",
        "text-valign": "bottom",
        "text-halign": "center",
        "font-size": 11,
        "font-weight": (ele) => ele.data("main") ? 700 : 400,
        "color": "#444",
        "text-margin-y": 6,
        "text-background-color": "#fff",
        "text-background-opacity": 0.8,
        "text-background-shape": "roundrectangle",
        "text-background-padding": 2,
      },
    },
    {
      selector: "edge",
      style: {
        width: "mapData(weight, 0, 1, 1.5, 3)",
        "line-color": (ele) => getRelationColor(ele.data("positivity")),
        "curve-style": "bezier",
        "label": "data(label)",
        "font-size": 9,
        "text-rotation": "autorotate",
        "color": "#42506b",
        "text-background-color": "#fff",
        "text-background-opacity": 0.8,
        "text-background-shape": "roundrectangle",
        "text-background-padding": 2,
        opacity: "mapData(weight, 0, 1, 0.5, 1)",
        "target-arrow-shape": "none"
      },
    },
    {
      selector: ".highlighted",
      style: {
        "border-width": 3,
        "border-color": "#ff5722",
        "background-color": "#5D7DE5",
        "z-index": 999,
      },
    },
    {
      selector: ".faded",
      style: {
        opacity: 0.25,
        "text-opacity": 0.5,
      },
    },
  ], []);

  // 레이아웃 정의
  const layout = useMemo(() => ({
    name: "cose",
    padding: 50,
    nodeRepulsion: 12000,
    idealEdgeLength: 100,
    animate: false,
    fit: true,
    randomize: false,
    avoidOverlap: true,
    nodeSeparation: 40,
    randomSeed: 42,
    gravity: 0.4,
    componentSpacing: 60
  }), []);

  // 검색 결과에 따라 다른 레이아웃 옵션 적용
  const searchLayout = useMemo(() => ({
    name: "cose",
    padding: 120,
    nodeRepulsion: 18000,
    idealEdgeLength: 180,
    animate: true,
    animationDuration: 800,
    fit: true,
    randomize: false,
    nodeOverlap: 40,
    avoidOverlap: true,
    nodeSeparation: 100,
    randomSeed: 42,
    gravity: 0.3,
    refresh: 20,
    componentSpacing: 120,
    coolingFactor: 0.95,
    initialTemp: 200
  }), []);

  // 줌 인
  const handleZoomIn = () => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.zoom({
        level: cy.zoom() * 1.2,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
      });
    }
  };

  // 줌 아웃
  const handleZoomOut = () => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.zoom({
        level: cy.zoom() * 0.8,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
      });
    }
  };

  // 화면에 맞추기
  const handleFitToScreen = () => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.fit(undefined, 40);
      cy.center();
    }
  };

  // 검색 초기화
  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    
    // 그래프 초기화
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().removeClass("faded");
      cy.elements().removeClass("highlighted");
      cy.fit(undefined, 40);
      cy.center();
    }
  }, []);

  // 검색 제출 핸들러
  const handleSearch = useCallback(() => {
    if (searchInput.trim()) {
      setSearch(searchInput.trim());
    }
  }, [searchInput]);

  useEffect(() => {
    const prevElements = prevElementsRef.current;
    // elements(노드/엣지) 비교 (순서까지 완전히 동일해야 함)
    const isSameElements = prevElements &&
      prevElements.length === filteredElements.length &&
      prevElements.every((el, i) => JSON.stringify(el) === JSON.stringify(filteredElements[i]));

    if (cyRef.current) {
      const cy = cyRef.current;

      // 동일하면 아무것도 하지 않음 (그래프 위치/줌/레이아웃 유지)
      if (isSameElements) {
        return;
      }
      
      // 이벤트 핸들러 등록 (enableTooltips가 true일 때만)
      if (enableTooltips) {
        cy.on('tap', 'node', tapNodeHandler);
        cy.on('tap', 'edge', tapEdgeHandler);
        cy.on('tap', tapBackgroundHandler);
      }
      
      // 검색 결과가 있으면 해당 노드에 맞추기
      if (search && fitNodeIds && fitNodeIds.length > 0) {
        const nodesToFit = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodesToFit.length > 0) {
          cy.fit(nodesToFit, 40);
          
          // 검색된 노드 강조
          cy.nodes().addClass('faded');
          nodesToFit.removeClass('faded').addClass('highlighted');
          
          // 연결된 엣지 강조
          const relatedEdges = nodesToFit.connectedEdges();
          relatedEdges.removeClass('faded');
        }
      } else {
        // 모든 노드가 보이도록 뷰 조정
        const nodeCount = cy.nodes().length;
        if (nodeCount <= 4) {
          cy.center();
          cy.zoom(1); // 노드가 적을 때 너무 확대되지 않게
        } else {
          cy.fit(undefined, 40);
          cy.center();
          cy.zoom(cy.zoom() * 0.9);
        }
      }
      
      return () => {
        cy.removeListener('tap');
      };
    }
    // 다음 렌더를 위해 저장
    prevElementsRef.current = filteredElements;
  }, [filteredElements, fitNodeIds, search, tapNodeHandler, tapEdgeHandler, tapBackgroundHandler, enableTooltips]);

  return (
    <div className="chapter-graph h-full flex flex-col">
      <div className="chapter-title-bar p-3 bg-gray-100 border-b border-gray-200">
        <h3 className="font-bold text-lg text-center text-gray-800">Chapter {chapterNumber} 관계도</h3>
        
        {/* 검색 폼 */}
        <div className="mt-2">
          <GraphControls
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            handleSearch={handleSearch}
            handleReset={handleReset}
            search={search}
            setSearch={setSearch}
          />
        </div>
      </div>
      
      <div className="graph-container flex-grow relative">
        <CytoscapeComponent
          elements={filteredElements}
          stylesheet={stylesheet}
          layout={search ? searchLayout : layout}
          cy={(cy) => { cyRef.current = cy; }}
          style={{ 
            width: '100%', 
            height: 'calc(100% - 3rem)', 
            paddingBottom: '1rem' 
          }}
        />
        
        {/* 그래프 컨트롤 */}
        <div className="graph-controls absolute bottom-16 right-4 bg-white rounded-lg shadow-md p-2 flex flex-col">
          <button
            onClick={handleZoomIn}
            className="p-2 hover:bg-gray-100 rounded-md"
            title="확대"
          >
            <FaPlus size={14} />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 hover:bg-gray-100 rounded-md"
            title="축소"
          >
            <FaMinus size={14} />
          </button>
          <button
            onClick={handleFitToScreen}
            className="p-2 hover:bg-gray-100 rounded-md"
            title="화면에 맞추기"
          >
            <FaExpand size={14} />
          </button>
        </div>
        
        {/* 툴팁 렌더링 */}
        {enableTooltips && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
            {activeTooltip?.type === 'node' && activeTooltip.data && (
              <GraphNodeTooltip
                key={`node-tooltip-${activeTooltip.id}`}
                data={activeTooltip.data}
                x={activeTooltip.x}
                y={activeTooltip.y}
                nodeCenter={activeTooltip.nodeCenter}
                onClose={handleCloseTooltip}
                inViewer={activeTooltip.inViewer}
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
                inViewer={activeTooltip.inViewer}
                style={{ pointerEvents: 'auto' }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChapterGraph; 