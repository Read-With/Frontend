/**
 * 로컬 책의 ArrayBuffer를 IndexedDB에 저장하고 불러오는 유틸리티
 */

const DB_NAME = 'readwith_local_books';
const STORE_NAME = 'books';
const DB_VERSION = 1;

let db = null;

/**
 * IndexedDB 열기
 */
const openDB = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
};

/**
 * 로컬 책의 ArrayBuffer 저장
 * @param {string} bookId - 책 ID
 * @param {ArrayBuffer} arrayBuffer - EPUB 파일의 ArrayBuffer
 */
export const saveLocalBookBuffer = async (bookId, arrayBuffer) => {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    await new Promise((resolve, reject) => {
      const request = store.put(arrayBuffer, bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    console.log('✅ 로컬 책 ArrayBuffer 저장 완료:', bookId);
  } catch (error) {
    console.error('❌ 로컬 책 ArrayBuffer 저장 실패:', error);
    throw error;
  }
};

/**
 * 로컬 책의 ArrayBuffer 불러오기
 * @param {string} bookId - 책 ID
 * @returns {Promise<ArrayBuffer|null>} ArrayBuffer 또는 null
 */
export const loadLocalBookBuffer = async (bookId) => {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get(bookId);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('❌ 로컬 책 ArrayBuffer 불러오기 실패:', error);
    return null;
  }
};

/**
 * 로컬 책의 ArrayBuffer 삭제
 * @param {string} bookId - 책 ID
 */
export const deleteLocalBookBuffer = async (bookId) => {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    await new Promise((resolve, reject) => {
      const request = store.delete(bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    console.log('✅ 로컬 책 ArrayBuffer 삭제 완료:', bookId);
  } catch (error) {
    console.error('❌ 로컬 책 ArrayBuffer 삭제 실패:', error);
  }
};

/**
 * 모든 로컬 책 ArrayBuffer 삭제
 */
export const clearAllLocalBookBuffers = async () => {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    console.log('✅ 모든 로컬 책 ArrayBuffer 삭제 완료');
  } catch (error) {
    console.error('❌ 모든 로컬 책 ArrayBuffer 삭제 실패:', error);
  }
};

/**
 * IndexedDB에 저장된 모든 책 ID 목록 가져오기
 * @returns {Promise<string[]>} 책 ID 배열
 */
export const getAllLocalBookIds = async () => {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = request.result || [];
        // 숫자 ID를 문자열로 변환
        const bookIds = keys.map(key => key.toString());
        console.log('📚 IndexedDB에 저장된 책 ID 목록:', bookIds);
        resolve(bookIds);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('❌ IndexedDB 책 ID 목록 조회 실패:', error);
    return [];
  }
};

/**
 * IndexedDB에 저장된 모든 책 정보 확인 (디버깅용)
 * @returns {Promise<Object>} 책 정보 객체 (ID -> 크기 정보)
 */
export const inspectIndexedDB = async () => {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = async () => {
        const keys = request.result || [];
        const bookIds = keys.map(key => key.toString());
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📚 IndexedDB 내용 확인');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`총 ${bookIds.length}개의 책이 저장되어 있습니다.`);
        console.log('');
        
        const bookInfo = {};
        
        // 각 책의 크기 정보 가져오기
        for (const bookId of bookIds) {
          try {
            const arrayBuffer = await loadLocalBookBuffer(bookId);
            if (arrayBuffer) {
              const sizeInKB = (arrayBuffer.byteLength / 1024).toFixed(2);
              const sizeInMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(2);
              bookInfo[bookId] = {
                size: arrayBuffer.byteLength,
                sizeInKB: parseFloat(sizeInKB),
                sizeInMB: parseFloat(sizeInMB),
                exists: true
              };
              console.log(`📖 ${bookId}: ${sizeInMB} MB (${sizeInKB} KB)`);
            } else {
              bookInfo[bookId] = { exists: false };
              console.log(`⚠️ ${bookId}: 데이터 없음`);
            }
          } catch (error) {
            bookInfo[bookId] = { exists: false, error: error.message };
            console.log(`❌ ${bookId}: 로드 실패 - ${error.message}`);
          }
        }
        
        console.log('');
        console.log('📊 상세 정보:');
        console.log(JSON.stringify(bookInfo, null, 2));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        resolve({
          totalCount: bookIds.length,
          bookIds: bookIds,
          bookInfo: bookInfo
        });
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('❌ IndexedDB 확인 실패:', error);
    throw error;
  }
};

