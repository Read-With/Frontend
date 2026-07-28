/** 뷰어 세션: 이벤트 매칭·진도·TopBar·저장 payload·런타임(UI/ref)·뷰어 설정 */

import { toast } from 'react-toastify';
import { errorUtils } from '../common/urlUtils';
import { storageUtils } from '../common/cache/cacheManager';
import {
  toLocator,
  progressResultToViewerAnchor,
  locatorsEqual,
  resolveProgressLocator,
  toViewerResumeAnchor,
  anchorToLocators,
  clampPercent,
  resolveChapterIndex,
  toPositiveNumberOrNull,
} from '../common/valueUtils';
import {
  findManifestEventInChapter,
  getLastManifestEventInChapter,
  resolveLocatorToEventParams as resolveManifestLocatorToEventParams,
  resolveProgressMetricsFromLocator,
  readingProgressPercentFromLocator,
} from '../common/cache/manifestCache';
import { getProgressFromCache } from '../common/cache/progressCache';
import { eventUtils, resolveServerBookId } from './viewerCore';

export const VIEWER_MODE_OPTIONS = [
  { showGraph: true, icon: 'view_sidebar', label: '단일 뷰어 & 그래프' },
  { showGraph: false, icon: 'article', label: '단일 뷰어' },
];

/** UI 미노출 필드 포함. XhtmlViewer 본문 기본값으로 사용·저장 */
export const defaultSettings = {
  fontSize: 100,
  lineHeight: 1.5,
  margin: 20,
  fontFamily: 'Noto Serif KR',
  showGraph: true,
};

export const SETTINGS_STORAGE_KEY = 'xhtml_viewer_settings';

const SETTINGS_KEYS = Object.keys(defaultSettings);

function toFiniteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSettings(settings = {}) {
  const merged = { ...defaultSettings, ...settings };
  return {
    fontSize: toFiniteOr(merged.fontSize, defaultSettings.fontSize),
    lineHeight: toFiniteOr(merged.lineHeight, defaultSettings.lineHeight),
    margin: toFiniteOr(merged.margin, defaultSettings.margin),
    fontFamily:
      typeof merged.fontFamily === 'string' && merged.fontFamily.trim()
        ? merged.fontFamily
        : defaultSettings.fontFamily,
    showGraph: Boolean(merged.showGraph),
  };
}

function needsSettingsPersist(raw, normalized) {
  if (!raw || typeof raw !== 'object' || 'pageMode' in raw) return true;
  return SETTINGS_KEYS.some((key) => raw[key] !== normalized[key]);
}

export function findViewerModeOption(showGraph) {
  return (
    VIEWER_MODE_OPTIONS.find((opt) => opt.showGraph === Boolean(showGraph)) ??
    VIEWER_MODE_OPTIONS[1]
  );
}

export function loadSettings() {
  try {
    const raw = storageUtils.getJson(SETTINGS_STORAGE_KEY, defaultSettings);
    const loaded = normalizeSettings(raw);
    if (needsSettingsPersist(raw, loaded)) {
      storageUtils.setJson(SETTINGS_STORAGE_KEY, loaded);
    }
    return loaded;
  } catch (error) {
    return errorUtils.handleError('loadSettings', error, defaultSettings, {
      settings: storageUtils.get(SETTINGS_STORAGE_KEY),
    });
  }
}

export function saveSettings(settings) {
  try {
    storageUtils.setJson(SETTINGS_STORAGE_KEY, normalizeSettings(settings));
    return { success: true };
  } catch (error) {
    errorUtils.logError('saveSettings', error, { settings });
    return { success: false, message: '설정 저장 중 오류가 발생했습니다.' };
  }
}

function progressPercentFromData(data, options, pickValue) {
  if (!data || typeof data !== 'object') return null;
  const bookId = options.bookId ?? data.bookId;
  const locator = resolveProgressLocator(data);
  if (bookId == null || !locator) return null;
  const value = pickValue(bookId, locator);
  return value != null ? clampPercent(value) : null;
}

function chapterIdxOf(source) {
  return toPositiveNumberOrNull(eventUtils.resolveChapterIdx(source));
}

