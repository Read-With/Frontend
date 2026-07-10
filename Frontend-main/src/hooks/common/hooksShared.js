/** hooks 공통: bookId·이벤트 인덱스 해석 */

import { useRef } from 'react';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import {
  resolveServerBookId,
  resolveViewerBookKey,
} from '../../utils/viewer/viewerCoreStateUtils';

export { resolveViewerBookKey };

export function resolvePositiveBookId(bookId) {
  return toPositiveNumberOrNull(bookId);
}

export function useLatestRef(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function resolveServerBookIdOrFallback(book, routeBookId = null) {
  return resolveServerBookId(book) ?? toPositiveNumberOrNull(routeBookId);
}
