import { useState, useEffect, useCallback } from 'react';
import { getChapterPovSummaries } from '../../utils/api/booksApi';

/** result: bookId, chapterIdx, chapterTitle, povSummaries[{ characterId, characterName, summaryText, isMainCharacter }] */
function normalizePovSummariesResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      bookId: null,
      chapterIdx: null,
      chapterTitle: '',
      povSummaries: [],
    };
  }
  const rows = Array.isArray(raw.povSummaries) ? raw.povSummaries : [];
  const povSummaries = rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const characterId = Number(row.characterId);
      if (!Number.isFinite(characterId)) return null;
      return {
        characterId,
        characterName: typeof row.characterName === 'string' ? row.characterName : '',
        summaryText: typeof row.summaryText === 'string' ? row.summaryText : '',
        isMainCharacter: Boolean(row.isMainCharacter),
      };
    })
    .filter(Boolean);
  const bookIdNum = Number(raw.bookId);
  const chapterIdxNum = Number(raw.chapterIdx);
  return {
    bookId: Number.isFinite(bookIdNum) && bookIdNum >= 1 ? bookIdNum : null,
    chapterIdx: Number.isFinite(chapterIdxNum) && chapterIdxNum >= 1 ? chapterIdxNum : null,
    chapterTitle: typeof raw.chapterTitle === 'string' ? raw.chapterTitle : '',
    povSummaries,
  };
}

export const useChapterPovSummaries = (bookId, chapterIdx) => {
  const [povSummaries, setPovSummaries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPovSummaries = useCallback(async () => {
    const bid = Number(bookId);
    const ch = Number(chapterIdx);
    if (!Number.isFinite(bid) || bid < 1 || !Number.isFinite(ch) || ch < 1) {
      setPovSummaries(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await getChapterPovSummaries(bid, ch);
      
      if (response.isSuccess) {
        setPovSummaries(normalizePovSummariesResult(response.result));
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

  return {
    povSummaries,
    loading,
    error,
    refetch: fetchPovSummaries,
  };
};

export default useChapterPovSummaries;
