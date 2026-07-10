/** 챕터 POV 요약 API 조회 (그래프 페이지) */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getChapterPovSummaries,
  normalizeChapterPovSummariesResult,
} from '../../utils/api/booksApi';

export function useChapterPovSummaries(bookId, chapterIdx) {
  const [povSummaries, setPovSummaries] = useState(null);
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
      const response = await getChapterPovSummaries(bid, ch);
      if (requestId !== requestIdRef.current) return;

      if (response.isSuccess) {
        setPovSummaries(normalizeChapterPovSummariesResult(response.result));
      } else {
        setPovSummaries(null);
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setPovSummaries(null);
    }
  }, [bookId, chapterIdx]);

  useEffect(() => {
    fetchPovSummaries();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchPovSummaries]);

  return { povSummaries };
}
