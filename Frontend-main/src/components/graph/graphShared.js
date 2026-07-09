/** 그래프 컴포넌트 공통 헬퍼 */

import {
  resolvePositiveBookId,
} from '../../hooks/common/hooksShared';
import { GRAPH_LAYOUT_CONSTANTS } from './graphConstants';

export function resolveTooltipBookId(bookId, filename) {
  return resolvePositiveBookId(bookId) ?? resolvePositiveBookId(filename);
}

export function isGraphOnlyGraphPage() {
  return typeof window !== 'undefined' && window.location.pathname.includes('/user/graph/');
}

export function resolveChapterSidebarWidth(isSidebarOpen) {
  const { OPEN_WIDTH, CLOSED_WIDTH } = GRAPH_LAYOUT_CONSTANTS.SIDEBAR;
  return isSidebarOpen ? OPEN_WIDTH : CLOSED_WIDTH;
}
