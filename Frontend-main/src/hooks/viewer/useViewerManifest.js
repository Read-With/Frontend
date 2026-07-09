/** 뷰어 manifest 로드 게이트 */

import { useState, useEffect } from 'react';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { errorUtils } from '../../utils/common/errorUtils';
import { ensureBookManifest } from '../common/manifestEnsure';

function resolveInitialManifestLoaded(manifestServerBookId) {
  if (!manifestServerBookId) return true;
  return Boolean(getManifestFromCache(manifestServerBookId));
}

export function useViewerManifest(manifestServerBookId) {
  const [manifestLoaded, setManifestLoaded] = useState(() =>
    resolveInitialManifestLoaded(manifestServerBookId)
  );

  useEffect(() => {
    if (!manifestServerBookId) {
      setManifestLoaded(true);
      return undefined;
    }

    if (getManifestFromCache(manifestServerBookId)) {
      setManifestLoaded(true);
      return undefined;
    }

    let cancelled = false;
    setManifestLoaded(false);

    void ensureBookManifest(manifestServerBookId).then((outcome) => {
      if (cancelled) return;
      if (!outcome.ok && !outcome.skipped) {
        errorUtils.logWarning(
          '[useViewerManifest] manifest 로드 실패',
          outcome.error?.message ?? outcome.response?.message ?? '알 수 없는 오류'
        );
      }
      setManifestLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [manifestServerBookId]);

  return { manifestLoaded };
}
