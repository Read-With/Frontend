import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import ViewerLayout from './ViewerLayout';
import EpubViewer from './epub/EpubViewer';
import BookmarkPanel from './epub/BookmarkPanel';
import ViewerSettings from './epub/ViewerSettings';
import { loadBookmarks, saveBookmarks } from "./epub/BookmarkManager";
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import RelationGraphMain from '../graph/RelationGraphMain';
import GraphControls from '../graph/GraphControls';
import { FaSyncAlt } from 'react-icons/fa';
import cytoscape from 'cytoscape';

// 반드시 파일 최상단에 위치!
const eventRelationModules = import.meta.glob('/src/data/*/[0-9][0-9]_ev*_relations.json', { eager: true });

// 기본 설정 값
const defaultSettings = {
  fontSize: 100,
  pageMode: 'double',  // 'single', 'double' 중 하나
  theme: 'light',
  lineHeight: 1.5,
  margin: 20,
  fontFamily: 'default',
  showGraph: true,     // 그래프 표시 여부 추가
};

// 로컬 스토리지에서 설정 불러오기
const loadSettings = () => {
  try {
    const settings = localStorage.getItem('epub_viewer_settings');
    const loadedSettings = settings ? JSON.parse(settings) : defaultSettings;
    
    // leftOnly 모드였다면 double로 변경
    if (loadedSettings.pageMode === 'leftOnly') {
      loadedSettings.pageMode = 'double';
    }
    
    // showGraph 속성이 없으면 기본값 추가
    if (loadedSettings.showGraph === undefined) {
      loadedSettings.showGraph = defaultSettings.showGraph;
    }
    
    // 업데이트된 설정 저장
    localStorage.setItem('epub_viewer_settings', JSON.stringify(loadedSettings));
    
    return loadedSettings;
  } catch (e) {
    console.error('설정 불러오기 오류:', e);
    return defaultSettings;
  }
};

function parseCfiToChapterDetail(cfi) {
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? `${chapterMatch[1]}장` : null;

  // [chapter-x]/숫+ 추출
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  const page = pageMatch ? pageMatch[1] : null;

  if (chapter && page) return `${chapter} ${page}`;
  if (chapter) return chapter;
  return cfi;
}

// import.meta.glob으로 data 폴더 내 챕터별 json 파일 context 생성 (Vite/Next.js/CRA 최신)
const characterModules = import.meta.glob('/src/data/*/[0-9][0-9]_characters.json', { eager: true });
const relationModules = import.meta.glob('/src/data/*/[0-9][0-9]_merged_relations.json', { eager: true });

const getChapterFile = (chapter, type) => {
  const num = String(chapter).padStart(2, '0');
  try {
    if (type === 'characters') {
      const filePath = `/src/data/${num}/${num}_characters.json`;
      const data = characterModules[filePath]?.default;
      console.log('[characters] filePath:', filePath, 'data:', data);
      if (!data) {
        console.warn(`캐릭터 파일을 찾을 수 없음: ${filePath}`);
        return [];
      }
      return data;
    } else {
      const filePath = `/src/data/${num}/${num}_merged_relations.json`;
      const data = relationModules[filePath]?.default;
      console.log('[relations] filePath:', filePath, 'data:', data);
      if (!data) {
        console.warn(`관계 파일을 찾을 수 없음: ${filePath}`);
        return [];
      }
      return data;
    }
  } catch (error) {
    console.error(`파일 로딩 오류 (${type}):`, error);
    return [];
  }
};

// 안전한 id 변환 함수: 숫자(1.0) → '1', 문자열 '1.0' → '1', null/undefined → ''
const safeId = v => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'string' && v.match(/^[0-9]+\.0$/)) return v.split('.')[0];
  return String(v).trim();
};

// 1. 모드 저장 함수
const saveViewerMode = (mode) => {
  try {
    localStorage.setItem('viewer_mode', mode);
  } catch (e) {}
};

// 2. 모드 복원 함수
const loadViewerMode = () => {
  try {
    return localStorage.getItem('viewer_mode');
  } catch (e) {
    return null;
  }
};

function getEventsForChapter(chapter) {
  const num = String(chapter).padStart(2, '0');
  try {
    const events = Object.entries(eventRelationModules)
      .filter(([path]) => path.includes(`/${num}/${num}_ev`))
      .map(([path, mod]) => {
        const eventNum = parseInt(path.match(/_ev(\d+)_relations\.json$/)?.[1] || '0');
        return { ...mod.default, eventNum, path };
      })
      .filter(ev => ev.eventNum > 0)
      .sort((a, b) => a.eventNum - b.eventNum);
    
    console.log('filteredPaths:', events);
    console.log('eventNums:', events.map(ev => ev.eventNum));
    const maxEvent = events.length > 0 ? Math.max(...events.map(ev => ev.eventNum)) : 1;
    console.log('maxEvent:', maxEvent);
    
    return events;
  } catch (error) {
    console.error('이벤트 로딩 오류:', error);
    return [];
  }
}

