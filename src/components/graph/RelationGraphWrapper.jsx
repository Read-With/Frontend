import React, { useState, useEffect, useRef } from "react";
import RelationGraphMain from "./RelationGraphMain";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes } from 'react-icons/fa';

// characters.json, 이벤트별 relations.json glob import
const characterModules = import.meta.glob('../../data/*_characters.json', { eager: true });
const eventModules = import.meta.glob('../../data/*_ev*_relations.json', { eager: true });

const getChapterCharacters = (chapter) => {
  const num = String(chapter).padStart(2, '0');
  // characters.json 구조: { characters: [...] } 또는 [...]
  const data = characterModules[`../../data/${num}_characters.json`]?.default;
  if (!data) return [];
  return Array.isArray(data) ? data : data.characters || [];
};

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const [currentChapter, setCurrentChapter] = useState(() => {
    const saved = localStorage.getItem('lastGraphChapter');
    return saved ? Number(saved) : 1;
  });
  const [elements, setElements] = useState([]);
  const [maxChapter, setMaxChapter] = useState(9);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [hideIsolated, setHideIsolated] = useState(true);
  const [eventNum, setEventNum] = useState(1);
  const [maxEventNum, setMaxEventNum] = useState(0);
  const [graphViewState, setGraphViewState] = useState(null);
  const [newNodeIds, setNewNodeIds] = useState([]);

  // === 1. 챕터별/이벤트별 모든 relations.json을 미리 누적 구조로 준비 ===
  const allEventsDataRef = useRef({}); // { [chapterNum]: [ {nodes, edges} ... ] }
  const allEventFilesRef = useRef({}); // { [chapterNum]: [파일경로, ...] }
  const allCharactersRef = useRef({}); // { [chapterNum]: [캐릭터배열] }

  // 챕터 변경 시, 해당 챕터의 모든 이벤트 relations.json 누적 준비
  useEffect(() => {
    const num = String(currentChapter).padStart(2, '0');
    // 해당 챕터의 모든 이벤트 파일 경로 추출 및 정렬
    const eventFiles = Object.keys(eventModules)
      .filter(path => path.includes(`/${num}_ev`) && path.includes('_relations.json'))
      .sort((a, b) => {
        // evN에서 N만 추출해서 정렬
        const getEvNum = p => parseInt((p.match(/_ev(\d+)_/) || [])[1] || (p.match(/_ev(\d+)\./) || [])[1] || '0', 10);
        return getEvNum(a) - getEvNum(b);
      });
    allEventFilesRef.current[num] = eventFiles;
    setMaxEventNum(eventFiles.length);
    setEventNum(1);
    // 캐릭터 정보 미리 저장
    allCharactersRef.current[num] = getChapterCharacters(currentChapter);
    // 누적 노드/엣지 준비
    let accumulatedNodeIds = new Set();
    let accumulatedEdgeIds = new Set();
    let accumulatedNodes = [];
    let accumulatedEdges = [];
    const chapterEvents = [];
    eventFiles.forEach((file, idx) => {
      const data = eventModules[file].default || {};
      // new_appearances: id 배열
      const newNodeIds = Array.isArray(data.new_appearances) ? data.new_appearances.map(id => String(Math.trunc(id))) : [];
      // relations: 엣지 배열
      const newEdges = Array.isArray(data.relations) ? data.relations : [];
      // 노드 상세정보 characters.json에서 찾아서 생성
      const charList = allCharactersRef.current[num] || [];
      const newNodes = newNodeIds
        .filter(id => !accumulatedNodeIds.has(id))
        .map(id => {
          const char = charList.find(c => String(Math.trunc(c.id)) === id);
          return {
            data: {
              id: id,
              label: char?.common_name || char?.name || id,
              main: char?.main_character,
              description: char?.description,
              names: char?.names,
              img: char?.img,
            },
            // position: ... (필요시 위치 정보 추가)
          };
        });
      // 엣지 생성
      const edges = newEdges
        .filter(e => e.id1 != null && e.id2 != null)
        .map((e, i) => {
          const source = String(Math.trunc(e.id1));
          const target = String(Math.trunc(e.id2));
          const edgeId = `${source}_${target}_${i}`;
          if (accumulatedEdgeIds.has(edgeId)) return null;
          return {
            data: {
              id: edgeId,
              source,
              target,
              label: Array.isArray(e.relation) ? e.relation.join(", ") : e.type,
              explanation: e.explanation,
              positivity: e.positivity,
              weight: e.weight,
            },
          };
        }).filter(Boolean);
      // 누적
      newNodes.forEach(n => accumulatedNodeIds.add(n.data.id));
      edges.forEach(e => accumulatedEdgeIds.add(e.data.id));
      accumulatedNodes = [...accumulatedNodes, ...newNodes];
      accumulatedEdges = [...accumulatedEdges, ...edges];
      // 이 시점의 누적 elements 저장
      chapterEvents.push({
        nodes: [...accumulatedNodes],
        edges: [...accumulatedEdges],
        newNodeIds: newNodes.map(n => n.data.id),
      });
    });
    allEventsDataRef.current[num] = chapterEvents;
    // 첫 이벤트로 초기화
    setElements([...(chapterEvents[0]?.nodes || []), ...(chapterEvents[0]?.edges || [])]);
    setNewNodeIds(chapterEvents[0]?.newNodeIds || []);
  }, [currentChapter]);

  // === 2. eventNum이 바뀔 때마다 해당 시점의 누적 elements로 setElements ===
  useEffect(() => {
    const num = String(currentChapter).padStart(2, '0');
    const chapterEvents = allEventsDataRef.current[num] || [];
    const idx = Math.max(0, Math.min(eventNum - 1, chapterEvents.length - 1));
    const curr = chapterEvents[idx] || { nodes: [], edges: [], newNodeIds: [] };
    setElements([...(curr.nodes || []), ...(curr.edges || [])]);
    setNewNodeIds(curr.newNodeIds || []);
  }, [eventNum, currentChapter]);

  // 챕터 변경 시 localStorage에 저장
  useEffect(() => {
    localStorage.setItem('lastGraphChapter', String(currentChapter));
  }, [currentChapter]);

  // 챕터별 graphViewState를 localStorage에 저장/복원
  useEffect(() => {
    // 마운트 시 복원
    const saved = localStorage.getItem(`graphViewState_chapter${currentChapter}`);
    if (saved) {
      setGraphViewState(JSON.parse(saved));
    } else {
      setGraphViewState(null);
    }
  }, [currentChapter]);

  useEffect(() => {
    return () => {
      if (graphViewState) {
        localStorage.setItem(`graphViewState_chapter${currentChapter}`, JSON.stringify(graphViewState));
      }
    };
  }, [graphViewState, currentChapter]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f4f7fb', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: 12 }}>
      {/* 상단바: 챕터 파일탭, 인물 검색, 독립 인물 버튼, 닫기 버튼 */}
      <div style={{
        width: '100vw',
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        borderBottom: '1px solid #e5e7eb',
        zIndex: 10001,
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 0,
        paddingLeft: 0,
        paddingRight: 0,
      }}
      onWheel={e => e.preventDefault()}
      >
        {/* 첫 번째 행: 챕터 파일탭 + 독립 인물 버튼 + 닫기 버튼 */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingTop: 0, height: 36, width: '100%' }}>
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 0,
            overflowX: 'auto',
            maxWidth: '90vw',
            paddingBottom: 6,
            scrollbarWidth: 'thin',
            scrollbarColor: '#bfc8e2 #f4f7fb',
          }}>
            {Array.from({ length: maxChapter }, (_, i) => i + 1).map((chapter) => (
              <button
                key={chapter}
                onClick={() => setCurrentChapter(chapter)}
                style={{
                  height: 45,
                  minWidth: 90,
                  padding: '0 15px',
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  borderTop: currentChapter === chapter ? '2.5px solid #6C8EFF' : '1.5px solid #bfc8e2',
                  borderRight: chapter === maxChapter ? (currentChapter === chapter ? '2.5px solid #6C8EFF' : '1.5px solid #bfc8e2') : 'none',
                  borderBottom: currentChapter === chapter ? 'none' : '1.5px solid #bfc8e2',
                  borderLeft: chapter === 1 ? (currentChapter === chapter ? '2.5px solid #6C8EFF' : '1.5px solid #bfc8e2') : 'none',
                  background: currentChapter === chapter ? '#fff' : '#e7edff',
                  color: currentChapter === chapter ? '#22336b' : '#6C8EFF',
                  fontWeight: currentChapter === chapter ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                  marginRight: 10,
                  marginLeft: chapter === 1 ? 0 : 0,
                  marginBottom: currentChapter === chapter ? -2 : 0,
                  boxShadow: currentChapter === chapter ? '0 4px 16px rgba(108,142,255,0.10)' : 'none',
                  zIndex: currentChapter === chapter ? 2 : 1,
                  transition: 'all 0.18s',
                  position: 'relative',
                  outline: 'none',
                }}
              >
                {`Chapter ${chapter}`}
              </button>
            ))}
          </div>
          <button
            onClick={() => setHideIsolated(v => !v)}
            style={{
              height: 32,
              padding: '2px 12px',
              borderRadius: 6,
              border: '1px solid #bfc8e2',
              background: hideIsolated ? '#6C8EFF' : '#f4f7fb',
              color: hideIsolated ? '#fff' : '#22336b',
              fontWeight: 500,
              fontSize: 14,
              cursor: 'pointer',
              marginLeft: 6,
              lineHeight: '28px'
            }}
          >
            {hideIsolated ? '독립 인물 숨김' : '독립 인물 표시'}
          </button>
          {/* 닫기 버튼: 오른쪽 끝 */}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => navigate(`user/viewer/${filename}`)}
            style={{
              height: 32,
              width: 32,
              minWidth: 32,
              minHeight: 32,
              borderRadius: 8,
              border: '1.5px solid #e3e6ef',
              background: '#fff',
              color: '#22336b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              marginRight: 32,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(108,142,255,0.07)',
              transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
            }}
            title="그래프 닫기"
          >
            <FaTimes />
          </button>
        </div>
        {/* 두 번째 행: 인물 검색 폼 */}
        <div style={{ width: '100%', height: 54, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 12, paddingTop: 0, paddingBottom: 0, background: '#fff' }}>
          <GraphControls
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            handleSearch={() => setSearch(searchInput)}
            handleReset={() => { setSearchInput(""); setSearch(""); }}
            handleFitView={() => {}}
            search={search}
            setSearch={setSearch}
            inputStyle={{ height: 32, fontSize: 14, padding: '2px 8px', borderRadius: 6 }}
            buttonStyle={{ height: 32, fontSize: 14, padding: '2px 10px', borderRadius: 6 }}
          />
        </div>
      </div>
      {/* 그래프 본문 */}
      <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
        {maxEventNum > 0 ? (
          <RelationGraphMain 
            elements={elements} 
            inViewer={true} 
            fullScreen={false}
            graphViewState={graphViewState}
            setGraphViewState={setGraphViewState}
            chapterNum={currentChapter}
            eventNum={Math.min(eventNum, maxEventNum)}
            maxEventNum={maxEventNum}
            newNodeIds={newNodeIds}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#6C8EFF' }}>
            이벤트 정보를 불러오는 중...
          </div>
        )}
      </div>
    </div>
  );
}

export default RelationGraphWrapper;