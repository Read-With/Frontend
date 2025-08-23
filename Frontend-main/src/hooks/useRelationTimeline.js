import { useEffect, useMemo, useState } from "react";
import { getChapterLastEventNums, getEventDataByIndex, getMaxEventCount } from "../utils/graphData";
import { normalizeRelation, isValidRelation, safeNum, isSamePair } from "../utils/relationUtils";

// Build timeline for a pair (id1,id2) across chapters up to current chapter/event
export default function useRelationTimeline({ id1, id2, chapterNum, eventNum, maxChapter = 10 }) {
  const [points, setPoints] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);

  const sid1 = safeNum(id1);
  const sid2 = safeNum(id2);

  const lastEventNums = useMemo(() => getChapterLastEventNums(maxChapter), [maxChapter]);

  useEffect(() => {
    if (!Number.isFinite(sid1) || !Number.isFinite(sid2)) {
      setPoints([]);
      setLabels([]);
      return;
    }
    setLoading(true);

    // 1) find first appearance
    let firstAppearance = null;
    for (let ch = 1; ch <= chapterNum; ch++) {
      const lastEv = lastEventNums[ch - 1] || 0;
      for (let e = 1; e <= lastEv; e++) {
        const json = getEventDataByIndex(ch, e);
        if (!json) continue;
        const found = (json.relations || [])
          .map(normalizeRelation)
          .filter(isValidRelation)
          .find(r => isSamePair(r, sid1, sid2));
        if (found) {
          firstAppearance = { chapter: ch, event: e };
          break;
        }
      }
      if (firstAppearance) break;
    }

    const nextPoints = [];
    const nextLabels = [];

    if (firstAppearance) {
      // previous chapters: use last snapshot
      for (let ch = firstAppearance.chapter; ch < chapterNum; ch++) {
        const lastEv = lastEventNums[ch - 1] || 0;
        const json = getEventDataByIndex(ch, lastEv);
        if (!json) {
          nextPoints.push(0);
          nextLabels.push(`챕터${ch}`);
        } else {
          const found = (json.relations || [])
            .map(normalizeRelation)
            .filter(isValidRelation)
            .find(r => isSamePair(r, sid1, sid2));
          nextPoints.push(found ? found.positivity : 0);
          nextLabels.push(`챕터${ch}`);
        }
      }

      // current chapter: all events
      const currentLastEv = lastEventNums[chapterNum - 1] || 0;
      for (let e = 1; e <= currentLastEv; e++) {
        const json = getEventDataByIndex(chapterNum, e);
        if (!json) {
          nextPoints.push(0);
          nextLabels.push(`E${e}`);
          continue;
        }
        const found = (json.relations || [])
          .map(normalizeRelation)
          .filter(isValidRelation)
          .find(r => isSamePair(r, sid1, sid2));
        nextPoints.push(found ? found.positivity : 0);
        nextLabels.push(`E${e}`);
      }
    }

    // padding for single point
    if (nextPoints.length === 1) {
      const paddedLabels = Array(11).fill('').map((_, i) => i === 5 ? nextLabels[0] : '');
      const paddedPoints = Array(11).fill(null).map((_, i) => i === 5 ? nextPoints[0] : null);
      setPoints(paddedPoints);
      setLabels(paddedLabels);
    } else {
      setPoints(nextPoints);
      setLabels(nextLabels);
    }

    setLoading(false);
  }, [sid1, sid2, chapterNum, eventNum, maxChapter, lastEventNums]);

  return { points, labels, loading, maxEventCount: getMaxEventCount(maxChapter) };
}


