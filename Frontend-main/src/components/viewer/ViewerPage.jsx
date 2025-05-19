import React, { useRef, useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import ViewerLayout from "./ViewerLayout";
import EpubViewer from "./epub/EpubViewer";
import BookmarkPanel from "./epub/BookmarkPanel";
import RelationGraphWrapper from "../graph/RelationGraphWrapper"; // 추가된 부분
import { loadBookmarks, saveBookmarks } from "./epub/BookmarkManager";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function parseCfiToChapterDetail(cfi) {
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? `${chapterMatch[1]}장` : null;
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  const page = pageMatch ? pageMatch[1] : null;
  return chapter && page ? `${chapter} ${page}` : chapter || cfi;
}

const ViewerPage = ({ darkMode }) => {
  const { filename } = useParams();
  const location = useLocation();
  const viewerRef = useRef(null);
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const book = location.state?.book || {
    title: filename,
    path: "/" + filename,
  };

  const [showToolbar, setShowToolbar] = useState(false);
  const cleanFilename = filename.replace(/^\//, "").trim();
  const [bookmarks, setBookmarks] = useState(loadBookmarks(cleanFilename));
  const [showBookmarkList, setShowBookmarkList] = useState(false);

  useEffect(() => {
    if (failCount >= 2) {
      toast.info("🔄 계속 실패하면 브라우저 새로고침을 해주세요!");
    }
  }, [failCount]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  useEffect(() => {
    if (book && progress !== undefined) {
      localStorage.setItem(`progress_${book.filename}`, progress);
    }
  }, [progress, book]);

  useEffect(() => {
    // 파일명이 바뀔 때만 localStorage에서 최신 북마크를 불러옴
    setBookmarks(loadBookmarks(cleanFilename));
  }, [cleanFilename]);

  const handlePrevPage = () => {
    if (viewerRef.current) viewerRef.current.prevPage();
  };

  const handleNextPage = () => {
    if (viewerRef.current) viewerRef.current.nextPage();
  };

  const handleAddBookmark = async () => {
    if (!viewerRef.current) {
      toast.error("❗ 페이지가 아직 준비되지 않았어요. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }
    let cfi = null;
    try {
      cfi = await viewerRef.current.getCurrentCfi?.();
    } catch (e) {
      console.error("getCurrentCfi 에러:", e);
    }
    if (!cfi) {
      toast.error("❗ 페이지 정보를 읽을 수 없습니다. 다시 불러옵니다...");
      setFailCount((cnt) => cnt + 1);
      return;
    }
    console.log("추가된 북마크 CFI:", cfi);
    setFailCount(0);

    const latestBookmarks = loadBookmarks(cleanFilename);
    const isDuplicate = latestBookmarks.some((b) => b.cfi === cfi);
    let newBookmarks;
    if (isDuplicate) {
      newBookmarks = latestBookmarks.filter((b) => b.cfi !== cfi);
      toast.info("❌ 북마크가 삭제되었습니다");
    } else {
      const newBookmark = { cfi, createdAt: new Date().toISOString() };
      newBookmarks = [newBookmark, ...latestBookmarks];
      toast.success("✅ 북마크가 추가되었습니다");
    }
    setBookmarks(newBookmarks);
    saveBookmarks(cleanFilename, newBookmarks);
  };

  const handleBookmarkSelect = (cfi) => {
    viewerRef.current?.displayAt(cfi);
    setShowBookmarkList(false);
  };

  const onToggleBookmarkList = () => {
    navigate(`/viewer/${filename}/bookmarks`);
  };

  const handleSliderChange = async (value) => {
    setProgress(value);
    if (viewerRef.current?.moveToProgress) {
      await viewerRef.current.moveToProgress(value);
    }
  };

  const handleDeleteBookmark = (cfi) => {
    if (!cleanFilename) {
      toast.error("❗ 파일명이 없어 북마크를 삭제할 수 없습니다.");
      return;
    }
    if (window.confirm("정말 삭제하시겠습니까?")) {
      const newBookmarks = bookmarks.filter((b) => b.cfi !== cfi);
      console.log("BookmarksPage - 북마크 삭제:", cleanFilename, newBookmarks);
      setBookmarks(newBookmarks);
      saveBookmarks(cleanFilename, newBookmarks);
    }
  };

  const handleRemoveBookmark = (cfi) => {
    if (!cleanFilename) {
      toast.error("❗ 파일명이 없어 북마크를 삭제할 수 없습니다.");
      return;
    }
    if (window.confirm("정말 삭제하시겠습니까?")) {
      const newBookmarks = bookmarks.filter((b) => b.cfi !== cfi);
      console.log("BookmarksPage - 북마크 삭제:", cleanFilename, newBookmarks);
      setBookmarks(newBookmarks);
      saveBookmarks(cleanFilename, newBookmarks);
    }
  };

  return (
    <div
      className="h-screen"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {/* 좌우 분할 컨테이너 */}
      <div
        style={{
          display: "flex",
          height: "100vh",
          width: "100vw",
          position: "relative",
        }}
      >
        {/* 왼쪽: EPUB 뷰어 영역 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderRight: "1px solid #e7eaf7",
            position: "relative",
            overflow: "hidden",
          }}
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
            currentPage={currentPage}
            totalPages={totalPages}
          >
            <EpubViewer
              key={reloadKey}
              ref={viewerRef}
              book={book}
              onProgressChange={setProgress}
              onCurrentPageChange={setCurrentPage}
              onTotalPagesChange={setTotalPages}
            />
            {showBookmarkList && (
              <BookmarkPanel
                bookmarks={bookmarks}
                onSelect={handleBookmarkSelect}
              >
                {bookmarks.map((bm) => (
                  <span
                    key={bm.cfi}
                    style={{
                      fontSize: "0.98rem",
                      color: "#4F6DDE",
                      fontFamily: "monospace",
                    }}
                  >
                    위치: {parseCfiToChapterDetail(bm.cfi)}
                  </span>
                ))}
              </BookmarkPanel>
            )}
          </ViewerLayout>
        </div>

        {/* 오른쪽: Cytoscape 그래프 영역 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "#f8fafc",
            position: "relative",
            overflow: "hidden", // 그래프 오버플로우 방지
          }}
        >
          <RelationGraphWrapper /> {/* 실제 그래프 컴포넌트 */}
        </div>
      </div>

      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop
        closeOnClick
      />
    </div>
  );
};

export default ViewerPage;
