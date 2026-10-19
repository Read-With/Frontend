import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { getBooksArray, getBook, uploadBook } from '../../utils/api/booksApi';
import {
  extractEpubFileMetadata,
  epubUploadBasename,
  EPUB_FILE_CONSTRAINTS,
  validateEpubFile,
} from '../../utils/libraryUtils';
import { errorUtils } from '../../utils/common/valueUtils';
import { normalizeTitle, normalizeAuthor } from '../../utils/common/bookNormalize';
import { findCanonicalBook } from '../../hooks/bookHooks';
import { onActivationKey } from '../../utils/common/domUtils';
import { useModalFocusTrap, useAsyncRequestGuard, useBodyScrollLock, useLatestRef } from '../../hooks/common/hooksShared';
import './LibraryModalChrome.css';
import './FileUpload.css';

const EMPTY_METADATA = { title: '', author: '', language: 'ko' };
const MAX_MB = Math.round(EPUB_FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024));
const METADATA_EXTRACT_TIMEOUT_MS = 10000;

const METADATA_FIELDS = [
  { key: 'title', label: '제목 *', id: 'file-upload-title-input', placeholder: '책 제목을 입력하세요' },
  { key: 'author', label: '저자 *', id: 'file-upload-author-input', placeholder: '저자명을 입력하세요' },
];

function withMetadataTimeout(promise, ms = METADATA_EXTRACT_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Metadata extraction timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

/** 서버 원문 에러 대신 상태별 안내 — 원문은 logError로만 남긴다 */
function uploadErrorMessage(error) {
  const status = Number(error?.status);
  if (status === 413) return `파일이 너무 큽니다. ${MAX_MB}MB 이하의 EPUB 파일을 선택해 주세요.`;
  if (status === 400 || status === 415 || status === 422) {
    return 'EPUB 파일을 처리할 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.';
  }
  // getUserFriendlyMessage는 모르는 상태에서 원문을 돌려주므로 아는 경우만 위임
  if ([401, 403, 500, 502, 503].includes(status) || errorUtils.isNetworkError(error)) {
    return errorUtils.getUserFriendlyMessage(error);
  }
  return '업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

/** EPUB 메타데이터 추출 (10초 제한). 실패하면 파일명으로 대체 */
async function extractMetadataOrFallback(file) {
  try {
    return await withMetadataTimeout(extractEpubFileMetadata(file));
  } catch (error) {
    errorUtils.logWarning('FileUpload', 'EPUB 메타데이터 추출 실패, 파일명 폴백', {
      message: error?.message,
      fileName: file?.name || null,
    });
    return { title: epubUploadBasename(file.name), author: 'Unknown', language: 'ko' };
  }
}

/** 같은 제목+저자의 책이 이미 서버에 있으면 그 책, 없으면 업로드 */
async function resolveServerBook(file, metadata) {
  const books = await getBooksArray();
  const canonical = findCanonicalBook(
    books,
    normalizeTitle(metadata.title || ''),
    normalizeAuthor(metadata.author || ''),
  );

  const response = canonical
    ? await getBook(canonical.id)
    : await uploadBook(file, {
      title: metadata.title,
      author: metadata.author,
      language: metadata.language || 'ko',
    });
  if (!response?.isSuccess || !response.result) {
    const fallback = canonical ? '매칭된 책 정보를 가져올 수 없습니다.' : 'EPUB 업로드에 실패했습니다.';
    throw new Error(response?.message || fallback);
  }
  return response.result;
}

/** 1단계: 드래그·클릭으로 EPUB 선택 */
function SelectStep({ onFiles, onCancel }) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);
  const openFilePicker = () => inputRef.current?.click();

  const setDrag = (active) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(active);
  };

  const handleDrop = (e) => {
    setDrag(false)(e);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files?.length) onFiles(e.target.files);
    e.target.value = '';
  };

  return (
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
        onKeyDown={onActivationKey(openFilePicker)}
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
        onChange={handleFileInputChange}
      />

      <div className="file-upload-actions file-upload-actions--select">
        <button type="button" className="book-detail-secondary-btn" onClick={onCancel}>
          취소
        </button>
      </div>
    </>
  );
}

