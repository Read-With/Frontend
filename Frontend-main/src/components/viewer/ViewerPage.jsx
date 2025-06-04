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
import CytoscapeGraphPortalProvider from '../graph/CytoscapeGraphPortalProvider';
import { calcGraphDiff } from '../graph/graphDiff';

// 반드시 파일 최상단에 위치!
const eventRelationModules = import.meta.glob('/src/data/*/chapter*_relationships_event_*.json', { eager: true });

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

// === glob import 패턴 변경: 작품명/챕터별 구조 반영 ===
const characterModules = import.meta.glob('/src/data/*/c_chapter*_*.json', { eager: true });
const eventModules = import.meta.glob('/src/data/*/chapter*_events.json', { eager: true });
const relationshipModules = import.meta.glob('/src/data/*/chapter*_relationships_event_*.json', { eager: true });

// === 동적 경로 생성 함수 ===
function getCharacterFile(book, chapter) {
  const num = String(chapter);
  // 예: /src/data/gatsby/c_chapter1_0.json
  const filePath = `/src/data/${book}/c_chapter${num}_0.json`;
  const data = characterModules[filePath]?.default;
  return data || { characters: [] };
}

function getEventsFile(book, chapter) {
  // 예: /src/data/gatsby/chapter1_events.json
  const filePath = `/src/data/${book}/chapter${chapter}_events.json`;
  const data = eventModules[filePath]?.default;
  return data || [];
}

function getRelationshipFile(book, chapter, eventNum) {
  // 예: /src/data/gatsby/chapter1_relationships_event_2.json
  const filePath = `/src/data/${book}/chapter${chapter}_relationships_event_${eventNum}.json`;
  const data = relationshipModules[filePath]?.default;
  return data || { relations: [] };
}

// getEventsForChapter는 events.json만 반환
function getEventsForChapter(book, chapter) {
  return getEventsFile(book, chapter);
}

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

