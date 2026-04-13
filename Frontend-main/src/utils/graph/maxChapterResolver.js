import { getManifestFromCache, calculateMaxChapterFromChapters } from '../common/cache/manifestCache';

/** maxChapter: manifest.chapters의 챕터 인덱스 중 최댓값만 사용(그래프 캐시·progressMetadata 미사용). */
export const resolveMaxChapter = (bookId, manifest = null) => {
  const manifestData = manifest ?? (bookId ? getManifestFromCache(bookId) : null);
  const chapters = Array.isArray(manifestData?.chapters) ? manifestData.chapters : [];
  const m = calculateMaxChapterFromChapters(chapters);
  return m > 0 ? m : 1;
};
