import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useFileUpload, FILE_CONSTRAINTS } from '../../hooks/books/useFileUpload';
import { getBooks, getBook } from '../../utils/api/booksApi';
import { getBookManifest } from '../../utils/api/api';
import { theme } from '../common/theme';
import { extractEpubFileMetadata, epubUploadBasename } from '../../utils/library/epubUploadUtils';
import {
  saveLocalBookBuffer,
  saveLocalBookMetadata,
  loadLocalBookBuffer,
} from '../../utils/library/localBookStorage';
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
  const [showApprovalPendingModal, setShowApprovalPendingModal] = useState(false);
  const [uploadedBook, setUploadedBook] = useState(null);
  const inputRef = useRef(null);
  const { uploading, uploadProgress, uploadError, resetUpload, validateEpubFile } = useFileUpload();

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
      const arrayBuffer = await selectedFile.arrayBuffer();

      // 1. 서버에 새 책을 등록하지 않음 — 제목+저자 완전 일치만 매칭 후 최소 bookId 사용
      const booksResponse = await getBooks({});
      if (!booksResponse?.isSuccess || !Array.isArray(booksResponse.result)) {
        throw new Error(
          booksResponse?.message || '서버 책 목록을 불러오지 못했습니다. 네트워크와 로그인 상태를 확인해주세요.'
        );
      }

      const titleKey = normalizeTitle(metadata.title || '');
      const authorKey = normalizeAuthorMatch(metadata.author || '');
      if (!titleKey || !authorKey) {
        throw new Error('제목과 저자를 확인해주세요. 서버 책과 정확히 매칭해야 합니다.');
      }

      // useBooks.reconcileBooks와 동일 기준(제목+저자 key의 최소 id)으로 canonical bookId를 선택
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
      const matchingBooks = booksResponse.result.filter((book) => {
        const numericId = Number(book?.id);
        if (!Number.isFinite(numericId) || numericId <= 0) return false;
        return (
          normalizeTitle(book.title || '') === titleKey &&
          normalizeAuthorMatch(book.author || '') === authorKey
        );
      });

      if (!canonicalBook) {
        throw new Error(
          '서버에 제목+저자가 동일한 책이 없습니다. EPUB는 기존 책과 정확히 일치할 때만 연결됩니다.'
        );
      }

      const existingBookId = canonicalBook.id;

      let serverBook = null;
      const finalBookId = existingBookId;

      const bookResponse = await getBook(existingBookId);
      if (bookResponse?.isSuccess && bookResponse.result) {
        serverBook = bookResponse.result;
      } else {
        throw new Error(bookResponse?.message || '매칭된 책 정보를 가져올 수 없습니다.');
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
          book: serverBook.book || null,
          chapters: serverBook.chapters || [],
          characters: serverBook.characters || [],
          progressMetadata: serverBook.progressMetadata || {},
          readerArtifacts: serverBook.readerArtifacts || null,
        };
      } else {
        // manifest 정보가 없으면 가져오기 시도
        try {
          const manifestResponse = await getBookManifest(finalBookId, { forceRefresh: false });
          if (manifestResponse?.isSuccess && manifestResponse?.result) {
            manifestData = {
              book: manifestResponse.result.book || null,
              chapters: manifestResponse.result.chapters || [],
              characters: manifestResponse.result.characters || [],
              progressMetadata: manifestResponse.result.progressMetadata || {},
              readerArtifacts: manifestResponse.result.readerArtifacts || null,
            };
          }
        } catch (error) {
          // 404 에러는 조용히 처리 (manifest가 없는 책일 수 있음)
          if (error.status !== 404 && !error.message?.includes('404')) {
            console.warn('Manifest 정보를 가져오지 못했습니다:', error);
          }
        }
      }

      const book = {
        id: finalBookId,
        _bookId: finalBookId,
        title: serverBook?.title || metadata.title || epubUploadBasename(selectedFile.name),
        author: serverBook?.author || metadata.author || 'Unknown',
        language: serverBook?.language || metadata.language || 'ko',
        coverImgUrl: serverBook?.coverImgUrl || serverBook?.coverImage || serverBook?.coverUrl || '',
        coverImage: serverBook?.coverImgUrl || serverBook?.coverImage || serverBook?.coverUrl || '',
        description: serverBook?.description || '',
        favorite: !!(serverBook?.isFavorite ?? serverBook?.favorite),
        isLocalOnly: false,
        // 서버에서 가져온 manifest 정보 포함
        ...(manifestData && {
          ...(manifestData.book && typeof manifestData.book === 'object' ? manifestData.book : {}),
          chapters: manifestData.chapters,
          characters: manifestData.characters,
          progressMetadata: manifestData.progressMetadata,
          ...(manifestData.readerArtifacts
            ? { readerArtifacts: manifestData.readerArtifacts }
            : {}),
        }),
      };

      // IndexedDB: 원본 바이너리 + 메타
      await Promise.all([
        saveLocalBookBuffer(String(finalBookId), arrayBuffer),
        saveLocalBookMetadata(String(finalBookId), {
          title: book.title,
          author: book.author,
        }),
      ]);

      // IndexedDB 저장 완료 확인 (저장이 실제로 완료되었는지 검증)
      // 최대 10번 재시도 (총 최대 2초 대기)
      let savedBuffer = null;
      for (let i = 0; i < 10; i++) {
        try {
          savedBuffer = await loadLocalBookBuffer(String(finalBookId));
          if (savedBuffer && savedBuffer.byteLength > 0) {
            // 저장 완료 확인됨
            break;
          }
        } catch (_error) {
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
      // 뷰어는 EPUB, IndexedDB는 로컬 백업용
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
            최대 {Math.round(FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024))}MB, .epub
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
