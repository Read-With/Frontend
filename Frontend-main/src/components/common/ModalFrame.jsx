import { useRef } from 'react';
import { useModalFocusTrap, useBodyScrollLock } from '../../hooks/common/hooksShared';

/**
 * 모달 공통 틀: 오버레이(클릭 시 닫기) + 다이얼로그(aria-modal·포커스 트랩·내부 클릭 전파 차단).
 * 헤더·본문·버튼은 children. 클래스명은 각 모달 CSS를 그대로 쓴다.
 *
 * @param {() => void} [onClose]       오버레이 클릭 시 호출 (closeOnOverlay=false면 무시)
 * @param {() => void} [onEscape]      Escape 처리. 상위가 Escape를 처리하면 생략 (useModalFocusTrap 참고)
 * @param {boolean}    [lockScroll]    열려 있는 동안 body 스크롤 잠금
 */
export default function ModalFrame({
  open,
  onClose,
  onEscape,
  closeOnOverlay = true,
  overlayClassName,
  className,
  role = 'dialog',
  labelledBy,
  describedBy,
  initialFocusRef,
  lockScroll = false,
  children,
}) {
  const dialogRef = useRef(null);
  useModalFocusTrap(open, dialogRef, onEscape, { initialFocusRef });
  useBodyScrollLock(open && lockScroll);

  if (!open) return null;

  return (
    <div
      className={overlayClassName}
      role="presentation"
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        className={className}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
