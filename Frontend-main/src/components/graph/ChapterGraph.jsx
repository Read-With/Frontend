import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import CytoscapeGraphDirect from "./CytoscapeGraphDirect";
import GraphControls from "./GraphControls";
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";
import "./RelationGraph.css";
import { FaSearch, FaTimes, FaPlus, FaMinus, FaExpand } from 'react-icons/fa';
import cytoscape from "cytoscape";

// === glob import 패턴 추가: 작품명/챕터별 구조 반영 ===
const characterModules = import.meta.glob('/src/data/*/c_chapter*_*.json', { eager: true });
const relationModules = import.meta.glob('/src/data/*/chapter*_relationships_event_*.json', { eager: true });

// === id 변환 함수 추가 ===
const safeId = v => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'string' && v.match(/^[0-9]+\.0$/)) return v.split('.')[0];
  return String(v).trim();
};

// === 동적 경로 생성 함수 ===
function getCharacterFile(book, chapter) {
  const filePath = `/src/data/${book}/c_chapter${chapter}_0.json`;
  const data = characterModules[filePath]?.default;
  return data || { characters: [] };
}

function getRelationFile(book, chapter, eventNum) {
  const filePath = `/src/data/${book}/chapter${chapter}_relationships_event_${eventNum}.json`;
  const data = relationModules[filePath]?.default;
  return data || { relations: [] };
}

function getRelationColor(positivity) {
  if (positivity > 0.6) return '#15803d';
  if (positivity > 0.3) return '#059669';
  if (positivity > -0.3) return '#6b7280';
  if (positivity > -0.6) return '#dc2626';
  return '#991b1b';
}

