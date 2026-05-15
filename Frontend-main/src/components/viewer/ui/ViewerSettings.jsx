import React, { useState, useEffect, useCallback } from 'react';
import { defaultSettings, loadSettings, saveSettings } from '../../../utils/common/settingsUtils';

const ACCENT = '#5C6F5C';
const HOVER_BG = '#f0fdf4';

const MODE_OPTIONS = [
  { pageMode: 'single', showGraph: true, icon: 'view_column', label: '단일 뷰어 & 그래프 화면' },
  { pageMode: 'single', showGraph: false, icon: 'view_column', label: '단일 뷰어화면' },
  { pageMode: 'double', showGraph: false, icon: 'view_column_2', label: '분할 뷰어화면' },
];

const modeBtnBase = {
  border: `1px solid ${ACCENT}`,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px',
  textAlign: 'left',
  width: '100%',
  justifyContent: 'flex-start',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
};

const stepBtnStyle = {
  padding: '8px 12px',
  backgroundColor: 'white',
  color: ACCENT,
  border: `1px solid ${ACCENT}`,
  fontWeight: 'bold',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
};

const outlineBtn = {
  backgroundColor: 'white',
  color: ACCENT,
  border: `1px solid ${ACCENT}`,
  padding: '10px 20px',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
};

const applyBtn = {
  backgroundColor: ACCENT,
  color: 'white',
  border: 'none',
  padding: '10px 20px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 'bold',
  transition: 'all 0.2s ease',
};

const closeHeaderBtn = {
  backgroundColor: 'white',
  color: ACCENT,
  border: `1px solid ${ACCENT}`,
  padding: '8px 12px',
  borderRadius: '8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s ease',
};

const onLightHoverOver = (e) => {
  e.currentTarget.style.backgroundColor = HOVER_BG;
};
const onLightHoverOut = (e) => {
  e.currentTarget.style.backgroundColor = 'white';
};

const onApplyHoverOver = (e) => {
  e.currentTarget.style.backgroundColor = '#4A5A4A';
};
const onApplyHoverOut = (e) => {
  e.currentTarget.style.backgroundColor = ACCENT;
};

function isModeSelected(s, opt) {
  return s.pageMode === opt.pageMode && s.showGraph === opt.showGraph;
}

const ViewerSettings = ({ isOpen, onClose, onApplySettings, currentSettings }) => {
  const [settings, setSettings] = useState(() => {
    const raw = currentSettings || loadSettings() || defaultSettings;
    const base = { ...raw };
    if (base.pageMode === 'leftOnly') {
      base.pageMode = 'double';
    }
    return base;
  });

  const handleChange = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const handleApply = useCallback(() => {
    saveSettings(settings);
    onApplySettings(settings);
    onClose();
  }, [settings, onApplySettings, onClose]);

  const handleReset = useCallback(() => {
    setSettings({ ...defaultSettings });
  }, []);

  const handleOutsideClick = useCallback((e) => {
    if (e.target.classList.contains('settings-modal-overlay')) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="settings-modal-overlay"
      onClick={handleOutsideClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        className="settings-modal"
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          width: '90%',
          maxWidth: '500px',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: ACCENT }}>뷰어 설정</h2>
          <button
            onClick={onClose}
            style={closeHeaderBtn}
            onMouseOver={onLightHoverOver}
            onMouseOut={onLightHoverOut}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: ACCENT, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">visibility</span> 화면 모드
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {MODE_OPTIONS.map((opt) => {
              const sel = isModeSelected(settings, opt);
              return (
                <button
                  key={`${opt.pageMode}-${opt.showGraph}`}
                  type="button"
                  onClick={() => {
                    setSettings((prev) => ({
                      ...prev,
                      pageMode: opt.pageMode,
                      showGraph: opt.showGraph,
                    }));
                  }}
                  style={{
                    ...modeBtnBase,
                    backgroundColor: sel ? ACCENT : 'white',
                    color: sel ? 'white' : ACCENT,
                    fontWeight: sel ? 'bold' : 'normal',
                  }}
                >
                  {sel && <span className="material-symbols-outlined">check</span>}
                  <span className="material-symbols-outlined">{opt.icon}</span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: ACCENT, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">format_size</span> 글꼴 크기
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => handleChange('fontSize', Math.max(80, settings.fontSize - 10))}
              style={stepBtnStyle}
              onMouseOver={onLightHoverOver}
              onMouseOut={onLightHoverOut}
            >
              -
            </button>
            <div style={{ flex: 1 }}>
              <input
                type="range"
                min="80"
                max="150"
                step="10"
                value={settings.fontSize}
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </div>
            <button
              type="button"
              onClick={() => handleChange('fontSize', Math.min(150, settings.fontSize + 10))}
              style={stepBtnStyle}
              onMouseOver={onLightHoverOver}
              onMouseOut={onLightHoverOut}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.fontSize}%</span>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: ACCENT, marginBottom: '12px' }}>
            줄 간격
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => handleChange('lineHeight', Math.max(1.0, settings.lineHeight - 0.1))}
              style={stepBtnStyle}
              onMouseOver={onLightHoverOver}
              onMouseOut={onLightHoverOut}
            >
              -
            </button>
            <div style={{ flex: 1 }}>
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.1"
                value={settings.lineHeight}
                onChange={(e) => handleChange('lineHeight', parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <button
              type="button"
              onClick={() => handleChange('lineHeight', Math.min(2.0, settings.lineHeight + 0.1))}
              style={stepBtnStyle}
              onMouseOver={onLightHoverOver}
              onMouseOut={onLightHoverOut}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.lineHeight.toFixed(1)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
          <button
            type="button"
            onClick={handleReset}
            style={outlineBtn}
            onMouseOver={onLightHoverOver}
            onMouseOut={onLightHoverOut}
          >
            초기화
          </button>
          <button
            type="button"
            onClick={handleApply}
            style={applyBtn}
            onMouseOver={onApplyHoverOver}
            onMouseOut={onApplyHoverOut}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewerSettings;
