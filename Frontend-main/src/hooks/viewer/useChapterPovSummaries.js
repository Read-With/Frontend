import { useState, useEffect, useCallback } from 'react';
import { getChapterPovSummaries } from '../../utils/api/booksApi';

export const useChapterPovSummaries = (bookId, chapterIdx) => {
  const [povSummaries, setPovSummaries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPovSummaries = useCallback(async () => {
    if (!bookId || !chapterIdx) {
      setPovSummaries(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await getChapterPovSummaries(bookId, chapterIdx);
      
      if (response.isSuccess) {
        setPovSummaries(response.result);
      } else {
        throw new Error(response.message || '챕터 시점 요약 조회에 실패했습니다.');
      }
    } catch (err) {
      const errorMessage = err.message || '챕터 시점 요약 조회에 실패했습니다.';
      setError(errorMessage);
      setPovSummaries(null);
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterIdx]);

  useEffect(() => {
    fetchPovSummaries();
  }, [fetchPovSummaries]);

  const refetch = useCallback(() => {
    fetchPovSummaries();
  }, [fetchPovSummaries]);

  return {
    povSummaries,
    loading,
    error,
    refetch
  };
};

export default useChapterPovSummaries;
