import React, { useState, useEffect } from 'react';
import { useBookmarks } from '../../../hooks/useBookmarks';

/**
 * 북마크 편집 컴포넌트
 * @param {Object} props
 * @param {number} props.bookId - 책 ID
 * @param {Object} props.bookmark - 편집할 북마크 객체
 * @param {Function} props.onClose - 닫기 콜백
 * @param {Function} props.onSuccess - 성공 콜백
 */
const BookmarkEditor = ({ bookId, bookmark, onClose, onSuccess }) => {
  const [memo, setMemo] = useState('');
  const [color, setColor] = useState('#28B532');
  const [loading, setLoading] = useState(false);
  const { changeBookmarkColor, changeBookmarkMemo } = useBookmarks(bookId);

  const colors = [
    { value: '#28B532', label: '기본', preview: '#28B532' },
    { value: '#FF6B6B', label: '빨강', preview: '#FF6B6B' },
    { value: '#4ECDC4', label: '청록', preview: '#4ECDC4' },
    { value: '#45B7D1', label: '파랑', preview: '#45B7D1' },
    { value: '#96CEB4', label: '연두', preview: '#96CEB4' },
    { value: '#FFEAA7', label: '노랑', preview: '#FFEAA7' },
    { value: '#DDA0DD', label: '보라', preview: '#DDA0DD' },
    { value: '#FFB347', label: '주황', preview: '#FFB347' },
  ];

  // 초기값 설정
  useEffect(() => {
    if (bookmark) {
      setMemo(bookmark.memo || '');
      setColor(bookmark.color || '#28B532');
    }
  }, [bookmark]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bookId || !bookmark?.id) return;

    setLoading(true);
    try {
      const updates = [];
      
      // 색상 변경
      if (color !== bookmark.color) {
        const colorResult = await changeBookmarkColor(bookmark.id, color);
        if (!colorResult.success) {
          alert(colorResult.message || '색상 변경에 실패했습니다.');
          return;
        }
        updates.push('색상');
      }

      // 메모 변경
      if (memo.trim() !== (bookmark.memo || '')) {
        const memoResult = await changeBookmarkMemo(bookmark.id, memo.trim());
        if (!memoResult.success) {
          alert(memoResult.message || '메모 변경에 실패했습니다.');
          return;
        }
        updates.push('메모');
      }

      if (updates.length > 0) {
        if (onSuccess) onSuccess();
        if (onClose) onClose();
      } else {
        if (onClose) onClose();
      }
    } catch (error) {
      console.error('북마크 편집 오류:', error);
      alert('북마크 편집 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onClose) onClose();
  };

  if (!bookmark) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">북마크 편집</h3>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 색상 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              색상 선택
            </label>
            <div className="grid grid-cols-4 gap-2">
              {colors.map((colorOption) => (
                <button
                  key={colorOption.value}
                  type="button"
                  onClick={() => setColor(colorOption.value)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === colorOption.value
                      ? 'border-gray-800 scale-110'
                      : 'border-gray-300 hover:border-gray-500'
                  }`}
                  style={{ backgroundColor: colorOption.preview }}
                  title={colorOption.label}
                />
              ))}
            </div>
          </div>

          {/* 메모 입력 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              메모
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="북마크에 대한 메모를 입력하세요..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows={3}
              maxLength={500}
            />
            <div className="text-xs text-gray-500 mt-1">
              {memo.length}/500
            </div>
          </div>

          {/* CFI 정보 표시 */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-600 mb-1">위치 정보</div>
            <div className="text-sm font-mono text-gray-800 break-all">
              {bookmark.startCfi}
            </div>
            {bookmark.endCfi && (
              <>
                <div className="text-xs text-gray-600 mt-2 mb-1">종료 위치</div>
                <div className="text-sm font-mono text-gray-800 break-all">
                  {bookmark.endCfi}
                </div>
              </>
            )}
          </div>

          {/* 생성일 표시 */}
          <div className="text-xs text-gray-500">
            생성일: {new Date(bookmark.createdAt).toLocaleString('ko-KR')}
          </div>

          {/* 버튼 */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: color }}
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  저장 중...
                </div>
              ) : (
                '변경사항 저장'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BookmarkEditor;
