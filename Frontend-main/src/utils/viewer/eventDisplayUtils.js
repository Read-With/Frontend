/**
 * 툴팁 등 뷰어 UI. 이벤트 번호 폴백은 `graphData`의 챕터별 마지막 인덱스로 가며,
 * 그 값은 GET /api/v2/graph/fine 기반 챕터 캐시에서 온다.
 */
import { getChapterLastEventNums } from '../graph/graphData.js';
import { getChapterData } from '../common/cache/manifestCache';

export function pickReadingEvent(currentEvent, prevValidEvent) {
  return currentEvent || prevValidEvent || null;
}

const positiveOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** ch1-e12, event-3 등 문자열에서 순번 추출 */
function eventNumFromStringId(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return positiveOrZero(raw);
  const s = String(raw).trim();
  if (!s) return 0;
  const direct = positiveOrZero(s);
  if (direct) return direct;
  const eTail = s.match(/[eE](\d+)\s*$/);
  if (eTail) return positiveOrZero(eTail[1]);
  const lastDigits = s.match(/(\d+)\s*$/);
  if (lastDigits) return positiveOrZero(lastDigits[1]);
  return 0;
}

/**
 * 상단바·툴팁 표시용. 루트/중첩 필드 중 GET /api/v2/graph/fine `result.event` 계열
 * (chapterIdx, event_id, eventId, eventNum, …) 과 맞는 값을 고른다.
 * 뷰어 스크롤만으로 온 `{ anchor }` 는 여기서 순번을 알 수 없다.
 */
export function resolveDisplayedEventNum(event) {
  if (!event || typeof event !== 'object') return 0;

  let v =
    positiveOrZero(event.eventNum) ||
    positiveOrZero(event.eventIdx) ||
    positiveOrZero(event.idx) ||
    positiveOrZero(event.resolvedEventIdx) ||
    positiveOrZero(event.originalEventIdx);
  if (v) return v;

  v = eventNumFromStringId(event.eventId) || eventNumFromStringId(event.id);
  if (v) return v;

  const inner = event.event;
  if (inner && typeof inner === 'object') {
    v =
      positiveOrZero(inner.eventNum) ||
      positiveOrZero(inner.eventIdx) ||
      positiveOrZero(inner.idx) ||
      positiveOrZero(inner.event_idx) ||
      positiveOrZero(inner.event_id);
    if (v) return v;
    v = eventNumFromStringId(inner.eventId) || eventNumFromStringId(inner.id);
    if (v) return v;
  }

  v = positiveOrZero(event.event_id);
  if (v) return v;

  return eventNumFromStringId(event.event_id);
}

/**
 * `reading`에 fine 응답의 result.event 가 붙어 있으면 그 객체(또는 루트에 동일 필드가 있으면 루트).
 */
const rootChapterPresent = (reading) => {
  const c = reading.chapterIdx ?? reading.chapter;
  return c != null && Number(c) >= 1;
};

export function pickFineGraphResultEvent(reading) {
  if (!reading || typeof reading !== 'object') return null;
  const inner = reading.event;
  if (inner && typeof inner === 'object') {
    const has =
      inner.chapterIdx != null ||
      inner.chapter != null ||
      inner.event_id != null ||
      inner.eventId != null ||
      inner.eventNum != null ||
      inner.startTxtOffset != null;
    if (has) return inner;
  }
  if (
    rootChapterPresent(reading) &&
    (reading.event_id != null ||
      reading.eventId != null ||
      reading.eventNum != null)
  ) {
    return reading;
  }
  return null;
}

/** fine 스냅샷의 `ch7-e4` 형식 eventId 문자열 */
export function resolveFineGraphEventIdString(reading) {
  const fine = pickFineGraphResultEvent(reading);
  if (!fine) return '';
  const v = fine.eventId ?? fine.id;
  if (v == null) return '';
  return String(v).trim();
}

function resolveFineEventChapterIndex(reading) {
  if (!reading || typeof reading !== 'object') return 0;
  const fine = pickFineGraphResultEvent(reading);
  const c = Number(
    fine?.chapterIdx ?? fine?.chapter ?? reading.chapterIdx ?? reading.chapter
  );
  return Number.isFinite(c) && c >= 1 ? c : 0;
}

function manifestEventRowByEventId(bookId, chapterIdx, eventIdStr) {
  const id = String(eventIdStr || '').trim();
  if (!id) return null;
  const bid = Number(bookId);
  const ch = Number(chapterIdx);
  if (!Number.isFinite(bid) || bid < 1 || !Number.isFinite(ch) || ch < 1) return null;
  const chapterData = getChapterData(bid, ch);
  const events = Array.isArray(chapterData?.events) ? chapterData.events : [];
  return events.find((e) => String(e?.eventId ?? '').trim() === id) ?? null;
}

function eventNumFromManifestEventRow(row) {
  if (!row) return 0;
  const n = Number(row.eventNum ?? row.idx ?? row.eventIdx);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * fine `eventId` + 챕터로 매니페스트의 해당 이벤트 한 건 (순번·메타; rawText는 UI에 쓰지 않음).
 */
export function resolveViewerGraphEventFromManifest(reading, bookId) {
  const bid = Number(bookId);
  if (!reading || typeof reading !== 'object' || !Number.isFinite(bid) || bid < 1) {
    return { title: '', eventNum: 0, eventId: '', chapterIdx: 0, manifestEvent: null };
  }
  const eventId = resolveFineGraphEventIdString(reading);
  const ch = resolveFineEventChapterIndex(reading);
  if (!eventId || !ch) {
    return { title: '', eventNum: 0, eventId, chapterIdx: ch || 0, manifestEvent: null };
  }
  const manifestEvent = manifestEventRowByEventId(bid, ch, eventId);
  return {
    title: '',
    eventNum: eventNumFromManifestEventRow(manifestEvent),
    eventId,
    chapterIdx: ch,
    manifestEvent,
  };
}

/** 순번: resolveDisplayedEventNum → 그래프 훅 `eventNum` 폴백 */
export function resolveViewerEventOrdinal(reading, graphHookEventNum = 0) {
  const fromPayload = resolveDisplayedEventNum(reading);
  if (fromPayload > 0) return fromPayload;
  const g = Number(graphHookEventNum);
  return Number.isFinite(g) && g > 0 ? g : 0;
}

export function eventFieldsForTooltip(eventToShow) {
  if (!eventToShow) return null;
  return {
    eventNum: resolveDisplayedEventNum(eventToShow),
    name: eventToShow.name || eventToShow.event_name || '',
    chapterProgress: eventToShow.chapterProgress,
    currentChars: eventToShow.currentChars,
    totalChars: eventToShow.totalChars,
  };
}

export function getUnifiedEventInfoForNodeTooltip({
  currentEvent,
  prevValidEvent,
  eventNum,
  chapterNum,
  folderKey,
}) {
  const eventToShow = pickReadingEvent(currentEvent, prevValidEvent);
  const fields = eventFieldsForTooltip(eventToShow);
  if (fields) return fields;
  if (!eventNum || eventNum === 0) {
    const lastEventNums = getChapterLastEventNums(folderKey);
    return { eventNum: lastEventNums[chapterNum - 1] || 1 };
  }
  return { eventNum: eventNum || 0 };
}

export function getUnifiedEventInfoForEdgeTooltip({ currentEvent, prevValidEvent, eventNum }) {
  const eventToShow = pickReadingEvent(currentEvent, prevValidEvent);
  const fields = eventFieldsForTooltip(eventToShow);
  if (fields) return fields;
  return { eventNum: eventNum || 0 };
}