function positiveEventNum(source) {
  return toPositiveNumberOrNull(eventUtils.resolveEventNum(source));
}

export function resolveProgressEventName(source) {
  if (!source || typeof source !== 'object') return '';
  const name =
    source.eventName ??
    source.eventTitle ??
    source.eventLabel ??
    source.name ??
    source.event_name ??
    source.event?.name ??
    source.event?.title ??
    source.title;
  return typeof name === 'string' ? name.trim() : '';
}

// --- 이벤트 매칭·manifest ---

export function eventMatchesChapter(event, chapter) {
  if (!event || typeof event !== 'object') return false;
  const eventChapter = Number(eventUtils.resolveChapterIdx(event));
  const currentChapter = Number(chapter);
  return !Number.isFinite(eventChapter) || eventChapter === currentChapter;
}

function pickReadingEventForChapter(currentEvent, prevValidEvent, currentChapter) {
  if (currentChapter == null) return currentEvent || prevValidEvent || null;
  if (eventMatchesChapter(currentEvent, currentChapter)) return currentEvent;
  if (eventMatchesChapter(prevValidEvent, currentChapter)) return prevValidEvent;
  return null;
}

export function resolveEventOrdinalForDisplay({
  currentEvent,
  prevValidEvent,
  currentChapter = null,
  progressTopBar,
  fallback = 0,
}) {
  const fromReading = eventUtils.resolveEventNum(
    pickReadingEventForChapter(currentEvent, prevValidEvent, currentChapter)
  );
  if (fromReading > 0) return fromReading;

  if (currentChapter == null || eventMatchesChapter(progressTopBar, currentChapter)) {
    const fromProgress = toPositiveNumberOrNull(progressTopBar?.eventNum);
    if (fromProgress) return fromProgress;
  }

  return toPositiveNumberOrNull(fallback) ?? 0;
}

export function getUnifiedEventInfoForTooltip({ currentEvent, prevValidEvent, eventNum }) {
  const eventToShow = currentEvent || prevValidEvent;
  if (!eventToShow) return { eventNum: eventNum || 0 };
  return {
    eventNum: eventUtils.resolveEventNum(eventToShow),
    name: resolveProgressEventName(eventToShow),
  };
}

function pickEventIdentityPayload(event) {
  if (!event || typeof event !== 'object') return null;
  const inner = event.event;
  const hasIdentity = (obj) => obj.eventId != null || obj.eventNum != null;
  const hasChapter = (obj) => obj.chapterIdx != null || obj.chapter != null;

  if (inner && typeof inner === 'object' && (hasChapter(inner) || hasIdentity(inner))) {
    return inner;
  }
  if (eventUtils.resolveChapterIdx(event) != null && hasIdentity(event)) {
    return event;
  }
  return null;
}

function resolveManifestEventMatch(event, bookId) {
  const identity = pickEventIdentityPayload(event);
  const eventId = eventUtils.resolveEventId(identity);
  const chapterIdx = chapterIdxOf(identity) ?? chapterIdxOf(event);
  const normalizedEventId = eventId == null ? '' : String(eventId).trim();
  const normalizedBookId = toPositiveNumberOrNull(bookId);
  if (!normalizedBookId || !chapterIdx || !normalizedEventId) {
    return { eventNum: 0, chapterIdx: chapterIdx ?? 0, manifestEvent: null };
  }

  const manifestEvent = findManifestEventInChapter(normalizedBookId, chapterIdx, {
    eventId: normalizedEventId,
  });
  return {
    eventNum: eventUtils.resolveEventNum(manifestEvent),
    chapterIdx,
    manifestEvent,
  };
}

function eventMatchResult({ bookId, chapterIdx, eventIdx, atLocator, source, manifestEvent }) {
  return {
    bookId,
    chapterIdx,
    eventIdx,
    atLocator,
    source,
    ...(manifestEvent ? { manifestEvent } : {}),
  };
}

