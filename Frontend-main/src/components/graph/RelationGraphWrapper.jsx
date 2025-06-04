import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import RelationGraphMain from "./RelationGraphMain";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { FaTimes } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import CytoscapeGraphPortalProvider from "./CytoscapeGraphPortalProvider";

// === glob import 패턴 변경: 작품명/챕터별 구조 반영 ===
const characterModules = import.meta.glob('/src/data/*/c_chapter*_*.json', { eager: true });
const eventModules = import.meta.glob('/src/data/*/chapter*_relationships_event_*.json', { eager: true });

console.log('=== [디버깅] eventModules keys:', Object.keys(eventModules));

// === 동적 경로 생성 함수 ===
function getChapterCharacters(book, chapter) {
  const filePath = `/src/data/${book}/c_chapter${chapter}_0.json`;
  const data = characterModules[filePath]?.default;
  return data?.characters || [];
}

function getEventRelations(book, chapter, eventNum) {
  const filePath = `/src/data/${book}/chapter${chapter}_relationships_event_${eventNum}.json`;
  const data = eventModules[filePath]?.default;
  return data?.relations || [];
}

// === id 변환 함수 추가 ===
const safeId = v => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'string' && v.match(/^[0-9]+\.0$/)) return v.split('.')[0];
  return String(v).trim();
};

