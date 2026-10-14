import { useCallback, useId } from 'react';
import { useLatestRef } from '../../hooks/common/hooksShared';
import ModalFrame from '../common/ModalFrame';
import '../../pages/BookmarksPage.css';

/** 북마크 삭제 확인 — 뷰어 툴바(ViewerPage)와 북마크 목록(BookmarksPage) 공용 */
function BookmarkDeleteConfirm({
  open,
  busy,
  description,
  onCancel,
  onConfirm,
}) {
  const titleId = useId();
  const descId = useId();
  const busyRef = useLatestRef(busy);
  const onCancelRef = useLatestRef(onCancel);
  // busy/onCancel을 ref로 안정화 — useModalFocusTrap의 onClose 참조가 busy 토글마다 바뀌면
  // effect가 재실행되며 (버튼이 disabled된) 다이얼로그로 포커스가 불필요하게 튐
  const handleClose = useCallback(() => {
    if (!busyRef.current) onCancelRef.current?.();
  }, [busyRef, onCancelRef]);

  return (
    <ModalFrame
      open={open}
      onClose={onCancel}
      closeOnOverlay={!busy}
      onEscape={handleClose}
      overlayClassName="bm-confirm-overlay"
      className="bm-confirm-dialog"
      labelledBy={titleId}
      describedBy={descId}
      lockScroll
    >
        <p id={titleId} className="bm-confirm-title">
          북마크를 삭제할까요?
        </p>
        <p id={descId} className="bm-confirm-desc">
          {description}
        </p>
        <div className="bm-confirm-actions">
          <button
            type="button"
            className="bm-btn bm-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="bm-btn bm-btn-confirm-delete"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '삭제 중…' : '삭제'}
          </button>
        </div>
    </ModalFrame>
  );
}

export default BookmarkDeleteConfirm;
