import { useQuery } from '@tanstack/react-query';
import { getBooks } from '../../utils/api/booksApi';
import { getBookManifest } from '../../utils/api/api';
import { prefetchManifest } from '../../utils/common/cache/manifestCache';
import { getStoredAccessToken } from '../../utils/security/authTokenStorage';
import { ensureSessionAccessToken } from '../../utils/api/authApi';

export function useBooksServerQuery() {
  return useQuery({
    queryKey: ['books', 'server'],
    queryFn: async () => {
      await ensureSessionAccessToken();
      const token = getStoredAccessToken();
      if (!token) {
        return { books: [], needsAuth: true };
      }

      const response = await getBooks({});
      if (!response?.isSuccess) {
        throw new Error(response?.message || '책 정보를 불러올 수 없습니다.');
      }

      const fetched = response.result || [];

      fetched.forEach((book) => {
        if (book?.id && Number.isFinite(Number(book.id))) {
          const numericId = Number(book.id);
          if (numericId > 0) {
            prefetchManifest(numericId, (id) => getBookManifest(id, { forceRefresh: false })).catch(
              () => {}
            );
          }
        }
      });

      return { books: fetched, needsAuth: false };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
