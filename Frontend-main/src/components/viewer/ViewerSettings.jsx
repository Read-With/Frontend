import { useState, useEffect, useCallback, useId } from 'react';
import { Check, Eye, Type, X } from 'lucide-react';
import {
  defaultSettings,
  normalizeSettings,
  VIEWER_MODE_OPTIONS,
  viewerFontStack,
} from '../../utils/viewer/viewerSession';
import ModalFrame from '../common/ModalFrame';
import './ViewerSettings.css';

/** 설정 한 줄: − / 슬라이더 / + / 값. ± 버튼은 step 단위로 이동하고 [min, max]로 제한 */
function StepSlider({ labelId, title, icon = null, value, min, max, step, decimals, format, decreaseLabel, increaseLabel, onChange }) {
  const stepBy = (dir) =>
    onChange(Math.min(max, Math.max(min, Number((value + dir * step).toFixed(decimals)))));
  return (
    <div className="viewer-settings-section">
      <h3 className="viewer-settings-section-title" id={labelId}>
        {icon}
        {title}
      </h3>
      <div className="viewer-settings-step-row">
        <button type="button" className="viewer-settings-step-btn" aria-label={decreaseLabel} onClick={() => stepBy(-1)}>
          -
        </button>
        <div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-labelledby={labelId}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={format(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
        <button type="button" className="viewer-settings-step-btn" aria-label={increaseLabel} onClick={() => stepBy(1)}>
          +
        </button>
        <span className="viewer-settings-step-value" aria-hidden="true">
          {format(value)}
        </span>
      </div>
    </div>
  );
}

const ViewerSettings = ({ isOpen, onClose, onApplySettings, settings }) => {
  const titleId = useId();

  const [draft, setDraft] = useState(() =>
    normalizeSettings(settings || defaultSettings)
  );

  useEffect(() => {
    if (isOpen) {
      setDraft(normalizeSettings(settings || defaultSettings));
    }
  }, [isOpen, settings]);

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

  return (
    <ModalFrame
      open={isOpen}
      onClose={onClose}
      onEscape={onClose}
      overlayClassName="viewer-settings-overlay"
      className="viewer-settings-dialog"
      labelledBy={titleId}
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
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="viewer-settings-section">
          <h3 className="viewer-settings-section-title">
            <Eye size={18} aria-hidden />
            보기 방식
          </h3>
          <div className="viewer-settings-mode-list" role="radiogroup" aria-label="보기 방식">
            {VIEWER_MODE_OPTIONS.map((opt) => {
              const sel = draft.showGraph === opt.showGraph;
              const OptIcon = opt.Icon;
              return (
                <button
                  key={String(opt.showGraph)}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  className={`viewer-settings-mode-btn${sel ? ' is-selected' : ''}`}
                  onClick={() => handleChange('showGraph', opt.showGraph)}
                >
                  {sel && <Check size={18} aria-hidden />}
                  <OptIcon size={18} aria-hidden />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <StepSlider
          labelId="viewer-settings-font-size"
          title="글꼴 크기"
          icon={<Type size={18} aria-hidden />}
          value={draft.fontSize}
          min={80}
          max={150}
          step={10}
          decimals={0}
          format={(v) => `${v}%`}
          decreaseLabel="글꼴 크기 줄이기"
          increaseLabel="글꼴 크기 늘리기"
          onChange={(v) => handleChange('fontSize', v)}
        />

        <StepSlider
          labelId="viewer-settings-line-height"
          title="줄 간격"
          value={draft.lineHeight}
          min={1}
          max={2}
          step={0.1}
          decimals={1}
          format={(v) => v.toFixed(1)}
          decreaseLabel="줄 간격 줄이기"
          increaseLabel="줄 간격 늘리기"
          onChange={(v) => handleChange('lineHeight', v)}
        />

        <p
          className="viewer-settings-preview"
          style={{
            fontSize: `${draft.fontSize}%`,
            lineHeight: draft.lineHeight,
            fontFamily: viewerFontStack(draft.fontFamily),
          }}
        >
          그는 창가에 앉아 오래된 책장을 넘겼다. 바람이 불 때마다 종이 냄새가 방 안에 번졌다.
        </p>

        <p className="viewer-settings-shortcuts">
          단축키: ← → 페이지 이동 · T 툴바 표시/숨김
        </p>

        <div className="viewer-settings-actions">
          <button type="button" className="viewer-settings-outline-btn" onClick={handleReset}>
            초기화
          </button>
          <button type="button" className="viewer-settings-apply-btn" onClick={handleApply}>
            적용
          </button>
        </div>
    </ModalFrame>
  );
};

export default ViewerSettings;
