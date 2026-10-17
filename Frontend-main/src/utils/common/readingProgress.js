/** 읽기 진도 계산: locator ↔ 챕터 로컬/도서 절대 오프셋, 진행률(%), locator → 이벤트 */

import { asArray, toNumberOrNull, clampPercent } from './valueUtils';
import { toLocator } from './locator';
import {
  getChapterData,
  memoByRef,
  sortByChapterIdx,
  resolveManifestForProgress,
} from './cache/manifestCache';

// manifest identity 기준 메모 (manifestCache 참고) — 진도 계산은 스크롤마다 불림
const chapterLengthIndexMemo = new WeakMap();
const chapterOffsetIndexMemo = new WeakMap();
const sortedEventsByStartMemo = new WeakMap();

const lengthFromChapterBody = (chapter) => {
  if (!chapter || typeof chapter !== 'object') return 0;
  const tcp = toNumberOrNull(chapter.totalCodePoints);
  if (tcp != null && tcp > 0) return tcp;
  const sp = toNumberOrNull(chapter.startPos);
  const ep = toNumberOrNull(chapter.endPos);
  if (sp != null && ep != null && ep > sp) return ep - sp;
  return 0;
};

const findChapterLengthEntryForChapter = (manifest, chapter) => {
  if (!chapter || typeof chapter !== 'object') return null;
  const lengths = manifest?.progressMetadata?.chapterLengths;
  if (!Array.isArray(lengths) || lengths.length === 0) return null;
  const idx = toNumberOrNull(chapter.idx);
  if (idx == null) return null;
  const byIdx = memoByRef(chapterLengthIndexMemo, lengths, (list) => {
    const map = new Map();
    for (const entry of list) {
      const key = toNumberOrNull(entry?.chapterIdx);
      if (!map.has(key)) map.set(key, entry);
    }
    return map;
  });
  return byIdx.get(idx) ?? null;
};

export const getEffectiveChapterLengthForProgress = (manifest, chapter) => {
  if (!chapter) return 0;
  const entry = findChapterLengthEntryForChapter(manifest, chapter);
  const fromTable = toNumberOrNull(entry?.length ?? entry?.codePointLength);
  if (fromTable != null && fromTable > 0) return fromTable;
  return lengthFromChapterBody(chapter);
};

/**
 * 챕터 순서대로 { chapter, start(앞선 양수 길이 합), length } — 스크롤마다 챕터를 처음부터 누적하지 않음 (O(C) → O(1)·O(log C)).
 * byIdx: 챕터 번호 → 첫 행, withLength: 길이 > 0 행(start 오름차순), total: 전체 길이
 */
const getChapterOffsetIndex = (manifest) =>
  memoByRef(chapterOffsetIndexMemo, manifest, (m) => {
    const byIdx = new Map();
    const withLength = [];
    let total = 0;
    for (const chapter of sortByChapterIdx(m.chapters)) {
      const length = getEffectiveChapterLengthForProgress(m, chapter);
      const row = { chapter, start: total, length };
      const idx = toNumberOrNull(chapter.idx);
      if (!byIdx.has(idx)) byIdx.set(idx, row);
      if (length > 0) {
        withLength.push(row);
        total += length;
      }
    }
    return { byIdx, withLength, total };
  });

/** 오름차순 배열에서 pred가 처음 true가 되는 index (없으면 length) */
const lowerBound = (length, pred) => {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};

/** paragraphStarts 없을 때 챕터 길이에 맞춘 블록 스텝 (고정 3000보다 역변환 정밀도 향상) */
const resolveApproxBlockStep = (chapter) => {
  const total = toNumberOrNull(chapter?.totalCodePoints);
  if (total == null || total <= 0) return 3000;
  const targetBlocks = Math.max(1, Math.min(32, Math.ceil(total / 750)));
  return Math.max(256, Math.ceil(total / targetBlocks));
};

/** 챕터 내부 코드포인트 오프셋 → v2 locator (paragraphStarts 우선, 없으면 길이 기반 스텝 근사) */
export const locatorFromChapterLocalOffset = (chapter, local) => {
  const chIdx = toNumberOrNull(chapter?.idx);
  if (chIdx == null) return null;
  const safeLocal = Math.max(0, Math.floor(Number(local)));

  const starts = Array.isArray(chapter?.paragraphStarts) ? chapter.paragraphStarts : [];
  const lengths = Array.isArray(chapter?.paragraphLengths) ? chapter.paragraphLengths : [];

  if (starts.length > 0) {
    // paragraphStarts는 문단 시작 오프셋이라 오름차순 — safeLocal 이하인 마지막 문단을 이분 탐색 (O(P) → O(log P))
    const firstAfter = lowerBound(starts.length, (i) => (toNumberOrNull(starts[i]) ?? 0) > safeLocal);
    const block = Math.max(0, firstAfter - 1);
    const startInBlock = toNumberOrNull(starts[block]) ?? 0;
    let offset = Math.max(0, safeLocal - startInBlock);
    const len = toNumberOrNull(lengths[block]);
    if (len != null && len > 0) {
      offset = Math.min(offset, len);
    }
    return { chapterIndex: chIdx, blockIndex: block, offset };
  }

  const step = resolveApproxBlockStep(chapter);
  const blockIndex = Math.floor(safeLocal / step);
  const offset = safeLocal % step;
  return { chapterIndex: chIdx, blockIndex, offset };
};

