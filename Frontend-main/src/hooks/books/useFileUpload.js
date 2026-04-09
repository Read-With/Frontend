import { useState } from 'react';
import { uploadBook } from '../../utils/api/api';
import { epubUploadBasename } from '../../utils/library/epubUploadUtils';

export const FILE_CONSTRAINTS = {
  MAX_SIZE: 50 * 1024 * 1024,
  ALLOWED_TYPES: ['application/epub+zip', 'application/epub'],
  ALLOWED_EXTENSIONS: ['.epub'],
  ACCEPT_ATTRIBUTE: '.epub,application/epub+zip,application/epub',
};

function isAllowedEpubFile(file) {
  const name = (file.name || '').toLowerCase();
  if (FILE_CONSTRAINTS.ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (file.type && FILE_CONSTRAINTS.ALLOWED_TYPES.includes(file.type)) return true;
  return false;
}

export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  const validateEpubFile = (file) => {
    if (!isAllowedEpubFile(file)) {
      return { valid: false, error: '.epub 파일만 업로드할 수 있습니다.' };
    }
    if (file.size > FILE_CONSTRAINTS.MAX_SIZE) {
      return { valid: false, error: '파일 크기는 50MB를 초과할 수 없습니다.' };
    }
    return { valid: true, error: null };
  };

  const uploadFile = async (file, metadata = {}) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const validation = validateEpubFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', metadata.title || epubUploadBasename(file.name));
      formData.append('author', metadata.author || 'Unknown');
      formData.append('language', metadata.language || 'ko');

      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 10;
        });
      }, 200);

      const response = await uploadBook(formData);

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (response.isSuccess) {
        return {
          success: true,
          data: response.result,
        };
      }
      throw new Error(response.message || '업로드에 실패했습니다.');
    } catch (error) {
      setUploadError(error.message);
      return {
        success: false,
        error: error.message,
      };
    } finally {
      setUploading(false);
    }
  };

  const resetUpload = () => {
    setUploading(false);
    setUploadProgress(0);
    setUploadError(null);
  };

  return {
    uploading,
    uploadProgress,
    uploadError,
    uploadFile,
    resetUpload,
    validateEpubFile,
  };
};
