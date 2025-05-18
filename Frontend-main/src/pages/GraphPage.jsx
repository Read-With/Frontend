import React, { useState, useMemo, useEffect } from "react";
import { PageContainer } from "@ant-design/pro-components";
import { Button, message } from "antd";
import { useParams, useNavigate } from "react-router-dom";
import RelationGraphMain from "../components/graph/RelationGraphMain";
import charactersData from "../data/Gatsby_01_characters.json";
import relationsData from "../data/Gatsby_01_relations.json";
import "./GraphPage.css";
import {
  FilterOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  HistoryOutlined,
} from "@ant-design/icons";
import { Spin } from "antd";
import { FaUndo } from "react-icons/fa";

// 임시 데이터 (chapter2, chapter3만)
const mockData = {
  "gatsby.epub": {
    chapter2: {
      characters: [
        {
          id: 1,
          common_name: "Nick",
          main_character: true,
          description: "주인공",
          names: ["Nick", "Nick Carraway"],
        },
        {
          id: 2,
          common_name: "Gatsby",
          main_character: true,
          description: "갯츠비",
          names: ["Gatsby", "Jay Gatsby"],
        },
        {
          id: 4,
          common_name: "Tom",
          main_character: true,
          description: "톰",
          names: ["Tom", "Tom Buchanan"],
        },
      ],
      relations: [
        {
          id1: 1,
          id2: 2,
          relation: ["친구"],
          explanation: "갯츠비의 이웃",
          positivity: 0.8,
          weight: 0.9,
          chapter: "chapter2",
        },
        {
          id1: 2,
          id2: 4,
          relation: ["적대"],
          explanation: "라이벌",
          positivity: -0.7,
          weight: 0.8,
          chapter: "chapter2",
        },
      ],
    },
    chapter3: {
      characters: [
        {
          id: 1,
          common_name: "Nick",
          main_character: true,
          description: "주인공",
          names: ["Nick", "Nick Carraway"],
        },
        {
          id: 2,
          common_name: "Gatsby",
          main_character: true,
          description: "갯츠비",
          names: ["Gatsby", "Jay Gatsby"],
        },
        {
          id: 3,
          common_name: "Daisy",
          main_character: true,
          description: "데이지",
          names: ["Daisy", "Daisy Buchanan"],
        },
        {
          id: 4,
          common_name: "Tom",
          main_character: true,
          description: "톰",
          names: ["Tom", "Tom Buchanan"],
        },
      ],
      relations: [
        {
          id1: 1,
          id2: 2,
          relation: ["친구"],
          explanation: "갯츠비의 이웃",
          positivity: 0.8,
          weight: 0.9,
          chapter: "chapter3",
        },
        {
          id1: 2,
          id2: 3,
          relation: ["사랑"],
          explanation: "과거의 연인",
          positivity: 0.9,
          weight: 1.0,
          chapter: "chapter3",
        },
        {
          id1: 2,
          id2: 4,
          relation: ["적대"],
          explanation: "라이벌",
          positivity: -0.7,
          weight: 0.8,
          chapter: "chapter3",
        },
      ],
    },
  },
};