/**
 * v2 locator(blockIndex·offset)를 챕터 rawText 기준 로컬 코드포인트 위치로 환산한다.
 * paragraphStarts가 있으면 서버 분할과 동일 축을 쓰고, 없으면 chapterLocalOffsetToLocator와 동일한 스텝 근사.
 */
const chapterLocalCodePointFromLocator = (chapter, locator) => {
  if (!chapter || typeof chapter !== 'object' || !locator) return 0;
  const block = Math.max(0, Math.floor(Number(locator.blockIndex) || 0));
  const off = Math.max(0, Math.floor(Number(locator.offset) || 0));
  const starts = asArray(chapter.paragraphStarts);
  const lengths = asArray(chapter.paragraphLengths);
  const total = toNumberOrNull(chapter.totalCodePoints);

  if (starts.length > 0) {
    const lastIdx = starts.length - 1;
    if (block > lastIdx) {
      const lastStart = toNumberOrNull(starts[lastIdx]) ?? 0;
      const lastLen = toNumberOrNull(lengths[lastIdx]);
      const endExclusive = lastLen != null && lastLen > 0 ? lastStart + lastLen : lastStart + 1;
      const capped = Math.max(0, endExclusive - 1);
      const cap = Number.isFinite(total) && total > 0 ? Math.min(capped, total - 1) : capped;
      return cap;
    }
  }

  const chapterStart = starts.length > 0
    ? toNumberOrNull(starts[block]) ?? 0
    : block * resolveApproxBlockStep(chapter);
  let chapterLocal = chapterStart + off;
  if (Number.isFinite(total) && total > 0) {
    chapterLocal = Math.min(chapterLocal, Math.max(0, total - 1));
  }
  return Math.max(0, chapterLocal);
};

const pickManifestEventForChapterLocalOffset = (events, local) => {
  if (!Array.isArray(events) || events.length === 0) return null;
  const L = Number.isFinite(local) ? Math.max(0, Math.floor(local)) : 0;
  // manifest events 배열은 불변 — 호출마다 복사·정렬하지 않음
  const sorted = memoByRef(sortedEventsByStartMemo, events, (list) =>
    [...list].sort(
      (a, b) => (toNumberOrNull(a.startTxtOffset) ?? 0) - (toNumberOrNull(b.startTxtOffset) ?? 0)
    )
  );
  for (const ev of sorted) {
    const s = toNumberOrNull(ev.startTxtOffset) ?? 0;
    const eRaw = toNumberOrNull(ev.endTxtOffset);
    const e = eRaw != null && eRaw > s ? eRaw : s + 1;
    if (L >= s && L < e) return ev;
  }
  const first = sorted[0];
  const firstStart = toNumberOrNull(first.startTxtOffset) ?? 0;
  if (L < firstStart) return first;
  let best = first;
  for (const ev of sorted) {
    const s = toNumberOrNull(ev.startTxtOffset) ?? 0;
    if (s <= L) best = ev;
    else break;
  }
  return best;
};

/**
 * 이벤트 시작 locator 해석 (progress/뷰어용). 그래프 API는 relationship-deltas(eventId)를 사용.
 * 매니페스트 이벤트 구간(startTxtOffset/endTxtOffset)으로 locator에 대응하는 eventIdx를 계산한다.
 */
export const resolveLocatorToEventParams = (
  bookId,
  atLocator,
  eventIdxFallback = 1,
  manifestOverride = undefined
) => {
  const loc = toLocator(atLocator);
  if (!loc) {
    return {
      chapterIdx: undefined,
      eventIdx: Math.max(1, Number(eventIdxFallback) || 1),
      atLocator: null,
      resolved: false,
    };
  }

  const chapterData = getChapterData(bookId, loc.chapterIndex, manifestOverride);
  const events = chapterData?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return {
      chapterIdx: loc.chapterIndex,
      eventIdx: Math.max(1, Number(eventIdxFallback) || 1),
      atLocator: loc,
      resolved: false,
    };
  }

  const local = chapterLocalCodePointFromLocator(chapterData, loc);
  const picked = pickManifestEventForChapterLocalOffset(events, local);
  const raw =
    toNumberOrNull(picked?.eventNum) ??
    toNumberOrNull(picked?.idx) ??
    toNumberOrNull(picked?.eventIdx) ??
    toNumberOrNull(eventIdxFallback);
  const eventIdx = Number.isFinite(raw) && raw >= 1 ? raw : Math.max(1, Number(eventIdxFallback) || 1);
  const eventId = picked?.eventId ? String(picked.eventId).trim() : '';

  return {
    chapterIdx: loc.chapterIndex,
    eventIdx,
    ...(eventId ? { eventId } : {}),
    atLocator: loc,
    resolved: true,
  };
};

