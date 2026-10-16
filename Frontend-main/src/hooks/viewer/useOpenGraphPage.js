/** 뷰어 → 전체 관계도 페이지 이동 (툴바 버튼·빈 이벤트 안내 공용) */

import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { userViewerPath, userGraphPath } from '../../utils/common/urlUtils';

/**
 * 현재 챕터와 돌아올 위치(from)·서재 진입 여부를 함께 넘긴다.
 * from이 없으면 지금 뷰어 경로로 돌아오게 한다
 */
export function useOpenGraphPage(currentChapter) {
  const navigate = useNavigate();
  const { filename: bookId } = useParams();
  const location = useLocation();
  const book = location.state?.book;
  const previousPage = location.state?.from || null;
  const isFromLibrary = previousPage?.pathname === '/mypage' || location.state?.fromLibrary === true;

  return useCallback(() => {
    const bookData = book || {
      title: String(bookId || '')
        .replace(/\.(xhtml|html|htm)$/i, '')
        .replace(/([A-Z])/g, ' $1')
        .trim(),
      author: '알 수 없음',
      path: `/${bookId}`,
      filename: bookId,
    };
    const currentPathname = location.pathname || userViewerPath(bookId);
    navigate(userGraphPath(bookId), {
      state: {
        book: bookData,
        selectedChapter: Number(currentChapter) || 1,
        fromLibrary: isFromLibrary,
        from: previousPage || { pathname: currentPathname, search: '' },
      },
      replace: false,
    });
  }, [book, bookId, currentChapter, isFromLibrary, location.pathname, navigate, previousPage]);
}
