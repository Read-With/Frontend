import { useMemo } from 'react';
import { getLocatorSortKey } from '../../utils/bookmarkUtils';

export const useBookmarkSort = (bookmarks, sortOrder) => {
  return useMemo(() => {
    if (!bookmarks || bookmarks.length === 0) return [];
    const sorted = [...bookmarks];
    if (sortOrder === 'position') {
      return sorted.sort((a, b) => {
        const keyA = getLocatorSortKey(a.startLocator) || (a.startCfi || '');
        const keyB = getLocatorSortKey(b.startLocator) || (b.startCfi || '');
        return keyA.localeCompare(keyB);
      });
    }
    const factor = sortOrder === 'oldest' ? 1 : -1;
    return sorted.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || 0).getTime();
      const dateB = new Date(b.createdAt || b.created_at || 0).getTime();
      return (dateA - dateB) * factor;
    });
  }, [bookmarks, sortOrder]);
};
