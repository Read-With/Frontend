import React, { useState, useEffect } from 'react';
import { FaTimes, FaFont, FaColumns, FaMoon, FaSun, FaCheck, FaChartBar } from 'react-icons/fa';

// 로컬 스토리지에서 설정 불러오기/저장하기 함수
const loadSettings = () => {
  try {
    const settings = localStorage.getItem('epub_viewer_settings');
    return settings ? JSON.parse(settings) : null;
  } catch (e) {
    console.error('설정 불러오기 오류:', e);
    return null;
  }
};

const saveSettings = (settings) => {
  try {
    localStorage.setItem('epub_viewer_settings', JSON.stringify(settings));
  } catch (e) {
    console.error('설정 저장 오류:', e);
  }
};

// 기본 설정 값
const defaultSettings = {
  fontSize: 100, // 기본 글꼴 크기 (%)
  pageMode: 'double', // 페이지 모드 (single, double)
  theme: 'light', // 테마 (light, dark, sepia)
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
            style={{ 
              background: 'none', 
              border: 'none', 
              fontSize: '1.5rem', 
              cursor: 'pointer',
              color: '#6b7280'
            }}
          >
            <FaTimes />
          </button>
        </div>
        
        {/* 페이지 모드 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FaColumns /> 페이지 모드
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleChange('pageMode', 'single')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: settings.pageMode === 'single' ? '#4F6DDE' : '#f8fafc',
                color: settings.pageMode === 'single' ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'single' ? 'bold' : 'normal',
              }}
            >
              {settings.pageMode === 'single' && <FaCheck />} 단일 페이지
            </button>
            <button
              onClick={() => handleChange('pageMode', 'double')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: settings.pageMode === 'double' ? '#4F6DDE' : '#f8fafc',
                color: settings.pageMode === 'double' ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.pageMode === 'double' ? 'bold' : 'normal',
              }}
            >
              {settings.pageMode === 'double' && <FaCheck />} 분할 페이지
            </button>
          </div>
        </div>
        
        {/* 그래프 표시 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FaChartBar /> 그래프 표시
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleChange('showGraph', true)}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: settings.showGraph ? '#4F6DDE' : '#f8fafc',
                color: settings.showGraph ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.showGraph ? 'bold' : 'normal',
              }}
            >
              {settings.showGraph && <FaCheck />} 그래프 표시
            </button>
            <button
              onClick={() => handleChange('showGraph', false)}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: !settings.showGraph ? '#4F6DDE' : '#f8fafc',
                color: !settings.showGraph ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: !settings.showGraph ? 'bold' : 'normal',
              }}
            >
              {!settings.showGraph && <FaCheck />} 그래프 숨기기
            </button>
          </div>
        </div>
        
        {/* 글꼴 크기 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FaFont /> 글꼴 크기
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => handleChange('fontSize', Math.max(80, settings.fontSize - 10))}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
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
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              +
            </button>
            <span style={{ minWidth: '60px', textAlign: 'right' }}>{settings.fontSize}%</span>
          </div>
        </div>
        
        {/* 테마 설정 */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#22336b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {settings.theme === 'dark' ? <FaMoon /> : <FaSun />} 테마
          </h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => handleChange('theme', 'light')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: settings.theme === 'light' ? '#4F6DDE' : '#f8fafc',
                color: settings.theme === 'light' ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.theme === 'light' ? 'bold' : 'normal',
              }}
            >
              {settings.theme === 'light' && <FaCheck />} 밝은 테마
            </button>
            <button
              onClick={() => handleChange('theme', 'dark')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: settings.theme === 'dark' ? '#4F6DDE' : '#f8fafc',
                color: settings.theme === 'dark' ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.theme === 'dark' ? 'bold' : 'normal',
              }}
            >
              {settings.theme === 'dark' && <FaCheck />} 어두운 테마
            </button>
            <button
              onClick={() => handleChange('theme', 'sepia')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: settings.theme === 'sepia' ? '#4F6DDE' : '#f8fafc',
                color: settings.theme === 'sepia' ? 'white' : '#22336b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: settings.theme === 'sepia' ? 'bold' : 'normal',
              }}
            >
              {settings.theme === 'sepia' && <FaCheck />} 세피아
            </button>
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
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
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
                borderRadius: '8px',
                border: '1px solid #e7eaf7',
                backgroundColor: '#f8fafc',
                color: '#22336b',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
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
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #e7eaf7',
              backgroundColor: '#f8fafc',
              color: '#22336b',
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
          <button
            onClick={handleApply}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#4F6DDE',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewerSettings; 