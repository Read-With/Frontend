/** 챕터 단위 인물 시점(POV) 요약 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getChapterPovSummaries,
  normalizeChapterPovSummariesResult,
} from '../../utils/api/booksApi';
import { toPositiveNumberOrNull, toPositiveInt } from '../../utils/common/valueUtils';

export const chapterPovQueryKey = (bookId, chapterIdx) => [
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

  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);

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
