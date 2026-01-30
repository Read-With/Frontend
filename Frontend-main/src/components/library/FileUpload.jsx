import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useFileUpload, FILE_CONSTRAINTS } from '../../hooks/books/useFileUpload';
import { getBooks } from '../../utils/api/booksApi';
import { theme } from '../common/theme';
import ePub from 'epubjs';
import { normalizeTitle } from '../../utils/stringUtils';

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
  const [showApprovalPendingModal, setShowApprovalPendingModal] = useState(false);
  const [uploadedBook, setUploadedBook] = useState(null);
  const inputRef = useRef(null);
  const { uploading, uploadProgress, uploadError, uploadFile, resetUpload } = useFileUpload();

  const extractEpubMetadata = async (file) => {
    try {
      setExtractingMetadata(true);
      
      // 전체 프로세스에 타임아웃 설정 (최대 10초)
      const metadataPromise = (async () => {
        try {
          // EPUB 파일을 메모리에만 로드하고 리소스 처리는 최소화
          const book = ePub(file, {
            replacements: 'none', // 리소스 대체 비활성화
            openAs: 'epub' // EPUB로 직접 열기
          });
          
          // ready 상태 대기 (타임아웃 8초)
          await Promise.race([
            book.ready,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Ready timeout')), 8000))
          ]);
          
          // 메타데이터 안전하게 추출
          let metadata = {};
          try {
            metadata = book.packaging?.metadata || book.metadata || {};
          } catch (e) {
          }
          
          const getMetadataValue = (field) => {
            try {
              const value = metadata[field];
              if (Array.isArray(value) && value.length > 0) {
                return value[0];
              }
              return value || null;
            } catch (e) {
              return null;
            }
          };
          
          const metadataResult = {
            title: getMetadataValue('title') || file.name.replace(/\.epub$/i, ''),
            author: getMetadataValue('creator') || getMetadataValue('author') || 'Unknown',
            language: getMetadataValue('language') || 'ko'
          };
          
          // 책 객체 정리
          try {
            if (book && typeof book.destroy === 'function') {
              book.destroy();
            }
          } catch (e) {
            // destroy 실패는 무시
          }
          
          return metadataResult;
        } catch (error) {
          throw error;
        }
      })();
      
      // 전체 프로세스 타임아웃 적용
      return await Promise.race([
        metadataPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Metadata extraction timeout')), 10000)
        )
      ]);
    } catch (error) {
      // 에러 발생 시 파일명 기반으로 기본값 반환
      return {
        title: file.name.replace(/\.epub$/i, ''),
        author: 'Unknown',
        language: 'ko'
      };
    } finally {
      setExtractingMetadata(false);
    }
  };

  const handleFiles = async (files) => {
    if (files && files.length > 0) {
      try {
        const file = files[0];
        setSelectedFile(file);
        
        // 파일 선택 후 즉시 메타데이터 단계로 이동 (UI 블로킹 방지)
        setStep('metadata');
        
        // 메타데이터 추출은 백그라운드에서 진행
        const extractedMetadata = await extractEpubMetadata(file);
        setMetadata(prev => ({
          ...prev,
          ...extractedMetadata
        }));
      } catch (error) {
        // 에러 발생 시에도 메타데이터 단계로 이동
        if (!selectedFile && files && files.length > 0) {
          setSelectedFile(files[0]);
          setMetadata(prev => ({
            ...prev,
            title: files[0].name.replace(/\.epub$/i, ''),
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
      const arrayBuffer = await selectedFile.arrayBuffer();
      const { saveLocalBookBuffer, saveLocalBookMetadata } = await import('../../utils/localBookStorage');
      
      // 1. 업로드 전에 서버 책 목록 확인하여 제목+저자로 매칭
      let existingBookId = null;
      try {
        const { getBooks } = await import('../../utils/api/booksApi');
        const booksResponse = await getBooks({});
        
        if (booksResponse?.isSuccess && Array.isArray(booksResponse.result)) {
          const normalizedTitle = (metadata.title || '').trim().toLowerCase();
          const normalizedAuthor = (metadata.author || '').trim().toLowerCase();
          
          // 제목과 저자가 일치하는 책 찾기
          const matchingBooks = booksResponse.result.filter(book => {
            const bookTitle = (book.title || '').trim().toLowerCase();
            const bookAuthor = (book.author || '').trim().toLowerCase();
            return bookTitle === normalizedTitle && bookAuthor === normalizedAuthor;
          });
          
          if (matchingBooks.length > 0) {
            // ID가 가장 작은 것부터 비교하여 선택 (가장 오래된 책)
            // ID를 숫자로 변환하여 정렬
            const sortedBooks = matchingBooks.sort((a, b) => {
              const idA = Number(a.id) || 0;
              const idB = Number(b.id) || 0;
              return idA - idB; // 오름차순 정렬 (가장 작은 ID가 첫 번째)
            });
            
            // 가장 작은 ID를 가진 책 선택
            existingBookId = sortedBooks[0].id;
          }
        }
      } catch (error) {
        console.warn('서버 책 목록 확인 실패, 새로 업로드합니다:', error);
      }
      
      // 2. 기존 책이 있으면 그 ID로만 취급 (새로 업로드하지 않음)
      let serverBook = null;
      let finalBookId = existingBookId;
      
      if (existingBookId) {
        // 기존 책 ID 사용 - 새로 업로드하지 않고 기존 ID로만 취급
        try {
          const { getBook } = await import('../../utils/api/booksApi');
          const bookResponse = await getBook(existingBookId);
          if (bookResponse?.isSuccess && bookResponse.result) {
            serverBook = bookResponse.result;
          } else {
            throw new Error('기존 책 정보를 가져올 수 없습니다.');
          }
        } catch (error) {
          throw new Error(`기존 책 정보 가져오기 실패: ${error.message}`);
        }
      } else {
        // 기존 책이 없을 때만 새로 업로드
        try {
          const result = await uploadFile(selectedFile, metadata);
          if (result.success) {
            serverBook = result.data;
            setUploadedBook(serverBook);
            finalBookId = serverBook?.id;
          } else {
            throw new Error(result.error || '서버 업로드에 실패했습니다.');
          }
        } catch (uploadError) {
          throw new Error(uploadError.message || '서버 업로드에 실패했습니다. 로그인 상태를 확인해주세요.');
        }
      }

      // 3. bookId 확인
      if (!finalBookId) {
        throw new Error('서버에서 책 ID를 받지 못했습니다.');
      }

      // 4. 서버에서 manifest 정보 가져오기 (기존 책이면 manifest가 있을 수 있음)
      let manifestData = null;
      if (serverBook?.isDefault || serverBook?.chapters || serverBook?.characters) {
        // 서버 응답에 이미 manifest 정보가 포함되어 있음
        manifestData = {
          chapters: serverBook.chapters || [],
          characters: serverBook.characters || [],
          progressMetadata: serverBook.progressMetadata || {},
        };
      } else {
        // manifest 정보가 없으면 가져오기 시도
        try {
          const { getBookManifest } = await import('../../utils/api/api');
          const manifestResponse = await getBookManifest(finalBookId, { forceRefresh: false });
          if (manifestResponse?.isSuccess && manifestResponse?.result) {
            manifestData = {
              chapters: manifestResponse.result.chapters || [],
              characters: manifestResponse.result.characters || [],
              progressMetadata: manifestResponse.result.progressMetadata || {},
            };
          }
        } catch (error) {
          // 404 에러는 조용히 처리 (manifest가 없는 책일 수 있음)
          if (error.status !== 404 && !error.message?.includes('404')) {
            console.warn('Manifest 정보를 가져오지 못했습니다:', error);
          }
        }
      }

      // 5. IndexedDB에 서버 bookId로 EPUB 파일 저장
      // 중요: EPUB 파일은 IndexedDB에만 저장되며, 서버에는 메타데이터만 저장됨
      // 서버 bookId를 키로 사용하여 서버 책 목록과 IndexedDB의 EPUB 파일을 매칭함
      const book = {
        id: finalBookId,
        _bookId: finalBookId,
        title: serverBook?.title || metadata.title || selectedFile.name.replace(/\.epub$/i, ''),
        author: serverBook?.author || metadata.author || 'Unknown',
        language: serverBook?.language || metadata.language || 'ko',
        coverImgUrl: serverBook?.coverImgUrl || serverBook?.coverImage || serverBook?.coverUrl || '',
        coverImage: serverBook?.coverImgUrl || serverBook?.coverImage || serverBook?.coverUrl || '',
        description: serverBook?.description || '',
        favorite: !!serverBook?.favorite,
        isLocalOnly: false,
        epubFile: selectedFile,
        epubArrayBuffer: arrayBuffer,
        // 서버에서 가져온 manifest 정보 포함
        ...(manifestData && {
          chapters: manifestData.chapters,
          characters: manifestData.characters,
          progressMetadata: manifestData.progressMetadata,
        }),
      };

      // IndexedDB에 저장 (완료 확인)
      // 책 이름, 저자 이름, EPUB 파일만 저장
      await Promise.all([
        saveLocalBookBuffer(String(finalBookId), arrayBuffer),
        saveLocalBookMetadata(String(finalBookId), {
          title: book.title,
          author: book.author,
        }),
      ]);

      // IndexedDB 저장 완료 확인 (저장이 실제로 완료되었는지 검증)
      // 최대 10번 재시도 (총 최대 2초 대기)
      const { loadLocalBookBuffer } = await import('../../utils/localBookStorage');
      let savedBuffer = null;
      for (let i = 0; i < 10; i++) {
        try {
          savedBuffer = await loadLocalBookBuffer(String(finalBookId));
          if (savedBuffer && savedBuffer.byteLength > 0) {
            // 저장 완료 확인됨
            break;
          }
        } catch (error) {
          // 에러는 무시하고 재시도
        }
        
        // 저장이 완료되지 않았으면 잠시 대기 후 재시도
        if (i < 9) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      if (!savedBuffer || savedBuffer.byteLength === 0) {
        throw new Error('IndexedDB에 파일 저장이 완료되지 않았습니다. 다시 시도해주세요.');
      }

      // 6. 서버 책 목록 갱신 및 뷰어로 이동
      // onUploadSuccess가 addBook을 호출하여 서버 책 목록을 갱신하고,
      // useBooks에서 서버 책만 표시하므로 자동으로 library에 표시됨
      // 뷰어에서는 서버 bookId로 IndexedDB에서 EPUB 파일을 로드함
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
    backgroundColor: '#5C6F5C',
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
            최대 {Math.round(FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024))}MB, .epub 파일만 지원됩니다
          </small>
        </p>
      </div>
    
      <input
        ref={inputRef}
        type="file"
        accept={FILE_CONSTRAINTS.ACCEPT_ATTRIBUTE}
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
          
          {!uploading ? (
            <>
              {step === 'select' ? renderSelectStep() : renderMetadataStep()}
            
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
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            {/* 생동감 있는 업로드 애니메이션 */}
            <div className="relative mb-8">
              {/* 메인 업로드 아이콘 */}
              <div style={{ width: '96px', height: '96px', margin: '0 auto 16px', position: 'relative' }}>
                <div style={{
                  position: 'absolute',
                  inset: '0',
                  border: '4px solid #dbeafe',
                  borderRadius: '50%',
                  animation: 'spin-ring 2s linear infinite'
                }}>
                  <div style={{
                    width: '100%',
                    height: '100%',
                    borderTop: '4px solid #5C6F5C',
                    borderRadius: '50%'
                  }}></div>
                </div>
                
                {/* 중앙 파일 아이콘 */}
                <div style={{
                  position: 'absolute',
                  inset: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <div style={{
                    width: '40px',
                    height: '48px',
                    backgroundColor: '#5C6F5C',
                    borderRadius: '4px',
                    position: 'relative',
                    animation: 'enhanced-pulse 1.5s ease-in-out infinite'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      right: '0',
                      width: '12px',
                      height: '12px',
                      backgroundColor: 'white'
                    }}></div>
                    <div style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      width: '12px',
                      height: '12px',
                      backgroundColor: '#5C6F5C',
                      transform: 'rotate(45deg)'
                    }}></div>
                    
                    {/* 파일 내용 라인들 */}
                    <div style={{
                      position: 'absolute',
                      top: '24px',
                      left: '4px',
                      right: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          style={{
                            height: '2px',
                            backgroundColor: 'white',
                            borderRadius: '1px',
                            width: `${80 - i * 10}%`,
                            animation: `enhanced-pulse 1.5s ease-in-out infinite ${i * 0.2}s`
                          }}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 업로드 메시지 */}
              <div style={{ marginBottom: '24px' }}>
                <p style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  파일을 업로드하고 있습니다...
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: '8px',
                        height: '8px',
                        backgroundColor: '#5C6F5C',
                        borderRadius: '50%',
                        animation: `bounce 1s ease-in-out infinite ${i * 0.2}s`
                      }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* 개선된 진행률 바 */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <div style={{
                width: '100%',
                height: '12px',
                backgroundColor: '#f3f4f6',
                borderRadius: '6px',
                overflow: 'hidden',
                boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.1)'
              }}>
                <div style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #7A8A7A, #5C6F5C, #4A5A4A)',
                  width: `${uploadProgress}%`,
                  borderRadius: '6px',
                  transition: 'width 0.5s ease-out',
                  position: 'relative'
                }}>
                  {/* 진행률 바 내 애니메이션 */}
                  <div style={{
                    position: 'absolute',
                    inset: '0',
                    background: 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '6px',
                    animation: 'enhanced-pulse 1s ease-in-out infinite'
                  }}></div>
                  <div style={{
                    position: 'absolute',
                    right: '0',
                    top: '0',
                    width: '16px',
                    height: '100%',
                    background: 'rgba(255, 255, 255, 0.3)',
                    borderRadius: '6px',
                    transform: uploadProgress > 95 ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.3s ease'
                  }}></div>
                </div>
              </div>
              
              {/* 진행률 텍스트 */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '8px'
              }}>
                <span style={{ fontSize: '14px', color: '#6b7280' }}>업로드 중...</span>
                <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#5C6F5C' }}>
                  {Math.round(uploadProgress)}%
                </span>
              </div>
            </div>
            
            {/* 업로드 단계 표시 */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '32px',
              marginTop: '24px'
            }}>
              {[
                { step: 1, label: '파일 읽기', threshold: 25 },
                { step: 2, label: '처리 중', threshold: 50 },
                { step: 3, label: '분석 중', threshold: 75 },
                { step: 4, label: '완료', threshold: 100 }
              ].map(({ step, label, threshold }) => (
                <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    backgroundColor: uploadProgress >= threshold ? '#10b981' : 
                                   uploadProgress >= threshold - 25 ? '#5C6F5C' : '#e5e7eb',
                    color: uploadProgress >= threshold - 25 ? 'white' : '#9ca3af',
                    transform: uploadProgress >= threshold ? 'scale(1.1)' : 'scale(1)',
                    transition: 'all 0.5s ease',
                    animation: uploadProgress >= threshold - 25 && uploadProgress < threshold ? 'enhanced-pulse 1s ease-in-out infinite' : 'none'
                  }}>
                    {uploadProgress >= threshold ? '✓' : step}
                  </div>
                  <span style={{
                    fontSize: '12px',
                    marginTop: '4px',
                    color: uploadProgress >= threshold ? '#10b981' : '#9ca3af',
                    fontWeight: uploadProgress >= threshold ? '600' : 'normal',
                    transition: 'color 0.3s ease'
                  }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          {!uploading && step === 'select' && (
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
      
      {/* 승인 대기 모달 */}
      {showApprovalPendingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            padding: '32px',
            maxWidth: '480px',
            width: '90%',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            border: '1px solid #e0e0e0',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '16px'
            }}>
              ⏳
            </div>
            <h3 style={{
              fontSize: '20px',
              fontWeight: 600,
              color: '#333',
              marginBottom: '16px'
            }}>
              관리자 승인 대기 중
            </h3>
            <p style={{
              fontSize: '14px',
              color: '#666',
              lineHeight: '1.6',
              marginBottom: '16px'
            }}>
              업로드가 완료되었습니다!
            </p>
            <div style={{
              padding: '16px',
              backgroundColor: '#e8f5e9',
              borderRadius: '8px',
              marginBottom: '24px',
              border: '1px solid #4caf50'
            }}>
              <p style={{
                fontSize: '14px',
                color: '#2e7d32',
                lineHeight: '1.6',
                margin: 0,
                fontWeight: 500
              }}>
                📚 <strong>관리자에 의해 인증을 받으면</strong><br/>
                라이브러리에 책이 자동으로 추가됩니다.
              </p>
              <p style={{
                fontSize: '13px',
                color: '#388e3c',
                lineHeight: '1.5',
                marginTop: '8px',
                margin: '8px 0 0 0'
              }}>
                승인이 완료되면 라이브러리에서 바로 읽을 수 있습니다.
              </p>
            </div>
            <div style={{
              padding: '12px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              marginBottom: '24px',
              textAlign: 'left'
            }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>업로드된 책:</div>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>{uploadedBook?.title || '제목 없음'}</div>
              <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>{uploadedBook?.author || '저자 없음'}</div>
            </div>
            <button
              onClick={() => {
                setShowApprovalPendingModal(false);
                setUploadedBook(null);
                onClose();
              }}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#5C6F5C',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#4A5A4A';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = '#5C6F5C';
              }}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

FileUpload.propTypes = {
  onUploadSuccess: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired
};

export default FileUpload;