const loading = false;
const isDataReady = true;

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
  const [isDataReady, setIsDataReady] = useState(true);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [graphViewState, setGraphViewState] = useState(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const maxChapter = 9; // data 폴더 기준
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isReloading, setIsReloading] = useState(false);
  const [prevElementsForDiff, setPrevElementsForDiff] = useState([]);
  const [diffNodes, setDiffNodes] = useState([]);
  const [latestValidEvent, setLatestValidEvent] = useState(null);

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
  const prevElementsRef = useRef([]);
  const prevChapterNumRef = useRef();
  const prevEventNumRef = useRef();
  const [graphDiff, setGraphDiff] = useState({ added: [], removed: [], updated: [] });

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
      try {
        // 챕터가 바뀔 때 단어 위치와 총 단어 수 초기화
        setCurrentWordIndex(0);
        setTotalChapterWords(0);
        const events = getEventsForChapter(book.title, currentChapter);
        // 첫 번째 이벤트의 시작 위치로 currentWordIndex 설정 (자동 선택 제거)
        // if (events && events.length > 0) {
        //   setCurrentWordIndex(events[0].start);
        // }
        const charactersData = getCharacterFile(book.title, currentChapter);
        const characters = charactersData.characters || [];
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
  }, [currentChapter]);

  const prevWordIndexStackRef = useRef([]);
  // currentWordIndex가 바뀔 때마다 스택에 push (0은 저장하지 않음)
  useEffect(() => {
    if (currentWordIndex > 0) {
      prevWordIndexStackRef.current.push(currentWordIndex);
      // 너무 길어지지 않게 최근 10개만 유지
      if (prevWordIndexStackRef.current.length > 10) {
        prevWordIndexStackRef.current = prevWordIndexStackRef.current.slice(-10);
      }
    }
  }, [currentWordIndex]);

  // currentEvent 결정 useEffect에서 events.json의 start/end로 매칭
  useEffect(() => {
    if (!isDataReady) return;
    const events = getEventsForChapter(book.title, currentChapter);
    if (!events || !events.length) {
      setCurrentEvent(null);
      return;
    }
    let wordIndexToUse = currentWordIndex;
    if (currentWordIndex === 0) {
      // 0이 아닌 가장 최근 인덱스 찾기
      const stack = prevWordIndexStackRef.current;
      const lastNonZero = [...stack].reverse().find(idx => idx > 0);
      wordIndexToUse = lastNonZero !== undefined ? lastNonZero : events[0].start;
    }
    const eventIdx = events.findIndex(event => wordIndexToUse >= event.start && wordIndexToUse < event.end);
    let matchedEvent = null;
    if (eventIdx !== -1) {
      matchedEvent = events[eventIdx];
      setCurrentEvent(matchedEvent);
    } else {
      matchedEvent = events[events.length - 1];
      setCurrentEvent(matchedEvent);
    }
    console.log('[ViewerPage 이벤트 매칭 디버그]', {
      wordIndex: wordIndexToUse,
      events: events.map(ev => ({start: ev.start, end: ev.end, event_id: ev.event_id})),
      matchedEvent
    });
    console.log('currentWordIndex:', wordIndexToUse, 'currentEvent:', matchedEvent);
  }, [isDataReady, currentChapter, currentWordIndex]);

  // === [추가] 챕터 전체 그래프(fullElements) 생성 ===
  const fullElements = useMemo(() => {
    const events = getEventsForChapter(book.title, currentChapter);
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
    const charactersData = getCharacterFile(book.title, currentChapter);
    const characters = charactersData.characters || [];
    return getElementsFromRelations(allRelations, charactersData, allNewAppearances, allImportance);
  }, [currentChapter]);

  // === [수정] elements: 현재 이벤트까지 등장한 노드/간선만 필터링 + position merge ===
  useEffect(() => {
    if (!isDataReady) {
      setGraphViewState(null);
      setElements(fullElements);
      setLoading(false);
      return;
    }
    if (!(currentEvent || prevEvent)) {
      setGraphViewState(null);
      setElements(fullElements);
      setLoading(false);
      return;
    }
    const events = getEventsForChapter(book.title, currentChapter);
    if (!events || !events.length) return;
    // 현재 이벤트의 event_id를 기준으로 관계 데이터 불러오기
    const eventId = currentEvent?.event_id ?? events[events.length - 1].event_id;
    const relationData = getRelationshipFile(book.title, currentChapter, eventId + 1); // event_id+1
    const charactersData = getCharacterFile(book.title, currentChapter);
    const elements = getElementsFromRelations(relationData.relations, charactersData, relationData.new_appearances, relationData.importance);
    setElements(elements);
    setLoading(false);
    console.log('elements:', elements);
  }, [isDataReady, currentEvent, prevEvent, currentChapter, hideIsolated, fullElements]);

  // === [추가] 마지막 이벤트 등장 노드/간선 위치만 저장 및 이벤트별 적용 ===
  // 마지막 이벤트에서 등장한 노드/간선 위치만 저장
  useEffect(() => {
    if (!isDataReady || !currentEvent || !graphViewState) return;
    const events = getEventsForChapter(book.title, currentChapter);
    if (!events || !events.length) return;
    const isLastEvent = currentEvent.event_id === events[events.length - 1].event_id;
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

  // elements가 바뀔 때마다 diff 계산
  useEffect(() => {
    if (!elements) return;
    const prev = prevElementsRef.current || [];
    const curr = elements;
    const diff = calcGraphDiff(prev, curr);

    setGraphDiff(diff);

    // diff 계산 후에 prevElementsRef를 갱신해야 함!
    prevElementsRef.current = elements;
  }, [elements]);

  // elements, chapterNum, eventNum이 바뀔 때마다 이전 값 저장
  useEffect(() => {
    prevElementsRef.current = elements;
    prevChapterNumRef.current = currentChapter;
    prevEventNumRef.current = currentEvent?.event_id;
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
        return;
      }
      // 1. merged_relations.json 전체 노드/엣지 생성
      const relationsData = getRelationshipFile(book.title, chapterNum, 0);
      const charactersData = getCharacterFile(book.title, chapterNum);
      const characters = charactersData.characters || [];
      const eventsData = getEventsFile(book.title, chapterNum);
      const events = Array.isArray(eventsData) ? eventsData : [];
      const relations = relationsData.relations || [];
      if (!relationsData || !charactersData) {
        return;
      }
      let allRelations = relationsData.relations || relationsData;
      let allImportance = relationsData.importance || {};
      let allNewAppearances = relationsData.new_appearances || [];
      const elements = getElementsFromRelations(allRelations, charactersData, allNewAppearances, allImportance);
      if (!elements || elements.length === 0) {
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
        } catch (e) {}
        cy.destroy();
      }, 100);
    });
  }, []);

  // elements가 바뀔 때마다 diffNodes 계산 (이전 상태와 비교)
  useEffect(() => {
    if (!elements || !prevElementsForDiff) return;
    if (!currentEvent || typeof currentEvent.event_id !== 'number') return;

    const diff = calcGraphDiff(prevElementsForDiff, elements);

    // 노드만 추출
    const addedNodeIds = diff.added;
    const addedNodes = elements.filter(e => addedNodeIds.includes(String(e.data.id)) && !e.data.source && !e.data.target);
    setDiffNodes(addedNodes);
    setPrevElementsForDiff(elements); // 반드시 diff 계산 후에만 갱신
  }, [elements]);

  // currentEvent, prevEvent가 바뀔 때마다 최신 유효 이벤트를 추적
  useEffect(() => {
    if (currentEvent) {
      setLatestValidEvent(currentEvent);
    } else if (prevEvent) {
      setLatestValidEvent(prevEvent);
    }
  }, [currentEvent, prevEvent]);

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
        pageMode={settings.pageMode}
        rightSideContent={
          <CytoscapeGraphPortalProvider>
            <GraphSplitArea
              elements={elements}
              currentChapter={currentChapter}
              maxChapter={maxChapter}
              hideIsolated={hideIsolated}
              setHideIsolated={setHideIsolated}
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              handleSearch={handleSearch}
              handleReset={handleReset}
              handleFitView={handleFitView}
              search={search}
              setSearch={setSearch}
              currentWordIndex={currentWordIndex}
              viewerRef={viewerRef}
              graphViewState={graphViewState}
              setGraphViewState={setGraphViewState}
              loading={loading}
              isDataReady={isDataReady}
              showGraph={showGraph}
              graphFullScreen={graphFullScreen}
              navigate={navigate}
              filename={filename}
              currentEvent={currentEvent}
              prevEvent={prevEvent}
              latestValidEvent={latestValidEvent}
              events={getEventsForChapter(book.title, currentChapter)}
              graphDiff={graphDiff}
              prevElements={Array.isArray(prevElementsRef.current) ? prevElementsRef.current : []}
              currentElements={elements}
              diffNodes={diffNodes}
              setCurrentChapter={setCurrentChapter}
              setCurrentEvent={setCurrentEvent}
              setCurrentWordIndex={setCurrentWordIndex}
            />
          </CytoscapeGraphPortalProvider>
        }
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
      <ToastContainer position="bottom-center" autoClose={1500} hideProgressBar newestOnTop closeOnClick />
    </div>
  );
};

