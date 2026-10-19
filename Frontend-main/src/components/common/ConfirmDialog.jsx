import { useCallback, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useLatestRef } from '../../hooks/common/hooksShared';
import ModalFrame from './ModalFrame';
import './ConfirmDialog.css';

/**
 * 공용 확인 다이얼로그 (서재 숨기기·진도 삭제·북마크 삭제·로그아웃).
 * busy: 처리 중에는 버튼·닫기·Escape·오버레이 클릭을 막고 확인 버튼에 busyLabel 표시
 */
const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel = '삭제',
  busy = false,
  busyLabel = `${confirmLabel} 중…`,
  onClose,
  onConfirm,
}) => {
  const titleId = useId();
  const messageId = useId();
  const cancelBtnRef = useRef(null);
  const busyRef = useLatestRef(busy);
  const onCloseRef = useLatestRef(onClose);
  // busy/onClose를 ref로 고정 — Escape 핸들러 참조가 바뀌면 포커스 트랩 effect가 재실행되며 포커스가 튐
  const handleEscape = useCallback(() => {
    if (!busyRef.current) onCloseRef.current?.();
  }, [busyRef, onCloseRef]);

  return (
    <ModalFrame
      open={isOpen}
      onClose={onClose}
      onEscape={handleEscape}
      closeOnOverlay={!busy}
      lockScroll
      overlayClassName="delete-confirm-modal-overlay"
      className="delete-confirm-modal"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={messageId}
      initialFocusRef={cancelBtnRef}
    >
      <div className="delete-confirm-header">
        <h3 id={titleId}>{title}</h3>
        <button
          className="delete-confirm-close"
          onClick={onClose}
          aria-label="닫기"
          type="button"
          disabled={busy}
        >
          <X size={20} />
        </button>
      </div>
      <div className="delete-confirm-body">
        <p id={messageId} className="delete-confirm-message">{message}</p>
      </div>
      <div className="delete-confirm-actions">
        <button
          ref={cancelBtnRef}
          className="delete-confirm-cancel"
          onClick={onClose}
          type="button"
          disabled={busy}
        >
          취소
        </button>
        <button
          className="delete-confirm-delete"
          onClick={onConfirm}
          type="button"
          disabled={busy}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </ModalFrame>
  );
};

export default ConfirmDialog;