const GraphPage = () => {
  const { filename, chapter } = useParams();
  const navigate = useNavigate();
  const currentChapter = chapter || "chapter1";
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredElements, setFilteredElements] = useState(null);
  const [graphVisible, setGraphVisible] = useState(true);

  // 파일별 데이터 로딩
  useEffect(() => {
    const loadGraphData = async () => {
      try {
        setLoading(true);
        let data;
        const filenameKey = filename ? filename.toLowerCase() : "";
        if (currentChapter === "chapter1") {
          data = {
            characters: charactersData.characters,
            relations: relationsData.relations.map((rel) => ({
              ...rel,
              chapter: "chapter1",
            })),
          };
        } else {
          data = mockData[filenameKey]?.[currentChapter];
        }
        // 데이터가 없으면 빈 그래프로 대체
        if (!data) {
          data = { characters: [], relations: [] };
        }
        setGraphData(data);
      } catch (error) {
        console.error("Error loading graph data:", error);
        message.error("그래프 데이터를 불러오는데 실패했습니다.");
      } finally {
        setLoading(false);
      }
    };
    if (filename) {
      loadGraphData();
    }
  }, [filename, currentChapter]);

  useEffect(() => {
    setGraphVisible(false); // 챕터 바뀔 때 숨김
    const timeout = setTimeout(() => setGraphVisible(true), 0); // 바로 보임(트랜지션 적용)
    return () => clearTimeout(timeout);
  }, [currentChapter]);

  // 그래프 요소 생성
  const elements = useMemo(() => {
    if (!graphData) return [];
    const nodes = graphData.characters
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((char) => ({
        data: {
          id: String(char.id),
          label: char.common_name,
          main: char.main_character,
          description: char.description,
          names: char.names,
        },
      }));
    const edges = graphData.relations
      .slice()
      .sort((a, b) => a.id1 - b.id1 || a.id2 - b.id2)
      .map((rel) => ({
        data: {
          id: `e${rel.id1}-${rel.id2}`,
          source: String(rel.id1),
          target: String(rel.id2),
          label: rel.relation.join(", "),
          explanation: rel.explanation,
          positivity: rel.positivity,
          weight: rel.weight,
          chapter: rel.chapter,
        },
      }));
    return [...nodes, ...edges];
  }, [graphData]);

  const handleTabChange = (key) => {
    navigate(`/graph/${filename}/${key}`);
  };

  const handleFilterClick = () => {
    // Filter logic
  };

  const handleExportClick = () => {
    // Export logic
  };

  const handleHelpClick = () => {
    // Help logic
  };

  const handleNodeClick = (node) => {
    // Node click logic
  };

  const handleEdgeClick = (edge) => {
    // Edge click logic
  };

  const handleTimelineClick = () => {
    navigate(`/viewer/${filename}/timeline`);
  };

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setFilteredElements(elements);
      return;
    }

    const searchTermLower = searchTerm.toLowerCase();
    // 1. 검색어에 해당하는 노드 찾기
    const matchedNode = elements.find((element) => {
      if (element.data.label) {
        const character = graphData.characters.find(
          (char) => String(char.id) === element.data.id
        );
        if (!character) return false;
        return character.names.some((name) =>
          name.toLowerCase().includes(searchTermLower)
        );
      }
      return false;
    });

    if (!matchedNode) {
      setFilteredElements([]);
      return;
    }

    // 2. 해당 노드와 연결된 간선 찾기
    const connectedEdges = elements.filter((element) => {
      if (element.data.source && element.data.target) {
        return (
          element.data.source === matchedNode.data.id ||
          element.data.target === matchedNode.data.id
        );
      }
      return false;
    });

    // 3. 연결된 노드들 찾기 (자기 자신 + 연결된 노드)
    const connectedNodeIds = new Set([
      matchedNode.data.id,
      ...connectedEdges.map((edge) => edge.data.source),
      ...connectedEdges.map((edge) => edge.data.target),
    ]);
    const connectedNodes = elements.filter((element) => {
      return element.data.label && connectedNodeIds.has(element.data.id);
    });

    // 4. 최종적으로 해당 노드 + 연결된 노드 + 간선만 보여주기
    setFilteredElements([...connectedNodes, ...connectedEdges]);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleReset = () => {
    setSearchTerm("");
    setFilteredElements(null);
    // RelationGraphMain에 ref로 resetGraph 등 전달 시 호출(예시)
    // if (graphRef.current) graphRef.current.resetGraph();
  };

  return (
    <div className="graph-page">
      <div className="graph-tabs folder-tabs">
        {[
          { key: "chapter1", label: "Chapter 1" },
          { key: "chapter2", label: "Chapter 2" },
          { key: "chapter3", label: "Chapter 3" },
        ].map((tab) => (
          <div
            key={tab.key}
            className={`graph-tab folder-tab ${
              currentChapter === tab.key ? "active" : ""
            }`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </div>
        ))}
      </div>
      <div className="graph-layout">
        <div className="graph-container">
          <div className="graph-controls">
            <div className="left-controls">
              <div className="search-box">
                <SearchOutlined />
                <input
                  type="text"
                  placeholder="인물 검색 (이름/별칭)"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
                <button onClick={handleSearch} className="search-button">
                  검색
                </button>
                <button
                  type="button"
                  className="ant-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "white",
                    color: "#4F6DDE",
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    fontSize: 14,
                    padding: "6px 12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    marginLeft: 8,
                  }}
                  onClick={handleReset}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = "#f5f5f5";
                    e.currentTarget.style.borderColor = "#ccc";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = "white";
                    e.currentTarget.style.borderColor = "#ddd";
                  }}
                >
                  <FaUndo style={{ fontSize: 16 }} /> 초기화
                </button>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="loading-container">
              <Spin size="large" />
              <p>Loading relationship data...</p>
            </div>
          ) : (
            <div
              className={`graph-canvas-area w-full h-full${
                graphVisible ? " fade-in" : " fade-out"
              }`}
              style={{
                transition: "opacity 0.3s",
                opacity: graphVisible ? 1 : 0,
                width: "100%",
                height: "100%",
                position: "relative",
              }}
            >
              <RelationGraphMain
                elements={filteredElements || elements}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                searchTerm={searchTerm}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GraphPage;
