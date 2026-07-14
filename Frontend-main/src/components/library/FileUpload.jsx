import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Upload, X, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getBooks, getBook, uploadBook } from '../../utils/api/booksApi';
import {
  extractEpubFileMetadata,
  epubUploadBasename,
  EPUB_FILE_CONSTRAINTS,
  validateEpubFile,
} from '../../utils/library/libraryUtils';
import { normalizeTitle, normalizeAuthor } from '../../utils/common/valueUtils';
import { BOOKS_QUERY_KEY, findCanonicalBook } from '../../hooks/books/bookHooks';
import './BookDetailModal.css';
import './FileUpload.css';

const EMPTY_METADATA = { title: '', author: '', language: 'ko' };
const MAX_MB = Math.round(EPUB_FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024));

const METADATA_FIELDS = [
  { key: 'title', label: '제목 *', id: 'file-upload-title-input', placeholder: '책 제목을 입력하세요' },
  { key: 'author', label: '저자 *', id: 'file-upload-author-input', placeholder: '저자명을 입력하세요' },
];

const FileUpload = ({ onUploadSuccess, onClose }) => {
  const queryClient = useQueryClient();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [step, setStep] = useState('select');
  const [extractingMetadata, setExtractingMetadata] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const uploadingRef = useRef(false);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== 'Escape' || uploadingRef.current) return;
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [onClose]);

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
    if (!files?.length) return;
    const file = files[0];
    const v = validateEpubFile(file);
    if (!v.valid) {
      alert(v.error);
      return;
    }
    setSelectedFile(file);
    setStep('metadata');
    const extracted = await extractEpubMetadata(file);
    setMetadata((prev) => ({ ...prev, ...extracted }));
  };

  const resolveServerBook = async () => {
    const titleKey = normalizeTitle(metadata.title || '');
    const authorKey = normalizeAuthor(metadata.author || '');
    if (!titleKey || !authorKey) {
      throw new Error('제목과 저자를 확인해주세요.');
    }

    let books = queryClient.getQueryData(BOOKS_QUERY_KEY)?.books;
    if (!Array.isArray(books)) {
      const res = await getBooks({});
      books = res?.isSuccess && Array.isArray(res.result) ? res.result : [];
    }

    const canonical = findCanonicalBook(books, titleKey, authorKey);
    if (canonical) {
      const bookResponse = await getBook(canonical.id);
      if (!bookResponse?.isSuccess || !bookResponse.result) {
        throw new Error(bookResponse?.message || '매칭된 책 정보를 가져올 수 없습니다.');
      }
      return bookResponse.result;
    }

    const uploadResponse = await uploadBook(selectedFile, {
      title: metadata.title,
      author: metadata.author,
      language: metadata.language || 'ko',
    });
    if (!uploadResponse?.isSuccess || !uploadResponse.result) {
      throw new Error(uploadResponse?.message || 'EPUB 업로드에 실패했습니다.');
    }
    return uploadResponse.result;
  };

  const handleUpload = async () => {
    if (!selectedFile || uploadingRef.current) return;

    uploadingRef.current = true;
    setUploading(true);

    try {
      const serverBook = await resolveServerBook();
      const bookId = serverBook.id;
      onUploadSuccess({
        ...serverBook,
        id: bookId,
        _bookId: bookId,
      });
      onClose();
    } catch (error) {
      console.error('업로드 처리 실패:', error);
      alert(`업로드 처리 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const handleBack = () => {
    if (uploadingRef.current) return;
    setStep('select');
    setSelectedFile(null);
    setMetadata(EMPTY_METADATA);
  };

  const setDrag = (active) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(active);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const openFilePicker = () => inputRef.current?.click();
  const canSubmit =
    Boolean(metadata.title && metadata.author) && !extractingMetadata && !uploading;
  const extractingPlaceholder = extractingMetadata ? '메타데이터 추출 중...' : undefined;

  return (
    <div
      className="book-detail-modal"
      onClick={(e) => {
        if (!uploadingRef.current && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-upload-title"
      aria-describedby="file-upload-desc"
    >
      <p id="file-upload-desc" className="book-detail-modal-desc">
        EPUB 파일을 선택하고 제목·저자를 확인한 뒤 업로드합니다.
      </p>

      <div className="file-upload-content">
        <button
          type="button"
          className="book-detail-close-btn"
          onClick={onClose}
          disabled={uploading}
          aria-label="닫기"
        >
          <X size={18} strokeWidth={2} />
        </button>

        <h2 id="file-upload-title" className="file-upload-title">
          {step === 'select' ? '파일 업로드' : '책 정보 확인'}
        </h2>

        {step === 'select' ? (
          <>
            <div
              className={`epub-dropzone${dragActive ? ' is-active' : ''}`}
              onDragEnter={setDrag(true)}
              onDragLeave={setDrag(false)}
              onDragOver={setDrag(true)}
              onDrop={handleDrop}
              onClick={openFilePicker}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openFilePicker();
                }
              }}
            >
              <div className="epub-dropzone-icon" aria-hidden>
                <Upload size={22} strokeWidth={1.75} />
              </div>
              <strong>{dragActive ? '파일을 여기에 놓으세요' : 'EPUB 파일 선택'}</strong>
              <span>파일을 드래그하거나 클릭해서 업로드하세요</span>
              <small>최대 {MAX_MB}MB · .epub</small>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept={EPUB_FILE_CONSTRAINTS.ACCEPT_ATTRIBUTE}
              className="file-upload-file-input"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
              }}
            />

            <div className="file-upload-actions file-upload-actions--select">
              <button type="button" className="book-detail-secondary-btn" onClick={onClose}>
                취소
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="file-upload-file-card">
              <div className="file-upload-file-label">선택된 파일</div>
              <div className="file-upload-file-name">{selectedFile?.name}</div>
              {extractingMetadata && (
                <div className="file-upload-extracting">
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  EPUB 메타데이터 추출 중...
                </div>
              )}
            </div>

            <div className="file-upload-fields">
              {METADATA_FIELDS.map(({ key, label, id, placeholder }) => (
                <div className="file-upload-field" key={key}>
                  <label htmlFor={id}>{label}</label>
                  <input
                    id={id}
                    type="text"
                    value={metadata[key]}
                    onChange={(e) => setMetadata((prev) => ({ ...prev, [key]: e.target.value }))}
                    disabled={extractingMetadata}
                    placeholder={extractingPlaceholder || placeholder}
                  />
                </div>
              ))}

              <div className="file-upload-field">
                <label htmlFor="file-upload-language-input">언어</label>
                <select
                  id="file-upload-language-input"
                  value={metadata.language}
                  onChange={(e) => setMetadata((prev) => ({ ...prev, language: e.target.value }))}
                  disabled={extractingMetadata || uploading}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="zh">中文</option>
                </select>
              </div>
            </div>

            <div className="file-upload-actions">
              <button
                type="button"
                className="book-detail-secondary-btn"
                onClick={handleBack}
                disabled={uploading}
              >
                뒤로
              </button>
              <button
                type="button"
                className="file-upload-btn-primary"
                onClick={handleUpload}
                disabled={!canSubmit}
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                    업로드 중...
                  </>
                ) : extractingMetadata ? (
                  '메타데이터 추출 중...'
                ) : (
                  '업로드'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

FileUpload.propTypes = {
  onUploadSuccess: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default FileUpload;
