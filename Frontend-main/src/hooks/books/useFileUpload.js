import { useState } from 'react';
import { uploadBook } from '../../utils/api/api';
import { xhtmlUploadBasename } from '../../utils/library/xhtmlUploadUtils';

export const FILE_CONSTRAINTS = {
  MAX_SIZE: 50 * 1024 * 1024,
  ALLOWED_TYPES: [
    'application/xhtml+xml',
    'application/xml',
    'text/html',
    'text/xml',
  ],
  ALLOWED_EXTENSIONS: ['.xhtml', '.html', '.htm'],
  ACCEPT_ATTRIBUTE: '.xhtml,.html,.htm,application/xhtml+xml,text/html,application/xml,text/xml',
};

function isAllowedXhtmlFile(file) {
  const name = (file.name || '').toLowerCase();
  if (FILE_CONSTRAINTS.ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (file.type && FILE_CONSTRAINTS.ALLOWED_TYPES.includes(file.type)) return true;
  return false;
}

export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  const validateXhtmlFile = (file) => {
    if (!isAllowedXhtmlFile(file)) {
      return { valid: false, error: '.xhtml / .html / .htm 파일만 업로드할 수 있습니다.' };
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
      const validation = validateXhtmlFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', metadata.title || xhtmlUploadBasename(file.name));
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
    validateXhtmlFile,
  };
};
