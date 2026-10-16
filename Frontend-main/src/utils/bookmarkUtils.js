/** 북마크 표시·locator·색상 팔레트 (API 호출 없음) */

import { toPositiveNumberOrNull, sleep, compareLocale } from './common/valueUtils';
import { toLocator, locatorsEqual, toViewerResumeAnchor } from './common/locator';
import { getChapterData } from './common/cache/manifestCache';
import { locatorToBookAbsoluteOffset, resolveProgressMetricsFromLocator } from './common/readingProgress';
import { normalizeStartEndLocatorsForServer } from './common/cache/progressCache';
import { GRAPH_COLORS } from './graph/graphStyles';
import { formatChapterOrdinalLabel } from './common/chapterLabel';

/** 북마크 → 뷰어 resumeAnchor (진도 preferred resume와 동일 헬퍼) */
export const bookmarkToResumeAnchor = (bookmark) =>
  toViewerResumeAnchor({
    startLocator: bookmark?.startLocator,
    endLocator: bookmark?.endLocator,
  });

/** 북마크 추가 전: 해당 챕터 paragraphStarts가 있어야 서버 offset 검증을 통과함 */
const isBookmarkAxisReady = (bookId, locator) => {
  const loc = toLocator(locator);
  const id = toPositiveNumberOrNull(bookId) ?? bookId;
  if (!loc || id == null || id === '') return false;
  const chapter = getChapterData(id, loc.chapterIndex);
  return Array.isArray(chapter?.paragraphStarts) && chapter.paragraphStarts.length > 0;
};

/** 매니페스트 축이 늦게 뜨는 경우 짧게 대기 */
export const waitForBookmarkAxisReady = async (
  bookId,
  locator,
  { timeoutMs = 2000, intervalMs = 100 } = {}
) => {
  if (isBookmarkAxisReady(bookId, locator)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    if (isBookmarkAxisReady(bookId, locator)) return true;
  }
  return isBookmarkAxisReady(bookId, locator);
};

const isBookmarkRange = (bookmark, startLoc, endLoc) =>
  !!(
    bookmark?.rangeBookmark ||
    (endLoc && startLoc && !locatorsEqual(startLoc, endLoc))
  );

/** 진도 메트릭과 동일한 축으로 위치 라벨 생성 */
export const parseBookmarkLocation = (bookmark, bookId = null) => {
  if (!bookmark) return '';
  const loc = toLocator(bookmark.startLocator);
  if (!loc) {
    const off = Number(bookmark.startTxtOffset);
    if (!Number.isFinite(off)) return '';
    const isRange =
      bookmark.rangeBookmark ||
      (Number(bookmark.endTxtOffset) > 0 && Number(bookmark.endTxtOffset) !== off);
    return isRange ? `문서 오프셋 ${off} · 범위` : `문서 오프셋 ${off}`;
  }

  const end = toLocator(bookmark.endLocator);
  const metrics = resolveProgressMetricsFromLocator(bookId, loc); // bookId 없으면 null

  let base;
  if (metrics?.chapterProgress != null) {
    base = `${loc.chapterIndex}챕터 · ${metrics.chapterProgress}%`;
  } else {
    base = `${loc.chapterIndex}챕터 · 블록 ${loc.blockIndex}`;
  }
  return isBookmarkRange(bookmark, loc, end) ? `${base} · 범위` : base;
};

export const formatBookmarkLocatorDetail = (bookmark, bookId = null) => {
  const loc = toLocator(bookmark?.startLocator);
  if (!loc) return '';
  const metrics = resolveProgressMetricsFromLocator(bookId, loc); // bookId 없으면 null
  if (metrics?.readingProgressPercent != null && metrics?.chapterProgress != null) {
    return `전체 ${metrics.readingProgressPercent}% · 챕터 ${metrics.chapterProgress}%`;
  }
  return `${formatChapterOrdinalLabel(loc.chapterIndex)} · 블록 ${loc.blockIndex} · 오프셋 ${loc.offset}`;
};

const locatorKey = (loc) => `${loc.chapterIndex}:${loc.blockIndex}:${loc.offset}`;

/**
 * 위치 동일성 비교용 키 (start·end locator, end가 없으면 start). 위치를 해석할 수 없으면 null.
 * 목록 전체와 비교할 때 키 Set을 만들어 두면 위치마다 O(1)
 */
export const bookmarkPositionKey = (bookmark) => {
  const start = toLocator(bookmark?.startLocator);
  if (!start) return null;
  return `${locatorKey(start)}|${locatorKey(toLocator(bookmark.endLocator) ?? start)}`;
};

export const isSameBookmarkPosition = (bookmark, ref) => {
  const key = bookmarkPositionKey(bookmark);
  return key != null && key === bookmarkPositionKey(ref);
};

