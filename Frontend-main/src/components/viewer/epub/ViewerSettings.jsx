import React, { useState, useEffect } from 'react';
import { FaTimes, FaFont, FaColumns, FaMoon, FaSun, FaCheck, FaChartBar, FaUndo, FaSave, FaPalette } from 'react-icons/fa';

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
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(4px)'
      }}
    >
      <div 
        className="settings-modal transform transition-all duration-300 ease-out"
        style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '0',
          width: '90%',
          maxWidth: '520px',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
          border: '1px solid rgba(255, 255, 255, 0.2)'
        }}
      >
        {/* 모달 헤더 */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 border-b border-gray-100">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FaPalette className="text-blue-600" />
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22336b' }}>뷰어 설정</h2>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
              style={{ 
                background: 'none', 
                border: 'none', 
                fontSize: '1.2rem', 
                cursor: 'pointer',
                color: '#6b7280'
              }}
            >
              <FaTimes />
            </button>
          </div>
        </div>

        {/* 모달 내용 */}
        <div className="p-6 space-y-6">
        
        {/* 페이지 모드 설정 */}
        <div className="bg-gray-50 p-4 rounded-xl">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
            <FaColumns className="text-blue-600" /> 페이지 모드
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleChange('pageMode', 'single')}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 font-medium ${
                settings.pageMode === 'single' 
                  ? 'border-blue-500 bg-blue-500 text-white shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              {settings.pageMode === 'single' && <FaCheck />} 
              단일 페이지
            </button>
            <button
              onClick={() => handleChange('pageMode', 'double')}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 font-medium ${
                settings.pageMode === 'double' 
                  ? 'border-blue-500 bg-blue-500 text-white shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              {settings.pageMode === 'double' && <FaCheck />} 
              분할 페이지
            </button>
          </div>
        </div>
        
        {/* 그래프 표시 설정 */}
        <div className="bg-gray-50 p-4 rounded-xl">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
            <FaChartBar className="text-green-600" /> 그래프 표시
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleChange('showGraph', true)}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 font-medium ${
                settings.showGraph 
                  ? 'border-green-500 bg-green-500 text-white shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-green-300 hover:bg-green-50'
              }`}
            >
              {settings.showGraph && <FaCheck />} 
              그래프 표시
            </button>
            <button
              onClick={() => handleChange('showGraph', false)}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 font-medium ${
                !settings.showGraph 
                  ? 'border-green-500 bg-green-500 text-white shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-green-300 hover:bg-green-50'
              }`}
            >
              {!settings.showGraph && <FaCheck />} 
              그래프 숨기기
            </button>
          </div>
        </div>
        
        {/* 글꼴 크기 설정 */}
        <div className="bg-gray-50 p-4 rounded-xl">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
            <FaFont className="text-purple-600" /> 글꼴 크기
          </h3>
          <div className="flex items-center gap-4">
            <button
              onClick={() => handleChange('fontSize', Math.max(80, settings.fontSize - 10))}
              className="w-10 h-10 rounded-lg border-2 border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50 text-gray-700 font-bold transition-all duration-200"
            >
              -
            </button>
            <div className="flex-1 px-2">
              <input
                type="range"
                min="80"
                max="150"
                step="10"
                value={settings.fontSize}
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                style={{
                  background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${((settings.fontSize - 80) / 70) * 100}%, #e5e7eb ${((settings.fontSize - 80) / 70) * 100}%, #e5e7eb 100%)`
                }}
              />
            </div>
            <button
              onClick={() => handleChange('fontSize', Math.min(150, settings.fontSize + 10))}
              className="w-10 h-10 rounded-lg border-2 border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50 text-gray-700 font-bold transition-all duration-200"
            >
              +
            </button>
            <div className="w-16 text-center">
              <span className="text-lg font-bold text-purple-600">{settings.fontSize}%</span>
            </div>
          </div>
        </div>
        
        {/* 테마 설정 */}
        <div className="bg-gray-50 p-4 rounded-xl">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
            {settings.theme === 'dark' ? <FaMoon className="text-indigo-600" /> : <FaSun className="text-yellow-500" />} 
            테마
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => handleChange('theme', 'light')}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex flex-col items-center gap-2 font-medium ${
                settings.theme === 'light' 
                  ? 'border-yellow-400 bg-yellow-50 text-yellow-700 shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-yellow-300 hover:bg-yellow-50'
              }`}
            >
              <FaSun className={settings.theme === 'light' ? 'text-yellow-500' : 'text-gray-400'} />
              <span className="text-sm">밝은 테마</span>
              {settings.theme === 'light' && <FaCheck className="text-yellow-600" />}
            </button>
            <button
              onClick={() => handleChange('theme', 'dark')}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex flex-col items-center gap-2 font-medium ${
                settings.theme === 'dark' 
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
              }`}
            >
              <FaMoon className={settings.theme === 'dark' ? 'text-indigo-600' : 'text-gray-400'} />
              <span className="text-sm">어두운 테마</span>
              {settings.theme === 'dark' && <FaCheck className="text-indigo-600" />}
            </button>
            <button
              onClick={() => handleChange('theme', 'sepia')}
              className={`p-3 rounded-lg border-2 transition-all duration-200 flex flex-col items-center gap-2 font-medium ${
                settings.theme === 'sepia' 
                  ? 'border-amber-500 bg-amber-50 text-amber-700 shadow-lg transform scale-105' 
                  : 'border-gray-200 bg-white text-gray-700 hover:border-amber-300 hover:bg-amber-50'
              }`}
            >
              <div className={`w-4 h-4 rounded-full ${settings.theme === 'sepia' ? 'bg-amber-600' : 'bg-gray-400'}`}></div>
              <span className="text-sm">세피아</span>
              {settings.theme === 'sepia' && <FaCheck className="text-amber-600" />}
            </button>
          </div>
        </div>
        
        {/* 줄 간격 설정 */}
        <div className="bg-gray-50 p-4 rounded-xl">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
            <div className="w-5 h-5 flex flex-col justify-between">
              <div className="h-0.5 bg-orange-500"></div>
              <div className="h-0.5 bg-orange-500"></div>
              <div className="h-0.5 bg-orange-500"></div>
            </div>
            줄 간격
          </h3>
          <div className="flex items-center gap-4">
            <button
              onClick={() => handleChange('lineHeight', Math.max(1.0, settings.lineHeight - 0.1))}
              className="w-10 h-10 rounded-lg border-2 border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50 text-gray-700 font-bold transition-all duration-200"
            >
              -
            </button>
            <div className="flex-1 px-2">
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.1"
                value={settings.lineHeight}
                onChange={(e) => handleChange('lineHeight', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                style={{
                  background: `linear-gradient(to right, #f97316 0%, #f97316 ${((settings.lineHeight - 1.0) / 1.0) * 100}%, #e5e7eb ${((settings.lineHeight - 1.0) / 1.0) * 100}%, #e5e7eb 100%)`
                }}
              />
            </div>
            <button
              onClick={() => handleChange('lineHeight', Math.min(2.0, settings.lineHeight + 0.1))}
              className="w-10 h-10 rounded-lg border-2 border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50 text-gray-700 font-bold transition-all duration-200"
            >
              +
            </button>
            <div className="w-16 text-center">
              <span className="text-lg font-bold text-orange-600">{settings.lineHeight.toFixed(1)}</span>
            </div>
          </div>
        </div>
        </div>
        
        {/* 모달 하단 버튼 */}
        <div className="p-6 bg-gray-50 border-t border-gray-100">
          <div className="flex justify-between gap-3">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-all duration-200"
            >
              <FaUndo />
              초기화
            </button>
            <button
              onClick={handleApply}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all duration-200 shadow-lg"
            >
              <FaSave />
              적용하기
            </button>
          </div>
        </div>
        

      </div>
    </div>
  );
};

export default ViewerSettings; 