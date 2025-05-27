import React, { useState, useEffect } from "react";
import RelationGraphMain from "./RelationGraphMain";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes } from 'react-icons/fa';

// 챕터별 파일 import.meta.glob context 생성
const characterModules = import.meta.glob('../../data/*_characters.json', { eager: true });
const relationModules = import.meta.glob('../../data/*_merged_relations.json', { eager: true });
// 모든 챕터/이벤트 파일을 한 번에 glob으로 불러오기
const allEventModules = import.meta.glob('../../data/*/chapter_*_event_*.json', { eager: true });

const getChapterFile = (chapter, type) => {
  const num = String(chapter).padStart(2, '0');
  if (type === 'characters') {
    return characterModules[`../../data/${num}_characters.json`]?.default || [];
  } else {
    return relationModules[`../../data/${num}_merged_relations.json`]?.default || [];
  }
};

// currentChapter의 초기값을 localStorage에서 불러오도록 함수 추가
const getInitialChapter = () => {
  const saved = localStorage.getItem('lastGraphChapter');
  return saved ? Number(saved) : 1;
};

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  const [currentChapter, setCurrentChapter] = useState(getInitialChapter);
  const [elements, setElements] = useState([]);
  const [maxChapter, setMaxChapter] = useState(9); // data 폴더 기준
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [hideIsolated, setHideIsolated] = useState(true);
  // 이벤트 상태 추가
  const [eventNum, setEventNum] = useState(1);
  const [maxEventNum, setMaxEventNum] = useState(0);
  // 그래프 pan/zoom/노드 위치 상태를 상위에서 관리
  const [graphViewState, setGraphViewState] = useState(null);

  // 챕터 변경 시 데이터 불러오기
  useEffect(() => {
    try {
      // maxEventNum 계산 (이벤트별 파일 개수 기반, 정적 glob)
      const num = String(currentChapter).padStart(2, '0');
      const allKeys = Object.keys(allEventModules);
      const filteredPaths = allKeys.filter(path => path.includes(`/data/${num}/chapter_${currentChapter}_event_`));
      const maxEvent = filteredPaths.length > 0 ? filteredPaths.length : 1;
      // --- 상태 점검용 로그 ---
      console.log('[maxEventNum 계산] allEventModules keys:', allKeys);
      console.log('[maxEventNum 계산] current num:', num, 'currentChapter:', currentChapter);
      console.log('[maxEventNum 계산] filtered event paths:', filteredPaths);
      console.log('[maxEventNum 계산] maxEvent:', maxEvent);
      setMaxEventNum(maxEvent);
      // eventNum이 maxEventNum보다 크면 자동 조정
      setEventNum(prev => prev > maxEvent ? maxEvent : prev);

      const charactersData = getChapterFile(currentChapter, 'characters');
      const relationsData = getChapterFile(currentChapter, 'relations');
      if (!charactersData || !relationsData) {
        setElements([]);
        return;
      }
      const safeId = v => {
        if (v === undefined || v === null) return '';
        if (typeof v === 'number') return String(Math.trunc(v));
        if (typeof v === 'string' && v.match(/^[0-9]+\.0$/)) return v.split('.')[0];
        return String(v).trim();
      };
      // localStorage에서 노드 위치 정보 읽기
      const storageKey = `chapter_node_positions_${currentChapter}`;
      let nodePositions = {};
      try {
        const posStr = localStorage.getItem(storageKey);
        if (posStr) nodePositions = JSON.parse(posStr);
      } catch (e) {}

      // === 이벤트별 등장 id만 필터링 ===
      // filteredNodes의 id 집합 구하기 (고립 노드 필터링 포함)
      const allNodeIds = new Set((charactersData.characters || charactersData).map(char => safeId(char.id)));
      const edgesRaw = (relationsData.relations || relationsData)
        .map((rel, idx) => ({
          data: {
            id: `e${idx}`,
            source: safeId(rel.id1 || rel.source),
            target: safeId(rel.id2 || rel.target),
            label: Array.isArray(rel.relation) ? rel.relation.join(", ") : rel.type,
            explanation: rel.explanation,
            positivity: rel.positivity,
            weight: rel.weight,
          },
        }));
      let filteredNodeIds = new Set();
      if (hideIsolated) {
        const connectedNodeIds = new Set();
        edgesRaw.forEach(edge => {
          connectedNodeIds.add(edge.data.source);
          connectedNodeIds.add(edge.data.target);
        });
        filteredNodeIds = new Set([...allNodeIds].filter(id => connectedNodeIds.has(id)));
      } else {
        filteredNodeIds = allNodeIds;
      }

      // === 위치 정보가 있는 id만 노드로 렌더링 ===
      const nodes = (charactersData.characters || charactersData)
        .filter(char => {
          const id = safeId(char.id);
          return filteredNodeIds.has(id) && nodePositions[id];
        })
        .map(char => ({
          data: {
            id: safeId(char.id),
            label: char.common_name || char.name,
            main: char.main_character,
            description: char.description,
            names: char.names,
            img: char.img,
          },
          position: nodePositions[safeId(char.id)]
        }));

      // === 간선도 source/target 모두 위치 정보가 있는 경우만 렌더링 ===
      const edges = edgesRaw.filter(edge =>
        nodePositions[edge.data.source] && nodePositions[edge.data.target]
      );

      // --- 마지막 이벤트일 때는 전체 노드+엣지 포함 ---
      const safeEventNum = Math.min(eventNum, maxEvent);
      if (safeEventNum === maxEvent) {
        setElements([...nodes, ...edges]);
      } else {
        setElements([...nodes, ...edges]); // 위치 정보 없는 노드는 이미 필터링됨
      }
    } catch (e) {
      setElements([]);
    }
  }, [currentChapter, hideIsolated, eventNum]);

  // 웹페이지 스크롤 막기 (body, html 모두 + 강제 스크롤 방지)
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyHeight = document.body.style.height;
    const originalHtmlHeight = document.documentElement.style.height;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.height = '100%';
    document.documentElement.style.height = '100%';

    // 강제로 스크롤 최상단 고정
    window.scrollTo(0, 0);
    const blockScroll = e => {
      e.preventDefault();
      window.scrollTo(0, 0);
      return false;
    };
    window.addEventListener('scroll', blockScroll, { passive: false });
    window.addEventListener('wheel', blockScroll, { passive: false });
    window.addEventListener('touchmove', blockScroll, { passive: false });
    window.addEventListener('keydown', e => {
      if ([32, 33, 34, 35, 36, 37, 38, 39, 40].includes(e.keyCode)) {
        blockScroll(e);
      }
    }, { passive: false });

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.height = originalBodyHeight;
      document.documentElement.style.height = originalHtmlHeight;
      window.removeEventListener('scroll', blockScroll);
      window.removeEventListener('wheel', blockScroll);
      window.removeEventListener('touchmove', blockScroll);
      // keydown 리스너는 별도 함수로 등록해야 제거 가능(여기선 생략)
    };
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