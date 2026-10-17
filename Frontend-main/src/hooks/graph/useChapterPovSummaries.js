/** 챕터 단위 인물 시점(POV) 요약 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getChapterPovSummaries,
  normalizeChapterPovSummariesResult,
} from '../../utils/api/booksApi';
import { toPositiveNumberOrNull, toPositiveInt } from '../../utils/common/valueUtils';
import { removeKeys } from '../../utils/common/cache/cacheManager';
import { formatChapterOrdinalLabel } from '../../utils/common/chapterLabel';
import { NODE_TOOLTIP_VIEW_STATUS } from '../../utils/graph/graphCore';

/* ─── 노드 시점(POV) 요약 표시 ─── */

function normalizeMatchName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function collectNodeMatchNames(node) {
  const names = [];
  const push = (v) => {
    if (typeof v !== 'string') return;
    const n = normalizeMatchName(v);
    if (n) names.push(n);
  };
  push(node?.common_name);
  push(node?.label);
  push(node?.displayName);
  push(node?.name);
  if (Array.isArray(node?.names)) {
    node.names.forEach(push);
  }
  return [...new Set(names)];
}

const POV_SPOILER_SESSION_KEY = 'readwith:pov-spoiler-unlocked';

// ponytail: 이 키를 쓰는 코드가 없음 — 이전 버전 잔여 세션 정리용. 배포 몇 주 뒤 함수째 삭제
export function clearPovSpoilerSession() {
  removeKeys('sessionStorage', POV_SPOILER_SESSION_KEY);
}

/**
 * @returns {{ text: string, status: string }}
 */
export function resolvePovSummary(
  node,
  currentChapter,
  povSummaries,
  povError = null,
  { isLoading = false, povCached = null } = {},
) {
  const S = NODE_TOOLTIP_VIEW_STATUS;
  if (!node) {
    return {
      text: '해당 챕터에서는 해당 캐릭터의 등장 비중이 낮아 별도의 분석 내용이 제공되지 않습니다.',
      status: S.NO_DATA,
    };
  }

  if (isLoading) {
    return { text: '시점 요약을 불러오는 중…', status: S.LOADING };
  }

  if (povError) {
    return {
      text: typeof povError === 'string' ? povError : '관점 요약을 불러오지 못했습니다.',
      status: S.ERROR,
    };
  }

  const list = povSummaries?.povSummaries;
  if (Array.isArray(list) && list.length > 0) {
    const nodeId = Number(node.id);
    let match = Number.isFinite(nodeId)
      ? list.find((s) => Number(s.characterId) === nodeId)
      : null;
    if (!match) {
      const names = collectNodeMatchNames(node);
      match = list.find((s) => names.includes(normalizeMatchName(s.characterName)));
    }
    const summaryText = typeof match?.summaryText === 'string' ? match.summaryText.trim() : '';
    if (summaryText) {
      return { text: summaryText, status: S.READY };
    }
  }

  const chapterLabel = currentChapter || 1;
  if (povCached === false) {
    return {
      text: `${node.displayName}의 ${formatChapterOrdinalLabel(chapterLabel)} 시점 요약은 아직 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.`,
      status: S.PENDING,
    };
  }

  return {
    text: '해당 챕터에서는 해당 캐릭터의 등장 비중이 낮아 별도의 분석 내용이 제공되지 않습니다.',
    status: S.NO_DATA,
  };
}

const chapterPovQueryKey = (bookId, chapterIdx) => [
  'books',
  bookId,
  'chapters',
  chapterIdx,
  'pov-summaries',
];

const POV_STALE_MS = 5 * 60 * 1000;
const POV_GC_MS = 60 * 60 * 1000;

/**
 * @returns {{
 *   povSummaries: object | null,
 *   error: string | null,
 *   isLoading: boolean,
 *   retry: () => void,
 * }}
 */
export function useChapterPovSummaries(bookId, chapterIdx) {
  const bid = toPositiveNumberOrNull(bookId);
  const ch = toPositiveInt(chapterIdx);

  const query = useQuery({
    queryKey: chapterPovQueryKey(bid, ch),
    enabled: bid != null && ch != null,
    staleTime: POV_STALE_MS,
    gcTime: POV_GC_MS,
    retry: 1,
    queryFn: async () => {
      const response = await getChapterPovSummaries(bid, ch);
      // 403/404 soft — 미생성·미노출을 하드 에러로 올리지 않음
      if (response?.code === 'NOT_FOUND' || response?.code === 'FORBIDDEN') {
        return normalizeChapterPovSummariesResult({
          bookId: bid,
          chapterIdx: ch,
          povSummaries: [],
        });
      }
      if (!response?.isSuccess) {
        throw new Error(response?.message || 'POV 요약을 불러오지 못했습니다.');
      }
      return normalizeChapterPovSummariesResult(response.result);
    },
  });

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const errorMessage =
    query.error == null
      ? null
      : typeof query.error?.message === 'string'
        ? query.error.message
        : 'POV 요약을 불러오는 중 오류가 발생했습니다.';

  return {
    povSummaries: query.data ?? null,
    error: errorMessage,
    isLoading: Boolean(
      bid != null && ch != null && (query.isPending || (query.isFetching && query.data == null)),
    ),
    retry,
  };
}
