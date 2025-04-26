import React, { useRef, useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import ViewerLayout from './ViewerLayout';
import EpubViewer from './epub/EpubViewer';
import BookmarkPanel from './epub/BookmarkPanel';
import { loadBookmarks, saveBookmarks }  from "./epub/BookmarkManager"
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ViewerProgressBar from './epub/ViewerProgressbar';

const ViewerPage = ({ darkMode }) => {
  const { filename } = useParams();
  const location = useLocation();
  const viewerRef = useRef(null);
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);

  const book = location.state?.book || {
    title: filename,
    path: "/example.epub",
  };

  const [progress, setProgress] = useState(0);
  const [showToolbar, setShowToolbar] = useState(false);
  const [bookmarks, setBookmarks] = useState(loadBookmarks(book.path));
  const [showBookmarkList, setShowBookmarkList] = useState(false)
  //const epubViewerRef = useRef();

  useEffect(() => {
    if (failCount >= 2) {
      toast.info('🔄 계속 실패하면 브라우저 새로고침을 해주세요!');
    }
  }, [failCount]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  const handlePrevPage = () => {
    if (viewerRef.current) viewerRef.current.prevPage();
  };

  const handleNextPage = () => {
    if (viewerRef.current) viewerRef.current.nextPage();
  };

  const handleAddBookmark = async () => {
    if (!viewerRef.current) {
      toast.error('❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...');
      setReloadKey((k) => k + 1);
      setFailCount((cnt) => cnt + 1); // 실패 카운트 증가
      return;
    }
    let cfi = null;
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
    } catch (e) {
      console.error('getCurrentCfi 에러:', e);
    }
    if (!cfi) {
      toast.error('❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...');
      setReloadKey((k) => k + 1);
      setFailCount((cnt) => cnt + 1); // 실패 카운트 증가
      return;
    }
    setFailCount(0);

    const isDuplicate = bookmarks.some((b) => b.cfi === cfi);
    console.log("중복 여부:", isDuplicate);

    if (isDuplicate) {
      const filtered = bookmarks.filter((b) => b.cfi !== cfi);
      setBookmarks(filtered);
      saveBookmarks(book.path, filtered);
      toast.info('❌ 북마크가 삭제되었습니다');
      console.log("❌ 북마크 삭제됨");
    } else {
      const newBookmark = { cfi, createdAt: new Date().toISOString() };
      const updated = [...bookmarks, newBookmark];
      setBookmarks(updated);
      saveBookmarks(book.path, updated);
      toast.success('✅ 북마크가 추가되었습니다');
      console.log("✅ 북마크 추가됨");
    }
  };

  const handleBookmarkSelect = (cfi) => {
    console.log('➡️ 북마크 선택됨:', cfi);
    viewerRef.current?.displayAt(cfi);
    setShowBookmarkList(false);
  };

  const onToggleBookmarkList = () => {
    navigate(`/viewer/${filename}/bookmarks`);
  };

  const handleSliderChange = async (value) => {
    setProgress(value);
    if (viewerRef.current?.moveToProgress) {
      console.log('moveToProgress 호출!', value);
      await viewerRef.current.moveToProgress(value);
    }
  };

  return (
    <div
      className="h-screen"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      <ViewerLayout
        showControls={showToolbar}
        book={book}
        darkMode={darkMode}
        progress={progress}
        setProgress={setProgress}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
        isBookmarked={false}
        onToggleBookmarkList={onToggleBookmarkList}
        onAddBookmark={handleAddBookmark}
        onSliderChange={handleSliderChange}
      >
        <EpubViewer key={reloadKey} ref={viewerRef} book={book} onProgressChange={setProgress}/>
        {showBookmarkList && (
          <BookmarkPanel
            bookmarks={bookmarks}
            onSelect={handleBookmarkSelect}
          />
        )}
      </ViewerLayout>
      <ToastContainer position="bottom-center" autoClose={1500} hideProgressBar newestOnTop closeOnClick />
    </div>
  );
};

export default ViewerPage;