const ChapterGraph = ({ filename, chapterNumber = 1, eventNum = 1, enableTooltips = true, inViewer = false }) => {
  const cyRef = useRef(null);
  const prevElementsRef = useRef();
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const selectedEdgeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const [elementsWithPosition, setElementsWithPosition] = useState(null);
  const [charactersData, setCharactersData] = useState({ characters: [] });
  const [relationsData, setRelationsData] = useState({ relations: [] });
  
  useEffect(() => {
    setCharactersData(getCharacterFile(filename, chapterNumber));
    setRelationsData(getRelationFile(filename, chapterNumber, eventNum));
  }, [filename, chapterNumber, eventNum]);

  useEffect(() => {
    // 최초 1회만 자동 배치
    if (!elementsWithPosition) {
      // 1. position 없이 elements 생성
      const nodes = (charactersData.characters || []).map((char) => ({
        data: {
          id: safeId(char.id),
          label: char.common_name,
          main: char.main_character,
          description: char.description,
          names: char.names,
        },
      }));
      const edges = (relationsData.relations || []).map((rel, idx) => ({
        data: {
          id: `e${idx}`,
          source: safeId(rel.id1),
          target: safeId(rel.id2),
          label: Array.isArray(rel.relation) ? rel.relation.join(", ") : rel.type,
          explanation: rel.explanation,
          positivity: rel.positivity,
          weight: rel.weight,
        },
      }));
      const elements = [...nodes, ...edges];

      // 2. 임시 Cytoscape 인스턴스에서 자동 배치
      const cy = cytoscape({
        elements,
        layout: { name: "cose" }, // 원하는 자동 배치 엔진
        headless: true, // 실제 DOM에 그리지 않음
      });
      cy.layout({ name: "cose" }).run();

      // 3. 배치가 끝난 후, 각 노드의 position을 읽어서 저장
      const elementsWithPos = cy.elements().map(ele => {
        if (ele.isNode()) {
          return {
            data: ele.data(),
            position: ele.position(), // 자동 배치된 위치
          };
        } else {
          return { data: ele.data() };
        }
      });
      setElementsWithPosition(elementsWithPos);
      cy.destroy();
    }
  }, [elementsWithPosition, charactersData, relationsData]);

  // 툴팁 상태 업데이트를 useCallback으로 최적화
  const updateTooltip = useCallback((type, data, position) => {
    setActiveTooltip({ type, ...data, ...position });
  }, []);

  // 노드 클릭 핸들러 최적화
  const tapNodeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const node = evt.target;
    const pos = node.renderedPosition();
    const cy = cyRef.current;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const container = document.querySelector('.graph-canvas-area');
    const containerRect = container.getBoundingClientRect();
    
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

    const mouseX = evt.originalEvent?.clientX ?? nodeCenter.x;
    const mouseY = evt.originalEvent?.clientY ?? nodeCenter.y;
    
    setTimeout(() => {
      updateTooltip('node', {
        id: node.id(),
        data: node.data(),
        nodeCenter
      }, {
        x: mouseX,
        y: mouseY
      });
    }, 0);
  }, [updateTooltip]);

  // 간선 클릭 핸들러 최적화
  const tapEdgeHandler = useCallback((evt) => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const edge = evt.target;
    const container = document.querySelector(".graph-canvas-area");
    const containerRect = container.getBoundingClientRect();

    const pos = edge.midpoint();
    const pan = cy.pan();
    const zoom = cy.zoom();

    const absoluteX = pos.x * zoom + pan.x + containerRect.left;
    const absoluteY = pos.y * zoom + pan.y + containerRect.top;

    setActiveTooltip(null);
    updateTooltip('edge', {
      id: edge.id(),
      data: edge.data(),
      sourceNode: edge.source(),
      targetNode: edge.target()
    }, {
      x: absoluteX,
      y: absoluteY
    });

    cy.batch(() => {
      cy.nodes().addClass("faded");
      cy.edges().addClass("faded");
      edge.removeClass("faded");
      edge.source().removeClass("faded").addClass("highlighted");
      edge.target().removeClass("faded").addClass("highlighted");
    });

    selectedEdgeIdRef.current = edge.id();
  }, [updateTooltip]);

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

  // 툴팁 닫기 핸들러
  const handleCloseTooltip = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // 검색 기능
  const { filteredElements, fitNodeIds } = useMemo(() => {
    let filteredElements = elementsWithPosition;
    let fitNodeIds = null;
    
    if (search) {
      // 모든 일치하는 노드 찾기
      const matchedNodes = elementsWithPosition.filter(
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
        
        const relatedEdges = elementsWithPosition.filter(
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
        filteredElements = elementsWithPosition.filter(
          (el) =>
            (el.data.source && relatedEdges.includes(el)) ||
            (!el.data.source && (matchedNodeIds.includes(el.data.id) || relatedNodeIds.includes(el.data.id)))
        );
        fitNodeIds = matchedNodeIds;
      } else {
        filteredElements = [];
        fitNodeIds = [];
      }
    } else {
      filteredElements = elementsWithPosition;
    }
    return { filteredElements, fitNodeIds };
  }, [elementsWithPosition, search]);

  // 스타일시트 useMemo 의존성 최소화
  const stylesheet = useMemo(() => [
    {
      selector: "node",
      style: {
        "background-color": "#eee",
        "border-width": (ele) => ele.data("main") ? 2 : 1,
        "border-color": "#5B7BA0",
        "width": inViewer ? (ele => ele.data("main") ? 32 : 24) : 16,
        "height": inViewer ? (ele => ele.data("main") ? 32 : 24) : 16,
        "shape": "ellipse",
        "label": "data(label)",
        "text-valign": "bottom",
        "text-halign": "center",
        "font-size": inViewer ? 4 : 3,
        "font-weight": (ele) => ele.data("main") ? 700 : 400,
        "color": "#444",
        "text-margin-y": inViewer ? 3 : 2,
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
        "line-color": "#6b7280",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": inViewer ? 4 : 3,
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
  ], [inViewer]);

  // layout useMemo 의존성 최소화
  const layout = useMemo(() => ({
    name: "cose",
    padding: 90,
    nodeRepulsion: 1800,
    idealEdgeLength: 120,
    animate: false,
    fit: true,
    randomize: false,
    nodeOverlap: 12,
    avoidOverlap: true,
    nodeSeparation: 10,
    randomSeed: 42,
    gravity: 0.25,
    componentSpacing: 90
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

  // 검색 초기화
  const handleReset = useCallback(() => {
    setSearch("");
    setSearchInput("");
    
    // 그래프 초기화
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.elements().removeClass("faded");
      cy.elements().removeClass("highlighted");
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

  if (!elementsWithPosition) return <div>로딩 중...</div>;

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
        <CytoscapeGraphDirect
          elements={filteredElements}
          fitNodeIds={fitNodeIds}
          cyRef={cyRef}
          stylesheet={stylesheet}
          layout={search ? searchLayout : layout}
          tapNodeHandler={tapNodeHandler}
          tapEdgeHandler={tapEdgeHandler}
          tapBackgroundHandler={tapBackgroundHandler}
        />
        
        {/* 그래프 컨트롤 */}
        <div className="graph-controls absolute bottom-16 right-4 bg-white rounded-lg shadow-md p-2 flex flex-col">
          <button
            onClick={() => {}}
            className="p-2 hover:bg-gray-100 rounded-md"
            title="확대"
          >
            <FaPlus size={14} />
          </button>
          <button
            onClick={() => {}}
            className="p-2 hover:bg-gray-100 rounded-md"
            title="축소"
          >
            <FaMinus size={14} />
          </button>
          <button
            onClick={() => {}}
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

export default React.memo(ChapterGraph); 