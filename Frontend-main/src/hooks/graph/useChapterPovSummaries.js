/** 챕터 POV 요약 API 조회 (그래프 페이지) */

import { useState, useEffect, useRef } from 'react';
import {
  getChapterPovSummaries,
  normalizeChapterPovSummariesResult,
} from '../../utils/api/booksApi';

const povInflight = new Map();

function fetchChapterPovSummariesOnce(bid, ch) {
  const key = `${bid}:${ch}`;
  const existing = povInflight.get(key);
  if (existing) return existing;

  const pending = getChapterPovSummaries(bid, ch).finally(() => {
    if (povInflight.get(key) === pending) {
      povInflight.delete(key);
    }
  });
  povInflight.set(key, pending);
  return pending;
}

export function useChapterPovSummaries(bookId, chapterIdx) {
  const [povSummaries, setPovSummaries] = useState(null);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const bid = Number(bookId);
    const ch = Number(chapterIdx);
    if (!Number.isFinite(bid) || bid < 1 || !Number.isFinite(ch) || ch < 1) {
      setPovSummaries(null);
      setError(null);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    setError(null);

    const fetchSummaries = async () => {
      try {
        const response = await fetchChapterPovSummariesOnce(bid, ch);
        if (requestId !== requestIdRef.current) return;

        if (response.isSuccess) {
          setPovSummaries(normalizeChapterPovSummariesResult(response.result));
          setError(null);
        } else {
          setPovSummaries(null);
          setError(response.message || 'POV 요약을 불러오지 못했습니다.');
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setPovSummaries(null);
        setError(err?.message || 'POV 요약을 불러오는 중 오류가 발생했습니다.');
      }
    };

    void fetchSummaries();

    return () => {
      requestIdRef.current += 1;
    };
  }, [bookId, chapterIdx]);

  return { povSummaries, error };
}
