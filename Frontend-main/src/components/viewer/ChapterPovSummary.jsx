import React from 'react';
import { useChapterPovSummaries } from '../../hooks/useChapterPovSummaries';
import { BookOpen, User, Star, RefreshCw } from 'lucide-react';

/**
 * 챕터별 인물 시점 요약 컴포넌트
 */
const ChapterPovSummary = ({ bookId, chapterIdx, onClose }) => {
  const { povSummaries, loading, error, refetch } = useChapterPovSummaries(bookId, chapterIdx);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-center space-x-2">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-gray-600">챕터 시점 요약을 불러오는 중...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div className="text-center">
            <div className="text-red-500 mb-4">
              <BookOpen className="w-12 h-12 mx-auto mb-2" />
              <h3 className="text-lg font-semibold">오류가 발생했습니다</h3>
            </div>
            <p className="text-gray-600 mb-4">{error}</p>
            <div className="flex space-x-2 justify-center">
              <button
                onClick={refetch}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                다시 시도
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!povSummaries) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div className="text-center">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">시점 요약이 없습니다</h3>
            <p className="text-gray-500 mb-4">이 챕터에 대한 시점 요약 정보를 찾을 수 없습니다.</p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              챕터 {povSummaries.chapterIdx || chapterIdx} 시점 요약
            </h2>
            <p className="text-gray-600">{povSummaries.chapterTitle || `챕터 ${chapterIdx}`}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 시점 요약 목록 */}
        <div className="space-y-4">
          {povSummaries.povSummaries?.map((summary, index) => (
            <div
              key={summary.characterId || index}
              className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    summary.mainCharacter 
                      ? 'bg-yellow-100 text-yellow-600' 
                      : 'bg-blue-100 text-blue-600'
                  }`}>
                    <User className="w-5 h-5" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="text-lg font-semibold text-gray-800">
                      {summary.characterName}
                    </h3>
                    {summary.mainCharacter && (
                      <div className="flex items-center space-x-1 text-yellow-600">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="text-sm font-medium">주인공</span>
                      </div>
                    )}
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    {summary.summaryText}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 푸터 */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              총 {povSummaries.povSummaries?.length || 0}명의 인물 시점
            </p>
            <button
              onClick={refetch}
              className="flex items-center space-x-1 text-green-600 hover:text-green-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="text-sm">새로고침</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChapterPovSummary;
