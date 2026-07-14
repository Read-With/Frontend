/** 뷰어 페이지 네비게이션: 페이지 이동·레이아웃 복원 */

import { toast } from 'react-toastify';
import { anchorToLocators } from '../common/locatorUtils';
import { waitForPaint } from './viewerCoreStateUtils';

export function runViewerPaging(viewerRef, direction) {
  const ref = viewerRef.current;
  if (!ref) {
    toast.error('뷰어가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  try {
    if (direction === 'prev') ref.prevPage();
    else ref.nextPage();
  } catch {
    toast.error(
      direction === 'prev'
        ? '이전 페이지로 이동할 수 없습니다.'
        : '다음 페이지로 이동할 수 없습니다.'
    );
  }
}

export async function restoreViewerPosition(viewerRef, progress) {
  const { startLocator: start, endLocator: end } = anchorToLocators(
    viewerRef.current?.getCurrentLocator?.()
  );
  viewerRef.current?.refreshLayout?.();
  await waitForPaint();

  if (start && viewerRef.current?.displayAt) {
    const moved = viewerRef.current.displayAt({
      startLocator: start,
      endLocator: end ?? start,
    });
    if (moved) {
      await waitForPaint();
      return;
    }
  }

  const pct = Number(progress);
  if (Number.isFinite(pct) && pct >= 0) {
    await viewerRef.current?.moveToProgress?.(pct);
  }
  await waitForPaint();
}
