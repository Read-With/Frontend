import React, { useState, useEffect } from 'react';
import { createButtonStyle, createAdvancedButtonHandlers } from '../../../utils/styles/styles';
import { ANIMATION_VALUES } from '../../../utils/styles/animations';

// 로컬 스토리지에서 설정 불러오기/저장하기 함수
const loadSettings = () => {
  try {
    const settings = localStorage.getItem('epub_viewer_settings');
    return settings ? JSON.parse(settings) : null;
  } catch (e) {
    return null;
  }
};

const saveSettings = (settings) => {
  try {
    localStorage.setItem('epub_viewer_settings', JSON.stringify(settings));
  } catch (e) {
    // 설정 저장 오류 처리
  }
};

// 기본 설정 값
const defaultSettings = {
  fontSize: 100, // 기본 글꼴 크기 (%)
  pageMode: 'double', // 페이지 모드 (single, double)
  lineHeight: 1.5, // 줄 간격
  margin: 20, // 여백 (px)
  fontFamily: 'default', // 글꼴
  showGraph: true, // 그래프 표시 여부
};

const ViewerSettings = ({ isOpen, onClose, onApplySettings, currentSettings }) => {
  // 현재 설정 상태
  const [settings, setSettings] = useState(() => {
    // 저장된 설정 또는 현재 설정 또는 기본 설정 사용
    const initialSettings = currentSettings || loadSettings() || defaultSettings;
    
    // leftOnly 모드였다면 double로 변경
    if (initialSettings.pageMode === 'leftOnly') {
      initialSettings.pageMode = 'double';
    }
    
    return initialSettings;
  });
  
  // 설정 변경 핸들러
  const handleChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  // 설정 적용 핸들러
  const handleApply = () => {
    saveSettings(settings);
    onApplySettings(settings);
    onClose();
  };
  
  // 설정 초기화 핸들러
  const handleReset = () => {
    setSettings(defaultSettings);
  };
  
  // 모달 외부 클릭 시 닫기
  const handleOutsideClick = (e) => {
    if (e.target.classList.contains('settings-modal-overlay')) {
      onClose();
    }
  };
  
  // ESC 키 누를 때 닫기
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
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22336b' }}>뷰어 설정</h2>
          <button 
            onClick={onClose}
            style={createButtonStyle(ANIMATION_VALUES, 'close')}
            {...createAdvancedButtonHandlers('close')}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        
        {/* 페이지 모드 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">view_column</span> 페이지 모드
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleChange('pageMode', 'single')}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, settings.pageMode === 'single' ? 'primary' : 'default'),
                backgroundColor: settings.pageMode === 'single' ? '#4F6DDE' : '#f8fafc',
                color: settings.pageMode === 'single' ? 'white' : '#22336b',
                border: '1px solid #e7eaf7',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'single' ? 'bold' : 'normal',
              }}
              {...createAdvancedButtonHandlers(settings.pageMode === 'single' ? 'primary' : 'default')}
            >
              {settings.pageMode === 'single' && <span className="material-symbols-outlined">check</span>} 단일 페이지
            </button>
            <button
              onClick={() => handleChange('pageMode', 'double')}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, settings.pageMode === 'double' ? 'primary' : 'default'),
                backgroundColor: settings.pageMode === 'double' ? '#4F6DDE' : '#f8fafc',
                color: settings.pageMode === 'double' ? 'white' : '#22336b',
                border: '1px solid #e7eaf7',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'double' ? 'bold' : 'normal',
              }}
              {...createAdvancedButtonHandlers(settings.pageMode === 'double' ? 'primary' : 'default')}
            >
              {settings.pageMode === 'double' && <span className="material-symbols-outlined">check</span>} 분할 페이지
            </button>
          </div>
        </div>
        
        {/* 그래프 표시 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">bar_chart</span> 그래프 표시
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleChange('showGraph', true)}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, settings.showGraph ? 'primary' : 'default'),
                backgroundColor: settings.showGraph ? '#4F6DDE' : '#f8fafc',
                color: settings.showGraph ? 'white' : '#22336b',
                border: '1px solid #e7eaf7',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.showGraph ? 'bold' : 'normal',
              }}
              {...createAdvancedButtonHandlers(settings.showGraph ? 'primary' : 'default')}
            >
              {settings.showGraph && <span className="material-symbols-outlined">check</span>} 그래프 표시
            </button>
            <button
              onClick={() => handleChange('showGraph', false)}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, !settings.showGraph ? 'primary' : 'default'),
                backgroundColor: !settings.showGraph ? '#4F6DDE' : '#f8fafc',
                color: !settings.showGraph ? 'white' : '#22336b',
                border: '1px solid #e7eaf7',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: !settings.showGraph ? 'bold' : 'normal',
              }}
              {...createAdvancedButtonHandlers(!settings.showGraph ? 'primary' : 'default')}
            >
              {!settings.showGraph && <span className="material-symbols-outlined">check</span>} 그래프 숨기기
            </button>
          </div>
        </div>
        
        {/* 글꼴 크기 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">format_size</span> 글꼴 크기
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => handleChange('fontSize', Math.max(80, settings.fontSize - 10))}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, 'default'),
                padding: '8px 12px',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                border: '1px solid #e7eaf7',
                fontWeight: 'bold',
              }}
              {...createAdvancedButtonHandlers('default')}
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
                ...createButtonStyle(ANIMATION_VALUES, 'default'),
                padding: '8px 12px',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                border: '1px solid #e7eaf7',
                fontWeight: 'bold',
              }}
              {...createAdvancedButtonHandlers('default')}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.fontSize}%</span>
          </div>
        </div>
        
        
        {/* 줄 간격 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px' }}>
            줄 간격
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => handleChange('lineHeight', Math.max(1.0, settings.lineHeight - 0.1))}
              style={{
                ...createButtonStyle(ANIMATION_VALUES, 'default'),
                padding: '8px 12px',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                border: '1px solid #e7eaf7',
                fontWeight: 'bold',
              }}
              {...createAdvancedButtonHandlers('default')}
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
                ...createButtonStyle(ANIMATION_VALUES, 'default'),
                padding: '8px 12px',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                border: '1px solid #e7eaf7',
                fontWeight: 'bold',
              }}
              {...createAdvancedButtonHandlers('default')}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.lineHeight.toFixed(1)}</span>
          </div>
        </div>
        
        {/* 버튼 그룹 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
          <button
            onClick={handleReset}
            style={{
              ...createButtonStyle(ANIMATION_VALUES, 'default'),
              backgroundColor: '#f8fafc',
              color: '#22336b',
              border: '1px solid #e7eaf7',
            }}
            {...createAdvancedButtonHandlers('default')}
          >
            초기화
          </button>
          <button
            onClick={handleApply}
            style={{
              ...createButtonStyle(ANIMATION_VALUES, 'primary'),
              fontWeight: 'bold',
            }}
            {...createAdvancedButtonHandlers('primary')}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewerSettings; 