function getElementsFromRelations(relations, characterData, _newAppearances, importance) {
  // 1. relation, importance에 등장하는 id 모두 수집 (newAppearances는 무시)
  const nodeIdSet = new Set();
  if (Array.isArray(relations)) {
    relations.forEach(rel => {
      if (rel.id1 !== undefined) nodeIdSet.add(String(rel.id1));
      if (rel.id2 !== undefined) nodeIdSet.add(String(rel.id2));
      if (rel.source !== undefined) nodeIdSet.add(String(rel.source));
      if (rel.target !== undefined) nodeIdSet.add(String(rel.target));
    });
  }
  if (importance && typeof importance === 'object') {
    Object.keys(importance).forEach(id => nodeIdSet.add(String(id)));
  }

  // 2. characterData.characters에서 해당 id만 노드로 생성
  let nodes = [];
  if (characterData && Array.isArray(characterData.characters)) {
    nodes = characterData.characters
      .filter(char => nodeIdSet.has(String(char.id)))
      .map(char => ({
        data: {
          id: String(char.id),
          label: char.common_name || char.name || String(char.id),
          description: char.description || ''
        }
      }));
  }

  // 3. 엣지 생성
  const edges = (relations || [])
    .filter(rel => {
      const source = String(rel.id1 || rel.source);
      const target = String(rel.id2 || rel.target);
      return nodeIdSet.has(source) && nodeIdSet.has(target);
    })
    .map((rel, idx) => ({
      data: {
        id: `e${idx}`,
        source: String(rel.id1 || rel.source),
        target: String(rel.id2 || rel.target),
        label: Array.isArray(rel.relation) ? rel.relation.join(', ') : rel.type,
        explanation: rel.explanation,
        positivity: rel.positivity,
        weight: rel.weight,
      }
    }));

  return [...nodes, ...edges];
}

// --- [추가] 고립 노드(독립 인물) 필터링 함수 ---
function filterIsolatedNodes(elements, hideIsolated) {
  if (!hideIsolated) return elements;
  // 엣지가 하나도 없으면(즉, relations가 아예 없으면) 노드는 숨기지 않음
  const hasEdge = elements.some(el => el.data && el.data.source && el.data.target);
  if (!hasEdge) return elements;
  // 노드 id 목록
  const nodeIds = new Set(elements.filter(el => el.data && el.data.id && !el.data.source).map(el => el.data.id));
  // 엣지의 source/target id 목록
  const connectedIds = new Set(
    elements
      .filter(el => el.data && el.data.source && el.data.target)
      .flatMap(el => [el.data.source, el.data.target])
  );
  // 연결된 노드만 남김
  return elements.filter(el => {
    if (el.data && el.data.id && !el.data.source) {
      // 노드
      return connectedIds.has(el.data.id);
    }
    // 엣지는 모두 표시
    return true;
  });
}