export function resolveServerEventMatch({
  book,
  fallbackBookId = null,
  currentChapter = null,
  event,
  atLocator = null,
}) {
  const bookId = resolveServerBookId(book) ?? toPositiveNumberOrNull(fallbackBookId);
  const anchorLocators = anchorToLocators(event?.anchor);
  const locator = toLocator(atLocator) ?? anchorLocators.startLocator;
  const endLocator = atLocator ? locator : anchorLocators.endLocator;
  const rawEventIdx = positiveEventNum(event);
  const rawChapter = chapterIdxOf(event) ?? toPositiveNumberOrNull(currentChapter);
  const locatorChapter = toPositiveNumberOrNull(resolveChapterIndex(locator));
  const endChapter = toPositiveNumberOrNull(resolveChapterIndex(endLocator));
  const spansFromPreviousChapter =
    locatorChapter != null &&
    ((rawChapter != null && locatorChapter < rawChapter) ||
      (endChapter != null && locatorChapter < endChapter));

  const fallbackMatch = () =>
    eventMatchResult({
      bookId: bookId ?? null,
      chapterIdx: locatorChapter ?? rawChapter,
      eventIdx: rawEventIdx,
      atLocator: locator,
      source: rawEventIdx ? 'event' : 'none',
    });

  if (!bookId) return fallbackMatch();

  if (spansFromPreviousChapter) {
    const boundaryLastEvent = getLastManifestEventInChapter(bookId, locatorChapter);
    const boundaryLastEventIdx = eventUtils.resolveEventNum(boundaryLastEvent);
    if (boundaryLastEventIdx) {
      return eventMatchResult({
        bookId,
        chapterIdx: locatorChapter,
        eventIdx: boundaryLastEventIdx,
        atLocator: locator,
        source: 'locator-boundary-last-event',
        manifestEvent: boundaryLastEvent,
      });
    }
  }

  if (locator) {
    const resolved = resolveManifestLocatorToEventParams(bookId, locator, rawEventIdx ?? 1);
    const locatorEventIdx = toPositiveNumberOrNull(resolved?.eventIdx);
    if (resolved?.resolved && locatorEventIdx) {
      return eventMatchResult({
        bookId,
        chapterIdx: toPositiveNumberOrNull(resolved.chapterIdx) ?? locatorChapter ?? rawChapter,
        eventIdx: locatorEventIdx,
        atLocator: locator,
        source: 'locator',
      });
    }
  }

  const manifestMatch = resolveManifestEventMatch(event, bookId);
  if (manifestMatch.eventNum > 0) {
    return eventMatchResult({
      bookId,
      chapterIdx: manifestMatch.chapterIdx || locatorChapter || rawChapter,
      eventIdx: manifestMatch.eventNum,
      atLocator: locator,
      source: 'manifest-event-id',
      manifestEvent: manifestMatch.manifestEvent,
    });
  }

  return fallbackMatch();
}

function applyChapterEventIndex(eventObj, eventIdx) {
  const normalizedEventIdx = toPositiveNumberOrNull(eventIdx);
  if (!normalizedEventIdx || !eventObj || typeof eventObj !== 'object') return eventObj;
  const previousEventIdx = eventUtils.resolveEventNum(eventObj);
  const eventChanged = previousEventIdx > 0 && previousEventIdx !== normalizedEventIdx;
  return {
    ...eventObj,
    eventNum: normalizedEventIdx,
    eventIdx: normalizedEventIdx,
    eventId: normalizedEventIdx,
    resolvedEventIdx: normalizedEventIdx,
    ...(eventChanged ? { eventName: '', eventTitle: '', name: '', title: '' } : {}),
  };
}

function applyResolvedEventMetadata(eventObj, manifestEvent) {
  if (!eventObj || !manifestEvent) return eventObj;
  const eventId = eventUtils.resolveEventId(manifestEvent);
  const eventName = resolveProgressEventName(manifestEvent);
  return {
    ...eventObj,
    ...(eventId != null ? { eventId } : {}),
    ...(eventName ? { eventName, eventTitle: eventName, name: eventName, title: eventName } : {}),
  };
}

