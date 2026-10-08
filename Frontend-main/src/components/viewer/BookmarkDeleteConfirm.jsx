import { useCallback, useId, useRef } from 'react';
import PropTypes from 'prop-types';
import { useModalFocusTrap, useLatestRef, useBodyScrollLock } from '../../hooks/common/hooksShared';
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
  const dialogRef = useRef(null);
  const busyRef = useLatestRef(busy);
  const onCancelRef = useLatestRef(onCancel);
  // busy/onCancel을 ref로 안정화 — useModalFocusTrap의 onClose 참조가 busy 토글마다 바뀌면
  // effect가 재실행되며 (버튼이 disabled된) 다이얼로그로 포커스가 불필요하게 튐
  const handleClose = useCallback(() => {
    if (!busyRef.current) onCancelRef.current?.();
  }, [busyRef, onCancelRef]);

  useModalFocusTrap(open, dialogRef, handleClose);
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div
      className="bm-confirm-overlay"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        className="bm-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
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
      </div>
    </div>
  );
}

BookmarkDeleteConfirm.propTypes = {
  open: PropTypes.bool.isRequired,
  busy: PropTypes.bool,
  description: PropTypes.node.isRequired,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};

export default BookmarkDeleteConfirm;
