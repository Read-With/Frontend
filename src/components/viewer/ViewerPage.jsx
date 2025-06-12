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
import GraphContainer from '../graph/GraphContainer';

const eventRelationModules = import.meta.glob('../../data/gatsby/chapter*_relationships_event_*.json', { eager: true });
const eventTextModules = import.meta.glob('../../data/gatsby/chapter*_events.json', { eager: true });
const charactersModules = import.meta.glob('../../data/gatsby/c_chapter*_0.json', { eager: true });
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


const getChapterFile = (chapter, type) => {
  const num = String(chapter);
  try {
    if (type === 'characters') {
      const filePath = Object.keys(charactersModules).find(key => key.includes(`c_chapter${num}_0.json`));
      const data = filePath ? charactersModules[filePath]?.default : undefined;
      return data?.characters || [];
    } else {
      // (relations 등 다른 타입도 필요하다면 여기에 맞게 수정)
      return [];
    }
  } catch (error) {
    return [];
  }
};

// safeId 함수가 없으면 추가
function safeId(id) {
  // id가 2.0, 2, "2" 등 어떤 타입이든 항상 문자열 "2"로 변환
  return String(parseInt(id, 10));
}

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

//이번에 바꾼것임
function getEventsForChapter(chapter) {
  const num = String(chapter);
  console.log('디버그 - getEventsForChapter 호출:', {
    chapter,
    num,
    eventTextModules: Object.keys(eventTextModules),
    eventRelationModules: Object.keys(eventRelationModules)
  });

  // 1. 이벤트 본문 데이터 추출
  const textFilePath = Object.keys(eventTextModules).find(path => path.includes(`chapter${num}_events.json`));
  console.log('디버그 - textFilePath:', textFilePath);
  
  const textArray = textFilePath ? eventTextModules[textFilePath]?.default : [];
  console.log('디버그 - textArray:', textArray);

  // 2. 각 event에 대해 event_id에 해당하는 관계 파일을 찾음
  const eventsWithRelations = textArray.map(event => {
    const eventId = event.event_id || 0; // event_id가 없으면 0으로 설정
    const relFilePath = Object.keys(eventRelationModules).find(path =>
      path.includes(`chapter${num}_relationships_event_${eventId === 0 ? 1 : eventId}.json`)
    );
    console.log('디버그 - event 관계 파일:', {
      eventId,
      relFilePath,
      relations: relFilePath ? eventRelationModules[relFilePath]?.default : null
    });

    const relations = relFilePath ? eventRelationModules[relFilePath]?.default?.relations || [] : [];
    return {
      ...event,
      eventNum: eventId,
      relations,
    };
  });

  console.log('디버그 - 최종 이벤트 목록:', eventsWithRelations);
  return eventsWithRelations;
}

