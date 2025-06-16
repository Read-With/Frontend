import React, { useState, useEffect, useRef } from "react";
import RelationGraphMain from "./RelationGraphMain";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes } from 'react-icons/fa';
import { convertRelationsToElements } from './graphElementUtils';
import GraphNodeTooltip from "./NodeTooltip";
import EdgeTooltip from "./EdgeTooltip";

// characters.json, 이벤트별 relations.json glob import
const characterModules = import.meta.glob('../../data/gatsby/c_chapter*_0.json', { eager: true });
const eventModules = import.meta.glob('../../data/gatsby/chapter*_relationships_event_*.json', { eager: true });

const getChapterCharacters = (chapter) => {
  const num = String(chapter).padStart(1, '0');
  // characters.json 구조: { characters: [...] }
  const data = characterModules[`../../data/gatsby/c_chapter${num}_0.json`]?.default;
  if (!data) return [];
  return data.characters || [];
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
  const [eventNum, setEventNum] = useState(0);
  const [maxEventNum, setMaxEventNum] = useState(0);
  const [graphViewState, setGraphViewState] = useState(null);
  const [newNodeIds, setNewNodeIds] = useState([]);
  const [chapterEvents, setChapterEvents] = useState([]);

  // === 1. 챕터별/이벤트별 모든 relations.json을 미리 누적 구조로 준비 ===
  const allEventsDataRef = useRef({}); // { [chapterNum]: [ {nodes, edges} ... ] }
  const allEventFilesRef = useRef({}); // { [chapterNum]: [파일경로, ...] }
  const allCharactersRef = useRef({}); // { [chapterNum]: [캐릭터배열] }

  // 챕터 변경 시 해당 챕터의 마지막 이벤트 번호를 찾아서 elements 세팅
  useEffect(() => {
    const num = String(currentChapter).padStart(1, '');
    // 해당 챕터의 모든 이벤트 관계 파일 경로 추출
    const eventFiles = Object.keys(eventModules).filter(path =>
      path.includes(`chapter${currentChapter}_relationships_event_`)
    );
    if (eventFiles.length === 0) {
      setElements([]);
      setNewNodeIds([]);
      return;
    }
    // 파일명에서 이벤트 번호 추출, 가장 큰 값 찾기
    const maxEventNum = Math.max(...eventFiles.map(path => {
      const match = path.match(/event_(\d+)\.json$/);
      return match ? Number(match[1]) : 0;
    }));
    setMaxEventNum(maxEventNum);
    // 가장 마지막 이벤트 파일 경로
    const lastEventFile = eventFiles.find(path => path.includes(`${maxEventNum}.json`));
    const eventData = lastEventFile ? eventModules[lastEventFile]?.default : null;
    if (!eventData) {
      setElements([]);
      setNewNodeIds([]);
      return;
    }
    // 인물 데이터 로딩
    const charFile = Object.keys(characterModules).find(path => path.includes(`c_chapter${currentChapter}_0.json`));
    const charData = charFile ? characterModules[charFile]?.default : null;
    
    // elements 변환 (viewer와 동일하게 idToName에 common_name 우선)
    let idToName = {}, idToDesc = {}, idToMain = {}, idToNames = {};
    
    // characters 배열이 있는 경우
    if (charData?.characters && Array.isArray(charData.characters)) {
      charData.characters.forEach(c => {
        const id = String(c.id);
        idToName[id] = c.common_name || c.name || id;
        idToDesc[id] = c.description || '';
        idToMain[id] = c.main_character || false;
        idToNames[id] = Array.isArray(c.names) ? c.names : [];
      });
    }
    

    const newElements = convertRelationsToElements(
      eventData?.relations || [],
      idToName, idToDesc, idToMain, idToNames
    );
    setElements(newElements);
    setNewNodeIds([]); // 필요시 새 노드 추출 로직 추가
  }, [currentChapter]);

  // === 2. eventNum이 바뀔 때마다 해당 시점의 누적 elements로 setElements ===
  // useEffect(() => {
  //   if (eventNum == null) return;
  //   const num = String(currentChapter).padStart(2, '0');
  //   const chapterEvents = allEventsDataRef.current[num] || [];
  //   // eventNum이 0부터 시작하므로 그대로 인덱스로 사용
  //   const idx = Math.max(0, Math.min(eventNum, chapterEvents.length - 1));
  //   const curr = chapterEvents[idx] || { nodes: [], edges: [], newNodeIds: [] };
  //   const elements = [...(curr.nodes || []), ...(curr.edges || [])];
  //   setElements(elements);
  //   setNewNodeIds(curr.newNodeIds || []);
  // }, [eventNum, currentChapter]);

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
            inViewer={false}
            fullScreen={true}
            graphViewState={graphViewState}
            setGraphViewState={setGraphViewState}
            chapterNum={currentChapter}
            eventNum={eventNum} // 이벤트 번호는 null 또는 undefined로 전달
            hideIsolated={hideIsolated}
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