/** 진도 absolute offset 기준으로 정렬 키 */
function getBookmarkPositionSortKey(bookmark, bookId = null) {
  if (!bookmark) return '';
  const loc = toLocator(bookmark.startLocator);
  if (loc && bookId != null && bookId !== '') {
    const abs = locatorToBookAbsoluteOffset(bookId, loc);
    if (abs != null) return `a_${String(abs).padStart(12, '0')}`;
  }
  if (loc) {
    return `${String(loc.chapterIndex).padStart(6, '0')}_${String(loc.blockIndex).padStart(6, '0')}_${String(loc.offset).padStart(8, '0')}`;
  }
  const o = Number(bookmark.startTxtOffset);
  return Number.isFinite(o) ? `o_${String(o).padStart(12, '0')}` : '';
}

const getCreatedTs = (bookmark) => {
  const raw = bookmark?.createdAt || bookmark?.created_at;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** 정렬 키를 북마크마다 한 번만 계산 (비교마다 locator·날짜 재해석 → O(N log N)회 → O(N)회) */
const sortByKey = (items, getKey, compare) =>
  items
    .map((item) => ({ item, key: getKey(item) }))
    .sort((a, b) => compare(a.key, b.key))
    .map(({ item }) => item);

const sortBookmarks = (bookmarks, sortOrder, bookId = null) => {
  if (!bookmarks?.length) return [];
  if (sortOrder === 'position') {
    return sortByKey(bookmarks, (b) => getBookmarkPositionSortKey(b, bookId), compareLocale);
  }
  if (sortOrder === 'oldest') return sortByKey(bookmarks, getCreatedTs, (a, b) => a - b);
  if (sortOrder === 'recent') return sortByKey(bookmarks, getCreatedTs, (a, b) => b - a);
  return bookmarks;
};

const getBookmarkChapterIndex = (bookmark) => {
  const loc = toLocator(bookmark?.startLocator);
  return loc?.chapterIndex ?? null;
};

/**
 * 챕터별 그룹. position → 챕터 오름차순·그룹 내 위치순.
 * recent/oldest → 그룹을 챕터 내 최신/최오래된 시각 기준 정렬, 그룹 내 시간순.
 */
export const groupBookmarksByChapter = (bookmarks, sortOrder = 'recent', bookId = null) => {
  if (!bookmarks?.length) return [];

  const sorted = sortBookmarks(bookmarks, sortOrder, bookId);
  const map = new Map();

  for (const bookmark of sorted) {
    const chapterIndex = getBookmarkChapterIndex(bookmark);
    const key = chapterIndex == null ? 'unknown' : String(chapterIndex);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        chapterIndex,
        title: bookmark.chapterTitle || null,
        label: chapterIndex == null ? '위치 미상' : formatChapterOrdinalLabel(chapterIndex),
        items: [],
      };
      map.set(key, group);
    } else if (!group.title && bookmark.chapterTitle) {
      group.title = bookmark.chapterTitle;
    }
    group.items.push(bookmark);
  }

  const groups = [...map.values()];

  if (sortOrder === 'position') {
    groups.sort((a, b) => {
      if (a.chapterIndex == null) return 1;
      if (b.chapterIndex == null) return -1;
      return a.chapterIndex - b.chapterIndex;
    });
  } else {
    // 그룹 대표 시각(최오래된/최신)은 그룹당 한 번만 계산 (비교마다 items 전체를 다시 훑지 않음)
    const pickTs = sortOrder === 'oldest' ? Math.min : Math.max;
    const groupTs = new Map(groups.map((group) => [group, pickTs(...group.items.map(getCreatedTs))]));
    groups.sort((a, b) =>
      sortOrder === 'oldest' ? groupTs.get(a) - groupTs.get(b) : groupTs.get(b) - groupTs.get(a)
    );
  }

  return groups;
};

const bookmarkColors = {
  normal: '#f4f7ff',
  important: '#fff3c2',
  highlight: '#e0e7ff',
};

export const bookmarkBorders = {
  normal: '#e7eaf7',
  important: '#ffd600',
  highlight: GRAPH_COLORS.primary,
};

const DEFAULT_BOOKMARK_COLOR = bookmarkColors.normal;

export const colorOptions = [
  { key: 'normal', label: '기본', color: bookmarkColors.normal, border: bookmarkBorders.normal },
  { key: 'important', label: '중요', color: bookmarkColors.important, border: bookmarkBorders.important },
  { key: 'highlight', label: '강조', color: bookmarkColors.highlight, border: bookmarkBorders.highlight },
];

const normalizeBookmarkColor = (color) => {
  if (typeof color !== 'string') return DEFAULT_BOOKMARK_COLOR;
  const trimmed = color.trim().toLowerCase();
  return trimmed || DEFAULT_BOOKMARK_COLOR;
};

export const getColorKey = (color) => {
  const normalized = normalizeBookmarkColor(color);
  return (
    colorOptions.find((option) => option.color.toLowerCase() === normalized)?.key ?? 'normal'
  );
};

export const createBookmarkData = (bookId, startLocator, endLocator = null) => {
  const { startLocator: start, endLocator: end } = normalizeStartEndLocatorsForServer(
    bookId,
    startLocator,
    endLocator
  );
  const data = { bookId, color: DEFAULT_BOOKMARK_COLOR, memo: '' };
  if (start) data.startLocator = start;
  if (end) data.endLocator = end;
  return data;
};