const ViewerPage = ({ darkMode: initialDarkMode }) => {
  const { filename } = useParams();
  const location = useLocation();
  const viewerRef = useRef(null);
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settings, setSettings] = useState(() => loadSettings());
  const [darkMode, setDarkMode] = useState(initialDarkMode || settings.theme === 'dark');
  const [showGraph, setShowGraph] = useState(settings.showGraph); // 설정에서 그래프 표시 여부 로드
  const [currentChapter, setCurrentChapter] = useState(1); // 현재 챕터 번호
  const [graphFullScreen, setGraphFullScreen] = useState(false);
  const [elements, setElements] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentPageWords, setCurrentPageWords] = useState(0);
  const [totalChapterWords, setTotalChapterWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterText, setChapterText] = useState('');
  const [isDataReady, setIsDataReady] = useState(false);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [graphViewState, setGraphViewState] = useState(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const maxChapter = 9; // data 폴더 기준
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isReloading, setIsReloading] = useState(false);

  // location.state에서 book 정보를 가져오거나, 없으면 filename에서 생성
  const book = location.state?.book || {
    title: filename.replace('.epub', ''),
    // public 폴더 루트에서 파일 찾기 (절대 경로)
    path: `/${filename}`,
    filename: filename
  };

  const [showToolbar, setShowToolbar] = useState(false);
  // 파일명에서 경로 제거하고 순수 파일명만 추출 (북마크 저장용)
  const cleanFilename = filename.trim();
  const [bookmarks, setBookmarks] = useState(loadBookmarks(cleanFilename));
  const [showBookmarkList, setShowBookmarkList] = useState(false);

  // 이전 그래프 상태를 추적하기 위한 ref 추가
  const prevElementsRef = useRef();
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();

  // 3. mount 시 localStorage에서 모드 복원
  useEffect(() => {
    const mode = loadViewerMode();
    if (mode === 'split') {
      setShowGraph(true);
      setGraphFullScreen(false);
    } else if (mode === 'graph') {
      setShowGraph(true);
      setGraphFullScreen(true);
    } else if (mode === 'viewer') {
      setShowGraph(false);
      setGraphFullScreen(false);
    }
  }, []);

  // 4. showGraph/graphFullScreen 상태 변경 시 localStorage에 저장
  useEffect(() => {
    if (graphFullScreen) {
      saveViewerMode('graph');
    } else if (showGraph) {
      saveViewerMode('split');
    } else {
      saveViewerMode('viewer');
    }
  }, [showGraph, graphFullScreen]);

  useEffect(() => {
    if (failCount >= 2) {
      toast.info('🔄 계속 실패하면 브라우저 새로고침을 해주세요!');
    }
  }, [failCount]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  useEffect(() => {
    if (book && progress !== undefined) {
      localStorage.setItem(`progress_${cleanFilename}`, progress);
    }
  }, [progress, book, cleanFilename]);

  useEffect(() => {
    // 파일명이 바뀔 때만 localStorage에서 최신 북마크를 불러옴
    setBookmarks(loadBookmarks(cleanFilename));
  }, [cleanFilename]);

  // 페이지 변경 시 현재 챕터 번호 업데이트
  useEffect(() => {
    // 현재 위치에서 챕터 정보 추출 기능, 예시일 뿐 실제로는 EPUB에서 정보를 가져와야 함
    const updateCurrentChapter = async () => {
      if (viewerRef.current && viewerRef.current.getCurrentCfi) {
        try {
          const cfi = await viewerRef.current.getCurrentCfi();
          if (cfi) {
            const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
            if (chapterMatch) {
              setCurrentChapter(parseInt(chapterMatch[1]));
            }
          }
        } catch (e) {
          console.error('챕터 정보 읽기 오류:', e);
        }
      }
    };
    
    updateCurrentChapter();
  }, [currentPage]);

  // 데이터 로딩 상태 관리
  useEffect(() => {
    const loadData = async () => {
      setIsDataReady(false);
      setLoading(true);
      // setElements([]); // 로딩 시작 시 그래프 데이터 즉시 비우기 제거
      try {
        // 챕터가 바뀔 때 단어 위치와 총 단어 수 초기화
        setCurrentWordIndex(0);
        setTotalChapterWords(0);
        const events = getEventsForChapter(currentChapter);
        // 첫 번째 이벤트의 시작 위치로 currentWordIndex 설정 (자동 선택 제거)
        // if (events && events.length > 0) {
        //   setCurrentWordIndex(events[0].start);
        // }
        const charactersData = getChapterFile(currentChapter, 'characters');
        setIsDataReady(true);
      } catch (error) {
        toast.error('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [currentChapter]);

  // currentChapter가 바뀔 때 currentEvent를 null로 초기화
  useEffect(() => {
    setCurrentEvent(null);
    // setElements([]); // 제거: 기존 그래프가 계속 보이도록
  }, [currentChapter]);

  // 현재 이벤트 결정 useEffect 개선
  useEffect(() => {
    if (!isDataReady) return;
    const events = getEventsForChapter(currentChapter);
    if (!events || !events.length) {
      setCurrentEvent(null);
      return;
    }
    // currentWordIndex가 0이면 아무 이벤트도 선택하지 않음
    if (currentWordIndex === 0) {
      setCurrentEvent(null);
      return;
    }
    // start <= currentWordIndex < end 범위의 이벤트 찾기
    const eventIdx = events.findIndex(event => currentWordIndex >= event.start && currentWordIndex < event.end);
    if (eventIdx !== -1) {
      setCurrentEvent(events[eventIdx]);
    } else {
      // fallback: 마지막 이벤트
      setCurrentEvent(events[events.length - 1]);
    }
  }, [isDataReady, currentChapter, currentWordIndex]);

  // === [추가] 챕터 전체 그래프(fullElements) 생성 ===
  const fullElements = useMemo(() => {
    const events = getEventsForChapter(currentChapter);
    if (!events || !events.length) return [];
    // 모든 relations/importance/new_appearances를 합침
    let allRelations = [];
    let allImportance = {};
    let allNewAppearances = [];
    const edgeSet = new Set(); // 중복 간선 방지용
    events.forEach(ev => {
      if (Array.isArray(ev.relations)) {
        ev.relations.forEach(rel => {
          const id1 = rel.id1 || rel.source;
          const id2 = rel.id2 || rel.target;
          const edgeKey = `${id1}-${id2}`;
          if (!edgeSet.has(edgeKey)) {
            allRelations.push(rel);
            edgeSet.add(edgeKey);
          }
        });
      }
      if (ev.importance && typeof ev.importance === 'object') {
        Object.entries(ev.importance).forEach(([k, v]) => { allImportance[k] = v; });
      }
      if (Array.isArray(ev.new_appearances)) allNewAppearances = allNewAppearances.concat(ev.new_appearances);
    });
    const charactersData = getChapterFile(currentChapter, 'characters');
    return getElementsFromRelations(allRelations, charactersData, allNewAppearances, allImportance);
  }, [currentChapter]);

  // === [수정] elements: 현재 이벤트까지 등장한 노드/간선만 필터링 + position merge ===
  useEffect(() => {
    if (!isDataReady || !(currentEvent || prevEvent)) {
      setGraphViewState(null);
      return;
    }
    // 등장 허용 eventNum 구하기
    const events = getEventsForChapter(currentChapter);
    if (!events || !events.length) return;
    const maxEventNum = currentEvent?.eventNum || events[events.length - 1].eventNum;
    // 등장 시점 기록
    const nodeFirstEvent = {};
    const edgeFirstEvent = {};
    events.forEach(ev => {
      // 노드: importance, new_appearances, relations의 id1/id2/source/target
      if (ev.importance) {
        Object.keys(ev.importance).forEach(id => {
          if (nodeFirstEvent[id] === undefined) nodeFirstEvent[id] = ev.eventNum;
        });
      }
      if (Array.isArray(ev.new_appearances)) {
        ev.new_appearances.forEach(id => {
          if (nodeFirstEvent[id] === undefined) nodeFirstEvent[id] = ev.eventNum;
        });
      }
      if (Array.isArray(ev.relations)) {
        ev.relations.forEach(rel => {
          const id1 = rel.id1 || rel.source;
          const id2 = rel.id2 || rel.target;
          if (id1 && nodeFirstEvent[id1] === undefined) nodeFirstEvent[id1] = ev.eventNum;
          if (id2 && nodeFirstEvent[id2] === undefined) nodeFirstEvent[id2] = ev.eventNum;
          // 간선: id1-id2 쌍
          const edgeKey = `${id1}-${id2}`;
          if (edgeFirstEvent[edgeKey] === undefined) edgeFirstEvent[edgeKey] = ev.eventNum;
        });
      }
    });
    // fullElements에서 현재 이벤트까지 등장한 노드/간선만 남김
    const filtered = fullElements.filter(el => {
      if (el.data.source && el.data.target) {
        // 간선
        const edgeKey = `${el.data.source}-${el.data.target}`;
        return edgeFirstEvent[edgeKey] !== undefined && edgeFirstEvent[edgeKey] <= maxEventNum;
      } else if (el.data.id) {
        // 노드
        return nodeFirstEvent[el.data.id] !== undefined && nodeFirstEvent[el.data.id] <= maxEventNum;
      }
      return false;
    });
    // === position merge ===
    let nodePositions = {};
    try {
      const posStr = localStorage.getItem(`chapter_node_positions_${currentChapter}`);
      if (posStr) nodePositions = JSON.parse(posStr);
    } catch (e) {}
    // id 기준 정렬 및 position merge
    const sorted = filterIsolatedNodes(filtered, hideIsolated).slice().sort((a, b) => {
      const aId = a.data?.id || (a.data?.source ? a.data?.source + '-' + a.data?.target : '');
      const bId = b.data?.id || (b.data?.source ? b.data?.source + '-' + b.data?.target : '');
      return aId.localeCompare(bId);
    }).map(el => {
      if (el.data.id && nodePositions[el.data.id]) {
        return { ...el, position: nodePositions[el.data.id] };
      }
      return el;
    });
    setElements(sorted);
  }, [isDataReady, currentEvent, prevEvent, currentChapter, hideIsolated, fullElements]);

  // === [추가] 마지막 이벤트 등장 노드/간선 위치만 저장 및 이벤트별 적용 ===
  // 마지막 이벤트에서 등장한 노드/간선 위치만 저장
  useEffect(() => {
    if (!isDataReady || !currentEvent || !graphViewState) return;
    const events = getEventsForChapter(currentChapter);
    if (!events || !events.length) return;
    const isLastEvent = currentEvent.eventNum === events[events.length - 1].eventNum;
    if (isLastEvent) {
      // 마지막 이벤트에서 등장한 노드/간선 id만 추출
      const lastNodes = new Set();
      const lastEdges = new Set();
      if (Array.isArray(currentEvent.relations)) {
        currentEvent.relations.forEach(rel => {
          const id1 = rel.id1 || rel.source;
          const id2 = rel.id2 || rel.target;
          if (id1) lastNodes.add(String(id1));
          if (id2) lastNodes.add(String(id2));
          lastEdges.add(`${id1}-${id2}`);
        });
      }
      if (currentEvent.importance) {
        Object.keys(currentEvent.importance).forEach(id => lastNodes.add(String(id)));
      }
      if (Array.isArray(currentEvent.new_appearances)) {
        currentEvent.new_appearances.forEach(id => lastNodes.add(String(id)));
      }
      // graphViewState에서 해당 노드/간선 위치만 추출
      const partialLayout = {};
      Object.entries(graphViewState).forEach(([key, value]) => {
        // key가 노드 id 또는 간선 id
        if (lastNodes.has(key) || lastEdges.has(key)) {
          partialLayout[key] = value;
        }
      });
      try {
        localStorage.setItem(`graph_partial_layout_chapter_${currentChapter}`, JSON.stringify(partialLayout));
      } catch (e) {}
    }
  }, [isDataReady, currentEvent, currentChapter, graphViewState]);

  // 각 이벤트 페이지에서 partialLayout을 merge해서 graphViewState로 적용
  useEffect(() => {
    if (!isDataReady || !currentEvent) return;
    const partialLayoutStr = localStorage.getItem(`graph_partial_layout_chapter_${currentChapter}`);
    if (!partialLayoutStr) return;
    try {
      const partialLayout = JSON.parse(partialLayoutStr);
      // 현재 이벤트에 등장하는 노드/간선만 merge
      const nodes = new Set();
      const edges = new Set();
      if (Array.isArray(currentEvent.relations)) {
        currentEvent.relations.forEach(rel => {
          const id1 = rel.id1 || rel.source;
          const id2 = rel.id2 || rel.target;
          if (id1) nodes.add(String(id1));
          if (id2) nodes.add(String(id2));
          edges.add(`${id1}-${id2}`);
        });
      }
      if (currentEvent.importance) {
        Object.keys(currentEvent.importance).forEach(id => nodes.add(String(id)));
      }
      if (Array.isArray(currentEvent.new_appearances)) {
        currentEvent.new_appearances.forEach(id => nodes.add(String(id)));
      }
      // merge: partialLayout에 있는 위치만 우선 적용
      const merged = {};
      Object.entries(partialLayout).forEach(([key, value]) => {
        if (nodes.has(key) || edges.has(key)) {
          merged[key] = value;
        }
      });
      setGraphViewState(merged);
    } catch (e) {}
  }, [isDataReady, currentEvent, currentChapter]);

  // EpubViewer에서 페이지/스크롤 이동 시 CFI 받아와서 글자 인덱스 갱신
  const handleLocationChange = async () => {
    if (viewerRef.current && viewerRef.current.getCurrentCfi) {
      try {
        const cfi = await viewerRef.current.getCurrentCfi();
        // 현재 챕터 추출
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        let chapterNum = currentChapter;
        if (chapterMatch) chapterNum = parseInt(chapterMatch[1]);
        
        // 챕터 번호만 업데이트
        setCurrentChapter(chapterNum);
        
      } catch (e) {
        console.error('위치 계산 오류:', e);
      }
    }
  };

  // CFI → 챕터/글자 인덱스 변환 함수 (epubjs locations 활용)
  const cfiToCharIndex = (cfi, chapter) => {
    try {
      // viewerRef.current.bookRef.current.locations.locationFromCfi(cfi) 사용
      if (
        viewerRef.current &&
        viewerRef.current.bookRef &&
        viewerRef.current.bookRef.current &&
        viewerRef.current.bookRef.current.locations &&
        typeof viewerRef.current.bookRef.current.locations.locationFromCfi === 'function'
      ) {
        // 챕터 내 인덱스 반환
        return viewerRef.current.bookRef.current.locations.locationFromCfi(cfi);
      }
    } catch (e) {
      // 무시
    }
    return 0;
  };

  // 챕터 진입 시 첫 이벤트만 표시 (자동 선택 제거)
  // useEffect(() => {
  //   const events = getEventsForChapter(currentChapter);
  //   if (events && events.length) {
  //     setCurrentWordIndex(events[0].start);
  //   }
  // }, [currentChapter]);

  const handlePrevPage = () => {
    if (viewerRef.current) viewerRef.current.prevPage();
  };

  const handleNextPage = () => {
    if (viewerRef.current) viewerRef.current.nextPage();
  };

  const handleAddBookmark = async () => {
    if (!viewerRef.current) {
      toast.error('❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...');
      setFailCount((cnt) => cnt + 1);
      return;
    }
    let cfi = null;
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
    } catch (e) {
      console.error('getCurrentCfi 에러:', e);
    }
    if (!cfi) {
      toast.error('❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...');
      setFailCount((cnt) => cnt + 1);
      return;
    }
    
    setFailCount(0);

    const latestBookmarks = loadBookmarks(cleanFilename);
    const isDuplicate = latestBookmarks.some((b) => b.cfi === cfi);
    let newBookmarks;
    if (isDuplicate) {
      newBookmarks = latestBookmarks.filter((b) => b.cfi !== cfi);
      toast.info('❌ 북마크가 삭제되었습니다');
    } else {
      const newBookmark = { cfi, createdAt: new Date().toISOString() };
      newBookmarks = [newBookmark, ...latestBookmarks];
      toast.success('✅ 북마크가 추가되었습니다');
    }
    setBookmarks(newBookmarks);
    saveBookmarks(cleanFilename, newBookmarks);
  };

  const handleBookmarkSelect = (cfi) => {
    viewerRef.current?.displayAt(cfi);
    setShowBookmarkList(false);
  };

  const handleOpenSettings = () => {
    setShowSettingsModal(true);
  };

  const handleCloseSettings = () => {
    setShowSettingsModal(false);
  };

  const handleApplySettings = (newSettings) => {
    // 현재 설정 백업
    const prevSettings = { ...settings };
    
    // 새 설정 적용
    setSettings(newSettings);
    
    // 테마 설정 적용
    if (newSettings.theme === 'dark') {
      setDarkMode(true);
    } else {
      setDarkMode(false);
    }
    
    // 그래프 표시 설정 적용
    setShowGraph(newSettings.showGraph);
    
    // 페이지 모드 변경 또는 그래프 표시 여부 변경 시 뷰어 다시 로드
    if (newSettings.pageMode !== prevSettings.pageMode || newSettings.showGraph !== prevSettings.showGraph) {
      // 현재 위치 저장 후 뷰어 다시 로드
      const saveCurrent = async () => {
        try {
          let cfi = null;
          
          if (viewerRef.current?.getCurrentCfi) {
            cfi = await viewerRef.current.getCurrentCfi();
            if (cfi) {
              localStorage.setItem(`readwith_${cleanFilename}_lastCFI`, cfi);
            }
          }
          
          // 즉시 뷰어 다시 로드
          setReloadKey(prev => prev + 1);
        } catch (e) {
          // 에러 발생 시에도 뷰어 다시 로드
          setReloadKey(prev => prev + 1);
        }
      };
      
      saveCurrent();
    } else {
      // 뷰어에 설정 적용 (페이지 모드 외 다른 설정이 변경된 경우)
      if (viewerRef.current && viewerRef.current.applySettings) {
        viewerRef.current.applySettings();
      }
    }
    
    // 로컬 스토리지에 설정 저장
    try {
      localStorage.setItem('epub_viewer_settings', JSON.stringify(newSettings));
    } catch (e) {
      toast.error('설정 저장 중 오류가 발생했습니다.');
    }
    
    toast.success('✅ 설정이 적용되었습니다');
  };

  const onToggleBookmarkList = () => {
    navigate(`/viewer/${filename}/bookmarks`);
  };

  const handleSliderChange = async (value) => {
    setProgress(value);
    if (viewerRef.current?.moveToProgress) {
      try {
        await viewerRef.current.moveToProgress(value);
        setTimeout(() => {
          // progress가 여전히 value와 다르면 새로고침
          if (progress !== value) {
            window.location.reload();
          }
        }, 1000);
      } catch (e) {
        window.location.reload();
      }
    }
  };

  const handleDeleteBookmark = (cfi) => {
    if (!cleanFilename) {
      toast.error('❗ 파일명이 없어 북마크를 삭제할 수 없습니다.');
      return;
    }
    if (window.confirm('정말 삭제하시겠습니까?')) {
      const newBookmarks = bookmarks.filter(b => b.cfi !== cfi);
      setBookmarks(newBookmarks);
      saveBookmarks(cleanFilename, newBookmarks);
    }
  };

  const handleRemoveBookmark = (cfi) => {
    if (!cleanFilename) {
      toast.error('❗ 파일명이 없어 북마크를 삭제할 수 없습니다.');
      return;
    }
    if (window.confirm('정말 삭제하시겠습니까?')) {
      const newBookmarks = bookmarks.filter((b) => b.cfi !== cfi);
      setBookmarks(newBookmarks);
      saveBookmarks(cleanFilename, newBookmarks);
    }
  };

  // 그래프 표시 토글 함수
  const toggleGraph = () => {
    const newShowGraph = !showGraph;
    setShowGraph(newShowGraph);
    
    // 설정에도 그래프 표시 여부 업데이트
    const updatedSettings = {
      ...settings,
      showGraph: newShowGraph
    };
    setSettings(updatedSettings);
    
    // 로컬 스토리지에 설정 저장
    try {
      localStorage.setItem('epub_viewer_settings', JSON.stringify(updatedSettings));
    } catch (e) {
      console.error('설정 저장 오류:', e);
    }
    
    // EPUB 뷰어 다시 로드
    const saveCurrent = async () => {
      try {
        let cfi = null;
        
        if (viewerRef.current?.getCurrentCfi) {
          cfi = await viewerRef.current.getCurrentCfi();
          if (cfi) {
            console.log('현재 위치 저장:', cfi);
            localStorage.setItem(`readwith_${cleanFilename}_lastCFI`, cfi);
          }
        }
        
        // 즉시 뷰어 다시 로드
        setReloadKey(prev => prev + 1);
      } catch (e) {
        console.error('설정 적용 오류:', e);
        // 에러 발생 시에도 뷰어 다시 로드
        setReloadKey(prev => prev + 1);
      }
    };
    
    saveCurrent();
  };

  const handleSearch = () => {
    // Implementation of handleSearch
  };

  const handleReset = () => {
    // Implementation of handleReset
  };

  const handleFitView = () => {
    // Implementation of handleFitView
  };

  useEffect(() => {
    // 새로고침 시에만 isReloading true로 설정
    if (performance && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length > 0 && navEntries[0].type === 'reload') {
        setIsReloading(true);
      }
    }
  }, []);

  // elements, chapterNum, eventNum이 바뀔 때마다 이전 값 저장
  useEffect(() => {
    prevElementsRef.current = elements;
    prevChapterNumRef.current = currentChapter;
    prevEventNumRef.current = currentEvent?.eventNum;
  }, [elements, currentChapter, currentEvent]);

  // elements가 이전과 완전히 같으면 로딩 메시지 안 보이게
  const isSameElements = useMemo(() => {
    if (!prevElementsRef.current || !elements) return false;
    if (prevElementsRef.current.length !== elements.length) return false;
    for (let i = 0; i < elements.length; i++) {
      if (JSON.stringify(prevElementsRef.current[i]) !== JSON.stringify(elements[i])) return false;
    }
    return true;
  }, [elements]);

  // === [디버깅용 로그 추가] 최초 진입 시 모든 챕터의 전체 노드 위치 미리 저장 ===
  useEffect(() => {
    // 챕터 번호 1~9 (data 폴더 기준)
    const chapterNums = Array.from({ length: 9 }, (_, i) => i + 1);
    chapterNums.forEach((chapterNum) => {
      const storageKey = `chapter_node_positions_${chapterNum}`;
      if (localStorage.getItem(storageKey)) {
        console.log(`[스킵] 챕터 ${chapterNum} 이미 저장됨`);
        return;
      }
      console.log(`[시도] 챕터 ${chapterNum} 레이아웃 저장 시도`);
      // 1. merged_relations.json 전체 노드/엣지 생성
      const relationsData = getChapterFile(chapterNum, 'relations');
      const charactersData = getChapterFile(chapterNum, 'characters');
      if (!relationsData || !charactersData) {
        console.log(`[실패] 챕터 ${chapterNum} 데이터 없음`);
        return;
      }
      let allRelations = relationsData.relations || relationsData;
      let allImportance = relationsData.importance || {};
      let allNewAppearances = relationsData.new_appearances || [];
      const elements = getElementsFromRelations(allRelations, charactersData, allNewAppearances, allImportance);
      if (!elements || elements.length === 0) {
        console.log(`[실패] 챕터 ${chapterNum} elements 없음`);
        return;
      }
      // 2. Cytoscape 임시 인스턴스 생성 및 레이아웃 실행
      const cy = cytoscape({
        elements,
        style: [],
        headless: true,
      });
      const layout = cy.layout({ name: 'cose', animate: false, fit: true, padding: 80 });
      layout.run();
      // headless 모드에서는 layoutstop 이벤트가 잘 안 오므로, setTimeout으로 우회
      setTimeout(() => {
        const layoutObj = {};
        cy.nodes().forEach(node => {
          layoutObj[node.id()] = node.position();
        });
        try {
          localStorage.setItem(storageKey, JSON.stringify(layoutObj));
          console.log(`[성공] 챕터 ${chapterNum} 위치 저장 완료`, layoutObj);
        } catch (e) {
          console.log(`[에러] 챕터 ${chapterNum} 저장 실패`, e);
        }
        cy.destroy();
      }, 100);
    });
  }, []);

  return (
    <div
      className="h-screen"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      <ViewerLayout
        showControls={showToolbar}
        book={book}
        darkMode={darkMode}
        progress={progress}
        setProgress={setProgress}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
        isBookmarked={false}
        onToggleBookmarkList={onToggleBookmarkList}
        onAddBookmark={handleAddBookmark}
        onOpenSettings={handleOpenSettings}
        onSliderChange={handleSliderChange}
        currentPage={currentPage}
        totalPages={totalPages}
        showGraph={showGraph}
        onToggleGraph={toggleGraph}
        rightSideContent={
          showGraph && !graphFullScreen && (
            <div 
              className="h-full w-full flex items-center justify-center"
              style={{ height: '100%', width: '100%', padding: 0, boxSizing: 'border-box', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'stretch', overflow: 'hidden' }}>
                {/* 상단바: < 버튼 + 챕터 드롭다운 + 독립 인물 버튼 */}
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', height: 40, marginBottom: 0, gap: 0, paddingLeft: 12, paddingTop: 0, justifyContent: 'flex-start' }}>
                  {/* < 전체화면 버튼 */}
                  <button
                    onClick={() => navigate(`/user/graph/${filename}`)}
                    style={{
                      height: 32,
                      width: 32,
                      minWidth: 32,
                      minHeight: 32,
                      borderRadius: '8px',
                      border: '1.5px solid #e3e6ef',
                      background: '#fff',
                      color: '#22336b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      marginRight: 8,
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(108,142,255,0.07)',
                      transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
                    }}
                    title="그래프 전체화면"
                  >
                    {'<'}
                  </button>
                  {/* 챕터 드롭다운, 초기화, 독립 인물 버튼 */}
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <div className="chapter-dropdown-container">
                      <select
                        value={currentChapter}
                        onChange={e => setCurrentChapter(Number(e.target.value))}
                        style={{
                          height: 32,
                          padding: '2px 8px',
                          borderRadius: 6,
                          border: '1px solid #bfc8e2',
                          fontSize: 14,
                          background: '#f4f7fb',
                          color: '#22336b',
                          fontWeight: 500,
                          outline: 'none',
                          minWidth: 90,
                          maxWidth: 180,
                          cursor: 'pointer',
                          lineHeight: '32px'
                        }}
                      >
                        {Array.from({ length: maxChapter }, (_, i) => i + 1).map((chapter) => (
                          <option key={chapter} value={chapter}>
                            Chapter {chapter}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* 초기화(새로고침) 버튼 */}
                    <button
                      onClick={() => window.location.reload()}
                      title="초기화"
                      style={{
                        height: 32,
                        width: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 6,
                        border: '1px solid #bfc8e2',
                        background: '#f4f7fb',
                        color: '#4F6DDE',
                        fontSize: 18,
                        margin: '0 4px',
                        cursor: 'pointer',
                        transition: 'background 0.18s',
                        outline: 'none',
                        boxShadow: 'none',
                        padding: 0
                      }}
                    >
                      <FaSyncAlt />
                    </button>
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
                  </div>
                  {/* 오른쪽: 인물 검색 폼 */}
                  <div style={{ minWidth: 120, maxWidth: 320, flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                    <GraphControls
                      searchInput={searchInput}
                      setSearchInput={setSearchInput}
                      handleSearch={handleSearch}
                      handleReset={handleReset}
                      handleFitView={handleFitView}
                      search={search}
                      setSearch={setSearch}
                      inputStyle={{ height: 32, fontSize: 14, padding: '2px 8px', borderRadius: 6 }}
                      buttonStyle={{ height: 32, fontSize: 14, padding: '2px 10px', borderRadius: 6 }}
                    />
                  </div>
                </div>
                {/* 그래프 본문 위: event 슬라이드 UI */}
                {(() => {
                  const events = getEventsForChapter(currentChapter);
                  
                  if (!events.length) return null;

                  // 현재 이벤트 인덱스 찾기 (현재 페이지의 마지막 글자 기준)
                  let cur;
                  
                  // 1. 현재 페이지의 마지막 글자가 어떤 이벤트의 end보다 작은 경우
                  const eventWithEndGreaterThanCurrent = events.findIndex(event => 
                    currentWordIndex < event.end
                  );
                  
                  if (eventWithEndGreaterThanCurrent !== -1) {
                    cur = eventWithEndGreaterThanCurrent;
                  } else {
                    // 2. 현재 페이지의 마지막 글자가 마지막 이벤트의 end보다 큰 경우
                    cur = events.length - 1;
                  }

                  const handlePrev = async () => {
                    if (cur > 0) {
                      const prevEvent = events[cur - 1];
                      setCurrentWordIndex(prevEvent.start);
                      if (viewerRef.current?.moveToProgress) {
                        const progressValue = (prevEvent.start / 100) * 100;
                        try {
                          await viewerRef.current.moveToProgress(progressValue);
                          setTimeout(() => {
                            if (currentWordIndex !== prevEvent.start) {
                              window.location.reload();
                            }
                          }, 500);
                        } catch (e) {
                          window.location.reload();
                        }
                      }
                    }
                  };
                  
                  const handleNext = async () => {
                    if (cur < events.length - 1) {
                      const nextEvent = events[cur + 1];
                      setCurrentWordIndex(nextEvent.start);
                      if (viewerRef.current?.moveToProgress) {
                        const progressValue = (nextEvent.start / 100) * 100;
                        try {
                          await viewerRef.current.moveToProgress(progressValue);
                          setTimeout(() => {
                            if (currentWordIndex !== nextEvent.start) {
                              window.location.reload();
                            }
                          }, 500);
                        } catch (e) {
                          window.location.reload();
                        }
                      }
                    }
                  };

                  return (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 24,
                        width: '100%',
                        minHeight: 48,
                        background: 'linear-gradient(90deg, #f8fafc 60%, #e7edff 100%)',
                        borderBottom: '1.5px solid #e5e7eb',
                        margin: '8px 0 8px 0',
                        padding: '8px 0',
                        boxShadow: '0 2px 8px rgba(108,142,255,0.07)',
                        borderRadius: 16,
                      }}
                    >
                      <button
                        onClick={handlePrev}
                        disabled={cur <= 0}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          border: 'none',
                          background: 'linear-gradient(135deg, #6C8EFF 60%, #42a5f5 100%)',
                          color: '#fff',
                          fontSize: 24,
                          fontWeight: 700,
                          boxShadow: '0 2px 8px rgba(108,142,255,0.13)',
                          cursor: cur <= 0 ? 'not-allowed' : 'pointer',
                          opacity: cur <= 0 ? 0.5 : 1,
                          transition: 'all 0.18s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="이전 이벤트"
                      >&#8592;</button>
                      <div style={{
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 18, 
                        minWidth: 60,
                        transition: 'transform 0.3s cubic-bezier(.4,2,.6,1)',
                      }}>
                        {events.map((event, idx) => (
                          <div
                            key={idx}
                            onClick={async () => {
                              setCurrentWordIndex(event.start);
                              if (viewerRef.current?.moveToProgress) {
                                const progressValue = (event.start / 100) * 100;
                                try {
                                  await viewerRef.current.moveToProgress(progressValue);
                                  setTimeout(() => {
                                    if (currentWordIndex !== event.start) {
                                      window.location.reload();
                                    }
                                  }, 500);
                                } catch (e) {
                                  window.location.reload();
                                }
                              }
                            }}
                            style={{
                              width: idx === cur ? 22 : 14,
                              height: idx === cur ? 22 : 14,
                              borderRadius: '50%',
                              background: idx === cur ? 'linear-gradient(135deg, #6C8EFF 60%, #42a5f5 100%)' : '#e3e6ef',
                              boxShadow: idx === cur ? '0 2px 8px rgba(108,142,255,0.18)' : 'none',
                              border: idx === cur ? '2.5px solid #6C8EFF' : '1.5px solid #e3e6ef',
                              transition: 'all 0.28s cubic-bezier(.4,2,.6,1)',
                              margin: '0 2px',
                              cursor: 'pointer',
                            }}
                            title={`${event.title} (${event.start}~${event.end} 글자)`}
                          />
                        ))}
                      </div>
                      <button
                        onClick={handleNext}
                        disabled={cur >= events.length - 1}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          border: 'none',
                          background: 'linear-gradient(135deg, #6C8EFF 60%, #42a5f5 100%)',
                          color: '#fff',
                          fontSize: 24,
                          fontWeight: 700,
                          boxShadow: '0 2px 8px rgba(108,142,255,0.13)',
                          cursor: cur >= events.length - 1 ? 'not-allowed' : 'pointer',
                          opacity: cur >= events.length - 1 ? 0.5 : 1,
                          transition: 'all 0.18s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="다음 이벤트"
                      >&#8594;</button>
                    </div>
                  );
                })()}
                {/* 그래프 본문 */}
                <div style={{ flex: 1, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 8 }}>
                  {/* 로딩중 메시지 완전 제거, elements가 준비된 경우에만 그래프 렌더링 */}
                  {elements.length > 0 && (
                    <RelationGraphMain 
                      elements={elements} 
                      inViewer={true} 
                      fullScreen={false}
                      style={{ width: '100%', height: '100%' }}
                      graphViewState={graphViewState}
                      setGraphViewState={setGraphViewState}
                      chapterNum={currentChapter}
                      eventNum={currentEvent?.eventNum}
                      hideIsolated={hideIsolated}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        }
        pageMode={settings.pageMode}
      >
        <EpubViewer
          key={reloadKey}
          ref={viewerRef}
          book={book}
          onProgressChange={setProgress}
          onCurrentPageChange={(page) => {
            setLoading(true);
            setElements([]);
            setCurrentPage(page);
          }}
          onTotalPagesChange={setTotalPages}
          onCurrentChapterChange={(chapter) => {
            setLoading(true);
            setElements([]);
            setCurrentChapter(chapter);
          }}
          settings={settings}
          onCurrentLineChange={(wordIndex, totalWords, currentEvent) => {
            console.log('[ViewerPage onCurrentLineChange] wordIndex:', wordIndex, 'currentEvent:', currentEvent);
            if (wordIndex >= 0) {
              setCurrentWordIndex(wordIndex);
              setTotalChapterWords(totalWords || 0);
              setCurrentEvent(currentEvent);
            } else {
              setCurrentWordIndex(0);
              setTotalChapterWords(0);
              setCurrentEvent(null);
            }
          }}
          onAllCfisReady={(_cfis, _ranges, offsets) => {
            // 줄 관련 상태/로직 완전 삭제
          }}
          onTextReady={(text, i) => {
            // 텍스트 로드 관련 로직 삭제
          }}
          onRelocated={handleLocationChange}
        />
        {showBookmarkList && (
          <BookmarkPanel
            bookmarks={bookmarks}
            onSelect={handleBookmarkSelect}
          >
            {bookmarks.map((bm) => (
              <span key={bm.cfi} style={{ fontSize: '0.98rem', color: '#4F6DDE', fontFamily: 'monospace' }}>
                위치: {parseCfiToChapterDetail(bm.cfi)}
              </span>
            ))}
          </BookmarkPanel>
        )}
        
        {/* 설정 모달 */}
        <ViewerSettings
          isOpen={showSettingsModal}
          onClose={handleCloseSettings}
          onApplySettings={handleApplySettings}
          currentSettings={settings}
        />
      </ViewerLayout>
      {/* 전체화면 그래프는 별도 렌더링 */}
      {graphFullScreen && (
        <>
          {console.log('전체화면 elements:', elements, 'currentChapter:', currentChapter, 'hideIsolated:', hideIsolated)}
          <div style={{ width: '100vw', height: '100vh', background: '#f4f7fb', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: 0 }}>
            {/* 상단바: 챕터 파일탭, 인물 검색, 독립 인물 버튼, 닫기 버튼 */}
            <div style={{
              width: '100vw',
              height: 90, // 상단바 높이 고정
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
                  onClick={() => setGraphFullScreen(false)}
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
                  ×
                </button>
              </div>
              {/* 두 번째 행: 인물 검색 폼 */}
              <div style={{ width: '100%', height: 54, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 12, paddingTop: 0, paddingBottom: 0, background: '#fff' }}>
                <GraphControls
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  handleSearch={handleSearch}
                  handleReset={handleReset}
                  handleFitView={handleFitView}
                  search={search}
                  setSearch={setSearch}
                  inputStyle={{ height: 32, fontSize: 14, padding: '2px 8px', borderRadius: 6 }}
                  buttonStyle={{ height: 32, fontSize: 14, padding: '2px 10px', borderRadius: 6 }}
                />
              </div>
            </div>
            {/* 그래프 본문 */}
            <div style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              width: '100%',
              height: '100%',
              marginTop: 0,
              paddingTop: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              background: '#f8fafc',
            }}>
              <RelationGraphMain 
                elements={elements} 
                inViewer={true} 
                fullScreen={true}
                onExitFullScreen={() => setGraphFullScreen(false)}
              />
            </div>
          </div>
        </>
      )}
      <ToastContainer position="bottom-center" autoClose={1500} hideProgressBar newestOnTop closeOnClick />
    </div>
  );
};

export default ViewerPage;