export function resolveViewerLineEvent({ receivedEvent, book, bookKey }) {
  if (!receivedEvent || typeof receivedEvent !== 'object') {
    return { nextEvent: receivedEvent, nextChapter: null, atLocator: null };
  }

  let nextEvent = receivedEvent;
  const match = resolveServerEventMatch({
    book,
    fallbackBookId: bookKey,
    event: nextEvent,
  });
  const resolvedEventIdx = toPositiveNumberOrNull(match.eventIdx) ?? 0;
  const resolvedChapter = toPositiveNumberOrNull(match.chapterIdx) ?? 0;
  const resolvedBookId = resolveServerBookId(book) ?? toPositiveNumberOrNull(bookKey);

  let nextChapter = null;
  if (resolvedChapter > 0) {
    nextChapter = resolvedChapter;
    nextEvent = { ...nextEvent, chapter: resolvedChapter, chapterIdx: resolvedChapter };
  }
  if (resolvedEventIdx > 0) nextEvent = applyChapterEventIndex(nextEvent, resolvedEventIdx);

  const manifestEvent =
    match.manifestEvent ??
    findManifestEventInChapter(
      resolvedBookId,
      resolvedChapter || eventUtils.resolveChapterIdx(nextEvent),
      { eventIdx: resolvedEventIdx }
    );
  nextEvent = applyResolvedEventMetadata(nextEvent, manifestEvent);

  return {
    nextEvent,
    nextChapter,
    atLocator: match.atLocator,
    resolvedEventIdx: eventUtils.resolveEventNum(nextEvent) || resolvedEventIdx,
  };
}

// --- 진도·TopBar·저장 payload ---

const EMPTY_PROGRESS_TOP_BAR = {
  eventNum: null,
  chapterIdx: null,
  chapterProgress: null,
  readingProgressPercent: null,
  eventName: '',
};

function emptyTopBar() {
  return { ...EMPTY_PROGRESS_TOP_BAR };
}

export function normalizeReadingProgressPercent(data, options = {}) {
  return progressPercentFromData(data, options, (bookId, locator) =>
    readingProgressPercentFromLocator(bookId, locator)
  );
}

export function normalizeChapterProgressPercent(data, options = {}) {
  return progressPercentFromData(data, options, (bookId, locator) => {
    const metrics = resolveProgressMetricsFromLocator(bookId, locator);
    return metrics?.chapterProgress ?? null;
  });
}

export function toReadingLocatorKey(startLocator, endLocator) {
  const start = toLocator(startLocator);
  if (!start) return '';
  const end = toLocator(endLocator) ?? start;
  return JSON.stringify({ start, end });
}

export function parseReadingLocatorKey(readingLocatorKey) {
  if (!readingLocatorKey) return { start: null, end: null };
  try {
    const parsed = JSON.parse(readingLocatorKey);
    const start = toLocator(parsed?.start);
    const end = toLocator(parsed?.end ?? parsed?.start) ?? start;
    return { start, end };
  } catch {
    return { start: null, end: null };
  }
}

export function resolveMetricsFromLocator(bookKey, locator, { metricsReady = true } = {}) {
  if (!bookKey || !metricsReady || !locator) return null;
  const start = toLocator(locator);
  return start ? resolveProgressMetricsFromLocator(bookKey, start) : null;
}

export function resolveMetricsFromReadingLocatorKey(bookKey, readingLocatorKey, options = {}) {
  if (!readingLocatorKey) return null;
  const { start } = parseReadingLocatorKey(readingLocatorKey);
  return resolveMetricsFromLocator(bookKey, start, options);
}

export function progressRowToTopBar(row, bookId = null) {
  if (!row || typeof row !== 'object') return emptyTopBar();

  const explicit = Number(row.eventNum);
  const fromId = eventUtils.resolveEventNum(row);
  const eventNum =
    Number.isFinite(explicit) && explicit > 0 ? explicit : fromId > 0 ? fromId : null;

  const loc = toLocator(row.startLocator ?? row.locator ?? row.anchor?.startLocator);
  const metrics = resolveMetricsFromLocator(bookId, loc);
  const chapterIdx =
    chapterIdxOf(row) ?? toPositiveNumberOrNull(row.chapterNum) ?? toPositiveNumberOrNull(loc?.chapterIndex);

  return {
    eventNum,
    chapterIdx,
    chapterProgress: metrics?.chapterProgress ?? null,
    readingProgressPercent: metrics?.readingProgressPercent ?? null,
    eventName: resolveProgressEventName(row),
  };
}

