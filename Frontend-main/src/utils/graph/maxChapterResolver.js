import { getMaxChapter, getManifestFromCache, calculateMaxChapterFromChapters } from '../common/cache/manifestCache';
import { getGraphBookCache } from '../common/cache/chapterEventCache';

export const resolveMaxChapter = (bookId, manifest = null, graphCache = null) => {
  if (!bookId) {
    return 1;
  }

  const cache = graphCache || getGraphBookCache(bookId);
  if (cache?.maxChapter && cache.maxChapter > 0) {
    return cache.maxChapter;
  }

  const cachedMaxChapter = getMaxChapter(bookId);
  if (cachedMaxChapter && cachedMaxChapter > 0) {
    return cachedMaxChapter;
  }

  const manifestData = manifest || getManifestFromCache(bookId);
  if (manifestData?.progressMetadata?.maxChapter && manifestData.progressMetadata.maxChapter > 0) {
    return manifestData.progressMetadata.maxChapter;
  }

  if (manifestData?.chapters && Array.isArray(manifestData.chapters)) {
    return calculateMaxChapterFromChapters(manifestData.chapters);
  }

  return 1;
};
