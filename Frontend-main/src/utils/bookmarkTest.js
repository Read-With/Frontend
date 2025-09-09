// 북마크 기능 테스트 유틸리티
import { loadBookmarks, addBookmark, removeBookmark, modifyBookmark } from '../components/viewer/bookmark/BookmarkManager';

// 테스트용 북마크 데이터 (매번 다른 CFI 사용)
const getTestBookmarkData = () => {
  const timestamp = Date.now();
  const randomOffset = Math.floor(Math.random() * 1000);
  
  return {
    bookId: 'test-book-123',
    startCfi: `epubcfi(/6/4[chapter-1]!/4[body01]/10[para05]/2/1:${3 + randomOffset})`,
    endCfi: null,
    color: '#0Ccd5B',
    memo: `테스트 북마크입니다 (${new Date().toLocaleTimeString()})`
  };
};

// 북마크 기능 테스트 함수들
export const bookmarkTestUtils = {
  // 0. 서버 연결 테스트
  async testServerConnection() {
    console.log('🔗 서버 연결 테스트 시작...');
    try {
      const startTime = Date.now();
      const response = await fetch('/api/books', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      console.log('📡 서버 응답 상태:', response.status, response.statusText);
      console.log('⏱️ 응답 시간:', responseTime + 'ms');
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ 서버 연결 성공:', data);
        
        return { 
          success: true, 
          data: {
            status: response.status,
            statusText: response.statusText,
            responseTime: responseTime,
            bookCount: data.result?.length || 0,
            serverData: data
          }
        };
      } else {
        console.error('❌ 서버 응답 오류:', response.status, response.statusText);
        return { success: false, error: `서버 응답 오류: ${response.status}` };
      }
    } catch (error) {
      console.error('❌ 서버 연결 실패:', error);
      return { success: false, error: error.message };
    }
  },
  // 1. 북마크 목록 조회 테스트
  async testLoadBookmarks(bookId = 'test-book-123') {
    console.log('🔍 북마크 목록 조회 테스트 시작...');
    try {
      const bookmarks = await loadBookmarks(bookId, 'time_desc');
      console.log('✅ 북마크 목록 조회 성공:', bookmarks);
      console.log(`📊 총 ${bookmarks.length}개의 북마크를 찾았습니다.`);
      
      // 북마크 상세 정보 로그
      if (bookmarks.length > 0) {
        console.log('📚 북마크 상세 정보:');
        bookmarks.forEach((bookmark, index) => {
          console.log(`  ${index + 1}. ID: ${bookmark.id}, 메모: "${bookmark.memo || '없음'}", 생성일: ${bookmark.createdAt}`);
        });
      }
      
      return { success: true, data: bookmarks };
    } catch (error) {
      console.error('❌ 북마크 목록 조회 실패:', error);
      return { success: false, error: error.message };
    }
  },

  // 2. 북마크 추가 테스트
  async testAddBookmark(bookId = 'test-book-123') {
    console.log('➕ 북마크 추가 테스트 시작...');
    try {
      const testData = getTestBookmarkData();
      console.log('📝 테스트 데이터:', testData);
      
      const result = await addBookmark(
        bookId,
        testData.startCfi,
        testData.endCfi,
        testData.color,
        testData.memo
      );
      
      if (result.success) {
        console.log('✅ 북마크 추가 성공:', result.bookmark);
        return { success: true, bookmark: result.bookmark };
      } else {
        console.error('❌ 북마크 추가 실패:', result.message);
        return { success: false, error: result.message };
      }
    } catch (error) {
      console.error('❌ 북마크 추가 예외:', error);
      console.error('❌ 오류 상세:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      return { success: false, error: error.message };
    }
  },


  // 3. 북마크 수정 테스트
  async testModifyBookmark(bookmarkId, newMemo = '수정된 테스트 메모') {
    console.log('✏️ 북마크 수정 테스트 시작...');
    try {
      const result = await modifyBookmark(bookmarkId, null, newMemo);
      
      if (result.success) {
        console.log('✅ 북마크 수정 성공:', result.bookmark);
        return { success: true, bookmark: result.bookmark };
      } else {
        console.error('❌ 북마크 수정 실패:', result.message);
        return { success: false, error: result.message };
      }
    } catch (error) {
      console.error('❌ 북마크 수정 예외:', error);
      return { success: false, error: error.message };
    }
  },

  // 4. 북마크 삭제 테스트
  async testRemoveBookmark(bookmarkId) {
    console.log('🗑️ 북마크 삭제 테스트 시작...');
    try {
      const result = await removeBookmark(bookmarkId);
      
      if (result.success) {
        console.log('✅ 북마크 삭제 성공');
        return { success: true };
      } else {
        console.error('❌ 북마크 삭제 실패:', result.message);
        return { success: false, error: result.message };
      }
    } catch (error) {
      console.error('❌ 북마크 삭제 예외:', error);
      return { success: false, error: error.message };
    }
  },

  // 5. 전체 북마크 기능 테스트
  async runFullTest(bookId = 'test-book-123') {
    console.log('🧪 북마크 전체 기능 테스트 시작...');
    console.log('='.repeat(50));
    
    const results = {
      load: null,
      add: null,
      modify: null,
      remove: null
    };

    // 1. 목록 조회 테스트
    results.load = await this.testLoadBookmarks(bookId);
    
    // 2. 북마크 추가 테스트 (매번 다른 CFI 사용)
    results.add = await this.testAddBookmark(bookId);
    
    if (results.add.success) {
      const bookmarkId = results.add.bookmark.id;
      
      // 3. 북마크 수정 테스트
      results.modify = await this.testModifyBookmark(bookmarkId);
      
      // 4. 북마크 삭제 테스트
      results.remove = await this.testRemoveBookmark(bookmarkId);
    }

    // 결과 요약
    console.log('='.repeat(50));
    console.log('📊 테스트 결과 요약:');
    console.log('목록 조회:', results.load.success ? '✅' : '❌');
    console.log('북마크 추가:', results.add.success ? '✅' : '❌');
    console.log('북마크 수정:', results.modify?.success ? '✅' : '❌');
    console.log('북마크 삭제:', results.remove?.success ? '✅' : '❌');
    
    const allSuccess = Object.values(results).every(result => result?.success);
    console.log('전체 결과:', allSuccess ? '✅ 모든 테스트 통과' : '❌ 일부 테스트 실패');
    
    return {
      success: allSuccess,
      results
    };
  }
};

// 브라우저 콘솔에서 사용할 수 있도록 전역 등록
if (typeof window !== 'undefined') {
  window.bookmarkTest = bookmarkTestUtils;
  console.log('🔧 북마크 테스트 유틸리티가 로드되었습니다.');
  console.log('사용법: bookmarkTest.runFullTest() 또는 개별 테스트 함수 호출');
}
