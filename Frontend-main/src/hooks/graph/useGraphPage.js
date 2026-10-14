/** 그래프 전용 페이지(GraphPage) 상태 훅: 챕터·이벤트 선택, manifest 보정, 제목, elements 커밋 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GRAPH_LAYOUT_CONSTANTS } from '../../utils/graph/graphCore';
import { useLocalStorageNumber } from '../common/hooksShared';
import {
  convertGraphSourceToElements,
  commitVisibleGraphElements,
} from '../../utils/viewer/viewerGraph';
import { extractNodeWeightsFromElements } from '../../utils/graph/graphElements';
import { getGraphEventState } from '../../utils/graph/graphChapterCache';
import {
  eventUtils,
  formatFallbackChapterLabel,
  stripRedundantBookTitlePrefix,
  resolveChapterTitleMeta,
} from '../../utils/viewer/viewerCore';
import { hasGraphPayload } from '../../utils/api/graphApi';
import { errorUtils } from '../../utils/common/valueUtils';
import {
  getChapterData,
  findManifestEventInChapter,
  getFirstManifestEventInChapter,
  resolveLastEventIdxForChapter,
} from '../../utils/common/cache/manifestCache.js';

/** URL 챕터(뷰어에서 전달) 우선, 없으면 마지막으로 본 챕터(localStorage). 이벤트는 1부터 */
export function useGraphChapterEventState(filename, requestedChapter) {
  let chapterFromViewer = Number(requestedChapter);
  if (!Number.isFinite(chapterFromViewer) || chapterFromViewer < 1) {
    chapterFromViewer = null;
  }

  const [currentChapter, setCurrentChapter] = useLocalStorageNumber(
    `lastGraphChapter_${filename}`,
    chapterFromViewer ?? 1,
    { forceInitialValue: chapterFromViewer != null }
  );
  const [currentEvent, setCurrentEvent] = useState(1);
  const appliedRequestedChapterRef = useRef(null);

  useEffect(() => {
    if (chapterFromViewer == null) return;
    if (appliedRequestedChapterRef.current === chapterFromViewer) return;
    if (chapterFromViewer !== currentChapter) {
      setCurrentChapter(chapterFromViewer);
      setCurrentEvent(1);
    }
    appliedRequestedChapterRef.current = chapterFromViewer;
  }, [chapterFromViewer, currentChapter, setCurrentChapter]);

  return { currentChapter, setCurrentChapter, currentEvent, setCurrentEvent };
}

/** manifest 기준 보정: 최대 챕터 초과 시 마지막 챕터로, manifest에 없는 이벤트면 챕터 첫 이벤트로 */
export function useManifestChapterEventClamp({
  serverBookId,
  manifestReady,
  manifestData,
  apiMaxChapter,
  currentChapter,
  setCurrentChapter,
  currentEvent,
  setCurrentEvent,
}) {
  useEffect(() => {
    if (!manifestReady) return;
    if (apiMaxChapter > 0 && currentChapter > apiMaxChapter) {
      setCurrentChapter(apiMaxChapter);
    }
  }, [manifestReady, apiMaxChapter, currentChapter, setCurrentChapter]);

  useEffect(() => {
    if (serverBookId == null || !manifestReady) return;
    const ch = Number(currentChapter);
    if (!Number.isFinite(ch) || ch < 1) return;
    if (findManifestEventInChapter(serverBookId, ch, { eventIdx: currentEvent }, manifestData)) return;

    const next = eventUtils.resolveEventNum(
      getFirstManifestEventInChapter(serverBookId, ch, manifestData),
    );
    if (!(next > 0) || next === currentEvent) return;
    if (findManifestEventInChapter(serverBookId, ch, { eventIdx: next }, manifestData)) {
      setCurrentEvent(next);
    }
  }, [serverBookId, manifestReady, manifestData, currentChapter, currentEvent, setCurrentEvent]);
}

/** 상단 챕터 라벨·툴팁 (책 제목 접두어 제거, 없으면 기본 라벨) */
export function useChapterTitleMeta(serverBookId, currentChapter, manifestData) {
  const bookTitle = useMemo(
    () => String(manifestData?.book?.title ?? '').trim(),
    [manifestData?.book?.title],
  );

  const chapterMeta = useMemo(() => {
    const ch =
      serverBookId != null ? getChapterData(serverBookId, currentChapter) : null;
    if (!Number.isFinite(Number(currentChapter)) || Number(currentChapter) < 1) {
      return { chapterDisplayLabel: '챕터 ?', chapterTitleTooltip: undefined };
    }
    const meta = resolveChapterTitleMeta(ch, bookTitle, currentChapter);
    const displayName =
      meta.status === 'ok'
        ? stripRedundantBookTitlePrefix(meta.raw, bookTitle) || meta.display
        : meta.status === 'collapsed'
          ? meta.display
          : '';
    return {
      chapterDisplayLabel: displayName || formatFallbackChapterLabel(currentChapter),
      chapterTitleTooltip: meta.raw || meta.tooltip || undefined,
    };
  }, [serverBookId, currentChapter, bookTitle]);

  return { bookTitle, chapterMeta };
}

