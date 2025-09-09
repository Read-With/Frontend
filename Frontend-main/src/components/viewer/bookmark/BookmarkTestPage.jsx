import React, { useState } from 'react';
import { bookmarkTestUtils } from '../../../utils/bookmarkTest';

const BookmarkTestPage = () => {
  const [testResults, setTestResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [bookId, setBookId] = useState('test-book-123');
  const [editingBookmark, setEditingBookmark] = useState(null);
  const [editMemo, setEditMemo] = useState('');

  const runTest = async () => {
    setIsRunning(true);
    setTestResults(null);
    
    try {
      const results = await bookmarkTestUtils.runFullTest(bookId);
      setTestResults(results);
    } catch (error) {
      setTestResults({
        success: false,
        error: error.message
      });
    } finally {
      setIsRunning(false);
    }
  };

  const runIndividualTest = async (testName) => {
    setIsRunning(true);
    setTestResults(null);
    
    try {
      let result;
      switch (testName) {
        case 'connection':
          result = await bookmarkTestUtils.testServerConnection();
          // 서버 연결 성공 시 북마크 목록도 함께 조회
          if (result.success) {
            const bookmarkResult = await bookmarkTestUtils.testLoadBookmarks(bookId);
            setTestResults({
              success: result.success,
              results: { 
                connection: result,
                load: bookmarkResult
              }
            });
            return; // setTestResults가 이미 호출되었으므로 return
          }
          break;
        case 'load':
          result = await bookmarkTestUtils.testLoadBookmarks(bookId);
          break;
        case 'add':
          result = await bookmarkTestUtils.testAddBookmark(bookId);
          break;
        default:
          result = { success: false, error: '알 수 없는 테스트' };
      }
      
      setTestResults({
        success: result.success,
        results: { [testName]: result }
      });
    } catch (error) {
      setTestResults({
        success: false,
        error: error.message
      });
    } finally {
      setIsRunning(false);
    }
  };

  // 북마크 편집 시작
  const startEditBookmark = (bookmark) => {
    setEditingBookmark(bookmark);
    setEditMemo(bookmark.memo || '');
  };

  // 북마크 편집 취소
  const cancelEditBookmark = () => {
    setEditingBookmark(null);
    setEditMemo('');
  };

  // 북마크 수정 저장
  const saveEditBookmark = async () => {
    if (!editingBookmark) return;
    
    setIsRunning(true);
    try {
      const result = await bookmarkTestUtils.testModifyBookmark(editingBookmark.id, editMemo);
      
      if (result.success) {
        // 목록 새로고침
        const loadResult = await bookmarkTestUtils.testLoadBookmarks(bookId);
        setTestResults(prev => ({
          ...prev,
          results: {
            ...prev.results,
            load: loadResult
          }
        }));
        setEditingBookmark(null);
        setEditMemo('');
      } else {
        alert('북마크 수정에 실패했습니다: ' + result.error);
      }
    } catch (error) {
      alert('북마크 수정 중 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  // 북마크 삭제
  const deleteBookmark = async (bookmarkId) => {
    if (!confirm('정말로 이 북마크를 삭제하시겠습니까?')) return;
    
    setIsRunning(true);
    try {
      const result = await bookmarkTestUtils.testRemoveBookmark(bookmarkId);
      
      if (result.success) {
        // 목록 새로고침
        const loadResult = await bookmarkTestUtils.testLoadBookmarks(bookId);
        setTestResults(prev => ({
          ...prev,
          results: {
            ...prev.results,
            load: loadResult
          }
        }));
      } else {
        alert('북마크 삭제에 실패했습니다: ' + result.error);
      }
    } catch (error) {
      alert('북마크 삭제 중 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={{ 
      padding: '2rem', 
      maxWidth: '800px', 
      margin: '0 auto',
      fontFamily: 'var(--font-family-primary)',
      minHeight: '100vh',
      overflowY: 'auto',
      scrollBehavior: 'smooth'
    }}>
      <h1 style={{ 
        fontSize: '2rem', 
        color: '#22336b', 
        marginBottom: '2rem',
        textAlign: 'center'
      }}>
        🔧 북마크 기능 테스트
      </h1>

      <div style={{
        background: '#f8f9fc',
        padding: '1.5rem',
        borderRadius: '1rem',
        marginBottom: '2rem',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#374151' }}>테스트 설정</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <label style={{ fontWeight: '500' }}>책 ID:</label>
          <input
            type="text"
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            style={{
              padding: '0.5rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.5rem',
              flex: 1,
              maxWidth: '300px'
            }}
            placeholder="테스트할 책 ID 입력"
          />
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <button
          onClick={runTest}
          disabled={isRunning}
          style={{
            background: 'linear-gradient(135deg, #6C8EFF 0%, #5A7BFF 100%)',
            color: 'white',
            border: 'none',
            padding: '1rem',
            borderRadius: '0.5rem',
            fontWeight: '600',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.7 : 1,
            fontSize: '1rem'
          }}
        >
          {isRunning ? '테스트 중...' : '🧪 전체 테스트 실행'}
        </button>

        <button
          onClick={() => runIndividualTest('load')}
          disabled={isRunning}
          style={{
            background: '#10b981',
            color: 'white',
            border: 'none',
            padding: '1rem',
            borderRadius: '0.5rem',
            fontWeight: '600',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.7 : 1
          }}
        >
          🔍 목록 조회 테스트
        </button>

        <button
          onClick={() => runIndividualTest('add')}
          disabled={isRunning}
          style={{
            background: '#f59e0b',
            color: 'white',
            border: 'none',
            padding: '1rem',
            borderRadius: '0.5rem',
            fontWeight: '600',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.7 : 1
          }}
        >
          ➕ 북마크 추가 테스트
        </button>

        <button
          onClick={() => runIndividualTest('connection')}
          disabled={isRunning}
          style={{
            background: '#8b5cf6',
            color: 'white',
            border: 'none',
            padding: '1rem',
            borderRadius: '0.5rem',
            fontWeight: '600',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.7 : 1
          }}
        >
          🔗 서버 연결 테스트
        </button>
      </div>

      {testResults && (
        <div style={{
          background: testResults.success ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${testResults.success ? '#bbf7d0' : '#fecaca'}`,
          borderRadius: '1rem',
          padding: '1.5rem',
          marginTop: '2rem'
        }}>
          <h3 style={{ 
            margin: '0 0 1rem 0',
            color: testResults.success ? '#166534' : '#dc2626'
          }}>
            {testResults.success ? '✅ 테스트 결과' : '❌ 테스트 실패'}
          </h3>

          {testResults.error ? (
            <div style={{ color: '#dc2626' }}>
              <strong>오류:</strong> {testResults.error}
            </div>
          ) : (
            <div>
              {testResults.results && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {Object.entries(testResults.results).map(([testName, result]) => (
                    <div key={testName} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      background: 'white',
                      borderRadius: '0.5rem',
                      border: '1px solid #e5e7eb'
                    }}>
                      <span style={{ fontSize: '1.2rem' }}>
                        {result.success ? '✅' : '❌'}
                      </span>
                      <span style={{ fontWeight: '500' }}>
                        {testName === 'connection' && '서버 연결'}
                        {testName === 'load' && '목록 조회'}
                        {testName === 'add' && '북마크 추가'}
                        {testName === 'modify' && '북마크 수정'}
                        {testName === 'remove' && '북마크 삭제'}
                      </span>
                      {result.error && (
                        <span style={{ color: '#dc2626', fontSize: '0.9rem' }}>
                          - {result.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 서버 연결 정보 표시 */}
              {testResults.results?.connection?.data && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#374151', fontSize: '1.1rem' }}>
                    🔗 서버 연결 정보
                  </h4>
                  <div style={{ 
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '0.5rem',
                    padding: '1rem'
                  }}>
                    <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: '500' }}>서버 상태:</span>
                        <span style={{ color: '#166534' }}>✅ 연결 성공</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: '500' }}>응답 코드:</span>
                        <span style={{ color: '#166534' }}>{testResults.results.connection.data.status} {testResults.results.connection.data.statusText}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: '500' }}>응답 시간:</span>
                        <span style={{ color: '#166534' }}>{testResults.results.connection.data.responseTime}ms</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: '500' }}>서버 도서 수:</span>
                        <span style={{ color: '#166534' }}>{testResults.results.connection.data.bookCount}권</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: '500' }}>테스트 시간:</span>
                        <span style={{ color: '#166534' }}>{new Date().toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 북마크 목록 표시 */}
              {testResults.results?.load?.data && testResults.results.load.data.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#374151', fontSize: '1.1rem' }}>
                    📚 북마크 목록 ({testResults.results.load.data.length}개)
                  </h4>
                  <div style={{ 
                    maxHeight: '500px', 
                    overflowY: 'auto',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    background: 'white'
                  }}>
                    {testResults.results.load.data.map((bookmark, index) => (
                      <div key={bookmark.id || index} style={{
                        padding: '1rem',
                        borderBottom: index < testResults.results.load.data.length - 1 ? '1px solid #f3f4f6' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              backgroundColor: bookmark.color || '#0Ccd5B'
                            }}></div>
                            <span style={{ fontWeight: '600', color: '#374151' }}>
                              북마크 #{bookmark.id}
                            </span>
                            <span style={{ 
                              fontSize: '0.8rem', 
                              color: '#6b7280',
                              background: '#f3f4f6',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '0.25rem'
                            }}>
                              {new Date(bookmark.createdAt).toLocaleString('ko-KR')}
                            </span>
                          </div>
                          
                          {/* 편집/삭제 버튼 */}
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              onClick={() => startEditBookmark(bookmark)}
                              disabled={isRunning}
                              style={{
                                background: '#3b82f6',
                                color: 'white',
                                border: 'none',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.8rem',
                                cursor: isRunning ? 'not-allowed' : 'pointer',
                                opacity: isRunning ? 0.6 : 1
                              }}
                            >
                              ✏️ 편집
                            </button>
                            <button
                              onClick={() => deleteBookmark(bookmark.id)}
                              disabled={isRunning}
                              style={{
                                background: '#dc2626',
                                color: 'white',
                                border: 'none',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.8rem',
                                cursor: isRunning ? 'not-allowed' : 'pointer',
                                opacity: isRunning ? 0.6 : 1
                              }}
                            >
                              🗑️ 삭제
                            </button>
                          </div>
                        </div>
                        
                        {/* 메모 표시/편집 */}
                        {editingBookmark?.id === bookmark.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <textarea
                              value={editMemo}
                              onChange={(e) => setEditMemo(e.target.value)}
                              placeholder="북마크 메모를 입력하세요..."
                              style={{
                                width: '100%',
                                minHeight: '60px',
                                padding: '0.5rem',
                                border: '1px solid #d1d5db',
                                borderRadius: '0.25rem',
                                fontSize: '0.9rem',
                                fontFamily: 'inherit',
                                resize: 'vertical'
                              }}
                            />
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                onClick={saveEditBookmark}
                                disabled={isRunning}
                                style={{
                                  background: '#10b981',
                                  color: 'white',
                                  border: 'none',
                                  padding: '0.5rem 1rem',
                                  borderRadius: '0.25rem',
                                  fontSize: '0.9rem',
                                  cursor: isRunning ? 'not-allowed' : 'pointer',
                                  opacity: isRunning ? 0.6 : 1
                                }}
                              >
                                💾 저장
                              </button>
                              <button
                                onClick={cancelEditBookmark}
                                disabled={isRunning}
                                style={{
                                  background: '#6b7280',
                                  color: 'white',
                                  border: 'none',
                                  padding: '0.5rem 1rem',
                                  borderRadius: '0.25rem',
                                  fontSize: '0.9rem',
                                  cursor: isRunning ? 'not-allowed' : 'pointer',
                                  opacity: isRunning ? 0.6 : 1
                                }}
                              >
                                ❌ 취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          bookmark.memo && (
                            <div style={{ 
                              color: '#4b5563',
                              fontSize: '0.9rem',
                              fontStyle: 'italic'
                            }}>
                              💭 {bookmark.memo}
                            </div>
                          )
                        )}
                        
                        <div style={{ 
                          fontSize: '0.8rem',
                          color: '#6b7280',
                          fontFamily: 'monospace',
                          background: '#f9fafb',
                          padding: '0.5rem',
                          borderRadius: '0.25rem',
                          wordBreak: 'break-all'
                        }}>
                          📍 {bookmark.startCfi}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 북마크가 없는 경우 */}
              {testResults.results?.load?.data && testResults.results.load.data.length === 0 && (
                <div style={{ 
                  marginTop: '1.5rem',
                  textAlign: 'center',
                  color: '#6b7280',
                  padding: '2rem',
                  background: '#f9fafb',
                  borderRadius: '0.5rem',
                  border: '1px solid #e5e7eb'
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📖</div>
                  <div>저장된 북마크가 없습니다.</div>
                  <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>
                    북마크 추가 테스트를 실행해보세요!
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

        <div style={{
          background: '#f3f4f6',
          padding: '1.5rem',
          borderRadius: '1rem',
          marginTop: '2rem',
          fontSize: '0.9rem',
          color: '#6b7280'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#374151' }}>📝 테스트 안내</h4>
          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
            <li>이 테스트는 epub 파일 없이도 북마크 API 기능을 확인할 수 있습니다.</li>
            <li>실제 서버 API와 통신하여 북마크 CRUD 기능을 테스트합니다.</li>
            <li>같은 CFI 위치에 시간에 따라 구별되는 북마크를 개별적으로 추가할 수 있습니다.</li>
            <li>테스트용 책 ID를 변경하여 다른 책의 북마크를 테스트할 수 있습니다.</li>
            <li>브라우저 개발자 도구 콘솔에서도 <code>bookmarkTest.runFullTest()</code>로 테스트할 수 있습니다.</li>
          </ul>
        </div>

        {/* 개발자 도구 섹션 */}
        <div style={{
          background: '#f8fafc',
          padding: '2rem',
          borderRadius: '1rem',
          marginTop: '2rem',
          border: '1px solid #e2e8f0'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#374151' }}>🔧 개발자 도구</h4>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', lineHeight: '1.6' }}>
            <p>브라우저 개발자 도구(F12)를 열고 콘솔에서 다음 명령어들을 사용할 수 있습니다:</p>
            <ul style={{ margin: '1rem 0', paddingLeft: '1.5rem' }}>
              <li><code style={{ background: '#e5e7eb', padding: '0.2rem 0.4rem', borderRadius: '0.25rem' }}>bookmarkTest.testServerConnection()</code> - 서버 연결 테스트</li>
              <li><code style={{ background: '#e5e7eb', padding: '0.2rem 0.4rem', borderRadius: '0.25rem' }}>bookmarkTest.testLoadBookmarks()</code> - 북마크 목록 조회</li>
              <li><code style={{ background: '#e5e7eb', padding: '0.2rem 0.4rem', borderRadius: '0.25rem' }}>bookmarkTest.testAddBookmark()</code> - 북마크 추가</li>
              <li><code style={{ background: '#e5e7eb', padding: '0.2rem 0.4rem', borderRadius: '0.25rem' }}>bookmarkTest.runFullTest()</code> - 전체 테스트 실행</li>
            </ul>
          </div>
        </div>

        {/* API 정보 섹션 */}
        <div style={{
          background: '#fef3c7',
          padding: '2rem',
          borderRadius: '1rem',
          marginTop: '2rem',
          border: '1px solid #f59e0b'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#92400e' }}>📡 API 엔드포인트 정보</h4>
          <div style={{ fontSize: '0.9rem', color: '#92400e', lineHeight: '1.6' }}>
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              <li><strong>GET /api/bookmarks</strong> - 북마크 목록 조회</li>
              <li><strong>POST /api/bookmarks</strong> - 북마크 생성</li>
              <li><strong>PATCH /api/bookmarks/&#123;id&#125;</strong> - 북마크 수정</li>
              <li><strong>DELETE /api/bookmarks/&#123;id&#125;</strong> - 북마크 삭제</li>
            </ul>
          </div>
        </div>

        {/* 주의사항 섹션 */}
        <div style={{
          background: '#fef2f2',
          padding: '2rem',
          borderRadius: '1rem',
          marginTop: '2rem',
          border: '1px solid #fecaca'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#dc2626' }}>⚠️ 주의사항</h4>
          <div style={{ fontSize: '0.9rem', color: '#dc2626', lineHeight: '1.6' }}>
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              <li>테스트용 북마크는 실제 서버에 저장됩니다.</li>
              <li>불필요한 테스트 데이터는 정기적으로 정리해주세요.</li>
              <li>서버 연결이 안 될 경우 백엔드 서버 상태를 확인해주세요.</li>
              <li>CFI는 EPUB 파일의 특정 위치를 나타내는 고유 식별자입니다.</li>
            </ul>
          </div>
        </div>

        {/* 추가 정보 섹션 */}
        <div style={{
          background: '#f0fdf4',
          padding: '2rem',
          borderRadius: '1rem',
          marginTop: '2rem',
          border: '1px solid #bbf7d0'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#166534' }}>💡 추가 정보</h4>
          <div style={{ fontSize: '0.9rem', color: '#166534', lineHeight: '1.6' }}>
            <p>이 페이지는 북마크 기능의 모든 CRUD 작업을 테스트할 수 있도록 설계되었습니다. 
            서버 연결부터 북마크 추가, 수정, 삭제까지 모든 기능을 확인해보세요.</p>
            <p style={{ marginTop: '1rem' }}>
              <strong>CFI (Content Fragment Identifier)</strong>는 EPUB 파일 내의 특정 위치를 정확히 식별하는 표준 방법입니다. 
              이 테스트에서는 가상의 CFI를 사용하여 북마크 기능을 시뮬레이션합니다.
            </p>
          </div>
        </div>

        {/* 하단 여백 */}
        <div style={{ height: '4rem' }}></div>
    </div>
  );
};

export default BookmarkTestPage;
