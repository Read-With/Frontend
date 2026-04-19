import React, { useCallback, useMemo } from 'react';
import GraphControls from '../graph/GraphControls';
import EdgeLabelToggle from '../graph/tooltip/EdgeLabelToggle';
import { getChapterData, getManifestFromCache } from '../../utils/common/cache/manifestCache';
import {
  formatChapterBadgeFromTitle,
  formatChapterColonLine,
  stripRedundantBookTitlePrefix,
} from '../../utils/viewer/chapterTitleDisplay';
import { GRAPH_CHARACTER_FILTER_STAGE_OPTIONS } from '../graph/graphConstants';
import {
  pickReadingEvent,
  resolveViewerGraphEventFromManifest,
} from '../../utils/viewer/eventDisplayUtils';

// 공통 스타일 상수들
const LOADING_STYLE = {
  display: "inline-block",
  padding: "4px 16px",
  borderRadius: 16,
  background: "#f3f4f6",
  color: "#9ca3af",
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid #e3e6ef",
};

const CHAPTER_STYLE = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 16,
  background: "#E8F5E8",
  color: "#5C6F5C",
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid #e3e6ef",
  maxWidth: "min(360px, 42vw)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const EVENT_NUMBER_STYLE = {
  display: "inline-block",
  padding: "4px 16px",
  borderRadius: 16,
  background: "#5C6F5C",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 2px 8px rgba(92,111,92,0.13)",
  transition: "transform 0.3s, background 0.3s",
};

const EVENT_NAME_STYLE = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 12,
  background: "#f8f9fc",
  color: "#5C6F5C",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid #e3e6ef",
  maxWidth: "200px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const PROGRESS_BAR_CONTAINER_STYLE = {
  width: 120,
  height: 6,
  background: "#e3e6ef",
  borderRadius: 3,
  overflow: "hidden",
};

const PROGRESS_BAR_FILL_STYLE = {
  height: "100%",
  background: "linear-gradient(90deg, #5C6F5C 0%, #6B7B6B 100%)",
  borderRadius: 3,
  transition: "width 0.4s cubic-bezier(.4,2,.6,1)",
};

