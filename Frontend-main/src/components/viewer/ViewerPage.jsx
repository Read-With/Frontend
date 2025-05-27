import React, { useRef, useState, useEffect, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import ViewerLayout from "./ViewerLayout";
import EpubViewer from "./epub/EpubViewer";
import BookmarkPanel from "./epub/BookmarkPanel";
import ViewerSettings from "./epub/ViewerSettings";
import { loadBookmarks, saveBookmarks } from "./epub/BookmarkManager";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import RelationGraphMain from "../graph/RelationGraphMain";
import GraphControls from "../graph/GraphControls";
import { FaSyncAlt } from "react-icons/fa";

// 반드시 파일 최상단에 위치!
const eventRelationModules = import.meta.glob(
  "/src/data/*/[0-9][0-9]_ev*_relations.json",
  { eager: true }
);

// public/gatsby 폴더의 이미지 파일명 목록
const gatsbyImages = [
  "Carraways.png",
  "Father.png",
  "Gatsby.png",
  "Great-Uncle.png",
  "Nick.png",
  "Young man at the office.png",
];

// public/gatsby 폴더 내 인물명 이미지(.png) 자동 매핑 함수 추가
function getNodeImagePath(node) {
  const baseName = (
    node.common_name ||
    (Array.isArray(node.names) ? node.names[0] : "") ||
    ""
  ).trim();
  if (!baseName) return undefined;
  const candidates = [
    `${baseName}.png`,
    `${baseName.replace(/\s+/g, "_")}.png`,
    `${baseName.replace(/\s+/g, "-")}.png`,
    `${baseName.charAt(0).toUpperCase() + baseName.slice(1)}.png`,
  ];
  const found = candidates.find((name) => gatsbyImages.includes(name));
  return found ? `/gatsby/${found}` : undefined;
}

// 기본 설정 값
const defaultSettings = {
  fontSize: 100,
  pageMode: "double", // 'single', 'double' 중 하나
  theme: "light",
  lineHeight: 1.5,
  margin: 20,
  fontFamily: "default",
  showGraph: true, // 그래프 표시 여부 추가
};

// 로컬 스토리지에서 설정 불러오기
const loadSettings = () => {
  try {
    const settings = localStorage.getItem("epub_viewer_settings");
    const loadedSettings = settings ? JSON.parse(settings) : defaultSettings;

    // leftOnly 모드였다면 double로 변경
    if (loadedSettings.pageMode === "leftOnly") {
      loadedSettings.pageMode = "double";
    }

    // showGraph 속성이 없으면 기본값 추가
    if (loadedSettings.showGraph === undefined) {
      loadedSettings.showGraph = defaultSettings.showGraph;
    }

    // 업데이트된 설정 저장
    localStorage.setItem(
      "epub_viewer_settings",
      JSON.stringify(loadedSettings)
    );

    return loadedSettings;
  } catch (e) {
    console.error("설정 불러오기 오류:", e);
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
const characterModules = import.meta.glob(
  "/src/data/*/[0-9][0-9]_characters.json",
  { eager: true }
);
const relationModules = import.meta.glob(
  "/src/data/*/[0-9][0-9]_merged_relations.json",
  { eager: true }
);

const getChapterFile = (chapter, type) => {
  const num = String(chapter).padStart(2, "0");
  try {
    if (type === "characters") {
      const filePath = `/src/data/${num}/${num}_characters.json`;
      const data = characterModules[filePath]?.default;
      console.log("[characters] filePath:", filePath, "data:", data);
      if (!data) {
        console.warn(`캐릭터 파일을 찾을 수 없음: ${filePath}`);
        return [];
      }
      return data;
    } else {
      const filePath = `/src/data/${num}/${num}_merged_relations.json`;
      const data = relationModules[filePath]?.default;
      console.log("[relations] filePath:", filePath, "data:", data);
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
const safeId = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return String(Math.trunc(v));
  if (typeof v === "string" && v.match(/^[0-9]+\.0$/)) return v.split(".")[0];
  return String(v).trim();
};

// 1. 모드 저장 함수
const saveViewerMode = (mode) => {
  try {
    localStorage.setItem("viewer_mode", mode);
  } catch (e) {}
};

// 2. 모드 복원 함수
const loadViewerMode = () => {
  try {
    return localStorage.getItem("viewer_mode");
  } catch (e) {
    return null;
  }
};

function getEventsForChapter(chapter) {
  const num = String(chapter).padStart(2, "0");
  try {
    const events = Object.entries(eventRelationModules)
      .filter(([path]) => path.includes(`/${num}/${num}_ev`))
      .map(([path, mod]) => {
        const eventNum = parseInt(
          path.match(/_ev(\d+)_relations\.json$/)?.[1] || "0"
        );
        return { ...mod.default, eventNum, path };
      })
      .filter((ev) => ev.eventNum > 0)
      .sort((a, b) => a.eventNum - b.eventNum);

    return events;
  } catch (error) {
    console.error("이벤트 로딩 오류:", error);
    return [];
  }
}

function getElementsFromRelations(
  relations,
  characterData,
  _newAppearances,
  importance
) {
  // 1. relation, importance에 등장하는 id 모두 수집 (newAppearances는 무시)
  const nodeIdSet = new Set();
  if (Array.isArray(relations)) {
    relations.forEach((rel) => {
      if (rel.id1 !== undefined) nodeIdSet.add(String(rel.id1));
      if (rel.id2 !== undefined) nodeIdSet.add(String(rel.id2));
      if (rel.source !== undefined) nodeIdSet.add(String(rel.source));
      if (rel.target !== undefined) nodeIdSet.add(String(rel.target));
    });
  }
  if (importance && typeof importance === "object") {
    Object.keys(importance).forEach((id) => nodeIdSet.add(String(id)));
  }

  // 2. characterData.characters에서 해당 id만 노드로 생성
  let nodes = [];
  if (characterData && Array.isArray(characterData.characters)) {
    nodes = characterData.characters
      .filter((char) => nodeIdSet.has(String(char.id)))
      .map((char) => ({
        data: {
          id: String(char.id),
          label: char.common_name || char.name || String(char.id),
          description: char.description || "",
          img: getNodeImagePath(char), // 노드 이미지 추가
        },
      }));
  }

  // 3. 엣지 생성
  const edges = (relations || [])
    .filter((rel) => {
      const source = String(rel.id1 || rel.source);
      const target = String(rel.id2 || rel.target);
      return nodeIdSet.has(source) && nodeIdSet.has(target);
    })
    .map((rel, idx) => ({
      data: {
        id: `e${idx}`,
        source: String(rel.id1 || rel.source),
        target: String(rel.id2 || rel.target),
        label: Array.isArray(rel.relation) ? rel.relation.join(", ") : rel.type,
        explanation: rel.explanation,
        positivity: rel.positivity,
        weight: rel.weight,
      },
    }));

  return [...nodes, ...edges];
}

// --- [추가] 고립 노드(독립 인물) 필터링 함수 ---
function filterIsolatedNodes(elements, hideIsolated) {
  if (!hideIsolated) return elements;
  // 엣지가 하나도 없으면(즉, relations가 아예 없으면) 노드는 숨기지 않음
  const hasEdge = elements.some(
    (el) => el.data && el.data.source && el.data.target
  );
  if (!hasEdge) return elements;
  // 노드 id 목록
  const nodeIds = new Set(
    elements
      .filter((el) => el.data && el.data.id && !el.data.source)
      .map((el) => el.data.id)
  );
  // 엣지의 source/target id 목록
  const connectedIds = new Set(
    elements
      .filter((el) => el.data && el.data.source && el.data.target)
      .flatMap((el) => [el.data.source, el.data.target])
  );
  // 연결된 노드만 남김
  return elements.filter((el) => {
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
  const [darkMode, setDarkMode] = useState(
    initialDarkMode || settings.theme === "dark"
  );
  const [showGraph, setShowGraph] = useState(settings.showGraph); // 설정에서 그래프 표시 여부 로드
  const [currentChapter, setCurrentChapter] = useState(1); // 현재 챕터 번호
  const [graphFullScreen, setGraphFullScreen] = useState(false);
  const [elements, setElements] = useState([]);
  // prevWordIndex, prevElements를 useRef로 관리
  const prevWordIndexRef = useRef(0);
  const prevElementsRef = useRef([]);
  const prevEventRef = useRef(null); // 추가
  const maxChapter = 9; // data 폴더 기준
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [hideIsolated, setHideIsolated] = useState(true);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentPageWords, setCurrentPageWords] = useState(0);
  const [totalChapterWords, setTotalChapterWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterText, setChapterText] = useState("");
  const [isDataReady, setIsDataReady] = useState(false);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [prevEvent, setPrevEvent] = useState(null);
  const [graphViewState, setGraphViewState] = useState(null);

  // location.state에서 book 정보를 가져오거나, 없으면 filename에서 생성
  const book = location.state?.book || {
    title: filename.replace(".epub", ""),
    // public 폴더 루트에서 파일 찾기 (절대 경로)
    path: `/${filename}`,
    filename: filename,
  };

  const [showToolbar, setShowToolbar] = useState(false);
  // 파일명에서 경로 제거하고 순수 파일명만 추출 (북마크 저장용)
  const cleanFilename = filename.trim();
  const [bookmarks, setBookmarks] = useState(loadBookmarks(cleanFilename));
  const [showBookmarkList, setShowBookmarkList] = useState(false);

  // 3. mount 시 localStorage에서 모드 복원
  useEffect(() => {
    const mode = loadViewerMode();
    if (mode === "split") {
      setShowGraph(true);
      setGraphFullScreen(false);
    } else if (mode === "graph") {
      setShowGraph(true);
      setGraphFullScreen(true);
    } else if (mode === "viewer") {
      setShowGraph(false);
      setGraphFullScreen(false);
    }
  }, []);

  // 4. showGraph/graphFullScreen 상태 변경 시 localStorage에 저장
  useEffect(() => {
    if (graphFullScreen) {
      saveViewerMode("graph");
    } else if (showGraph) {
      saveViewerMode("split");
    } else {
      saveViewerMode("viewer");
    }
  }, [showGraph, graphFullScreen]);

  useEffect(() => {
    if (failCount >= 2) {
      toast.info("🔄 계속 실패하면 브라우저 새로고침을 해주세요!");
    }
  }, [failCount]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
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
          console.error("챕터 정보 읽기 오류:", e);
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
      setElements([]); // 로딩 시작 시 그래프 데이터 즉시 비우기
      try {
        // 챕터가 바뀔 때 단어 위치와 총 단어 수 초기화
        setCurrentWordIndex(0);
        setTotalChapterWords(0);
        const events = getEventsForChapter(currentChapter);
        // 첫 번째 이벤트의 시작 위치로 currentWordIndex 설정
        if (events && events.length > 0) {
          setCurrentWordIndex(events[0].start);
        }
        const charactersData = getChapterFile(currentChapter, "characters");
        setIsDataReady(true);
      } catch (error) {
        toast.error("데이터를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [currentChapter]);

  // currentChapter가 바뀔 때 currentEvent를 null로 초기화
  useEffect(() => {
    setCurrentEvent(null);
    setElements([]);
  }, [currentChapter]);

  // 현재 이벤트 결정 useEffect 개선
  useEffect(() => {
    if (!isDataReady) return;
    const events = getEventsForChapter(currentChapter);
    if (!events || !events.length) {
      setCurrentEvent(null);
      return;
    }
    // 디버그 로그 추가
    console.log("[디버그][이벤트 탐색] currentChapter:", currentChapter);
    console.log("[디버그][이벤트 탐색] currentWordIndex:", currentWordIndex);
    console.log(
      "[디버그][이벤트 탐색] events:",
      events.map((ev) => ({
        start: ev.start,
        end: ev.end,
        eventNum: ev.eventNum,
      }))
    );
    // currentWordIndex가 0이면 무조건 첫 이벤트
    if (currentWordIndex === 0) {
      setCurrentEvent(events[0]);
      console.log("[이벤트 탐색] currentWordIndex:", currentWordIndex);
      console.log(
        "[이벤트 탐색] events:",
        events.map((ev) => ({
          start: ev.start,
          end: ev.end,
          eventNum: ev.eventNum,
        }))
      );
      console.log("[이벤트 탐색] 선택된 이벤트:", {
        start: events[0].start,
        end: events[0].end,
        eventNum: events[0].eventNum,
      });
      return;
    }
    // start <= currentWordIndex < end 범위의 이벤트 찾기
    const eventIdx = events.findIndex(
      (event) => currentWordIndex >= event.start && currentWordIndex < event.end
    );
    console.log("[이벤트 탐색] currentWordIndex:", currentWordIndex);
    console.log(
      "[이벤트 탐색] events:",
      events.map((ev) => ({
        start: ev.start,
        end: ev.end,
        eventNum: ev.eventNum,
      }))
    );
    if (eventIdx !== -1) {
      setCurrentEvent(events[eventIdx]);
      console.log("[이벤트 탐색] 선택된 이벤트:", {
        start: events[eventIdx].start,
        end: events[eventIdx].end,
        eventNum: events[eventIdx].eventNum,
      });
    } else {
      // fallback: 마지막 이벤트
      setCurrentEvent(events[events.length - 1]);
      console.log("[이벤트 탐색] 선택된 이벤트(마지막):", {
        start: events[events.length - 1].start,
        end: events[events.length - 1].end,
        eventNum: events[events.length - 1].eventNum,
      });
    }
  }, [isDataReady, currentChapter, currentWordIndex]);

  // elements는 currentEvent가 바뀔 때만 생성
  useEffect(() => {
    if (!isDataReady || !(currentEvent || prevEvent)) {
      setElements([]);
      prevElementsRef.current = [];
      prevWordIndexRef.current = 0;
      prevEventRef.current = null;
      setGraphViewState(null);
      return;
    }
    const charactersData = getChapterFile(currentChapter, "characters");
    const eventKey = currentEvent?.path || `chapter${currentChapter}_event`;
    // localStorage에서 이전 그래프 정보와 뷰 상태 불러오기
    if (currentEvent === prevEventRef.current) {
      const saved = localStorage.getItem(`graph_${eventKey}`);
      if (saved) {
        const { elements: savedElements, graphViewState: savedViewState } =
          JSON.parse(saved);
        setElements(savedElements);
        setGraphViewState(savedViewState);
        console.log("[localStorage] 그래프 복원:", eventKey, savedViewState);
        return;
      }
    }
    // 새로 생성
    const newElements = filterIsolatedNodes(
      getElementsFromRelations(
        currentEvent?.relations,
        charactersData,
        null,
        currentEvent?.importance
      ),
      hideIsolated
    );
    setElements(newElements);
    prevElementsRef.current = newElements;
    prevWordIndexRef.current = currentWordIndex;
    prevEventRef.current = currentEvent;
    // graphViewState는 RelationGraphMain에서 setGraphViewState로 저장됨
    // localStorage에 저장
    localStorage.setItem(
      `graph_${eventKey}`,
      JSON.stringify({ elements: newElements, graphViewState })
    );
    console.log("[localStorage] 그래프 저장:", eventKey, graphViewState);
  }, [
    isDataReady,
    currentEvent,
    prevEvent,
    currentChapter,
    hideIsolated,
    currentWordIndex,
  ]);

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
        console.error("위치 계산 오류:", e);
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
        typeof viewerRef.current.bookRef.current.locations.locationFromCfi ===
          "function"
      ) {
        // 챕터 내 인덱스 반환
        return viewerRef.current.bookRef.current.locations.locationFromCfi(cfi);
      }
    } catch (e) {
      // 무시
    }
    return 0;
  };

  // 챕터 진입 시 첫 이벤트만 표시
  useEffect(() => {
    const events = getEventsForChapter(currentChapter);
    if (events && events.length) {
      setCurrentWordIndex(events[0].start);
    }
  }, [currentChapter]);

  const handlePrevPage = () => {
    if (viewerRef.current) viewerRef.current.prevPage();
  };

  const handleNextPage = () => {
    if (viewerRef.current) viewerRef.current.nextPage();
  };

  const handleAddBookmark = async () => {
    if (!viewerRef.current) {
      toast.error("❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }
    let cfi = null;
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
    } catch (e) {
      console.error("getCurrentCfi 에러:", e);
    }
    if (!cfi) {
      toast.error("❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }

    setFailCount(0);

    const latestBookmarks = loadBookmarks(cleanFilename);
    const isDuplicate = latestBookmarks.some((b) => b.cfi === cfi);
    let newBookmarks;
    if (isDuplicate) {
      newBookmarks = latestBookmarks.filter((b) => b.cfi !== cfi);
      toast.info("❌ 북마크가 삭제되었습니다");
    } else {
      const newBookmark = { cfi, createdAt: new Date().toISOString() };
      newBookmarks = [newBookmark, ...latestBookmarks];
      toast.success("✅ 북마크가 추가되었습니다");
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
    if (newSettings.theme === "dark") {
      setDarkMode(true);
    } else {
      setDarkMode(false);
    }

    // 그래프 표시 설정 적용
    setShowGraph(newSettings.showGraph);

    // 페이지 모드 변경 또는 그래프 표시 여부 변경 시 뷰어 다시 로드
    if (
      newSettings.pageMode !== prevSettings.pageMode ||
      newSettings.showGraph !== prevSettings.showGraph
    ) {
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
          setReloadKey((prev) => prev + 1);
        } catch (e) {
          // 에러 발생 시에도 뷰어 다시 로드
          setReloadKey((prev) => prev + 1);
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
      localStorage.setItem("epub_viewer_settings", JSON.stringify(newSettings));
    } catch (e) {
      toast.error("설정 저장 중 오류가 발생했습니다.");
    }

    toast.success("✅ 설정이 적용되었습니다");
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
      toast.error("❗ 파일명이 없어 북마크를 삭제할 수 없습니다.");
      return;
    }
    if (window.confirm("정말 삭제하시겠습니까?")) {
      const newBookmarks = bookmarks.filter((b) => b.cfi !== cfi);
      setBookmarks(newBookmarks);
      saveBookmarks(cleanFilename, newBookmarks);
    }
  };

  const handleRemoveBookmark = (cfi) => {
    if (!cleanFilename) {
      toast.error("❗ 파일명이 없어 북마크를 삭제할 수 없습니다.");
      return;
    }
    if (window.confirm("정말 삭제하시겠습니까?")) {
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
      showGraph: newShowGraph,
    };
    setSettings(updatedSettings);

    // 로컬 스토리지에 설정 저장
    try {
      localStorage.setItem(
        "epub_viewer_settings",
        JSON.stringify(updatedSettings)
      );
    } catch (e) {
      console.error("설정 저장 오류:", e);
    }

    // EPUB 뷰어 다시 로드
    const saveCurrent = async () => {
      try {
        let cfi = null;

        if (viewerRef.current?.getCurrentCfi) {
          cfi = await viewerRef.current.getCurrentCfi();
          if (cfi) {
            console.log("현재 위치 저장:", cfi);
            localStorage.setItem(`readwith_${cleanFilename}_lastCFI`, cfi);
          }
        }

        // 즉시 뷰어 다시 로드
        setReloadKey((prev) => prev + 1);
      } catch (e) {
        console.error("설정 적용 오류:", e);
        // 에러 발생 시에도 뷰어 다시 로드
        setReloadKey((prev) => prev + 1);
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
          showGraph &&
          !graphFullScreen && (
            <div
              className="h-full w-full flex items-center justify-center"
              style={{
                height: "100%",
                width: "100%",
                padding: 0,
                boxSizing: "border-box",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  justifyContent: "stretch",
                  overflow: "hidden",
                }}
              >
                {/* 상단바: < 버튼 + 챕터 드롭다운 + 독립 인물 버튼 */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    width: "100%",
                    height: 40,
                    marginBottom: 0,
                    gap: 0,
                    paddingLeft: 12,
                    paddingTop: 0,
                    justifyContent: "flex-start",
                  }}
                >
                  {/* < 전체화면 버튼 */}
                  <button
                    onClick={() => navigate(`/user/graph/${filename}`)}
                    style={{
                      height: 32,
                      width: 32,
                      minWidth: 32,
                      minHeight: 32,
                      borderRadius: "8px",
                      border: "1.5px solid #e3e6ef",
                      background: "#fff",
                      color: "#22336b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                      marginRight: 8,
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
                      transition:
                        "background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s",
                    }}
                    title="그래프 전체화면"
                  >
                    {"<"}
                  </button>
                  {/* 챕터 드롭다운, 초기화, 독립 인물 버튼 */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div className="chapter-dropdown-container">
                      <select
                        value={currentChapter}
                        onChange={(e) =>
                          setCurrentChapter(Number(e.target.value))
                        }
                        style={{
                          height: 32,
                          padding: "2px 8px",
                          borderRadius: 6,
                          border: "1px solid #bfc8e2",
                          fontSize: 14,
                          background: "#f4f7fb",
                          color: "#22336b",
                          fontWeight: 500,
                          outline: "none",
                          minWidth: 90,
                          maxWidth: 180,
                          cursor: "pointer",
                          lineHeight: "32px",
                        }}
                      >
                        {Array.from(
                          { length: maxChapter },
                          (_, i) => i + 1
                        ).map((chapter) => (
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
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 6,
                        border: "1px solid #bfc8e2",
                        background: "#f4f7fb",
                        color: "#4F6DDE",
                        fontSize: 18,
                        margin: "0 4px",
                        cursor: "pointer",
                        transition: "background 0.18s",
                        outline: "none",
                        boxShadow: "none",
                        padding: 0,
                      }}
                    >
                      <FaSyncAlt />
                    </button>
                    <button
                      onClick={() => setHideIsolated((v) => !v)}
                      style={{
                        height: 32,
                        padding: "2px 12px",
                        borderRadius: 6,
                        border: "1px solid #bfc8e2",
                        background: hideIsolated ? "#6C8EFF" : "#f4f7fb",
                        color: hideIsolated ? "#fff" : "#22336b",
                        fontWeight: 500,
                        fontSize: 14,
                        cursor: "pointer",
                        marginLeft: 6,
                        lineHeight: "28px",
                      }}
                    >
                      {hideIsolated ? "독립 인물 숨김" : "독립 인물 표시"}
                    </button>
                  </div>
                  {/* 오른쪽: 인물 검색 폼 */}
                  <div
                    style={{
                      minWidth: 120,
                      maxWidth: 320,
                      flex: 1,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <GraphControls
                      searchInput={searchInput}
                      setSearchInput={setSearchInput}
                      handleSearch={handleSearch}
                      handleReset={handleReset}
                      handleFitView={handleFitView}
                      search={search}
                      setSearch={setSearch}
                      inputStyle={{
                        height: 32,
                        fontSize: 14,
                        padding: "2px 8px",
                        borderRadius: 6,
                      }}
                      buttonStyle={{
                        height: 32,
                        fontSize: 14,
                        padding: "2px 10px",
                        borderRadius: 6,
                      }}
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
                  const eventWithEndGreaterThanCurrent = events.findIndex(
                    (event) => currentWordIndex < event.end
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
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 24,
                        width: "100%",
                        minHeight: 48,
                        background:
                          "linear-gradient(90deg, #f8fafc 60%, #e7edff 100%)",
                        borderBottom: "1.5px solid #e5e7eb",
                        margin: "8px 0 8px 0",
                        padding: "8px 0",
                        boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
                        borderRadius: 16,
                      }}
                    >
                      <button
                        onClick={handlePrev}
                        disabled={cur <= 0}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "50%",
                          border: "none",
                          background:
                            "linear-gradient(135deg, #6C8EFF 60%, #42a5f5 100%)",
                          color: "#fff",
                          fontSize: 24,
                          fontWeight: 700,
                          boxShadow: "0 2px 8px rgba(108,142,255,0.13)",
                          cursor: cur <= 0 ? "not-allowed" : "pointer",
                          opacity: cur <= 0 ? 0.5 : 1,
                          transition: "all 0.18s",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="이전 이벤트"
                      >
                        &#8592;
                      </button>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 18,
                          minWidth: 60,
                          transition: "transform 0.3s cubic-bezier(.4,2,.6,1)",
                        }}
                      >
                        {events.map((event, idx) => (
                          <div
                            key={idx}
                            onClick={async () => {
                              setCurrentWordIndex(event.start);
                              if (viewerRef.current?.moveToProgress) {
                                const progressValue = (event.start / 100) * 100;
                                try {
                                  await viewerRef.current.moveToProgress(
                                    progressValue
                                  );
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
                              borderRadius: "50%",
                              background:
                                idx === cur
                                  ? "linear-gradient(135deg, #6C8EFF 60%, #42a5f5 100%)"
                                  : "#e3e6ef",
                              boxShadow:
                                idx === cur
                                  ? "0 2px 8px rgba(108,142,255,0.18)"
                                  : "none",
                              border:
                                idx === cur
                                  ? "2.5px solid #6C8EFF"
                                  : "1.5px solid #e3e6ef",
                              transition: "all 0.28s cubic-bezier(.4,2,.6,1)",
                              margin: "0 2px",
                              cursor: "pointer",
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
                          borderRadius: "50%",
                          border: "none",
                          background:
                            "linear-gradient(135deg, #6C8EFF 60%, #42a5f5 100%)",
                          color: "#fff",
                          fontSize: 24,
                          fontWeight: 700,
                          boxShadow: "0 2px 8px rgba(108,142,255,0.13)",
                          cursor:
                            cur >= events.length - 1
                              ? "not-allowed"
                              : "pointer",
                          opacity: cur >= events.length - 1 ? 0.5 : 1,
                          transition: "all 0.18s",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="다음 이벤트"
                      >
                        &#8594;
                      </button>
                    </div>
                  );
                })()}
                {/* 그래프 본문 */}
                <div
                  style={{
                    flex: 1,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    marginTop: 8,
                  }}
                >
                  {loading && showGraph && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        textAlign: "center",
                        color: "#6C8EFF",
                        fontSize: 20,
                        fontWeight: 600,
                        zIndex: 10,
                        background: "rgba(255,255,255,0.85)",
                        padding: "32px 0",
                        borderRadius: 16,
                        boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 180,
                      }}
                    >
                      <span
                        className="graph-loading-spinner"
                        style={{
                          width: 40,
                          height: 40,
                          border: "4px solid #e3e6ef",
                          borderTop: "4px solid #6C8EFF",
                          borderRadius: "50%",
                          animation: "spin 1s linear infinite",
                          marginBottom: 16,
                          display: "inline-block",
                        }}
                      />
                      그래프 로딩 중...
                    </div>
                  )}
                  {!loading && !isDataReady && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        textAlign: "center",
                        color: "#6C8EFF",
                        fontSize: 20,
                        fontWeight: 600,
                        zIndex: 10,
                        background: "rgba(255,255,255,0.85)",
                        padding: "32px 0",
                        borderRadius: 16,
                        boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
                      }}
                    >
                      데이터를 준비하는 중...
                    </div>
                  )}
                  {!loading && isDataReady && elements.length === 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        textAlign: "center",
                        color: "#6C8EFF",
                        fontSize: 20,
                        fontWeight: 600,
                        zIndex: 10,
                        background: "rgba(255,255,255,0.85)",
                        padding: "32px 0",
                        borderRadius: 16,
                        boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
                      }}
                    >
                      표시할 데이터가 없습니다
                    </div>
                  )}
                  {!loading && isDataReady && elements.length > 0 && (
                    <RelationGraphMain
                      elements={elements}
                      inViewer={true}
                      fullScreen={false}
                      key={currentEvent?.path || `graph-${currentChapter}`}
                      style={{ width: "100%", height: "100%" }}
                      graphViewState={graphViewState}
                      setGraphViewState={setGraphViewState}
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
          onCurrentPageChange={setCurrentPage}
          onTotalPagesChange={setTotalPages}
          onCurrentChapterChange={setCurrentChapter}
          settings={settings}
          onCurrentLineChange={(wordIndex, totalWords, currentEvent) => {
            console.log(
              "[ViewerPage onCurrentLineChange] wordIndex:",
              wordIndex,
              "currentEvent:",
              currentEvent
            );
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
          <BookmarkPanel bookmarks={bookmarks} onSelect={handleBookmarkSelect}>
            {bookmarks.map((bm) => (
              <span
                key={bm.cfi}
                style={{
                  fontSize: "0.98rem",
                  color: "#4F6DDE",
                  fontFamily: "monospace",
                }}
              >
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
          {console.log(
            "전체화면 elements:",
            elements,
            "currentChapter:",
            currentChapter,
            "hideIsolated:",
            hideIsolated
          )}
          <div
            style={{
              width: "100vw",
              height: "100vh",
              background: "#f4f7fb",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              paddingTop: 0,
            }}
          >
            {/* 상단바: 챕터 파일탭, 인물 검색, 독립 인물 버튼, 닫기 버튼 */}
            <div
              style={{
                width: "100vw",
                height: 90, // 상단바 높이 고정
                background: "#fff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                borderBottom: "1px solid #e5e7eb",
                zIndex: 10001,
                display: "flex",
                flexDirection: "column",
                paddingTop: 0,
                paddingLeft: 0,
                paddingRight: 0,
              }}
              onWheel={(e) => e.preventDefault()}
            >
              {/* 첫 번째 행: 챕터 파일탭 + 독립 인물 버튼 + 닫기 버튼 */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingLeft: 12,
                  paddingTop: 0,
                  height: 36,
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-end",
                    gap: 0,
                    overflowX: "auto",
                    maxWidth: "90vw",
                    paddingBottom: 6,
                    scrollbarWidth: "thin",
                    scrollbarColor: "#bfc8e2 #f4f7fb",
                  }}
                >
                  {Array.from({ length: maxChapter }, (_, i) => i + 1).map(
                    (chapter) => (
                      <button
                        key={chapter}
                        onClick={() => setCurrentChapter(chapter)}
                        style={{
                          height: 45,
                          minWidth: 90,
                          padding: "0 15px",
                          borderTopLeftRadius: 12,
                          borderTopRightRadius: 12,
                          borderBottomLeftRadius: 0,
                          borderBottomRightRadius: 0,
                          borderTop:
                            currentChapter === chapter
                              ? "2.5px solid #6C8EFF"
                              : "1.5px solid #bfc8e2",
                          borderRight:
                            chapter === maxChapter
                              ? currentChapter === chapter
                                ? "2.5px solid #6C8EFF"
                                : "1.5px solid #bfc8e2"
                              : "none",
                          borderBottom:
                            currentChapter === chapter
                              ? "none"
                              : "1.5px solid #bfc8e2",
                          borderLeft:
                            chapter === 1
                              ? currentChapter === chapter
                                ? "2.5px solid #6C8EFF"
                                : "1.5px solid #bfc8e2"
                              : "none",
                          background:
                            currentChapter === chapter ? "#fff" : "#e7edff",
                          color:
                            currentChapter === chapter ? "#22336b" : "#6C8EFF",
                          fontWeight: currentChapter === chapter ? 700 : 500,
                          fontSize: 12,
                          cursor: "pointer",
                          marginRight: 10,
                          marginLeft: chapter === 1 ? 0 : 0,
                          marginBottom: currentChapter === chapter ? -2 : 0,
                          boxShadow:
                            currentChapter === chapter
                              ? "0 4px 16px rgba(108,142,255,0.10)"
                              : "none",
                          zIndex: currentChapter === chapter ? 2 : 1,
                          transition: "all 0.18s",
                          position: "relative",
                          outline: "none",
                        }}
                      >
                        {`Chapter ${chapter}`}
                      </button>
                    )
                  )}
                </div>
                <button
                  onClick={() => setHideIsolated((v) => !v)}
                  style={{
                    height: 32,
                    padding: "2px 12px",
                    borderRadius: 6,
                    border: "1px solid #bfc8e2",
                    background: hideIsolated ? "#6C8EFF" : "#f4f7fb",
                    color: hideIsolated ? "#fff" : "#22336b",
                    fontWeight: 500,
                    fontSize: 14,
                    cursor: "pointer",
                    marginLeft: 6,
                    lineHeight: "28px",
                  }}
                >
                  {hideIsolated ? "독립 인물 숨김" : "독립 인물 표시"}
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
                    border: "1.5px solid #e3e6ef",
                    background: "#fff",
                    color: "#22336b",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    marginRight: 32,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
                    transition:
                      "background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s",
                  }}
                  title="그래프 닫기"
                >
                  ×
                </button>
              </div>
              {/* 두 번째 행: 인물 검색 폼 */}
              <div
                style={{
                  width: "100%",
                  height: 54,
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  paddingLeft: 12,
                  paddingTop: 0,
                  paddingBottom: 0,
                  background: "#fff",
                }}
              >
                <GraphControls
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  handleSearch={handleSearch}
                  handleReset={handleReset}
                  handleFitView={handleFitView}
                  search={search}
                  setSearch={setSearch}
                  inputStyle={{
                    height: 32,
                    fontSize: 14,
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                  buttonStyle={{
                    height: 32,
                    fontSize: 14,
                    padding: "2px 10px",
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
            {/* 그래프 본문 */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                width: "100%",
                height: "100%",
                marginTop: 0,
                paddingTop: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                background: "#f8fafc",
              }}
            >
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
      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop
        closeOnClick
      />
    </div>
  );
};

export default ViewerPage;
