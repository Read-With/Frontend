import { getManifestFromCache, calculateMaxChapterFromChapters } from '../common/cache/manifestCache';
import { toPositiveInt } from './graphNormalizeUtils';

/** v2: progressMetadata.maxChapter 와 chapters[].idx 최댓값 중 더 큰 값(둘 다 없으면 1). */
export const resolveMaxChapter = (bookId, manifest = null) => {
  const manifestData = manifest ?? (bookId ? getManifestFromCache(bookId) : null);
  const chapters = Array.isArray(manifestData?.chapters) ? manifestData.chapters : [];
  const fromChapters = calculateMaxChapterFromChapters(chapters);
  const fromMeta = toPositiveInt(manifestData?.progressMetadata?.maxChapter, 0);
  const m = Math.max(fromChapters, fromMeta);
  return m > 0 ? m : 1;
};
