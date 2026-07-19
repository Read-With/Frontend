import { useMemo, memo } from 'react';
import GraphControls, { EdgeLabelToggle, CharacterFilterSegmented } from '../graph/GraphControls';
import { getChapterData, getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { resolveChapterIndex, toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import {
  formatChapterOrderAndName,
  stripRedundantBookTitlePrefix,
} from '../../utils/viewer/viewerCoreStateUtils';
import { resolveEventOrdinalForDisplay } from '../../utils/viewer/viewerEventProgressUtils';

const LOADING_STYLE = {
  display: 'inline-block',
  padding: '4px 16px',
  borderRadius: 16,
  background: '#f3f4f6',
  color: '#9ca3af',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid #e3e6ef',
};

const CHAPTER_STYLE = {
  display: 'inline-block',
  padding: '4px 12px',
  borderRadius: 16,
  background: '#E8F5E8',
  color: '#5C6F5C',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid #e3e6ef',
  maxWidth: 'min(360px, 42vw)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const EVENT_NUMBER_STYLE = {
  display: 'inline-block',
  padding: '4px 16px',
  borderRadius: 16,
  background: '#5C6F5C',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  boxShadow: '0 2px 8px rgba(92,111,92,0.13)',
  transition: 'transform 0.3s, background 0.3s',
};

const PROGRESS_BAR_CONTAINER_STYLE = {
  width: 120,
  height: 6,
  background: '#e3e6ef',
  borderRadius: 3,
  overflow: 'hidden',
};

const PROGRESS_BAR_FILL_STYLE = {
  height: '100%',
  background: 'linear-gradient(90deg, #5C6F5C 0%, #6B7B6B 100%)',
  borderRadius: 3,
  transition: 'width 0.4s cubic-bezier(.4,2,.6,1)',
};

const BAR_BASE_STYLE = {
  height: 44,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  width: '100%',
  marginBottom: 0,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 0,
};

const ROW_STYLE = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
};

const FULLSCREEN_BTN_STYLE = {
  height: 28,
  width: 28,
  minWidth: 28,
  minHeight: 28,
  borderRadius: '6px',
  border: '1.5px solid #e3e6ef',
  background: '#fff',
  color: '#22336b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(108,142,255,0.07)',
  transition: 'background 0.18s, color 0.18s, box-shadow 0.18s, transform 0.13s',
};

function ChapterEventInfo({
  bookId,
  isProgressPending,
  progressTopBar,
  currentEvent,
  prevValidEvent,
  resolvedServerChapter,
  chapterDisplayLabel,
  chapterTitleTooltip,
  currentProgressWidth,
}) {
  if ((progressTopBar === undefined || isProgressPending) && bookId) {
    return <span style={LOADING_STYLE}>계산중...</span>;
  }

  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter: resolvedServerChapter,
    progressTopBar: progressTopBar ?? { eventNum: null },
    fallback: 0,
  });
  const eventDisplay = eventNum > 0 ? String(eventNum) : '?';

  return (
    <>
      <span style={CHAPTER_STYLE} title={chapterTitleTooltip}>
        {chapterDisplayLabel}
      </span>
      <div style={{ ...ROW_STYLE, gap: 12 }}>
        <span style={EVENT_NUMBER_STYLE}>Event {eventDisplay}</span>
        <div style={PROGRESS_BAR_CONTAINER_STYLE}>
          <div style={{ ...PROGRESS_BAR_FILL_STYLE, width: currentProgressWidth }} />
        </div>
      </div>
    </>
  );
}

