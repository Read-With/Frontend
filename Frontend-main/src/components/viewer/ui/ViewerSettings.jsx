import { useState, useEffect, useCallback, useRef, useId } from 'react';
import {
  defaultSettings,
  normalizeSettings,
  VIEWER_MODE_OPTIONS,
} from '../../../utils/common/settingsUtils';
import './ViewerSettings.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ViewerSettings = ({ isOpen, onClose, onApplySettings, currentSettings }) => {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  const [draft, setDraft] = useState(() =>
    normalizeSettings(currentSettings || defaultSettings)
  );

  useEffect(() => {
    if (isOpen) {
      setDraft(normalizeSettings(currentSettings || defaultSettings));
    }
  }, [isOpen, currentSettings]);

  const handleChange = useCallback((key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    onApplySettings(normalizeSettings(draft));
    onClose();
  }, [draft, onApplySettings, onClose]);

  const handleReset = useCallback(() => {
    setDraft({ ...defaultSettings });
  }, []);

  const handleOutsideClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocusedRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    const focusable = getFocusable();
    (focusable[0] || dialog).focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const nodes = getFocusable();
      if (nodes.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="viewer-settings-overlay"
      onClick={handleOutsideClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="viewer-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="viewer-settings-header">
          <h2 id={titleId} className="viewer-settings-title">
            뷰어 설정
          </h2>
          <button
            type="button"
            className="viewer-settings-close-btn"
            onClick={onClose}
            aria-label="설정 닫기"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className="viewer-settings-section">
          <h3 className="viewer-settings-section-title">
            <span className="material-symbols-outlined" aria-hidden="true">
              visibility
            </span>
            화면 모드
          </h3>
          <div className="viewer-settings-mode-list" role="radiogroup" aria-label="화면 모드">
            {VIEWER_MODE_OPTIONS.map((opt) => {
              const sel = draft.showGraph === opt.showGraph;
              return (
                <button
                  key={String(opt.showGraph)}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  className={`viewer-settings-mode-btn${sel ? ' is-selected' : ''}`}
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, showGraph: opt.showGraph }));
                  }}
                >
                  {sel && (
                    <span className="material-symbols-outlined" aria-hidden="true">
                      check
                    </span>
                  )}
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {opt.icon}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="viewer-settings-section">
          <h3 className="viewer-settings-section-title" id="viewer-settings-font-size">
            <span className="material-symbols-outlined" aria-hidden="true">
              format_size
            </span>
            글꼴 크기
          </h3>
          <div className="viewer-settings-step-row">
            <button
              type="button"
              className="viewer-settings-step-btn"
              aria-label="글꼴 크기 줄이기"
              onClick={() => handleChange('fontSize', Math.max(80, draft.fontSize - 10))}
            >
              -
            </button>
            <div>
              <input
                type="range"
                min="80"
                max="150"
                step="10"
                value={draft.fontSize}
                aria-labelledby="viewer-settings-font-size"
                aria-valuemin={80}
                aria-valuemax={150}
                aria-valuenow={draft.fontSize}
                aria-valuetext={`${draft.fontSize}%`}
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value, 10))}
              />
            </div>
            <button
              type="button"
              className="viewer-settings-step-btn"
              aria-label="글꼴 크기 늘리기"
              onClick={() => handleChange('fontSize', Math.min(150, draft.fontSize + 10))}
            >
              +
            </button>
            <span className="viewer-settings-step-value" aria-hidden="true">
              {draft.fontSize}%
            </span>
          </div>
        </div>

        <div className="viewer-settings-section">
          <h3 className="viewer-settings-section-title" id="viewer-settings-line-height">
            줄 간격
          </h3>
          <div className="viewer-settings-step-row">
            <button
              type="button"
              className="viewer-settings-step-btn"
              aria-label="줄 간격 줄이기"
              onClick={() =>
                handleChange('lineHeight', Math.max(1.0, Number((draft.lineHeight - 0.1).toFixed(1))))
              }
            >
              -
            </button>
            <div>
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.1"
                value={draft.lineHeight}
                aria-labelledby="viewer-settings-line-height"
                aria-valuemin={1}
                aria-valuemax={2}
                aria-valuenow={draft.lineHeight}
                aria-valuetext={draft.lineHeight.toFixed(1)}
                onChange={(e) => handleChange('lineHeight', parseFloat(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="viewer-settings-step-btn"
              aria-label="줄 간격 늘리기"
              onClick={() =>
                handleChange('lineHeight', Math.min(2.0, Number((draft.lineHeight + 0.1).toFixed(1))))
              }
            >
              +
            </button>
            <span className="viewer-settings-step-value" aria-hidden="true">
              {draft.lineHeight.toFixed(1)}
            </span>
          </div>
        </div>

        <div className="viewer-settings-actions">
          <button type="button" className="viewer-settings-outline-btn" onClick={handleReset}>
            초기화
          </button>
          <button type="button" className="viewer-settings-apply-btn" onClick={handleApply}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewerSettings;