export default ViewerPage;

const GraphSplitArea = ({
  elements,
  currentChapter,
  maxChapter,
  hideIsolated,
  setHideIsolated,
  searchInput,
  setSearchInput,
  handleSearch,
  handleReset,
  handleFitView,
  search,
  setSearch,
  currentWordIndex,
  viewerRef,
  graphViewState,
  setGraphViewState,
  loading,
  isDataReady,
  showGraph,
  graphFullScreen,
  navigate,
  filename,
  currentEvent,
  prevEvent,
  latestValidEvent,
  events,
  graphDiff,
  prevElements,
  currentElements,
  diffNodes,
  setCurrentChapter,
  setCurrentEvent,
  setCurrentWordIndex,
}) => {
  return (
    <div
      className="h-full w-full flex flex-col"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        width: '100%',
        overflow: 'hidden',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        boxSizing: 'border-box',
        padding: 0
      }}
    >
      {/* 상단바: < 버튼 + 챕터 드롭다운 + 독립 인물 버튼 + 검색 등 */}
      <div style={{ height: 40, flexShrink: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 0, gap: 0, paddingLeft: 12, paddingTop: 0, justifyContent: 'flex-start' }}>
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
              onChange={async e => {
                const nextChapter = Number(e.target.value);
                setCurrentChapter(nextChapter);
                setPendingChapter(nextChapter);
                // 그래프: 첫 이벤트로 맞추기
                const events = (typeof getEventsForChapter === 'function') ? getEventsForChapter(book.title, nextChapter) : (Array.isArray(events) ? events : []);
                if (events && events.length > 0) {
                  setCurrentWordIndex && setCurrentWordIndex(events[0].start);
                  if (typeof setCurrentEvent === 'function') setCurrentEvent(events[0]);
                } else {
                  setCurrentWordIndex && setCurrentWordIndex(0);
                  if (typeof setCurrentEvent === 'function') setCurrentEvent(null);
                }
              }}
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
          {/* 노드 위치 초기화 버튼 */}
          <button
            onClick={() => {
              // 모든 챕터의 노드 위치 캐시 삭제
              for (let i = 1; i <= maxChapter; i++) {
                localStorage.removeItem(`chapter_node_positions_${i}`);
              }
              window.location.reload();
            }}
            title="모든 챕터 노드 위치 초기화"
            style={{
              height: 32,
              padding: '2px 12px',
              borderRadius: 6,
              border: '1px solid #bfc8e2',
              background: '#fff0f0',
              color: '#e74c3c',
              fontWeight: 500,
              fontSize: 14,
              cursor: 'pointer',
              marginLeft: 6,
              lineHeight: '28px'
            }}
          >
            노드 위치 초기화
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
      {/* [이벤트 전환 UX] 상단바와 그래프 영역 사이에 추가 */}
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 48,
        background: 'linear-gradient(90deg, #e3eafe 0%, #f8fafc 100%)',
        borderBottom: '1.5px solid #e3e6ef',
        position: 'relative',
        zIndex: 2,
        fontWeight: 600,
        fontSize: 18,
        letterSpacing: 1,
        transition: 'background 0.3s'
      }}>
        <span style={{
          display: 'inline-block',
          padding: '6px 22px',
          borderRadius: 24,
          background: '#4F6DDE',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(79,109,222,0.13)',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: 1,
          transition: 'transform 0.3s, background 0.3s',
          transform: prevEvent && currentEvent && prevEvent.event_id !== currentEvent.event_id
            ? 'scale(1.12)'
            : 'scale(1)'
        }}>
          {currentEvent
            ? `이벤트 ${currentEvent.event_id}${currentEvent.name ? `: ${currentEvent.name}` : ''}`
            : (prevEvent
                ? `이벤트 ${prevEvent.event_id}${prevEvent.name ? `: ${prevEvent.name}` : ''}`
                : (latestValidEvent
                    ? `이벤트 ${latestValidEvent.event_id}${latestValidEvent.name ? `: ${latestValidEvent.name}` : ''}`
                    : ''))}
        </span>
        {/* 전체 이벤트 중 현재 위치 프로그레스 바 */}
        {events && (currentEvent || prevEvent) && (
          <div style={{
            position: 'absolute',
            right: 32,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 180,
            height: 8,
            background: '#e3e6ef',
            borderRadius: 4,
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(((currentEvent || prevEvent).event_id) / events.length) * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)',
              borderRadius: 4,
              transition: 'width 0.4s cubic-bezier(.4,2,.6,1)'
            }} />
          </div>
        )}
      </div>
      {/* 그래프 본문 */}
      <div style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        overflow: 'hidden',
        marginTop: 0
      }}>
        {/* 단 한 번만 렌더링 */}
        {showGraph && !graphFullScreen && !loading && isDataReady && elements && elements.length > 0 && (
          (() => { console.log('eventNum:', currentEvent ? currentEvent.event_id + 1 : 1, 'chapterNum:', currentChapter); return null; })(),
          <RelationGraphMain
            elements={elements}
            inViewer={true}
            fullScreen={false}
            style={{ width: '100%', height: '100%', minHeight: 0 }}
            graphViewState={graphViewState}
            setGraphViewState={setGraphViewState}
            chapterNum={currentChapter}
            eventNum={currentEvent ? currentEvent.event_id + 1 : 1}
            hideIsolated={hideIsolated}
            graphDiff={graphDiff}
            prevElements={Array.isArray(prevElements) ? prevElements : []}
            currentElements={currentElements}
            diffNodes={diffNodes}
          />
        )}
        {/* 로딩 또는 데이터 없음 안내 */}
        {showGraph && !graphFullScreen && (!elements || elements.length === 0 || loading || !isDataReady) && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
            {/* 필요시 로딩 스피너 또는 안내 메시지 */}
          </div>
        )}
      </div>
    </div>
  );
};

