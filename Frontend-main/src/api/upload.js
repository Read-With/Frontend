import axios from 'axios';

/**
 * ePub 파일을 서버에 업로드하는 함수
 * @param {File} file - 업로드할 ePub 파일
 * @param {Function} onProgress - 업로드 진행률 콜백 함수
 * @returns {Promise} - 업로드 결과
 */
export const uploadEpubFile = async (file, onProgress) => {
  try {
    // FormData 객체 생성
    const formData = new FormData();
    formData.append('file', file);
    
    // 서버에 파일 업로드 요청
    const response = await axios.post('/api/upload/epub', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        // 업로드 진행률을 계산
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        
        // 콜백 함수가 제공된 경우 호출
        if (onProgress && typeof onProgress === 'function') {
          onProgress(percentCompleted);
        }
        
        console.log(`업로드 진행률: ${percentCompleted}%`);
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('파일 업로드 중 오류 발생:', error);
    throw error;
  }
};

/**
 * 업로드된 ePub 파일의 메타데이터를 가져오는 함수
 * @param {string} fileId - 업로드된 파일의 ID
 * @returns {Promise} - 파일 메타데이터
 */
export const getEpubMetadata = async (fileId) => {
  try {
    const response = await axios.get(`/api/upload/epub/${fileId}/metadata`);
    return response.data;
  } catch (error) {
    console.error('메타데이터 가져오기 중 오류 발생:', error);
    throw error;
  }
}; 