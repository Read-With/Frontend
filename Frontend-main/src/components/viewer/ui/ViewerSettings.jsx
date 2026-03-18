import React, { useState, useEffect } from 'react';
import { defaultSettings, loadSettings, saveSettings } from '../../../utils/common/settingsUtils';

const ViewerSettings = ({ isOpen, onClose, onApplySettings, currentSettings }) => {
  const [settings, setSettings] = useState(() => {
    const initialSettings = currentSettings || loadSettings() || defaultSettings;
    if (initialSettings.pageMode === 'leftOnly') {
      initialSettings.pageMode = 'double';
    }
    return initialSettings;
  });

  const handleChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleApply = () => {
    saveSettings(settings);
    onApplySettings(settings);
    onClose();
  };

  const handleReset = () => {
    setSettings(defaultSettings);
  };

  const handleOutsideClick = (e) => {
    if (e.target.classList.contains('settings-modal-overlay')) {
      onClose();
    }
  };

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
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#5C6F5C' }}>뷰어 설정</h2>
          <button
            onClick={onClose}
            style={{
              backgroundColor: 'white',
              color: '#5C6F5C',
              border: '1px solid #5C6F5C',
              padding: '8px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#f0fdf4'}
            onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#5C6F5C', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">visibility</span> 화면 모드
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={() => {
                setSettings(prev => ({
                  ...prev,
                  pageMode: 'single',
                  showGraph: true
                }));
              }}
              style={{
                backgroundColor: settings.pageMode === 'single' && settings.showGraph ? '#5C6F5C' : 'white',
                color: settings.pageMode === 'single' && settings.showGraph ? 'white' : '#5C6F5C',
                border: '1px solid #5C6F5C',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'single' && settings.showGraph ? 'bold' : 'normal',
                padding: '12px 16px',
                textAlign: 'left',
                width: '100%',
                justifyContent: 'flex-start',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {settings.pageMode === 'single' && settings.showGraph && <span className="material-symbols-outlined">check</span>}
              <span className="material-symbols-outlined">view_column</span>
              단일 뷰어 & 그래프 화면
            </button>

            <button
              onClick={() => {
                setSettings(prev => ({
                  ...prev,
                  pageMode: 'single',
                  showGraph: false
                }));
              }}
              style={{
                backgroundColor: settings.pageMode === 'single' && !settings.showGraph ? '#5C6F5C' : 'white',
                color: settings.pageMode === 'single' && !settings.showGraph ? 'white' : '#5C6F5C',
                border: '1px solid #5C6F5C',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'single' && !settings.showGraph ? 'bold' : 'normal',
                padding: '12px 16px',
                textAlign: 'left',
                width: '100%',
                justifyContent: 'flex-start',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {settings.pageMode === 'single' && !settings.showGraph && <span className="material-symbols-outlined">check</span>}
              <span className="material-symbols-outlined">view_column</span>
              단일 뷰어화면
            </button>

            <button
              onClick={() => {
                setSettings(prev => ({
                  ...prev,
                  pageMode: 'double',
                  showGraph: false
                }));
              }}
              style={{
                backgroundColor: settings.pageMode === 'double' && !settings.showGraph ? '#5C6F5C' : 'white',
                color: settings.pageMode === 'double' && !settings.showGraph ? 'white' : '#5C6F5C',
                border: '1px solid #5C6F5C',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'double' && !settings.showGraph ? 'bold' : 'normal',
                padding: '12px 16px',
                textAlign: 'left',
                width: '100%',
                justifyContent: 'flex-start',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {settings.pageMode === 'double' && !settings.showGraph && <span className="material-symbols-outlined">check</span>}
              <span className="material-symbols-outlined">view_column_2</span>
              분할 뷰어화면
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#5C6F5C', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">format_size</span> 글꼴 크기
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => handleChange('fontSize', Math.max(80, settings.fontSize - 10))}
              style={{
                padding: '8px 12px',
                backgroundColor: 'white',
                color: '#5C6F5C',
                border: '1px solid #5C6F5C',
                fontWeight: 'bold',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#f0fdf4'}
              onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
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
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <button
              onClick={() => handleChange('fontSize', Math.min(150, settings.fontSize + 10))}
              style={{
                padding: '8px 12px',
                backgroundColor: 'white',
                color: '#5C6F5C',
                border: '1px solid #5C6F5C',
                fontWeight: 'bold',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#f0fdf4'}
              onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.fontSize}%</span>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#5C6F5C', marginBottom: '12px' }}>
            줄 간격
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => handleChange('lineHeight', Math.max(1.0, settings.lineHeight - 0.1))}
              style={{
                padding: '8px 12px',
                backgroundColor: 'white',
                color: '#5C6F5C',
                border: '1px solid #5C6F5C',
                fontWeight: 'bold',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#f0fdf4'}
              onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
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
              onClick={() => handleChange('lineHeight', Math.min(2.0, settings.lineHeight + 0.1))}
              style={{
                padding: '8px 12px',
                backgroundColor: 'white',
                color: '#5C6F5C',
                border: '1px solid #5C6F5C',
                fontWeight: 'bold',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#f0fdf4'}
              onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.lineHeight.toFixed(1)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
          <button
            onClick={handleReset}
            style={{
              backgroundColor: 'white',
              color: '#5C6F5C',
              border: '1px solid #5C6F5C',
              padding: '10px 20px',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#f0fdf4'}
            onMouseOut={(e) => e.target.style.backgroundColor = 'white'}
          >
            초기화
          </button>
          <button
            onClick={handleApply}
            style={{
              backgroundColor: '#5C6F5C',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#4A5A4A'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#5C6F5C'}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewerSettings;
