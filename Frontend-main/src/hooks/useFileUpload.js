import { useState } from 'react';
import { uploadBook } from '../utils/api';

export const FILE_CONSTRAINTS = {
  MAX_SIZE: 50 * 1024 * 1024,
  ALLOWED_TYPES: ['application/epub+zip', 'application/epub'],
  ALLOWED_EXTENSIONS: ['.epub'],
  ACCEPT_ATTRIBUTE: '.epub,application/epub+zip'
};

export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  // EPUB 파일인지 검증
  const validateEpubFile = (file) => {
    // MIME 타입 체크
    if (!FILE_CONSTRAINTS.ALLOWED_TYPES.includes(file.type) && 
        !file.name.toLowerCase().endsWith('.epub')) {
      return { valid: false, error: 'EPUB 파일만 업로드 가능합니다.' };
    }
    
    // 파일 크기 체크
    if (file.size > FILE_CONSTRAINTS.MAX_SIZE) {
      return { valid: false, error: '파일 크기는 50MB를 초과할 수 없습니다.' };
    }
    
    return { valid: true, error: null };
  };

  // 실제 파일 업로드
  const uploadFile = async (file, metadata = {}) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      // 파일 유효성 검증
      const validation = validateEpubFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // FormData 생성
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', metadata.title || file.name.replace(/\.epub$/i, ''));
      formData.append('author', metadata.author || 'Unknown');
      formData.append('language', metadata.language || 'ko');

      // 업로드 진행률 시뮬레이션 (실제 업로드 진행률은 서버에서 받아야 함)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 10;
        });
      }, 200);

      // API 호출
      const response = await uploadBook(formData);
      
      clearInterval(progressInterval);
      setUploadProgress(100);

      if (response.isSuccess) {
        return {
          success: true,
          data: response.result
        };
      } else {
        throw new Error(response.message || '업로드에 실패했습니다.');
      }

    } catch (error) {
      setUploadError(error.message);
      return {
        success: false,
        error: error.message
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
    validateEpubFile
  };
};
