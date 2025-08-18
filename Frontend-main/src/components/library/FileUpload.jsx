import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useFileUpload } from '../../hooks/useFileUpload';
import { theme } from '../../styles/theme';

const FileUpload = ({ onUploadSuccess, onClose }) => {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);
  const { uploading, uploadProgress, uploadError, uploadFile, resetUpload } = useFileUpload();

  const handleFiles = async (files) => {
    if (files && files.length > 0) {
      const file = files[0];
      const result = await uploadFile(file);
      
      if (result.success) {
        onUploadSuccess(result.data);
        onClose();
      }
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const onButtonClick = () => {
    inputRef.current?.click();
  };

  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  };

  const modalStyle = {
    background: '#fff',
    borderRadius: '12px',
    padding: '32px',
    maxWidth: '480px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    border: '1px solid #e0e0e0'
  };

  const titleStyle = {
    fontSize: '24px',
    fontWeight: 600,
    color: '#333',
    marginBottom: '24px',
    textAlign: 'center'
  };

  const dropZoneStyle = {
    border: `2px dashed ${dragActive ? '#4F6DDE' : '#ccc'}`,
    borderRadius: '8px',
    padding: '40px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: dragActive ? '#f8f9ff' : '#fafafa',
    transition: 'all 0.2s ease',
    marginBottom: '20px'
  };

  const closeButtonStyle = {
    background: '#f5f5f5',
    border: '1px solid #ddd',
    color: '#666',
    borderRadius: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease'
  };

  const progressBarStyle = {
    width: '100%',
    height: '8px',
    backgroundColor: '#e9ecef',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '16px'
  };

  const progressFillStyle = {
    height: '100%',
    backgroundColor: '#4F6DDE',
    width: `${uploadProgress}%`,
    transition: 'width 0.3s ease'
  };

  const errorStyle = {
    color: '#dc3545',
    fontSize: '14px',
    marginTop: '16px',
    textAlign: 'center',
    backgroundColor: '#f8d7da',
    padding: '12px',
    borderRadius: '4px',
    border: '1px solid #f5c6cb'
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <h2 style={titleStyle}>파일 업로드</h2>
          
          {!uploading ? (
            <>
              <div
                style={dropZoneStyle}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={onButtonClick}
              >
                <div style={{ 
                  fontSize: '24px', 
                  marginBottom: '12px',
                  color: '#666'
                }}>
                  📁
                </div>
                <p style={{ 
                  fontSize: '16px', 
                  fontWeight: 500,
                  marginBottom: '8px',
                  color: '#333'
                }}>
                  {dragActive ? '파일을 여기에 놓으세요' : 'EPUB 파일 선택'}
                </p>
                <p style={{ 
                  fontSize: '14px', 
                  color: '#666',
                  lineHeight: '1.4',
                  margin: '0'
                }}>
                  파일을 드래그하거나 클릭해서 업로드하세요<br/>
                  <small style={{ fontSize: '12px', color: '#999' }}>
                    최대 50MB, .epub 파일만 지원됩니다
                  </small>
                </p>
              </div>
            
            <input
              ref={inputRef}
              type="file"
              accept=".epub,application/epub+zip"
              style={{ display: 'none' }}
              onChange={handleChange}
            />
            
            {uploadError && (
              <div style={errorStyle}>
                {uploadError}
                <br />
                <button 
                  onClick={resetUpload}
                  style={{ 
                    ...closeButtonStyle, 
                    marginTop: theme.spacing.sm,
                    marginLeft: 0 
                  }}
                >
                  다시 시도
                </button>
              </div>
            )}
          </>
                  ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{ 
              fontSize: '16px',
              fontWeight: 500,
              color: '#333',
              marginBottom: '8px'
            }}>
              업로드 중... ({Math.round(uploadProgress)}%)
            </p>
            <div style={progressBarStyle}>
              <div style={progressFillStyle} />
            </div>
          </div>
        )}
        
        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          {!uploading && (
            <button 
              style={closeButtonStyle} 
              onClick={onClose}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#e9ecef';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = '#f5f5f5';
              }}
            >
              취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

FileUpload.propTypes = {
  onUploadSuccess: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired
};

export default FileUpload;
