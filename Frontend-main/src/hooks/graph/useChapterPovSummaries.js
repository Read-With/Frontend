/** 챕터 POV 요약 API 조회 (그래프 페이지) */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getChapterPovSummaries,
  normalizeChapterPovSummariesResult,
} from '../../utils/api/booksApi';

export function useChapterPovSummaries(bookId, chapterIdx) {
  const [povSummaries, setPovSummaries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const fetchPovSummaries = useCallback(async () => {
    const bid = Number(bookId);
    const ch = Number(chapterIdx);
    if (!Number.isFinite(bid) || bid < 1 || !Number.isFinite(ch) || ch < 1) {
      requestIdRef.current += 1;
      setPovSummaries(null);
      return;
    }

    const requestId = ++requestIdRef.current;

    try {
      setLoading(true);
      setError(null);

      const response = await getChapterPovSummaries(bid, ch);
      if (requestId !== requestIdRef.current) return;

      if (response.isSuccess) {
        setPovSummaries(normalizeChapterPovSummariesResult(response.result));
      } else {
        throw new Error(response.message || '챕터 시점 요약 조회에 실패했습니다.');
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const errorMessage = err.message || '챕터 시점 요약 조회에 실패했습니다.';
      setError(errorMessage);
      setPovSummaries(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [bookId, chapterIdx]);

  useEffect(() => {
    fetchPovSummaries();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchPovSummaries]);

  return {
    povSummaries,
    loading,
    error,
    refetch: fetchPovSummaries,
  };
}
