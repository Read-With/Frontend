import { useState } from 'react';
import { uploadBook } from '../utils/common/api';

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

  // 로컬 파일 처리 (서버 업로드 없이 바로 뷰어에서 열기)
  const processLocalFile = async (file, metadata = {}) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      // 파일 유효성 검증
      const validation = validateEpubFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // 파일을 ArrayBuffer로 변환 (CSP 문제 회피)
      const arrayBuffer = await file.arrayBuffer();
      
      // 로컬 책 객체 생성
      const localBookId = `local_${Date.now()}_${file.name}`;
      const localBook = {
        id: localBookId,
        title: metadata.title || file.name.replace(/\.epub$/i, ''),
        author: metadata.author || 'Unknown',
        language: metadata.language || 'ko',
        epubFile: file, // File 객체 저장 (메모리에만)
        epubArrayBuffer: arrayBuffer, // ArrayBuffer 저장 (메모리에만)
        filename: file.name,
        isLocal: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // IndexedDB에 ArrayBuffer 저장 (다시 열기 위해)
      try {
        const { saveLocalBookBuffer } = await import('../utils/localBookStorage');
        await saveLocalBookBuffer(localBookId, arrayBuffer);
      } catch (error) {
        console.warn('IndexedDB 저장 실패, 메모리에서만 사용:', error);
      }
      
      // localStorage에는 메타데이터만 저장 (File 객체는 직렬화 불가)
      const localBookMeta = {
        id: localBookId,
        title: localBook.title,
        author: localBook.author,
        language: localBook.language,
        filename: localBook.filename,
        isLocal: true,
        createdAt: localBook.createdAt,
        updatedAt: localBook.updatedAt
      };
      
      const localBooks = JSON.parse(localStorage.getItem('localBooks') || '[]');
      const filteredBooks = localBooks.filter(b => b.id !== localBookMeta.id);
      localStorage.setItem('localBooks', JSON.stringify([localBookMeta, ...filteredBooks]));

      setUploadProgress(100);

      return {
        success: true,
        data: localBook
      };

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
    processLocalFile,
    resetUpload,
    validateEpubFile
  };
};