/** 2단계: 추출된 제목·저자·언어 확인 후 업로드 */
function MetadataStep({ file, metadata, onFieldChange, extracting, uploading, onBack, onUpload }) {
  const canSubmit =
    Boolean(normalizeTitle(metadata.title || '') && normalizeAuthor(metadata.author || '')) &&
    !extracting &&
    !uploading;
  const extractingPlaceholder = extracting ? '메타데이터 추출 중...' : undefined;
  const fieldChange = (key) => (e) => onFieldChange(key, e.target.value);

  let submitLabel = '업로드';
  if (uploading) {
    submitLabel = (
      <>
        <Loader2 size={16} className="animate-spin" aria-hidden />
        업로드 중...
      </>
    );
  } else if (extracting) {
    submitLabel = '메타데이터 추출 중...';
  }

  return (
    <>
      <div className="file-upload-file-card">
        <div className="file-upload-file-label">선택된 파일</div>
        <div className="file-upload-file-name">{file?.name}</div>
        {extracting && (
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
              onChange={fieldChange(key)}
              disabled={extracting}
              placeholder={extractingPlaceholder || placeholder}
            />
          </div>
        ))}

        <div className="file-upload-field">
          <label htmlFor="file-upload-language-input">언어</label>
          <select
            id="file-upload-language-input"
            value={metadata.language}
            onChange={fieldChange('language')}
            disabled={extracting || uploading}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </div>

      <div className="file-upload-actions">
        <button type="button" className="book-detail-secondary-btn" onClick={onBack} disabled={uploading}>
          뒤로
        </button>
        <button type="button" className="file-upload-btn-primary" onClick={onUpload} disabled={!canSubmit}>
          {submitLabel}
        </button>
      </div>
    </>
  );
}

const FileUpload = ({ onUploadSuccess, onClose }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [extractingMetadata, setExtractingMetadata] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const dialogRef = useRef(null);
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();
  // 언마운트 시 진행 중인 메타데이터 추출 결과를 버림 (isStale로 race·언마운트 모두 처리)
  useEffect(() => invalidate, [invalidate]);
  const step = selectedFile ? 'metadata' : 'select';

  // onClose는 부모 inline 함수라 ref로 고정 — 바뀔 때마다 포커스 트랩이 재실행되며 초기 포커스가 튀지 않게
  const onCloseRef = useLatestRef(onClose);
  const handleEscape = useCallback(() => {
    if (!uploadingRef.current) onCloseRef.current?.();
  }, [onCloseRef]);

  useModalFocusTrap(true, dialogRef, handleEscape);
  useBodyScrollLock();

  const handleFiles = async (files) => {
    const file = files?.[0];
    if (!file) return;
    const v = validateEpubFile(file);
    if (!v.valid) {
      toast.error(v.error);
      return;
    }
    const extractionId = nextRequestId();
    setSelectedFile(file);
    setExtractingMetadata(true);
    const extracted = await extractMetadataOrFallback(file);
    if (isStale(extractionId)) return;
    setExtractingMetadata(false);
    setMetadata((prev) => ({ ...prev, ...extracted }));
  };

  const handleUpload = async () => {
    if (!selectedFile || uploadingRef.current) return;

    uploadingRef.current = true;
    setUploading(true);
    try {
      const serverBook = await resolveServerBook(selectedFile, metadata);
      onUploadSuccess({ ...serverBook, _bookId: serverBook.id });
      onClose();
    } catch (error) {
      errorUtils.logError('FileUpload', error, {
        fileName: selectedFile?.name || null,
        title: metadata.title || null,
        status: error?.status ?? null,
        code: error?.code ?? null,
      });
      toast.error(uploadErrorMessage(error));
    } finally {
      uploadingRef.current = false;
      setUploading(false); // 언마운트 후 setState는 React 18+에서 무시됨
    }
  };

  const handleBack = () => {
    if (uploadingRef.current) return;
    setSelectedFile(null);
    setMetadata(EMPTY_METADATA);
  };

  const handleOverlayClick = (e) => {
    if (!uploadingRef.current && e.target === e.currentTarget) onClose();
  };

  return (
    <div
      ref={dialogRef}
      className="book-detail-modal"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-upload-title"
      aria-describedby="file-upload-desc"
      tabIndex={-1}
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
          <SelectStep onFiles={handleFiles} onCancel={onClose} />
        ) : (
          <MetadataStep
            file={selectedFile}
            metadata={metadata}
            onFieldChange={(key, value) => setMetadata((prev) => ({ ...prev, [key]: value }))}
            extracting={extractingMetadata}
            uploading={uploading}
            onBack={handleBack}
            onUpload={handleUpload}
          />
        )}
      </div>
    </div>
  );
};

export default FileUpload;