/**
 * GET /api/v2/progress 등에 locator 없이 startTxtOffset만 올 때,
 * manifest의 챕터 길이 누적을 기준으로 도서 전체 기준 절대 코드포인트 위치를 v2 locator로 근사한다.
 */
export const locatorFromBookAbsoluteOffset = (bookId, absoluteOffset, manifestOverride = undefined) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  const pos = toNumberOrNull(absoluteOffset);
  if (!manifest?.chapters?.length || pos == null || pos < 0) return null;

  const { withLength } = getChapterOffsetIndex(manifest);
  if (!withLength.length) return null;

  const i = lowerBound(withLength.length, (k) => pos < withLength[k].start + withLength[k].length);
  if (i < withLength.length) {
    const { chapter, start, length } = withLength[i];
    return locatorFromChapterLocalOffset(chapter, Math.max(0, Math.min(pos - start, length - 1)));
  }
  const last = withLength[withLength.length - 1];
  return locatorFromChapterLocalOffset(last.chapter, last.length - 1);
};

const getProgressTotalLength = (manifest) => {
  if (!manifest || typeof manifest !== 'object') return 0;
  const metaTotal = toNumberOrNull(manifest.progressMetadata?.totalLength);
  if (metaTotal != null && metaTotal > 0) return metaTotal;
  return getChapterOffsetIndex(manifest).total;
};

/** paragraphStarts 없으면 스텝 인코딩, 페이지 인코딩(block이 챕터 길이를 넘김)이면 offset을 챕터 로컬로 사용 */
export const chapterLocalOffsetFromLocator = (chapter, locator) => {
  if (!chapter || !locator) return 0;
  const starts = asArray(chapter.paragraphStarts);
  if (starts.length > 0) {
    return chapterLocalCodePointFromLocator(chapter, locator);
  }
  const block = Math.max(0, Math.floor(Number(locator.blockIndex) || 0));
  const off = Math.max(0, Math.floor(Number(locator.offset) || 0));
  const step = resolveApproxBlockStep(chapter);
  const total = toNumberOrNull(chapter.totalCodePoints) ?? lengthFromChapterBody(chapter);
  if (total > 0 && block * step >= total) {
    return Math.min(Math.max(0, off), Math.max(0, total - 1));
  }
  return chapterLocalCodePointFromLocator(chapter, locator);
};

const percentFromOffsetInLength = (offset, length) => {
  if (!(length > 0) || !Number.isFinite(offset)) return null;
  if (length <= 1) return offset > 0 ? 100 : 0;
  const local = Math.min(Math.max(0, offset), length - 1);
  return clampPercent((local / (length - 1)) * 100);
};

export const canResolveProgressMetrics = (bookId, manifestOverride = undefined) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  if (!manifest?.chapters?.length) return false;
  return getProgressTotalLength(manifest) > 0;
};

export const locatorToBookAbsoluteOffset = (bookId, locator, manifestOverride = undefined) => {
  const loc = toLocator(locator);
  if (!loc) return null;
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  if (!manifest?.chapters?.length) return null;

  const row = getChapterOffsetIndex(manifest).byIdx.get(loc.chapterIndex);
  if (!row) return null;
  const local = chapterLocalOffsetFromLocator(row.chapter, loc);
  if (!(row.length > 0)) return row.start;
  return row.start + Math.min(Math.max(0, local), row.length - 1);
};

export const readingProgressPercentFromLocator = (bookId, locator, manifestOverride = undefined) => {
  const abs = locatorToBookAbsoluteOffset(bookId, locator, manifestOverride);
  if (abs == null) return null;
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  return percentFromOffsetInLength(abs, getProgressTotalLength(manifest));
};

export const absoluteOffsetFromReadingProgressPercent = (
  bookId,
  percent,
  manifestOverride = undefined
) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  const total = getProgressTotalLength(manifest);
  if (!(total > 0)) return null;
  const p = Number(percent);
  if (!Number.isFinite(p)) return null;
  const clamped = Math.min(100, Math.max(0, p));
  if (total <= 1) return 0;
  return Math.min(total - 1, Math.max(0, Math.round((clamped / 100) * (total - 1))));
};

export const resolveProgressMetricsFromLocator = (bookId, locator, manifestOverride = undefined) => {
  const loc = toLocator(locator);
  if (!loc) return null;
  const readingProgressPercent = readingProgressPercentFromLocator(bookId, loc, manifestOverride);
  if (readingProgressPercent == null) return null;

  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  const chapter = getChapterData(bookId, loc.chapterIndex, manifestOverride);
  const chapterLen = getEffectiveChapterLengthForProgress(manifest, chapter);
  const local = chapterLocalOffsetFromLocator(chapter, loc);
  return {
    readingProgressPercent,
    chapterProgress: percentFromOffsetInLength(local, chapterLen),
  };
};
