import React, { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import RelationGraphMain from "../components/graph/RelationGraphMain";
import "./GraphPage.css";
import { Spin, Select, Button } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { FaUndo } from "react-icons/fa";

// 챕터 1-9까지 추가
const chapters = [
  { key: "chapter1", label: "Chapter 1" },
  { key: "chapter2", label: "Chapter 2" },
  { key: "chapter3", label: "Chapter 3" },
  { key: "chapter4", label: "Chapter 4" },
  { key: "chapter5", label: "Chapter 5" },
  { key: "chapter6", label: "Chapter 6" },
  { key: "chapter7", label: "Chapter 7" },
  { key: "chapter8", label: "Chapter 8" },
  { key: "chapter9", label: "Chapter 9" },
];

const GraphPage = () => {
  const { filename, chapter } = useParams();
  const navigate = useNavigate();
  const currentChapter = chapter || "chapter1";
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState({ characters: [], relations: [] });
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredElements, setFilteredElements] = useState(null);
  const [graphVisible, setGraphVisible] = useState(true);
  const [availableBooks, setAvailableBooks] = useState(["Gatsby"]);
  const [currentBook, setCurrentBook] = useState(filename || "Gatsby");

  // 책 및 챕터별 데이터 동적 로딩
  useEffect(() => {
    const loadChapterData = async (bookName, chapterKey) => {
      try {
        const chapterNum = chapterKey.replace("chapter", "").padStart(2, "0");
        console.log(`Loading ${bookName}/${chapterNum} data...`);

        // data/Gatsby/01_characters.json 형식으로 임포트
        const charactersData = await import(
          `../data/${bookName}/${chapterNum}_characters.json`
        );
        const relationsData = await import(
          `../data/${bookName}/${chapterNum}_relations.json`
        );

        return {
          characters: charactersData.characters || [],
          relations: (relationsData.relations || []).map((rel) => ({
            ...rel,
            chapter: chapterKey,
            book: bookName,
          })),
        };
      } catch (error) {
        console.error(
          `${bookName} 챕터 ${chapterKey} 데이터 로드 실패:`,
          error
        );
        return { characters: [], relations: [] };
      }
    };

    const loadData = async () => {
      setLoading(true);
      const data = await loadChapterData(currentBook, currentChapter);
      setGraphData(data);
      setLoading(false);
    };

    loadData();
  }, [currentBook, currentChapter]);

  useEffect(() => {
    setGraphVisible(false);
    const timeout = setTimeout(() => setGraphVisible(true), 300);
    return () => clearTimeout(timeout);
  }, [currentBook, currentChapter]);

  // 그래프 요소 생성 (존재하지 않는 노드 참조 간선은 제외)
  const elements = useMemo(() => {
    if (!graphData) return [];

    // 노드 생성
    const nodes = graphData.characters.map((char) => ({
      data: {
        id: String(char.id),
        label: char.common_name,
        main: char.main_character,
        description: char.description || "",
        names: char.names || [char.common_name],
      },
    }));

    // 실제 존재하는 노드 id 집합
    const validNodeIds = new Set(nodes.map((node) => node.data.id));

    // 존재하는 노드만 연결하는 간선만 포함
    const edges = graphData.relations
      .filter(
        (rel) =>
          validNodeIds.has(String(rel.id1)) && validNodeIds.has(String(rel.id2))
      )
      .map((rel, idx) => ({
        data: {
          id: `e${rel.id1}-${rel.id2}-${idx}`,
          source: String(rel.id1),
          target: String(rel.id2),
          label: Array.isArray(rel.relation)
            ? rel.relation.join(", ")
            : String(rel.relation || ""),
          explanation: rel.explanation || "",
          positivity: rel.positivity || 0,
          weight: rel.weight || 0.5,
          chapter: rel.chapter,
        },
      }));

    return [...nodes, ...edges];
  }, [graphData]);

  const handleBookChange = (book) => {
    setCurrentBook(book);
    navigate(`/graph/${book}/${currentChapter}`);
  };

  const handleTabChange = (key) => {
    navigate(`/graph/${currentBook}/${key}`);
  };

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setFilteredElements(elements);
      return;
    }
    const searchTermLower = searchTerm.toLowerCase();
    const matchedNode = elements.find(
      (element) =>
        element.data.label &&
        (element.data.label.toLowerCase().includes(searchTermLower) ||
          element.data.names?.some((name) =>
            name.toLowerCase().includes(searchTermLower)
          ))
    );
    if (!matchedNode) {
      setFilteredElements([]);
      return;
    }
    const connectedEdges = elements.filter(
      (element) =>
        element.data.source === matchedNode.data.id ||
        element.data.target === matchedNode.data.id
    );
    const connectedNodeIds = new Set([
      matchedNode.data.id,
      ...connectedEdges.flatMap((edge) => [edge.data.source, edge.data.target]),
    ]);
    const connectedNodes = elements.filter(
      (element) => element.data.label && connectedNodeIds.has(element.data.id)
    );
    setFilteredElements([...connectedNodes, ...connectedEdges]);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleReset = () => {
    setSearchTerm("");
    setFilteredElements(null);
  };

  return (
    <div className="graph-page">
      <div className="graph-tabs folder-tabs">
        {chapters.map((tab) => (
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
                <Button
                  icon={<FaUndo />}
                  onClick={handleReset}
                  style={{ marginLeft: 8 }}
                >
                  초기화
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-container">
              <Spin size="large" />
              <p>
                {currentBook} - Chapter {currentChapter.replace("chapter", "")}{" "}
                데이터 로딩 중...
              </p>
            </div>
          ) : (
            <div
              className="graph-canvas-area"
              style={{
                transition: "opacity 0.5s",
                opacity: graphVisible ? 1 : 0,
                width: "100%",
                height: "calc(100vh - 150px)",
                position: "relative",
              }}
            >
              <RelationGraphMain
                elements={filteredElements || elements}
                searchTerm={searchTerm}
              />
              {elements.length === 0 && !loading && (
                <div className="no-data-message">
                  이 챕터에 대한 관계 데이터가 없습니다.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GraphPage;