export function patchTopBarFromLineEvent(prev, nextEvent, lineLocator = null) {
  const previous = prev != null && typeof prev === 'object' ? prev : emptyTopBar();
  const eventNum = eventUtils.resolveEventNum(nextEvent);
  const chapterIdx =
    chapterIdxOf(nextEvent) ?? toPositiveNumberOrNull(resolveChapterIndex(lineLocator));

  return {
    ...previous,
    eventNum: eventNum > 0 ? eventNum : null,
    chapterIdx,
    eventName: resolveProgressEventName(nextEvent),
  };
}

export function snapshotFromProgressRow(row, bookId) {
  const idStr = String(bookId);
  const topBar = progressRowToTopBar(row, idStr);
  return {
    topBar,
    anchor: progressResultToViewerAnchor(row),
    readingLocatorKey: toReadingLocatorKey(
      row?.startLocator ?? row?.locator,
      row?.endLocator
    ),
    readingProgressPercent: topBar.readingProgressPercent,
  };
}

export function shouldApplyCacheSnapshot(snapshot, liveLocatorKey, isViewerPageReady) {
  const cacheKey = snapshot?.readingLocatorKey ?? '';
  if (!cacheKey || !liveLocatorKey || !isViewerPageReady) return true;

  const { start: cacheStart } = parseReadingLocatorKey(cacheKey);
  const { start: liveStart } = parseReadingLocatorKey(liveLocatorKey);
  if (cacheStart && liveStart) return locatorsEqual(cacheStart, liveStart);
  return cacheKey === liveLocatorKey;
}

export const VIEWER_RESUME_TIMING = {
  POLL_MS: 100,
  MAX_ATTEMPTS: 150,
  PERCENT_FALLBACK_ATTEMPTS: 30,
  TIMEOUT_MS: 100 * 150,
};

export const FORCE_RESUME_SNAPSHOT = { force: true, updateResumeAnchor: true };

export function normalizeProgressBookId(bookKey) {
  const id = toPositiveNumberOrNull(bookKey);
  return id != null ? String(id) : null;
}

export function mergeProgressTopBar(prev, bookKey, { readingProgressPercent, chapterProgress }) {
  const base =
    prev != null && typeof prev === 'object'
      ? prev
      : progressRowToTopBar(null, bookKey);
  const nextPct = readingProgressPercent ?? base.readingProgressPercent;
  const resolvedCp = chapterProgress ?? base.chapterProgress;
  if (base.readingProgressPercent === nextPct && base.chapterProgress === resolvedCp) {
    return prev;
  }
  return {
    ...base,
    ...(nextPct != null ? { readingProgressPercent: nextPct } : {}),
    ...(resolvedCp != null ? { chapterProgress: resolvedCp } : {}),
  };
}

export function resolveCachedResumeAnchor(bookId) {
  const cached = getProgressFromCache(bookId);
  return snapshotFromProgressRow(cached, bookId).anchor;
}

export function isViewerResumeBlocking(resumePending, preferredResume) {
  return Boolean(resumePending || preferredResume);
}

export function resolveReadingLocators(getCurrentLocator, currentEvent) {
  const fromViewer = getCurrentLocator?.();
  if (fromViewer) {
    const pair = toViewerResumeAnchor(fromViewer);
    if (pair?.startLocator) return pair;
  }
  return toViewerResumeAnchor(currentEvent?.anchor) ?? { startLocator: null, endLocator: null };
}

function buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics) {
  if (!bookId || !startLocator) return null;
  return {
    startLocator,
    endLocator: endLocator ?? startLocator,
    locator: startLocator,
    resolvedMetrics: metrics ?? resolveProgressMetricsFromLocator(bookId, startLocator),
    eventName: resolveProgressEventName(currentEvent),
    eventNum: Number(currentEvent?.eventNum),
  };
}

