/** 그래프 컴포넌트 공통 상수·헬퍼 */

import {
  resolvePositiveBookId,
} from '../../hooks/common/hooksShared';
import { getChapterData } from '../../utils/common/cache/manifestCache';
import { stripRedundantBookTitlePrefix } from '../../utils/viewer/chapterTitleDisplay';

export const GRAPH_LAYOUT_CONSTANTS = {
  SIDEBAR: { OPEN_WIDTH: 360, CLOSED_WIDTH: 60 },
  TOP_BAR_HEIGHT: 54,
  /** GraphCanvas 툴팁 사이드바 실제 너비와 동일해야 센터링이 맞음 */
  TOOLTIP_SIDEBAR_WIDTH: 480,
  ANIMATION_MS: 700,
};

export const GRAPH_CHARACTER_FILTER_STAGE_OPTIONS = [
  { value: 0, label: '모두 보기' },
  { value: 1, label: '주요 인물만 보기' },
  { value: 2, label: '주요 인물과 보기' },
];

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

/** 챕터 표시용 제목. 없으면 raw/display 모두 빈 문자열 */
export function getChapterTitleParts(manifestBookId, chapterNum, bookTitle, manifestHint) {
  if (manifestBookId == null) {
    return { raw: '', display: '' };
  }
  const n = Number(chapterNum);
  if (!Number.isFinite(n) || n < 1) {
    return { raw: '', display: '' };
  }
  const ch = getChapterData(manifestBookId, n, manifestHint ?? undefined);
  const raw = String(ch?.title ?? '').trim();
  if (!raw) {
    return { raw: '', display: '' };
  }
  const display = stripRedundantBookTitlePrefix(raw, bookTitle).trim() || raw;
  return { raw, display };
}

export function resolveChapterDisplayTitle(manifestBookId, chapterNum, bookTitle, manifestHint) {
  return getChapterTitleParts(manifestBookId, chapterNum, bookTitle, manifestHint).display;
}
