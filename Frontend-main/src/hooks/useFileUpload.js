import { useState } from 'react';

/**
 * 파일 업로드를 관리하는 커스텀 훅
 */
export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  // EPUB 파일인지 검증
  const validateEpubFile = (file) => {
    const allowedTypes = ['application/epub+zip', 'application/epub'];
    const allowedExtensions = ['.epub'];
    
    // MIME 타입 체크
    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.epub')) {
      return { valid: false, error: 'EPUB 파일만 업로드 가능합니다.' };
    }
    
    // 파일 크기 체크 (50MB 제한)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return { valid: false, error: '파일 크기는 50MB를 초과할 수 없습니다.' };
    }
    
    return { valid: true, error: null };
  };

  // 파일에서 메타데이터 추출 (기본 정보)
  const extractMetadata = (file) => {
    return {
      title: file.name.replace(/\.epub$/i, ''),
      filename: file.name,
      author: 'Unknown',
      uploadedAt: new Date().toISOString(),
      size: file.size,
      cover: null // 실제 구현에서는 EPUB 내부에서 커버 이미지를 추출할 수 있음
    };
  };

  // 파일 업로드 시뮬레이션
  const uploadFile = async (file) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      // 파일 유효성 검증
      const validation = validateEpubFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // 업로드 진행률 시뮬레이션
      const simulateUpload = () => {
        return new Promise((resolve) => {
          let progress = 0;
          const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 100) {
              progress = 100;
              clearInterval(interval);
              resolve();
            }
            setUploadProgress(Math.min(progress, 100));
          }, 200);
        });
      };

      await simulateUpload();

      // 메타데이터 추출
      const metadata = extractMetadata(file);

      // 실제 환경에서는 서버에 업로드하고 응답을 받음
      // 여기서는 로컬 스토리지나 상태에 저장하는 것으로 시뮬레이션
      
      return {
        success: true,
        data: metadata
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