export function buildProgressPayload(bookId, startLocator, endLocator, currentEvent, metrics = null) {
  const base = buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics);
  if (!base) return null;

  const { resolvedMetrics, eventName, eventNum, ...locs } = base;
  return {
    bookId: String(bookId),
    ...locs,
    ...(resolvedMetrics?.readingProgressPercent != null
      ? { readingProgressPercent: resolvedMetrics.readingProgressPercent }
      : {}),
    ...(resolvedMetrics?.chapterProgress != null
      ? { chapterProgress: resolvedMetrics.chapterProgress }
      : {}),
    ...(Number.isFinite(eventNum) && eventNum > 0 ? { eventNum } : {}),
    ...(eventName ? { eventName } : {}),
  };
}

export function buildSaveLocationPayload(bookId, startLocator, endLocator, currentEvent, metrics = null) {
  const base = buildLocatorPayloadBase(bookId, startLocator, endLocator, currentEvent, metrics);
  if (!base) return null;

  const numericBookId = Number(bookId);
  return {
    bookId: Number.isFinite(numericBookId) && numericBookId > 0 ? numericBookId : null,
    startLocator: base.startLocator,
    endLocator: base.endLocator,
    locator: base.locator,
    chapterIdx: base.startLocator.chapterIndex,
    eventIdx: base.eventNum,
    eventNum: base.eventNum,
    eventId: eventUtils.resolveEventId(currentEvent),
    eventName: base.eventName || null,
    chapterProgress: base.resolvedMetrics?.chapterProgress ?? null,
    source: 'runtime',
  };
}


export function saveViewerMode(mode) {
  try {
    if (!mode || typeof mode !== 'string') return;
    localStorage.setItem('viewer_mode', mode);
  } catch {
    return;
  }
}

function loadViewerMode() {
  try {
    return localStorage.getItem('viewer_mode');
  } catch {
    return null;
  }
}

/** showGraph는 settings SSOT. viewer_mode는 전체화면(graph) 여부만 복원. */
export function resolveInitialGraphFullScreen(showGraph = loadSettings().showGraph) {
  return Boolean(showGraph) && loadViewerMode() === 'graph';
}

export function resolvePersistedViewerMode(graphFullScreen, showGraph) {
  if (graphFullScreen) return 'graph';
  if (showGraph) return 'split';
  return 'viewer';
}

export function deriveGraphPhase({ isReloading, isEventGraphLoading, isGraphLoading }) {
  if (isReloading) return 'reloading';
  if (isEventGraphLoading) return 'event';
  if (isGraphLoading) return 'loading';
  return 'idle';
}

export function isHardNavigationReload() {
  if (!performance?.getEntriesByType) return false;
  const [entry] = performance.getEntriesByType('navigation');
  return entry?.type === 'reload';
}

export function buildViewerActionError(message, details, retry) {
  return { message, details, retry };
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

export function waitForViewerMethod(viewerRef, methodName, timeoutMs = 3000) {
  if (viewerRef.current?.[methodName]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      if (viewerRef.current?.[methodName]) {
        clearInterval(id);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(id);
        resolve(false);
      }
    }, 100);
  });
}

export function runViewerPaging(viewerRef, direction) {
  const ref = viewerRef.current;
  if (!ref) {
    toast.error('뷰어가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  try {
    if (direction === 'prev') ref.prevPage();
    else ref.nextPage();
  } catch {
    toast.error(
      direction === 'prev'
        ? '이전 페이지로 이동할 수 없습니다.'
        : '다음 페이지로 이동할 수 없습니다.'
    );
  }
}

export async function restoreViewerPosition(viewerRef, progress) {
  const { startLocator: start, endLocator: end } = anchorToLocators(
    viewerRef.current?.getCurrentLocator?.()
  );
  viewerRef.current?.refreshLayout?.();
  await waitForPaint();

  if (start && viewerRef.current?.displayAt) {
    const moved = viewerRef.current.displayAt({
      startLocator: start,
      endLocator: end ?? start,
    });
    if (moved) {
      await waitForPaint();
      return;
    }
  }

  const pct = Number(progress);
  if (Number.isFinite(pct) && pct >= 0) {
    await viewerRef.current?.moveToProgress?.(pct);
  }
  await waitForPaint();
}
