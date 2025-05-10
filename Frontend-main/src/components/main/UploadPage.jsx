import React, { useRef, useState } from 'react';
import PageLayout from '../common/PageLayout';

const UploadPage = () => {
  const [file, setFile] = useState(null);
  const fileInputRef = useRef();
  const [dragActive, setDragActive] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleClick = () => {
    fileInputRef.current.click();
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  return (
    <PageLayout>
      <div style={{
        minHeight: 'calc(100vh - 120px)', // 헤더 높이 제외 전체 높이
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        marginTop: '3.5rem',
      }}>
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            border: dragActive ? '2.5px solid #4F6DDE' : '2.5px dashed #bfc8e6',
            borderRadius: 14,
            background: dragActive ? '#f4f7ff' : '#f8fafc',
            padding: '2.5rem 2.5rem',
            cursor: 'pointer',
            transition: 'border 0.2s, background 0.2s',
            minWidth: 340,
            minHeight: 180,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'none',
          }}
        >
          <div style={{ fontSize: '2.5rem', color: '#4F6DDE', marginBottom: '0.7rem' }}>⬆️</div>
          <div style={{ fontWeight: 700, color: '#22336b', fontSize: '1.18rem', marginBottom: '0.3rem', textAlign: 'center' }}>
            EPUB 파일을 여기에 드래그하거나<br/>클릭해서 업로드
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.98rem', marginBottom: '1.2rem', textAlign: 'center' }}>
            (.epub만 지원)
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            style={{ display: 'none' }}
            onChange={handleChange}
          />
          {file && (
            <div style={{ marginBottom: '1.2rem', color: '#4F6DDE', fontWeight: 500 }}>
              선택된 파일: {file.name}
            </div>
          )}
          {/* <button
            style={{
              background: '#4F6DDE', color: '#fff', border: 'none', borderRadius: 6,
              padding: '0.7rem 2.2rem', fontWeight: 600, fontSize: '1.1rem', cursor: file ? 'pointer' : 'not-allowed', opacity: file ? 1 : 0.6
            }}
            disabled={!file}
          >
            업로드
          </button> */}
        </div>
      </div>
    </PageLayout>
  );
};

export default UploadPage; 