const ViewerTopBar = memo(function ViewerTopBar({
  graphState,
  graphActions,
  viewerState,
  searchState,
  searchActions,
}) {
  const { book } = viewerState;

  const {
    currentChapter,
    currentEvent,
    prevValidEvent,
    graphFullScreen,
    edgeLabelVisible,
    progressTopBar,
    progressMetricsReady = true,
  } = graphState;

  const {
    setGraphFullScreen,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
  } = graphActions;

  const {
    searchTerm,
    isSearchActive,
    suggestions = [],
    showSuggestions = false,
    selectedIndex = -1,
  } = searchState;

  const {
    onSearchSubmit,
    clearSearch,
    closeSuggestions,
    onGenerateSuggestions,
    handleKeyDown,
    onSelectedIndexChange,
  } = searchActions;

  const bookId = useMemo(() => toPositiveNumberOrNull(book?.id), [book?.id]);

  const stripBookTitle = useMemo(() => {
    const fromBook = String(book?.title ?? '').trim();
    if (fromBook) return fromBook;
    const m = bookId != null ? getManifestFromCache(bookId) : null;
    return String(m?.book?.title ?? m?.title ?? '').trim();
  }, [book?.title, bookId]);

  const chapterMeta = useMemo(() => {
    const fallbackChapter = Number(currentChapter) || 1;
    if (bookId == null) {
      return {
        resolvedServerChapter: fallbackChapter,
        chapterDisplayLabel: formatChapterOrderAndName(fallbackChapter, ''),
        chapterTitleTooltip: undefined,
      };
    }

    const byCurrent = getChapterData(bookId, currentChapter);
    const resolvedFromData = byCurrent ? resolveChapterIndex(byCurrent) : null;
    const resolvedServerChapter = resolvedFromData ?? fallbackChapter;
    const ch =
      byCurrent && (resolvedFromData == null || resolvedFromData === Number(currentChapter))
        ? byCurrent
        : getChapterData(bookId, resolvedServerChapter);

    const rawTitle = String(ch?.title ?? '').trim();
    const displayName = rawTitle ? stripRedundantBookTitlePrefix(rawTitle, stripBookTitle) : '';

    return {
      resolvedServerChapter,
      chapterDisplayLabel: formatChapterOrderAndName(resolvedServerChapter, displayName),
      chapterTitleTooltip: rawTitle || undefined,
    };
  }, [bookId, currentChapter, stripBookTitle]);

  const isProgressPending =
    Boolean(bookId) &&
    !progressMetricsReady &&
    (progressTopBar?.readingProgressPercent == null ||
      !Number.isFinite(Number(progressTopBar?.readingProgressPercent)));

  const currentProgressWidth = useMemo(() => {
    if (progressTopBar === undefined || isProgressPending) return '0%';
    const rp = progressTopBar.readingProgressPercent;
    if (rp != null && Number.isFinite(rp)) {
      return `${Math.min(100, Math.max(0, Math.round(rp * 100) / 100))}%`;
    }
    return '0%';
  }, [progressTopBar, isProgressPending]);

  const fullscreenLabel = graphFullScreen
    ? '분할 화면으로 전환'
    : '그래프 전체화면으로 전환';

  const chapterEventInfo = (
    <ChapterEventInfo
      bookId={bookId}
      isProgressPending={isProgressPending}
      progressTopBar={progressTopBar}
      currentEvent={currentEvent}
      prevValidEvent={prevValidEvent}
      resolvedServerChapter={chapterMeta.resolvedServerChapter}
      chapterDisplayLabel={chapterMeta.chapterDisplayLabel}
      chapterTitleTooltip={chapterMeta.chapterTitleTooltip}
      currentProgressWidth={currentProgressWidth}
    />
  );

  return (
    <>
      <div
        style={{
          ...BAR_BASE_STYLE,
          gap: 0,
          justifyContent: 'space-between',
          borderBottom: graphFullScreen ? '1px solid #e3e6ef' : 'none',
        }}
      >
        <div style={{ ...ROW_STYLE, gap: 12, marginRight: 36 }}>
          <button
            type="button"
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            onClick={() => setGraphFullScreen(!graphFullScreen)}
            style={FULLSCREEN_BTN_STYLE}
          >
            {graphFullScreen ? '>' : '<'}
          </button>

          <GraphControls
            onSearchSubmit={onSearchSubmit}
            onGenerateSuggestions={onGenerateSuggestions}
            searchTerm={searchTerm}
            isSearchActive={isSearchActive}
            onClearSearch={clearSearch}
            onCloseSuggestions={closeSuggestions}
            suggestions={suggestions}
            showSuggestions={showSuggestions}
            selectedIndex={selectedIndex}
            onSelectedIndexChange={onSelectedIndexChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        {graphFullScreen && (
          <div style={{ ...ROW_STYLE, gap: 16 }}>{chapterEventInfo}</div>
        )}

        <div style={{ ...ROW_STYLE, gap: 12, marginRight: 24 }}>
          <EdgeLabelToggle
            visible={edgeLabelVisible}
            onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
          />
          <CharacterFilterSegmented value={filterStage} onChange={setFilterStage} />
        </div>
      </div>

      {!graphFullScreen && (
        <div
          style={{
            ...BAR_BASE_STYLE,
            justifyContent: 'center',
            borderTop: '1px solid #e3e6ef',
            borderBottom: '1px solid #e3e6ef',
          }}
        >
          {chapterEventInfo}
        </div>
      )}
    </>
  );
});

export default ViewerTopBar;