const ViewerTopBar = ({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
}) => {

  const { filename, book } = viewerState;
  
  const {
    currentChapter,
    currentEvent,
    prevValidEvent,
    graphFullScreen,
    edgeLabelVisible,
    progressTopBar,
  } = graphState;
  
  const {
    setCurrentChapter,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage
  } = graphActions;

  
  const {
    searchTerm,
    isSearchActive,
    suggestions = [],
    showSuggestions = false,
    selectedIndex = -1
  } = searchState;
  
  const {
    onSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions,
    handleKeyDown
  } = searchActions;

  const bookId = useMemo(() => {
    const id = book?.id;
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [book]);

  const stripBookTitle = useMemo(() => {
    const fromBook = String(book?.title ?? '').trim();
    if (fromBook) return fromBook;
    const m = bookId != null ? getManifestFromCache(bookId) : null;
    return String(m?.book?.title ?? m?.title ?? '').trim();
  }, [book?.title, bookId]);

  const resolvedServerChapter = useMemo(() => {
    const serverChapter = getChapterData(bookId, currentChapter);
    if (serverChapter) {
      return Number(serverChapter.chapterIdx ?? serverChapter.idx ?? currentChapter);
    }
    return Number(currentChapter) || 1;
  }, [bookId, currentChapter]);

  const chapterDisplayLabel = useMemo(() => {
    const idxStr = String(resolvedServerChapter ?? '').trim() || '—';
    if (!bookId) {
      return formatChapterColonLine(idxStr);
    }
    const ch = getChapterData(bookId, resolvedServerChapter);
    const t = String(ch?.title ?? '').trim();
    const tForBadge = t ? stripRedundantBookTitlePrefix(t, stripBookTitle) : '';
    const part = tForBadge ? formatChapterBadgeFromTitle(tForBadge) : idxStr;
    return formatChapterColonLine(part);
  }, [bookId, resolvedServerChapter, stripBookTitle]);

  const chapterTitleTooltip = useMemo(() => {
    if (!bookId) return undefined;
    const t = String(getChapterData(bookId, resolvedServerChapter)?.title ?? '').trim();
    return t || undefined;
  }, [bookId, resolvedServerChapter]);

  const currentProgressWidth = useMemo(() => {
    if (progressTopBar === undefined) return "0%";
    const cp = progressTopBar.chapterProgress;
    if (cp != null && Number.isFinite(cp)) {
      return `${Math.min(100, Math.max(0, Math.round(cp * 100) / 100))}%`;
    }
    const rp = progressTopBar.readingProgressPercent;
    if (rp != null && Number.isFinite(rp)) {
      return `${Math.min(100, Math.max(0, Math.round(rp * 100) / 100))}%`;
    }
    return "0%";
  }, [progressTopBar]);

  React.useEffect(() => {
    const handleChapterChange = (event) => {
      if (event.detail && event.detail.chapter !== currentChapter) {
        setCurrentChapter(event.detail.chapter);
      }
    };
    
    window.addEventListener('chapterChange', handleChapterChange);
    
    return () => {
      window.removeEventListener('chapterChange', handleChapterChange);
    };
  }, [currentChapter, setCurrentChapter]);
  
  // 제안 생성을 위한 별도 함수 (실제 검색은 실행하지 않음)
  const handleGenerateSuggestions = useCallback((searchTerm) => {
    // onGenerateSuggestions prop을 사용하여 제안 생성
    if (onGenerateSuggestions) {
      onGenerateSuggestions(searchTerm);
    }
  }, [onGenerateSuggestions]);

  const ChapterEventInfo = useMemo(() => {
    if (progressTopBar === undefined && bookId) {
      return (
        <span style={LOADING_STYLE}>
          로딩중...
        </span>
      );
    }

    const row = progressTopBar ?? {
      eventNum: null,
      chapterProgress: null,
      readingProgressPercent: null,
      eventName: "",
    };

    const reading = pickReadingEvent(currentEvent, prevValidEvent);
    const panel =
      bookId != null
        ? resolveViewerGraphEventFromManifest(reading, bookId)
        : { title: '', eventNum: 0, eventId: '' };
    const eventDisplay = panel.eventNum > 0 ? String(panel.eventNum) : "—";
    const eventTitle = panel.eventId || undefined;
    const eventNameLabel = panel.title || "";

    return (
      <>
        <span style={CHAPTER_STYLE} title={chapterTitleTooltip}>
          {chapterDisplayLabel}
        </span>

        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={EVENT_NUMBER_STYLE} title={eventTitle}>
            Event {eventDisplay}
          </span>

          {eventNameLabel ? (
            <span style={EVENT_NAME_STYLE} title={eventNameLabel}>
              {eventNameLabel}
            </span>
          ) : null}

          <div style={PROGRESS_BAR_CONTAINER_STYLE}>
            <div
              style={{
                ...PROGRESS_BAR_FILL_STYLE,
                width: currentProgressWidth,
              }}
            />
          </div>
        </div>
      </>
    );
  }, [
    progressTopBar,
    bookId,
    chapterDisplayLabel,
    chapterTitleTooltip,
    currentProgressWidth,
    currentEvent,
    prevValidEvent,
  ]);

  const renderGraphControls = useCallback(() => (
    <GraphControls
      onSearchSubmit={onSearchSubmit}
      onGenerateSuggestions={handleGenerateSuggestions}
      searchTerm={searchTerm}
      isSearchActive={isSearchActive}
      onClearSearch={clearSearch}
      onCloseSuggestions={closeSuggestions}
      suggestions={suggestions}
      showSuggestions={showSuggestions}
      selectedIndex={selectedIndex}
      onKeyDown={handleKeyDown}
    />
  ), [onSearchSubmit, handleGenerateSuggestions, searchTerm, isSearchActive, clearSearch, closeSuggestions, suggestions, showSuggestions, selectedIndex, handleKeyDown]);

  const renderToggleButtons = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginRight: 24,
      }}
    >
      <EdgeLabelToggle
        visible={edgeLabelVisible}
        onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
      />
      
      {/* 3단계 필터링 드롭다운 */}
      <select
        value={filterStage}
        onChange={(e) => setFilterStage(Number(e.target.value))}
        style={{
          height: 32,
          padding: '0 12px',
          borderRadius: 8,
          border: `1px solid ${filterStage > 0 ? '#5C6F5C' : '#e5e7eb'}`,
          background: filterStage > 0 ? '#5C6F5C' : '#fff',
          color: filterStage > 0 ? '#fff' : '#5C6F5C',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: filterStage > 0 ? '0 2px 8px rgba(92,111,92,0.25)' : '0 2px 8px rgba(0,0,0,0.1)',
          justifyContent: 'center',
          minWidth: 120,
        }}
        title="필터링 단계 선택"
      >
        {GRAPH_CHARACTER_FILTER_STAGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ color: '#5C6F5C', background: '#fff' }}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
  
  return (
    <>
      {/* 상단바 1: 전체화면 모드일 때 모든 기능이 통합된 상단바 */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          width: "100%",
          marginBottom: 0,
          gap: 0,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 0,
          justifyContent: "space-between", // space-between 유지
          borderBottom: graphFullScreen ? "1px solid #e3e6ef" : "none", // 전체화면일 때만 하단 테두리
        }}
      >
        {/* 왼쪽 영역: < 버튼 + 초기화 (분할화면일 때) */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginRight: 36,
          }}
        >
          {/* < 전체화면 버튼 */}
          <button
            onClick={() => {
              if (graphFullScreen) {
                // 그래프 전체화면 -> 분할 화면으로 전환
                graphActions.setGraphFullScreen(false);
              } else {
                // 분할 화면 -> 그래프 전체화면으로 전환
                graphActions.setGraphFullScreen(true);
              }
            }}
            style={{
              height: 28,
              width: 28,
              minWidth: 28,
              minHeight: 28,
              borderRadius: "6px",
              border: "1.5px solid #e3e6ef",
              background: "#fff",
              color: "#22336b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(108,142,255,0.07)",
              transition:
                "background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s",
            }}
            title={graphFullScreen ? "분할 화면으로 전환" : "그래프 전체화면으로 전환"}
          >
            {graphFullScreen ? ">" : "<"}
          </button>

          {/* 인물 검색 기능 */}
          {renderGraphControls()}
        </div>

        {/* 중앙 영역: 챕터 + 이벤트 정보 (전체화면일 때만) */}
        {graphFullScreen && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
            }}
          >
            {ChapterEventInfo}
          </div>
        )}

        {/* 오른쪽 영역: 토글 버튼 */}
        {renderToggleButtons()}
      </div>
      
      {/* 상단바 2: 챕터 + 이벤트 정보 (분할화면일 때만) */}
      {!graphFullScreen && (
        <div
          style={{
            height: 44,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            width: "100%",
            marginBottom: 0,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 0,
            justifyContent: "center",
            borderTop: "1px solid #e3e6ef",
            borderBottom: "1px solid #e3e6ef",
          }}
        >
          {ChapterEventInfo}
        </div>
      )}
    </>
  );
};

export default ViewerTopBar;
