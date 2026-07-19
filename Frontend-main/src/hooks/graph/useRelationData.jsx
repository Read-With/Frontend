/** relationship-deltas → graph timeline (엣지 툴팁) */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { resolvePositiveBookId } from '../common/hooksShared';
import {
  padSingleEvent,
  fetchRelationTimelineCumulative,
  fetchRelationTimelineViewer,
} from '../../utils/graph/graphData';

function buildRelationFetchKey(mode, bookId, id1, id2, chapterNum, eventNum) {
  return `${mode}:${bookId}:${id1}:${id2}:${chapterNum}:${eventNum ?? ''}`;
}

export function useRelationData(mode, id1, id2, chapterNum, eventNum, bookId = null) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const lastSuccessKeyRef = useRef('');

  const numericBookId = useMemo(() => resolvePositiveBookId(bookId), [bookId]);

  const resetEmpty = useCallback((message) => {
    requestIdRef.current += 1;
    lastSuccessKeyRef.current = '';
    setTimeline([]);
    setLabels([]);
    setNoRelation(true);
    setError(message);
    setLoading(false);
  }, []);

  const fetchData = useCallback(async (options = {}) => {
    const force = options?.force === true;

    if (!numericBookId || !id1 || !id2 || !chapterNum) {
      resetEmpty('관계 타임라인을 불러올 수 없습니다.');
      return;
    }

    const fetchKey = buildRelationFetchKey(
      mode,
      numericBookId,
      id1,
      id2,
      chapterNum,
      eventNum ? Math.max(1, eventNum) : 1
    );

    if (!force && lastSuccessKeyRef.current === fetchKey) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const result =
        mode === 'cumulative'
          ? await fetchRelationTimelineCumulative(numericBookId, id1, id2, chapterNum)
          : await fetchRelationTimelineViewer(
              numericBookId,
              id1,
              id2,
              chapterNum,
              eventNum ? Math.max(1, eventNum) : 1
            );

      if (requestId !== requestIdRef.current) return;

      const { points, labelInfo, noRelation: resultNoRelation } = result;
      const { points: paddedPoints, labels: paddedLabels } = padSingleEvent(points, labelInfo);

      setTimeline(paddedPoints);
      setLabels(paddedLabels);
      setNoRelation(resultNoRelation || paddedPoints.filter((value) => value !== null).length === 0);
      lastSuccessKeyRef.current = fetchKey;
    } catch {
      if (requestId !== requestIdRef.current) return;
      lastSuccessKeyRef.current = '';
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
      setError('관계 데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [numericBookId, id1, id2, chapterNum, eventNum, mode, resetEmpty]);

  useEffect(() => {
    void fetchData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchData]);

  const retryFetch = useCallback(() => fetchData({ force: true }), [fetchData]);

  return useMemo(
    () => ({
      timeline,
      labels,
      loading,
      noRelation,
      error,
      fetchData: retryFetch,
    }),
    [timeline, labels, loading, noRelation, error, retryFetch]
  );
}
