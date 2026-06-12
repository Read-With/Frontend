import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getBooks, getBook, uploadBook } from '../../utils/api/booksApi';
import { getBookManifest } from '../../utils/api/api';
import {
  extractEpubFileMetadata,
  epubUploadBasename,
  EPUB_FILE_CONSTRAINTS,
  validateEpubFile,
} from '../../utils/library/epubUploadUtils';
import { normalizeTitle } from '../../utils/common/stringUtils';

function normalizeAuthorMatch(author) {
  return (author || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const FileUpload = ({ onUploadSuccess, onClose }) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [metadata, setMetadata] = useState({
    title: '',
    author: '',
    language: 'ko'
  });
  const [step, setStep] = useState('select'); // 'select' or 'metadata'
  const [extractingMetadata, setExtractingMetadata] = useState(false);
  const inputRef = useRef(null);

  const extractEpubMetadata = async (file) => {
    try {
      setExtractingMetadata(true);
      return await Promise.race([
        extractEpubFileMetadata(file),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Metadata extraction timeout')), 10000)
        ),
      ]);
    } catch {
      return {
        title: epubUploadBasename(file.name),
        author: 'Unknown',
        language: 'ko',
      };
    } finally {
      setExtractingMetadata(false);
    }
  };

  const handleFiles = async (files) => {
    if (files && files.length > 0) {
      const file = files[0];
      const v = validateEpubFile(file);
      if (!v.valid) {
        alert(v.error);
        return;
      }
      try {
        setSelectedFile(file);
        
        // 파일 선택 후 즉시 메타데이터 단계로 이동 (UI 블로킹 방지)
        setStep('metadata');
        
        // 메타데이터 추출은 백그라운드에서 진행
        const extractedMetadata = await extractEpubMetadata(file);
        setMetadata(prev => ({
          ...prev,
          ...extractedMetadata
        }));
      } catch (_error) {
        // 에러 발생 시에도 메타데이터 단계로 이동
        if (!selectedFile && files && files.length > 0) {
          setSelectedFile(files[0]);
          setMetadata(prev => ({
            ...prev,
            title: epubUploadBasename(files[0].name),
            author: prev.author || 'Unknown',
            language: prev.language || 'ko'
          }));
          setStep('metadata');
        }
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    try {
      const titleKey = normalizeTitle(metadata.title || '');
      const authorKey = normalizeAuthorMatch(metadata.author || '');
      if (!titleKey || !authorKey) {
        throw new Error('제목과 저자를 확인해주세요.');
      }

      let serverBook = null;
      let bookId = null;

      const booksResponse = await getBooks({});
      if (booksResponse?.isSuccess && Array.isArray(booksResponse.result)) {
        const canonicalByKey = new Map();
        booksResponse.result.forEach((book) => {
          const numericId = Number(book?.id);
          if (!Number.isFinite(numericId) || numericId <= 0) return;
          const tKey = normalizeTitle(book?.title || '');
          const aKey = normalizeAuthorMatch(book?.author || '');
          if (!tKey || !aKey) return;
          const key = `${tKey}::${aKey}`;
          const existing = canonicalByKey.get(key);
          if (!existing || numericId < Number(existing.id)) {
            canonicalByKey.set(key, book);
          }
        });

        const matchedKey = `${titleKey}::${authorKey}`;
        const canonicalBook = canonicalByKey.get(matchedKey);
        if (canonicalBook) {
          bookId = canonicalBook.id;
        }
      }

      if (!bookId) {
        const uploadResponse = await uploadBook(selectedFile, {
          title: metadata.title,
          author: metadata.author,
          language: metadata.language || 'ko',
        });
        if (!uploadResponse?.isSuccess || !uploadResponse.result) {
          throw new Error(uploadResponse?.message || 'EPUB 업로드에 실패했습니다.');
        }
        serverBook = uploadResponse.result;
        bookId = serverBook.id;
      } else {
        const bookResponse = await getBook(bookId);
        if (!bookResponse?.isSuccess || !bookResponse.result) {
          throw new Error(bookResponse?.message || '매칭된 책 정보를 가져올 수 없습니다.');
        }
        serverBook = bookResponse.result;
      }
      let manifestData = null;
      try {
        const manifestResponse = await getBookManifest(bookId, { forceRefresh: false });
        if (manifestResponse?.isSuccess && manifestResponse?.result) {
          manifestData = manifestResponse.result;
        }
      } catch (error) {
        if (error.status !== 404 && !error.message?.includes('404')) {
          console.warn('Manifest 정보를 가져오지 못했습니다:', error);
        }
      }

      const book = {
        ...serverBook,
        id: bookId,
        _bookId: bookId,
        isLocalOnly: false,
        ...(manifestData && {
          chapters: manifestData.chapters,
          characters: manifestData.characters,
          progressMetadata: manifestData.progressMetadata,
          ...(manifestData.readerArtifacts ? { readerArtifacts: manifestData.readerArtifacts } : {}),
        }),
      };

      onUploadSuccess(book);
      onClose();
    } catch (error) {
      console.error('업로드 처리 실패:', error);
      alert(`업로드 처리 중 오류가 발생했습니다: ${error.message}`);
    }
  };

  const handleBack = () => {
    setStep('select');
    setSelectedFile(null);
    setMetadata({
      title: '',
      author: '',
      language: 'ko'
    });
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
    border: `2px dashed ${dragActive ? '#5C6F5C' : '#ccc'}`,
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

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const renderSelectStep = () => (
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
            최대 {Math.round(EPUB_FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024))}MB, .epub
          </small>
        </p>
      </div>
    
      <input
        ref={inputRef}
        type="file"
        accept={EPUB_FILE_CONSTRAINTS.ACCEPT_ATTRIBUTE}
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </>
  );

  const renderMetadataStep = () => (
    <div>
      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
        <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>선택된 파일:</div>
        <div style={{ fontSize: '16px', fontWeight: 500 }}>{selectedFile?.name}</div>
        {extractingMetadata && (
          <div style={{ fontSize: '12px', color: '#5C6F5C', marginTop: '8px' }}>
            📖 EPUB 메타데이터 추출 중...
          </div>
        )}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#333' }}>
            제목 *
          </label>
          <input
            type="text"
            value={metadata.title}
            onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
            disabled={extractingMetadata}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: extractingMetadata ? '#f5f5f5' : 'white',
              cursor: extractingMetadata ? 'not-allowed' : 'text'
            }}
            placeholder={extractingMetadata ? '메타데이터 추출 중...' : '책 제목을 입력하세요'}
          />
        </div>
        
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#333' }}>
            저자 *
          </label>
          <input
            type="text"
            value={metadata.author}
            onChange={(e) => setMetadata(prev => ({ ...prev, author: e.target.value }))}
            disabled={extractingMetadata}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: extractingMetadata ? '#f5f5f5' : 'white',
              cursor: extractingMetadata ? 'not-allowed' : 'text'
            }}
            placeholder={extractingMetadata ? '메타데이터 추출 중...' : '저자명을 입력하세요'}
          />
        </div>
        
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#333' }}>
            언어
          </label>
          <select
            value={metadata.language}
            onChange={(e) => setMetadata(prev => ({ ...prev, language: e.target.value }))}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: 'white'
            }}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
          </select>
        </div>

      </div>
      
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
        <button 
          onClick={handleBack}
          style={{
            ...closeButtonStyle,
            flex: 1
          }}
        >
          뒤로
        </button>
        <button 
          onClick={handleUpload}
          disabled={!metadata.title || !metadata.author || extractingMetadata}
          style={{
            ...closeButtonStyle,
            flex: 1,
            backgroundColor: (!metadata.title || !metadata.author || extractingMetadata) ? '#ccc' : '#5C6F5C',
            color: 'white',
            border: 'none',
            cursor: (!metadata.title || !metadata.author || extractingMetadata) ? 'not-allowed' : 'pointer'
          }}
        >
          {extractingMetadata ? '메타데이터 추출 중...' : '업로드'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <h2 style={titleStyle}>파일 업로드</h2>

        {step === 'select' ? renderSelectStep() : renderMetadataStep()}

        {step === 'select' && (
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
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
          </div>
        )}
      </div>
    </div>
  );
};

FileUpload.propTypes = {
  onUploadSuccess: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired
};

export default FileUpload;
