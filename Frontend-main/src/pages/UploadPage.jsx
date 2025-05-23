import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/common/Header';
import UserProfile from '../components/common/UserProfile';
import { uploadEpubFile } from '../api/upload';
import './UploadPage.css';

const UploadPage = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState(null); // 'success', 'error', null
  const [errorMessage, setErrorMessage] = useState('');
  
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  // 로그아웃 핸들러
  const handleLogout = () => {
    // 로그아웃 로직 구현
    console.log('로그아웃 처리');
    // navigate('/login'); // 로그인 페이지로 이동
  };

  const handleSubmit = async () => {
    if (!file) {
      setUploadStatus('error');
      setErrorMessage('파일을 선택해주세요.');
      return;
    }
    
    // 파일 확장자 검사
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (fileExtension !== 'epub') {
      setUploadStatus('error');
      setErrorMessage('ePub 형식의 파일만 업로드할 수 있습니다.');
      return;
    }
    
    // 파일 크기 검사 (최대 100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_FILE_SIZE) {
      setUploadStatus('error');
      setErrorMessage('파일 크기는 100MB 이하여야 합니다.');
      return;
    }
    
    try {
      setIsUploading(true);
      setUploadProgress(0);
      
      // 업로드 진행률 추적을 위한 axios 설정
      const onUploadProgress = (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(percentCompleted);
      };
      
      // API 호출하여 파일 업로드
      const result = await uploadEpubFile(file, onUploadProgress);
      
      // 업로드 성공
      setUploadStatus('success');
      
      // 3초 후 라이브러리 페이지로 이동
      setTimeout(() => {
        navigate('/user/library');
      }, 3000);
      
    } catch (error) {
      console.error('파일 업로드 실패:', error);
      setUploadStatus('error');
      setErrorMessage(error.response?.data?.message || '파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setIsUploading(false);
    }
  };
  
  const handleCancel = () => {
    setFile(null);
    setUploadStatus(null);
    setErrorMessage('');
    setUploadProgress(0);
  };
  
  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
      setUploadStatus(null);
      setErrorMessage('');
    }
  };
  
  const handleSelectFile = () => {
    fileInputRef.current.click();
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
      setUploadStatus(null);
      setErrorMessage('');
    }
  };
  
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const closeStatusMessage = () => {
    setUploadStatus(null);
    setErrorMessage('');
  };

  return (
    <div className="upload-root">
      {/* Top Bar - 항상 고정 */}
      <Header userNickname="User Nickname" />
      {/* Main Content */}
      <div className="upload-main">
        {/* 유저 정보 섹션 - 컴포넌트로 대체 */}
        <UserProfile 
          userNickname="User's Nickname"
          onLogout={handleLogout}
        />
        
        <div className="upload-section">
          <div className="upload-container">
            <h1 className="upload-title">새 책 업로드</h1>
            <p className="upload-description">
              ePub 형식의 전자책 파일을 업로드하여 나만의 서재에 추가하세요.
            </p>
          </div>
        </div>
        
        <div 
          className="upload-field"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <svg 
            className="upload-cloud-icon" 
            width="48" 
            height="48" 
            viewBox="0 0 24 24" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path 
              d="M16 16L12 12L8 16" 
              stroke="rgba(0, 0, 0, 0.4)" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M12 12V21" 
              stroke="rgba(0, 0, 0, 0.4)" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
            <path 
              d="M20.39 18.39C21.3653 17.8583 22.1358 17.0169 22.5798 15.9986C23.0239 14.9804 23.1162 13.8432 22.8422 12.7667C22.5682 11.6901 21.9434 10.7355 21.0666 10.0534C20.1898 9.37138 19.1108 9.00073 18 9.00001H16.74C16.4373 7.82926 15.8732 6.74235 15.0899 5.82099C14.3067 4.89963 13.3248 4.16785 12.2181 3.68061C11.1114 3.19336 9.90856 2.96639 8.70012 3.01638C7.49169 3.06638 6.31332 3.39213 5.24822 3.96864C4.18312 4.54516 3.26065 5.35544 2.55333 6.33939C1.84601 7.32334 1.37368 8.45678 1.17333 9.65003C0.972988 10.8433 1.05089 12.0663 1.399 13.2255C1.74712 14.3847 2.35733 15.4464 3.18 16.33" 
              stroke="rgba(0, 0, 0, 0.4)" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
          
          <div className="upload-bottom-content">
            <div className="upload-description-container">
              <p className="upload-field-title">파일을 선택하거나 이곳에 드래그하세요</p>
              <p className="upload-field-subtitle">ePub 형식, 최대 100MB</p>
            </div>
            
            <button className="upload-select-button" onClick={handleSelectFile}>
              <span className="upload-select-text">파일 선택</span>
            </button>
            
            <input
              type="file"
              ref={fileInputRef}
              className="upload-file-input"
              onChange={handleFileChange}
              accept=".epub"
              style={{ display: 'none' }}
            />
            
            {file && (
              <div className="selected-file">
                <p>선택된 파일: {file.name}</p>
                <p>({(file.size / (1024 * 1024)).toFixed(2)} MB)</p>
              </div>
            )}
            
            {isUploading && (
              <div className="upload-progress">
                <div className="upload-progress-bar">
                  <div 
                    className="upload-progress-fill" 
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="upload-progress-text">{uploadProgress}% 완료</p>
              </div>
            )}
            
            <div className="upload-buttons">
              <button 
                className="upload-btn-secondary"
                onClick={handleSubmit}
                disabled={isUploading}
              >
                <span className="btn-title">{isUploading ? '업로드 중...' : '업로드'}</span>
              </button>
              <button 
                className="upload-btn-primary"
                onClick={handleCancel}
              >
                <span className="btn-title">취소</span>
              </button>
            </div>
          </div>
        </div>
        
        {uploadStatus && (
          <div className="upload-status-message">
            <div className={`upload-status-content ${uploadStatus}`}>
              {uploadStatus === 'success' ? (
                <>
                  <svg 
                    className="upload-status-icon" 
                    width="24" 
                    height="24" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path 
                      d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85781 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999" 
                      stroke="#4CAF50" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                    <path 
                      d="M22 4L12 14.01L9 11.01" 
                      stroke="#4CAF50" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p>업로드 성공! 라이브러리로 이동합니다.</p>
                </>
              ) : (
                <>
                  <svg 
                    className="upload-status-icon" 
                    width="24" 
                    height="24" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path 
                      d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" 
                      stroke="#FF5252" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                    <path 
                      d="M15 9L9 15" 
                      stroke="#FF5252" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                    <path 
                      d="M9 9L15 15" 
                      stroke="#FF5252" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p>{errorMessage}</p>
                </>
              )}
              <button className="upload-status-close" onClick={closeStatusMessage}>
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadPage; 