function getElementsFromRelations(relations, characterData, _newAppearances, importance) {
  // 1. relation, importance에 등장하는 id 모두 수집 (newAppearances는 무시)
  const nodeIdSet = new Set();
  
  // relations가 객체인 경우 relations.relations 배열을 사용
  const relationsArray = relations?.relations || (Array.isArray(relations) ? relations : []);
  
  if (Array.isArray(relationsArray)) {
    relationsArray.forEach(rel => {
      if (rel.id1 !== undefined) nodeIdSet.add(safeId(rel.id1));
      if (rel.id2 !== undefined) nodeIdSet.add(safeId(rel.id2));
      if (rel.source !== undefined) nodeIdSet.add(safeId(rel.source));
      if (rel.target !== undefined) nodeIdSet.add(safeId(rel.target));
    });
  }
  
  if (importance && typeof importance === 'object') {
    Object.keys(importance).forEach(id => nodeIdSet.add(safeId(id)));
  }

  let nodes = [];
  if (Array.isArray(characterData)) {
    // relations가 없으면 모든 캐릭터를 노드로!
    const filteredCharacters = nodeIdSet.size === 0
      ? characterData
      : characterData.filter(char => {
          const sid = safeId(char.id);
          return nodeIdSet.has(sid) || nodeIdSet.has(char.id) || nodeIdSet.has(Number(char.id));
        });
    nodes = filteredCharacters.map(char => {
      return {
        data: {
          id: safeId(char.id),
          label: char.common_name || char.name || safeId(char.id),
          description: char.description || '',
          main: char.main_character !== undefined ? char.main_character : false,
          names: (char.names && char.names.length > 0) ? char.names : (char.common_name ? [char.common_name] : []),
          portrait_prompt: char.portrait_prompt || ''
        }
      };
    });
  }

  // 3. 엣지 생성 (safeId 적용)
  const edges = relationsArray
    .filter(rel => {
      const source = safeId(rel.id1 || rel.source);
      const target = safeId(rel.id2 || rel.target);
      return nodeIdSet.has(source) && nodeIdSet.has(target);
    })
    .map((rel, idx) => ({
      data: {
        id: `e${idx}`,
        source: safeId(rel.id1 || rel.source),
        target: safeId(rel.id2 || rel.target),
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
  const [showGraph, setShowGraph] = useState(settings.showGraph);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [graphFullScreen, setGraphFullScreen] = useState(false);
  const [elements, setElements] = useState([]);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [currentPageWords, setCurrentPageWords] = useState(0);
  const [totalChapterWords, setTotalChapterWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterText, setChapterText] = useState('');
  const [isDataReady, setIsDataReady] = useState(true);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [graphViewState, setGraphViewState] = useState(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [characterData, setCharacterData] = useState(null);
  const [events, setEvents] = useState([]);
  const [maxChapter, setMaxChapter] = useState(9); // data 폴더 기준
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isReloading, setIsReloading] = useState(false);
  const [eventNum, setEventNum] = useState(0);

  // location.state에서 book 정보를 가져오거나, 없으면 filename에서 생성
  const book = location.state?.book || {
    title: filename.replace('.epub', ''),
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
  const loadData = async () => {
    try {
      setLoading(true);
      setIsDataReady(false);

      // 이벤트 데이터 로드
      const events = await getEventsForChapter(currentChapter);
      console.log('디버그 - 로드된 이벤트:', events);
      setEvents(events);

      // 캐릭터 데이터 로드 - c_chapter1_0.json 사용
      const characterFilePath = Object.keys(charactersModules).find(path => 
        path.includes(`c_chapter${currentChapter}_0.json`)
      );
      if (!characterFilePath) {
        throw new Error(`캐릭터 데이터 파일을 찾을 수 없습니다: chapter${currentChapter}`);
      }
      const characterData = charactersModules[characterFilePath].default;
      console.log('디버그 - 로드된 캐릭터 데이터:', characterData);
      setCharacterData(characterData);

      // 첫 번째 이벤트 설정
      if (events && events.length > 0) {
        const firstEvent = events[0]; // 첫 번째 이벤트 사용
        console.log('디버그 - 첫 번째 이벤트:', firstEvent);
        if (firstEvent) {
          const eventId = firstEvent.event_id || 0;  // event_id가 없으면 0으로 설정
          
          // 이벤트 ID가 0이거나 없는 경우 (목차 등)
          if (eventId === 0) {
            setCurrentEvent({
              ...firstEvent,
              eventNum: 0,
              name: "다음 페이지로 넘어가주세요"
            });
            
            // 이벤트 ID가 0일 때는 1번 관계 파일 사용
            const eventRelationFilePath = Object.keys(eventRelationModules).find(path => 
              path.includes(`chapter${currentChapter}_relationships_event_1.json`)
            );
            if (!eventRelationFilePath) {
              throw new Error(`이벤트 관계 데이터 파일을 찾을 수 없습니다: chapter${currentChapter} event1`);
            }
            const eventRelations = eventRelationModules[eventRelationFilePath].default;
            console.log('디버그 - 로드된 관계 데이터 (event_id=0):', eventRelations);
            const elements = getElementsFromRelations(eventRelations, characterData, [], 1);
            console.log('디버그 - 생성된 elements (event_id=0):', elements);
            setElements(elements);
          } else {
            setCurrentEvent({
              ...firstEvent,
              eventNum: eventId
            });
            
            // 이벤트의 관계 데이터 로드
            const eventRelationFilePath = Object.keys(eventRelationModules).find(path => 
              path.includes(`chapter${currentChapter}_relationships_event_${eventId}.json`)
            );
            if (!eventRelationFilePath) {
              throw new Error(`이벤트 관계 데이터 파일을 찾을 수 없습니다: chapter${currentChapter} event${eventId}`);
            }
            const eventRelations = eventRelationModules[eventRelationFilePath].default;
            console.log('디버그 - 로드된 관계 데이터:', eventRelations);
            const elements = getElementsFromRelations(eventRelations, characterData, [], eventId);
            console.log('디버그 - 생성된 elements:', elements);
            setElements(elements);
          }
        }
      }

      setIsDataReady(true);
      setLoading(false);
    } catch (error) {
      console.error('데이터 로드 중 오류:', error);
      setLoading(false);
    }
  };

  // currentEvent가 변경될 때 관계 데이터 업데이트
  useEffect(() => {
    if (isDataReady && !loading && currentEvent) {
      const eventId = currentEvent.event_id || 1;  // event_id가 없으면 1로 설정
      const eventNum = currentEvent.eventNum || 1;  // eventNum이 없으면 1로 설정
      
      // 이벤트 관계 데이터 로드
      const loadEventRelations = async () => {
        try {
          const eventRelationFilePath = Object.keys(eventRelationModules).find(path => 
            path.includes(`chapter${currentChapter}_relationships_event_${eventId}.json`)
          );
          if (!eventRelationFilePath) {
            console.warn(`이벤트 관계 데이터 파일을 찾을 수 없습니다: chapter${currentChapter} event${eventId}`);
            return;
          }
          const eventRelations = eventRelationModules[eventRelationFilePath].default;
          const elements = getElementsFromRelations(eventRelations, characterData, [], eventNum);
          setElements(elements);
        } catch (error) {
          console.error('이벤트 관계 데이터 로드 중 오류:', error);
        }
      };

      loadEventRelations();
    }
  }, [isDataReady, loading, currentEvent, currentChapter, characterData]);

  // currentChapter가 바뀔 때 currentEvent, prevEvent, elements 등도 초기화
  useEffect(() => {
    setCurrentEvent(null);
    setPrevEvent(null);
    setElements([]); // 그래프도 초기화
  }, [currentChapter]);

  // === [추가] 챕터 전체 그래프(fullElements) 생성 ===
  const fullElements = useMemo(() => {
    if (!events || !events.length || !characterData || !characterData.length) return [];
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
    return getElementsFromRelations(allRelations, characterData, allNewAppearances, allImportance);
  }, [currentChapter, events, characterData]);

  // === [수정] elements: 데이터 준비/이벤트별 분리 ===
  // 1. 데이터 준비되면 fullElements를 보여줌
  useEffect(() => {
    if (isDataReady && !currentEvent) {
      setElements(fullElements);
      setLoading(false);
    }
  }, [isDataReady, currentEvent, fullElements]);

  // 2. currentEvent가 잡히면 이벤트별 필터링 그래프를 보여줌
  useEffect(() => {
    if (!currentEvent || !isDataReady) return;
    
    const events = getEventsForChapter(currentChapter);
    if (!events || !events.length) return;
    
    const maxEventNum = currentEvent?.eventNum || events[events.length - 1].eventNum;
    const nodeFirstEvent = {};
    const edgeFirstEvent = {};
    
    events.forEach(ev => {
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
          const edgeKey = `${id1}-${id2}`;
          if (edgeFirstEvent[edgeKey] === undefined) edgeFirstEvent[edgeKey] = ev.eventNum;
        });
      }
    });

    const filtered = fullElements.filter(el => {
      if (el.data.source && el.data.target) {
        const edgeKey = `${el.data.source}-${el.data.target}`;
        return edgeFirstEvent[edgeKey] !== undefined && edgeFirstEvent[edgeKey] <= maxEventNum;
      } else if (el.data.id) {
        return nodeFirstEvent[el.data.id] !== undefined && nodeFirstEvent[el.data.id] <= maxEventNum;
      }
      return false;
    });

    let nodePositions = {};
    try {
      const posStr = localStorage.getItem(`chapter_node_positions_${currentChapter}`);
      if (posStr) nodePositions = JSON.parse(posStr);
    } catch (e) {}

    const sorted = filtered.slice().sort((a, b) => {
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
    setLoading(false);
  }, [currentEvent, currentChapter, hideIsolated, fullElements, isDataReady]);

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
        return;
      }
      // 1. merged_relations.json 전체 노드/엣지 생성
      const relationsData = getChapterFile(chapterNum, 'relations');
      const charactersData = getChapterFile(chapterNum, 'characters');
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

  // [추가] 그래프 diff 계산 함수
  function getGraphDiff(prevElements, currentElements) {
    const prevIds = new Set(prevElements.map(e => e.data.id));
    const currIds = new Set(currentElements.map(e => e.data.id));

    const added = currentElements.filter(e => !prevIds.has(e.data.id));
    const removed = prevElements.filter(e => !currIds.has(e.data.id));
    const updated = currentElements.filter(e => {
      const prev = prevElements.find(pe => pe.data.id === e.data.id);
      return prev && JSON.stringify(prev.data) !== JSON.stringify(e.data);
    });

    return { added, removed, updated };
  }

  // elements가 바뀔 때마다 diff 계산
  useEffect(() => {
    if (!elements) return;
    const prev = prevElementsRef.current || [];
    const curr = elements;
    const diff = getGraphDiff(prev, curr);
    setGraphDiff(diff);
    prevElementsRef.current = curr;
  }, [elements]);

  useEffect(() => {
    // 필요한 디버그 로그만 남김
    console.log('[디버그] currentEvent:', currentEvent);
    console.log('[디버그] fullElements:', fullElements);
    console.log('[디버그] isDataReady:', isDataReady, 'loading:', loading);
    
    // currentEvent가 변경될 때마다 eventNum 업데이트
    if (currentEvent) {
      setEventNum(currentEvent.event_id ?? 0);
    }
  }, [currentEvent, fullElements, isDataReady, loading]);

  // currentChapter가 변경될 때 데이터 다시 로드
  useEffect(() => {
    loadData();
  }, [currentChapter]);

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
              currentCharIndex={currentCharIndex}
              hideIsolated={hideIsolated}
              setHideIsolated={setHideIsolated}
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              handleSearch={handleSearch}
              handleReset={handleReset}
              handleFitView={handleFitView}
              search={search}
              setSearch={setSearch}
              currentChapter={currentChapter}
              maxChapter={maxChapter}
              loading={loading}
              isDataReady={isDataReady}
              showGraph={showGraph}
              graphFullScreen={graphFullScreen}
              navigate={navigate}
              filename={filename}
              currentEvent={currentEvent}
              prevEvent={prevEvent}
              events={getEventsForChapter(currentChapter)}
              graphDiff={graphDiff}
              prevElements={prevElementsRef.current}
              currentElements={elements}
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
            setCurrentPage(page);
          }}
          onTotalPagesChange={setTotalPages}
          onCurrentChapterChange={(chapter) => {
            setLoading(true);
            setCurrentChapter(chapter);
          }}
          settings={settings}
          onCurrentLineChange={(charIndex, totalEvents, currentEvent) => {
            setCurrentCharIndex(charIndex);
            setTotalChapterWords(totalEvents || 0);
            setCurrentEvent(currentEvent);
          }}
          onAllCfisReady={(_cfis, _ranges, offsets) => {}}
          onTextReady={(text, i) => {}}
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

function GraphSplitArea({
  currentCharIndex,
  hideIsolated,
  setHideIsolated,
  searchInput,
  setSearchInput,
  handleSearch,
  handleReset,
  handleFitView,
  search,
  setSearch,
  currentChapter,
  maxChapter,
  loading,
  isDataReady,
  showGraph,
  graphFullScreen,
  navigate,
  filename,
  currentEvent,
  prevEvent,
  events,
  graphDiff,
  prevElements,
  currentElements,
}) {
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
          transform: prevEvent && currentEvent && prevEvent.eventNum !== currentEvent.eventNum
            ? 'scale(1.12)'
            : 'scale(1)'
        }}>
          {currentEvent
            ? `이벤트 ${currentEvent.eventNum ?? 0}${currentEvent.name ? `: ${currentEvent.name}` : ''}`
            : '이벤트 정보 없음'}
        </span>
        {/* 전체 이벤트 중 현재 위치 프로그레스 바 */}
        {events && currentEvent && (
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
              width: `${((currentEvent.eventNum || 0) / (events.length + 1)) * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #4F6DDE 0%, #6fa7ff 100%)',
              borderRadius: 4,
              transition: 'width 0.4s cubic-bezier(.4,2,.6,1)'
            }} />
          </div>
        )}
      </div>
      {/* 그래프 본문 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0 }}>
        <GraphContainer currentPosition={currentCharIndex} currentEvent={currentEvent} />
      </div>
    </div>
  );
}