/**
 * 현재 챕터 응답(loadedGraphKey 일치)만 elements로 변환해 커밋.
 * 응답이 비면 로딩이 끝난 뒤에만 비움 (로딩 중 깜빡임 방지).
 */
export function useGraphPageElements({ serverBookId, currentChapter, currentEvent, apiBookGraphData, loadedGraphKey, isGraphLoading }) {
  const [elements, setElements] = useState([]);
  const profileApplyTokenRef = useRef(0);
  // 언마운트 시 이미지 재시도 루프 중단
  useEffect(() => () => { profileApplyTokenRef.current += 1; }, []);

  const graphApiPayload = hasGraphPayload(apiBookGraphData) ? apiBookGraphData : null;
  const requestedGraphKey = serverBookId != null
    ? `${serverBookId}:${Number(currentChapter)}`
    : null;
  const isGraphResponseCurrent = loadedGraphKey === requestedGraphKey;

  const apiElements = useMemo(() => {
    if (!isGraphResponseCurrent) return null;
    if (!graphApiPayload) return [];
    try {
      const previousEventState =
        serverBookId && currentEvent > 1
          ? getGraphEventState(serverBookId, currentChapter, currentEvent - 1)
          : null;
      return convertGraphSourceToElements(
        graphApiPayload,
        currentChapter,
        currentEvent,
        extractNodeWeightsFromElements(previousEventState?.elements),
        { bookId: serverBookId },
      ).elements;
    } catch (error) {
      errorUtils.logError('GraphPage.convert', error, {
        bookId: serverBookId,
        chapter: currentChapter,
        event: currentEvent,
      });
      return [];
    }
  }, [isGraphResponseCurrent, graphApiPayload, serverBookId, currentChapter, currentEvent]);

  useEffect(() => {
    if (apiElements == null) return;
    if (!apiElements.length) {
      if (isGraphLoading) return;
      profileApplyTokenRef.current += 1;
      setElements([]);
      return;
    }
    commitVisibleGraphElements(setElements, apiElements, {
      applyTokenRef: profileApplyTokenRef,
    });
  }, [apiElements, isGraphLoading]);

  const isApiGraphEmpty = !isGraphLoading && isGraphResponseCurrent && !graphApiPayload;
  return { elements, isApiGraphEmpty };
}

/**
 * 챕터 선택: 선택(툴팁) 해제 후 전환. 툴팁이 열려 있었으면 닫힘 애니메이션 뒤에 적용.
 * 이벤트는 챕터 마지막 이벤트, 없으면 첫 실제 이벤트.
 */
export function useChapterSelect({
  currentChapter,
  setCurrentChapter,
  setCurrentEvent,
  serverBookId,
  manifestData,
  activeTooltip,
  clearGraphSelection,
  startClosing,
}) {
  const pendingChapterChangeRef = useRef(null);

  useEffect(() => () => {
    if (pendingChapterChangeRef.current) {
      window.clearTimeout(pendingChapterChangeRef.current);
      pendingChapterChangeRef.current = null;
    }
  }, []);

  return useCallback((chapter) => {
    if (chapter === currentChapter) return;

    if (pendingChapterChangeRef.current) {
      window.clearTimeout(pendingChapterChangeRef.current);
      pendingChapterChangeRef.current = null;
    }

    const applyChapter = () => {
      pendingChapterChangeRef.current = null;
      setCurrentChapter(chapter);

      const lastEventNum = resolveLastEventIdxForChapter(
        serverBookId,
        chapter,
        manifestData?.chapters?.length ? { chapters: manifestData.chapters } : undefined
      );
      const normalized = Number(lastEventNum);
      if (Number.isFinite(normalized) && normalized >= 1) {
        setCurrentEvent(normalized);
        return;
      }
      // 빈 챕터: 가짜 lastEvent=1로 속이지 않음. 첫 실제 이벤트만 사용.
      const firstNum = eventUtils.resolveEventNum(
        getFirstManifestEventInChapter(serverBookId, chapter, manifestData),
      );
      if (firstNum > 0) setCurrentEvent(firstNum);
    };

    // 선택 해제는 챕터 변경 effect(GraphPage)가 한다. 툴팁이 열려 있으면 닫힘 애니메이션 동안
    // 하이라이트가 남지 않도록 미리 한 번 해제 (그 사이 선택이 바뀔 수 있어 effect의 해제도 유지)
    if (activeTooltip) {
      clearGraphSelection({ fitViewport: false, restoreViewport: false });
      startClosing();
      pendingChapterChangeRef.current = window.setTimeout(
        applyChapter,
        GRAPH_LAYOUT_CONSTANTS.ANIMATION_MS
      );
      return;
    }

    applyChapter();
  }, [
    activeTooltip,
    currentChapter,
    setCurrentChapter,
    setCurrentEvent,
    manifestData,
    serverBookId,
    clearGraphSelection,
    startClosing,
  ]);
}