console.log('=== RelationGraphWrapper 렌더링됨');
function RelationGraphWrapper(props) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  // filename 우선순위: props > params > location
  const filename = props.filename || params.filename || location.pathname.split('/').pop();
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
  const [chapterEvents, setChapterEvents] = useState([]);

  // === 1. 챕터별/이벤트별 모든 relations.json을 미리 누적 구조로 준비 ===
  const allEventsDataRef = useRef({}); // { [chapterNum]: [ {nodes, edges} ... ] }
  const allEventFilesRef = useRef({}); // { [chapterNum]: [파일경로, ...] }
  const allCharactersRef = useRef({}); // { [chapterNum]: [캐릭터배열] }

  // === 기존 노드/엣지 생성 코드 복원 ===
  // eventFiles, allNodeIds 등 누적 방식이 아니라, 단순히 해당 챕터/이벤트의 characters/relations에서 바로 생성

  // 예시:
  // const nodes = (charactersData.characters || []).map((char) => ({
  //   data: {
  //     id: safeId(char.id),
  //     label: char.common_name,
  //     main: char.main_character,
  //     description: char.description,
  //     names: char.names,
  //   },
  // }));
  // const edges = (relationsData.relations || []).map((rel, idx) => ({
  //   data: {
  //     id: `e${idx}`,
  //     source: safeId(rel.id1),
  //     target: safeId(rel.id2),
  //     label: Array.isArray(rel.relation) ? rel.relation.join(", ") : rel.type,
  //     explanation: rel.explanation,
  //     positivity: rel.positivity,
  //     weight: rel.weight,
  //   },
  // }));
  // setElements([...nodes, ...edges]);

  // filename에서 .epub 등 확장자 제거
  const bookName = filename ? filename.replace(/\.[^/.]+$/, '') : '';

  console.log('=== [디버깅] filename:', filename);
  console.log('=== [디버깅] bookName:', bookName);
  console.log('=== [디버깅] currentChapter:', currentChapter);
  console.log('=== [디버깅] eventNum:', eventNum);

  useEffect(() => {
    console.log('=== [디버깅] useEffect 선언부 진입', bookName, currentChapter, eventNum);
    if (!bookName) return;
    // 1. 캐릭터 데이터 로드
    const charactersData = getChapterCharacters(bookName, currentChapter);
    // 2. 관계 데이터 로드
    const relationsData = getEventRelations(bookName, currentChapter, eventNum || 1);

    console.log('=== [디버깅] useEffect 실행됨');
    console.log('=== [디버깅] charactersData:', charactersData);
    console.log('=== [디버깅] relationsData:', relationsData);

    const nodes = (charactersData?.characters || []).map((char) => ({
      data: {
        id: safeId(char.id),
        label: char.common_name,
        main: char.main_character,
        description: char.description,
        names: char.names,
      },
    }));
    const edges = (relationsData?.relations || []).map((rel, idx) => ({
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

    console.log('=== [디버깅] nodes:', nodes);
    console.log('=== [디버깅] edges:', edges);
    console.log('=== [디버깅] elements:', [...nodes, ...edges]);
    setElements([...nodes, ...edges]);
  }, [bookName, currentChapter, eventNum]);

  // 현재 이벤트 데이터 계산을 useMemo로 최적화
  const idx = typeof eventNum === 'number' && eventNum > 0
    ? Math.max(0, Math.min(eventNum - 1, chapterEvents.length - 1))
    : 0;
  const currentEventData = chapterEvents[idx] || { nodes: [], edges: [], newNodeIds: [] };

  // elements 업데이트를 useCallback으로 최적화
  const updateElements = useCallback(() => {
    if (eventNum === 1) {
      // 첫 이벤트: 변화분만
      const { diffNodes = [], diffEdges = [], newNodeIds = [] } = chapterEvents[0] || {};
    setElements([
        ...diffNodes,
        ...diffEdges
    ]);
    setNewNodeIds(newNodeIds);
      return;
    }
    // 이전까지의 elements를 누적해서 가져옴
    let prevElements = [];
    for (let i = 0; i < eventNum; i++) {
      const { diffNodes = [], diffEdges = [] } = chapterEvents[i] || {};
      prevElements = [
        ...prevElements,
        ...diffNodes,
        ...diffEdges
      ];
    }
    // 변화분만 추가
    setElements(prevElements);
    // 마지막 이벤트의 newNodeIds만 반영
    setNewNodeIds(chapterEvents[eventNum - 1]?.newNodeIds || []);
  }, [chapterEvents, eventNum]);

  // eventNum이 바뀔 때마다 해당 시점의 누적 elements로 setElements
  useEffect(() => {
    updateElements();
  }, [updateElements]);

  // 챕터 변경 핸들러를 useCallback으로 최적화
  const handleChapterChange = useCallback((chapter) => {
    setCurrentChapter(chapter);
  }, []);

  // 이벤트 변경 핸들러를 useCallback으로 최적화
  const handleEventChange = useCallback((num) => {
    setEventNum(num);
  }, []);

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

  // 컴포넌트가 언마운트될 때까지 상태 유지
  const [isExiting, setIsExiting] = useState(false);

  // 페이지 전환 시 상태 유지
  useEffect(() => {
    return () => {
      setIsExiting(true);
    };
  }, []);

  useEffect(() => {
    console.log('[Wrapper] elements:', elements);
  }, [elements]);

  const graphDiffForCytoscape = useMemo(() => {
    return {
      added: getElementsByIds(elements, graphDiff.added, true),
      removed: getElementsByIds(prevElementsRef.current, graphDiff.removed, true),
      updated: [
        ...getElementsByIds(elements, graphDiff.added, true),
        ...getElementsByIds(prevElementsRef.current, graphDiff.removed, true)
      ]
    };
  }, [elements, graphDiff, prevElementsRef.current]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 왼쪽: 책 뷰어 (실제 BookViewer 컴포넌트로 대체) */}
        {/* <BookViewer ... /> */}
      </div>
      <div style={{ width: 600, minWidth: 400, maxWidth: '50vw', height: '100vh', background: '#fff', borderLeft: '1px solid #eee' }}>
        {/* 오른쪽: 그래프 */}
        <CytoscapeGraphPortalProvider>
          <AnimatePresence mode="wait">
            <motion.div 
              key={`graph-${currentChapter}-${eventNum}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ 
                duration: 0.3,
                ease: "easeInOut"
              }}
              style={{ 
                width: '100%', 
                height: '100%', 
                background: '#f4f7fb', 
                overflow: 'hidden', 
                display: 'flex', 
                flexDirection: 'column', 
                paddingTop: 12,
                position: 'relative',
                willChange: 'opacity'
              }}
            >
              <motion.div 
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ 
                  duration: 0.3, 
                  delay: 0.1,
                  ease: "easeInOut"
                }}
                style={{
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
                  willChange: 'transform, opacity'
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
                        onClick={() => handleChapterChange(chapter)}
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
              </motion.div>

              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ 
                  duration: 0.3, 
                  delay: 0.2,
                  ease: "easeInOut"
                }}
                style={{ 
                  flex: 1, 
                  position: 'relative',
                  willChange: 'opacity'
                }}
              >
                <RelationGraphMain
                  elements={elements}
                  newNodeIds={newNodeIds}
                  graphViewState={graphViewState}
                  setGraphViewState={setGraphViewState}
                  hideIsolated={hideIsolated}
                  isExiting={isExiting}
                  onEventChange={handleEventChange}
                  eventNum={eventNum}
                  diffNodes={currentEventData.diffNodes}
                />
              </motion.div>

              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ 
                  duration: 0.3, 
                  delay: 0.3,
                  ease: "easeInOut"
                }}
                style={{
                  willChange: 'transform, opacity'
                }}
              >
                <GraphControls
                  currentChapter={currentChapter}
                  setCurrentChapter={handleChapterChange}
                  maxChapter={maxChapter}
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  search={search}
                  setSearch={setSearch}
                  hideIsolated={hideIsolated}
                  setHideIsolated={setHideIsolated}
                  eventNum={eventNum}
                  setEventNum={handleEventChange}
                  maxEventNum={maxEventNum}
                />
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </CytoscapeGraphPortalProvider>
      </div>
    </div>
  );
}

export default React.memo(RelationGraphWrapper);