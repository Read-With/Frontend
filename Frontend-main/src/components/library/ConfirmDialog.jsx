import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { attachLibraryModalChrome } from '../../utils/library/libraryUtils';
import ModalFrame from '../common/ModalFrame';
import './ConfirmDialog.css';

/** 서재 카드 컨텍스트 메뉴, 책 상세 모달 등에서 공용으로 쓰는 삭제/확인 다이얼로그 */
const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  onClose,
  onConfirm,
  manageChrome = true,
}) => {
  const titleId = useId();
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !manageChrome) return undefined;
    return attachLibraryModalChrome({ onClose });
  }, [isOpen, manageChrome, onClose]);

  return (
    // Escape는 manageChrome일 때 attachLibraryModalChrome이, 아닐 때는 상위 모달(예: BookDetailModal)이 처리 — onEscape 생략
    <ModalFrame
      open={isOpen}
      onClose={onClose}
      overlayClassName="delete-confirm-modal-overlay"
      className="delete-confirm-modal"
      role="alertdialog"
      labelledBy={titleId}
      initialFocusRef={cancelBtnRef}
    >
        <div className="delete-confirm-header">
          <h3 id={titleId}>{title}</h3>
          <button
            className="delete-confirm-close"
            onClick={onClose}
            aria-label="닫기"
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className="delete-confirm-body">
          <p className="delete-confirm-message">{message}</p>
        </div>
        <div className="delete-confirm-actions">
          <button
            ref={cancelBtnRef}
            className="delete-confirm-cancel"
            onClick={onClose}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="delete-confirm-delete"
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
    </ModalFrame>
  );
};

export default ConfirmDialog;
