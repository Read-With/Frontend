import React, { useState } from "react";
import axios from "axios";
import { getApiBaseUrl } from "../utils/common/authUtils";

const API_BASE_URL = `${getApiBaseUrl()}/api/v2/admin`;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 아이콘 컴포넌트들
const DatabaseIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
    />
  </svg>
);

const DocumentSearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
    />
  </svg>
);

const UploadIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
    />
  </svg>
);

const TrashIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

const LayoutDashboardIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
    />
  </svg>
);

const BookIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
    />
  </svg>
);

const AdminPage = () => {
  // 탭 상태 (dashboard, books, query, upload, delete)
  const [activeTab, setActiveTab] = useState("dashboard");

  // 입력 상태 관리
  const [bookId, setBookId] = useState("");
  const [chapterIdx, setChapterIdx] = useState("");
  const [eventIdx, setEventIdx] = useState("");
  const [files, setFiles] = useState(null);

  // API 응답/결과 상태 관리
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [books, setBooks] = useState([]);

  // 공통 API 호출 함수
  const handleApiCall = async (apiFunction, updateBooks = false) => {
    setLoading(true);
    setError(null);
    if (!updateBooks) setResponse(null);
    try {
      const result = await apiFunction();
      // 백엔드의 ApiResponse 형식에 맞춰 실제 데이터는 result.data.result에 있음.
      if (result.data && result.data.isSuccess) {
        if (updateBooks) {
          setBooks(result.data.result);
        } else {
          setResponse(result.data.result);
        }
      } else {
        setError(
          result.data || { message: "API 응답 형식이 올바르지 않습니다." },
        );
      }
    } catch (err) {
      console.error("API Error:", err.response || err);
      setError(
        err.response?.data ?? {
          message: err?.message ?? "An unexpected error occurred.",
        },
      );
    } finally {
      setLoading(false);
    }
  };

  // 파일 업로드 핸들러
  const handleFileChange = (e) => setFiles(e.target.files);

  // 각 API 호출 함수들
  const getUnsummarizedChapters = () =>
    handleApiCall(() => apiClient.get("/chapters/unsummarized"));
  const getUnsummarizedBooks = () =>
    handleApiCall(() => apiClient.get("/books/unsummarized"));
  const getBooksList = () =>
    handleApiCall(() => apiClient.get(`/books`), true);

  const uploadMultipleFiles = (endpoint) => {
    if (!bookId || !files || files.length === 0) {
      setError({ message: "Book ID와 파일을 모두 선택해야 합니다." });
      return;
    }
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    handleApiCall(() =>
      apiClient.post(`/books/${bookId}/${endpoint}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
  };

  const uploadSingleFile = (endpoint) => {
    if (!bookId || !files || files.length === 0) {
      setError({ message: "Book ID와 파일을 선택해야 합니다." });
      return;
    }
    const formData = new FormData();
    formData.append("file", files[0]);
    handleApiCall(() =>
      apiClient.post(`/books/${bookId}/${endpoint}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
  };

  const deleteData = (endpoint) => {
    // 각 엔드포인트에 필요한 파라미터가 있는지 확인
    let finalEndpoint = endpoint;

    if (endpoint.includes("{bookId}")) {
      if (!bookId)
        return setError({
          message: "삭제 작업을 위해 Book ID를 입력해야 합니다.",
        });
      finalEndpoint = finalEndpoint.replace("{bookId}", bookId);
    }
    if (endpoint.includes("{chapterIdx}")) {
      if (!chapterIdx)
        return setError({
          message: "삭제 작업을 위해 Chapter Index를 입력해야 합니다.",
        });
      finalEndpoint = finalEndpoint.replace("{chapterIdx}", chapterIdx);
    }
    if (endpoint.includes("{eventIdx}")) {
      if (!eventIdx)
        return setError({
          message: "삭제 작업을 위해 Event Index를 입력해야 합니다.",
        });
      finalEndpoint = finalEndpoint.replace("{eventIdx}", eventIdx);
    }
    handleApiCall(() => apiClient.delete(finalEndpoint));
  };

  const renderNav = () => (
    <nav className="w-64 flex-shrink-0 bg-white shadow-sm border-r border-gray-200 hidden md:block">
      <div className="h-full flex flex-col">
        <div className="px-6 py-8 border-b border-gray-100 flex items-center space-x-3">
          <DatabaseIcon />
          <h2 className="text-xl font-bold text-gray-800 tracking-tight">
            Admin Dashboard
          </h2>
        </div>
        <div className="flex-1 py-6 px-4 space-y-1">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "dashboard"
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <LayoutDashboardIcon />
            <span>대시보드 홈</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("books");
              getBooksList();
            }}
            className={`w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "books"
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <BookIcon />
            <span>도서 목록</span>
          </button>
          <button
            onClick={() => setActiveTab("query")}
            className={`w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "query"
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <DocumentSearchIcon />
            <span>데이터 조회</span>
          </button>
          <button
            onClick={() => setActiveTab("upload")}
            className={`w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "upload"
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <UploadIcon />
            <span>데이터 업로드</span>
          </button>
          <button
            onClick={() => setActiveTab("delete")}
            className={`w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "delete"
                ? "bg-red-50 text-red-700"
                : "text-gray-600 hover:bg-red-50 hover:text-red-600"
            }`}
          >
            <TrashIcon />
            <span>데이터 삭제</span>
          </button>
        </div>
      </div>
    </nav>
  );

  const renderCommonParams = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
      <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800">
          공통 파라미터 설정
        </h3>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Book ID
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow text-sm"
              placeholder="예: 123"
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Chapter Index
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow text-sm"
              placeholder="예: 1"
              value={chapterIdx}
              onChange={(e) => setChapterIdx(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Event Index
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow text-sm"
              placeholder="예: 1"
              value={eventIdx}
              onChange={(e) => setEventIdx(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderBooksSection = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <BookIcon />
          <h3 className="text-lg font-semibold text-gray-800">도서 목록</h3>
        </div>
        <button
          onClick={getBooksList}
          disabled={loading}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          새로고침
        </button>
      </div>
      <div className="p-6">
        {books.length === 0 && !loading ? (
          <div className="text-center py-12 text-gray-500">
            도서 데이터가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {books.map((book) => (
              <div
                key={book.id}
                onClick={() => {
                  setBookId(book.id);
                  // 추후 캐릭터 이미지 생성 상태 확인 페이지로 이동하거나 모달 띄우는 로직 추가
                  alert(`도서 ID: ${book.id} 선택됨. (기능 준비 중)`);
                }}
                className="group cursor-pointer bg-gray-50 rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="aspect-[3/4] overflow-hidden bg-gray-200 relative">
                  {book.cover_img_url ? (
                    <img
                      src={book.cover_img_url}
                      alt={book.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <BookIcon />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                    ID: {book.id}
                  </div>
                </div>
                <div className="p-3">
                  <h4 className="font-semibold text-sm text-gray-800 truncate mb-1">
                    {book.title}
                  </h4>
                  <p className="text-xs text-gray-500 truncate">{book.author}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderQuerySection = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center space-x-2">
        <DocumentSearchIcon />
        <h3 className="text-lg font-semibold text-gray-800">데이터 조회</h3>
      </div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={getUnsummarizedChapters}
          disabled={loading}
          className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-xl border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 transition-all group"
        >
          <span className="text-indigo-600 font-medium group-hover:text-indigo-700">
            미요약 챕터 목록 조회
          </span>
          <span className="text-xs text-gray-500 mt-2">
            요약이 필요한 챕터들을 확인합니다.
          </span>
        </button>
        <button
          onClick={getUnsummarizedBooks}
          disabled={loading}
          className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-xl border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 transition-all group"
        >
          <span className="text-indigo-600 font-medium group-hover:text-indigo-700">
            미요약 도서 목록 조회
          </span>
          <span className="text-xs text-gray-500 mt-2">
            요약이 필요한 도서들을 확인합니다.
          </span>
        </button>
      </div>
    </div>
  );

  const renderUploadSection = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center space-x-2">
        <UploadIcon />
        <h3 className="text-lg font-semibold text-gray-800">데이터 업로드</h3>
      </div>
      <div className="p-6">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            파일 선택
          </label>
          <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
            <div className="space-y-1 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="flex text-sm text-gray-600 justify-center">
                <label className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500 p-1">
                  <span>파일 선택</span>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
                <p className="pl-1 pt-1">또는 드래그 앤 드롭</p>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                JSON 파일 여러 개 선택 가능
              </p>
            </div>
          </div>
          {files && files.length > 0 && (
            <p className="mt-2 text-sm text-indigo-600 font-medium">
              선택된 파일: {files.length}개
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "인물 정보",
              endpoint: "characters",
              fn: () => uploadSingleFile("characters"),
            },
            {
              label: "이벤트 정보",
              endpoint: "events",
              fn: () => uploadMultipleFiles("events"),
            },
            {
              label: "챕터 요약본",
              endpoint: "summary",
              fn: () => uploadMultipleFiles("summary"),
            },
            {
              label: "관계 정보",
              endpoint: "relationships",
              fn: () => uploadMultipleFiles("relationships"),
            },
          ].map((item, idx) => (
            <button
              key={idx}
              onClick={item.fn}
              disabled={loading}
              className="px-4 py-3 bg-white border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-300 focus:outline-none transition-all disabled:opacity-50"
            >
              {item.label} 업로드
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderDeleteSection = () => (
    <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
      <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex items-center space-x-2">
        <div className="text-red-600">
          <TrashIcon />
        </div>
        <h3 className="text-lg font-semibold text-red-800">데이터 삭제</h3>
      </div>
      <div className="p-6">
        <p className="text-sm text-red-600 mb-6 bg-red-50 p-3 rounded-lg border border-red-100">
          <strong>경고:</strong> 데이터베이스에서 영구적으로 삭제됩니다. 필요한
          파라미터를 정확히 확인하세요.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              label: "인물 정보 삭제",
              ep: "/books/{bookId}/characters",
              desc: "Book ID 필요",
            },
            {
              label: "이벤트 정보 삭제",
              ep: "/books/{bookId}/chapters/{chapterIdx}/events",
              desc: "Book ID, Chapter Index 필요",
            },
            {
              label: "챕터 요약본 삭제",
              ep: "/books/{bookId}/chapters/{chapterIdx}/summary",
              desc: "Book ID, Chapter Index 필요",
            },
            {
              label: "관계 정보 삭제",
              ep: "/books/{bookId}/chapters/{chapterIdx}/events/{eventIdx}/relationships",
              desc: "Book ID, Chapter, Event Index 필요",
            },
          ].map((item, idx) => (
            <button
              key={idx}
              onClick={() => deleteData(item.ep)}
              disabled={loading}
              className="flex flex-col items-start p-4 bg-white border border-red-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors text-left"
            >
              <span className="font-medium text-red-700">{item.label}</span>
              <span className="text-xs text-red-400 mt-1">{item.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      {renderNav()}

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8 max-w-6xl mx-auto space-y-6">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              {activeTab === "dashboard" && "대시보드 홈"}
              {activeTab === "books" && "도서 목록"}
              {activeTab === "query" && "데이터 조회"}
              {activeTab === "upload" && "데이터 업로드"}
              {activeTab === "delete" && "데이터 삭제"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              시스템 데이터를 관리하고 제어합니다.
            </p>
          </div>

          {/* 공통 파라미터는 항상 상단에 표시 */}
          {renderCommonParams()}

          {/* 탭 내용 */}
          {activeTab === "dashboard" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {renderQuerySection()}
              {renderUploadSection()}
              <div className="lg:col-span-2">{renderDeleteSection()}</div>
            </div>
          )}
          {activeTab === "books" && renderBooksSection()}
          {activeTab === "query" && renderQuerySection()}
          {activeTab === "upload" && renderUploadSection()}
          {activeTab === "delete" && renderDeleteSection()}

          {/* 결과 및 에러 표시 패널 (고정 위치 또는 하단) */}
          {(loading || error || response) && (
            <div className="mt-8 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  실행 결과
                </h3>
                {loading && (
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                  </span>
                )}
              </div>
              <div className="p-6">
                {loading && (
                  <div className="flex items-center text-indigo-600 text-sm font-medium">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-indigo-600"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    데이터를 처리하고 있습니다...
                  </div>
                )}
                {error && (
                  <div className="text-sm text-red-700 bg-red-50 p-4 rounded-lg border border-red-100">
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {JSON.stringify(error, null, 2)}
                    </pre>
                  </div>
                )}
                {response && (
                  <div className="text-sm text-green-700 bg-green-50 p-4 rounded-lg border border-green-100">
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {JSON.stringify(response, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
