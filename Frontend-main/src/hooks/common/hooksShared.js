/** hooks 공통: bookId·이벤트 인덱스 해석 */

import { toPositiveNumberOrNull } from '../../utils/common/numberUtils';
import {
  resolveServerBookId,
  resolveViewerBookKey,
  resolveEventIdxOrFallback,
} from '../../utils/viewer/viewerCoreStateUtils';

export { resolveViewerBookKey, resolveEventIdxOrFallback };

export function resolvePositiveBookId(bookId) {
  return toPositiveNumberOrNull(bookId);
}

export function resolveServerBookIdOrFallback(book, routeBookId = null) {
  return resolveServerBookId(book) ?? toPositiveNumberOrNull(routeBookId);
}
