import { useRef } from 'react';
import { useModalFocusTrap, useBodyScrollLock } from '../../hooks/common/hooksShared';

/**
 * 모달 공통 틀: 오버레이(클릭 시 닫기) + 다이얼로그(aria-modal·포커스 트랩·내부 클릭 전파 차단).
 * 헤더·본문·버튼은 children. 클래스명은 각 모달 CSS를 그대로 쓴다.
 *
 * @param {() => void} [onClose]       오버레이 클릭 시 호출 (closeOnOverlay=false면 무시)
 * @param {() => void} [onEscape]      Escape 처리. 상위가 Escape를 처리하면 생략 (useModalFocusTrap 참고)
 * @param {boolean}    [lockScroll]    열려 있는 동안 body 스크롤 잠금
 * @param {object}     [returnFocusRef] 닫을 때 포커스를 돌려줄 요소 (기본: 열기 직전 포커스)
 * @param {boolean}    [captureEscape] Escape를 캡처 단계에서 처리 (상위 keydown 핸들러보다 먼저)
 */
export default function ModalFrame({
  open,
  onClose,
  onEscape,
  closeOnOverlay = true,
  overlayClassName,
  overlayStyle,
  className,
  role = 'dialog',
  labelledBy,
  describedBy,
  initialFocusRef,
  lockScroll = false,
  returnFocusRef,
  captureEscape = false,
  children,
}) {
  const dialogRef = useRef(null);
  useModalFocusTrap(open, dialogRef, onEscape, { initialFocusRef, returnFocusRef, capture: captureEscape });
  useBodyScrollLock(open && lockScroll);

  if (!open) return null;

  return (
    <div
      className={overlayClassName}
      style={overlayStyle}
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
