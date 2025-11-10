/**
 * 로컬 책의 ArrayBuffer를 IndexedDB에 저장하고 불러오는 유틸리티
 */

const DB_NAME = 'readwith_local_books';
const BUFFER_STORE = 'books';
const META_STORE = 'books_metadata';
const DB_VERSION = 2;

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
      if (!database.objectStoreNames.contains(BUFFER_STORE)) {
        database.createObjectStore(BUFFER_STORE);
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
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
    const transaction = database.transaction([BUFFER_STORE], 'readwrite');
    const store = transaction.objectStore(BUFFER_STORE);
    
    await new Promise((resolve, reject) => {
      const request = store.put(arrayBuffer, bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
  } catch (error) {
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
    const transaction = database.transaction([BUFFER_STORE], 'readonly');
    const store = transaction.objectStore(BUFFER_STORE);
    
    return new Promise((resolve, reject) => {
      const request = store.get(bookId);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
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
    const transaction = database.transaction([BUFFER_STORE], 'readwrite');
    const store = transaction.objectStore(BUFFER_STORE);
    
    await new Promise((resolve, reject) => {
      const request = store.delete(bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
  } catch (error) {
    // 삭제 실패 무시
  }
};

export const saveLocalBookMetadata = async (bookId, metadata) => {
  try {
    const database = await openDB();
    const transaction = database.transaction([META_STORE], 'readwrite');
    const store = transaction.objectStore(META_STORE);
    await new Promise((resolve, reject) => {
      const request = store.put(metadata, bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    throw error;
  }
};

export const loadLocalBookMetadata = async (bookId) => {
  try {
    const database = await openDB();
    const transaction = database.transaction([META_STORE], 'readonly');
    const store = transaction.objectStore(META_STORE);
    return new Promise((resolve, reject) => {
      const request = store.get(bookId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    return null;
  }
};

export const getAllLocalBookMetadata = async () => {
  try {
    const database = await openDB();
    const transaction = database.transaction([META_STORE], 'readonly');
    const store = transaction.objectStore(META_STORE);
    const [keys, values] = await Promise.all([
      new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }),
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }),
    ]);
    return keys.map((key, index) => ({
      key: key.toString(),
      value: values[index] || null,
    }));
  } catch (error) {
    return [];
  }
};

export const deleteLocalBookMetadata = async (bookId) => {
  try {
    const database = await openDB();
    const transaction = database.transaction([META_STORE], 'readwrite');
    const store = transaction.objectStore(META_STORE);
    await new Promise((resolve, reject) => {
      const request = store.delete(bookId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    // noop
  }
};

/**
 * 모든 로컬 책 ArrayBuffer 삭제
 */
export const clearAllLocalBookBuffers = async () => {
  try {
    const database = await openDB();
    const transaction = database.transaction([BUFFER_STORE], 'readwrite');
    const store = transaction.objectStore(BUFFER_STORE);
    
    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
  } catch (error) {
    // 삭제 실패 무시
  }
};

/**
 * IndexedDB에 저장된 모든 책 ID 목록 가져오기
 * @returns {Promise<string[]>} 책 ID 배열
 */
export const getAllLocalBookIds = async () => {
  try {
    const database = await openDB();
    const transaction = database.transaction([BUFFER_STORE], 'readonly');
    const store = transaction.objectStore(BUFFER_STORE);
    
    return new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = request.result || [];
        // 숫자 ID를 문자열로 변환
        const bookIds = keys.map(key => key.toString());
        resolve(bookIds);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
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
    const transaction = database.transaction([BUFFER_STORE], 'readonly');
    const store = transaction.objectStore(BUFFER_STORE);
    
    return new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = async () => {
        const keys = request.result || [];
        const bookIds = keys.map(key => key.toString());
        
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
            } else {
              bookInfo[bookId] = { exists: false };
            }
          } catch (error) {
            bookInfo[bookId] = { exists: false, error: error.message };
          }
        }
        
        resolve({
          totalCount: bookIds.length,
          bookIds: bookIds,
          bookInfo: bookInfo
        });
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    throw error;
  }
};

