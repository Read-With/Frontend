import React, { useState, useEffect } from "react";
import axios from "axios";

// API 기본 URL 설정 (배포 서버 고정 사용)
const getApiBaseUrl = () => {
  // 로컬 개발 환경: 프록시 사용 (배포 서버로 전달)
  if (import.meta.env.DEV) {
    return ''; // 프록시를 통해 배포 서버로 요청
  }
  // 프로덕션 환경: 커스텀 도메인 사용
  return 'https://dev.readwith.store';
};

const API_BASE_URL = `${getApiBaseUrl()}/api/admin`;

// API 요청을 위한 axios 인스턴스
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

const AdminPage = () => {
  // 입력 상태 관리
  const [bookId, setBookId] = useState("");
  const [chapterIdx, setChapterIdx] = useState("");
  const [eventIdx, setEventIdx] = useState("");
  const [files, setFiles] = useState(null);

  // API 응답/결과 상태 관리
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // 공통 API 호출 함수
  const handleApiCall = async (apiFunction) => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const result = await apiFunction();
      // 백엔드의 ApiResponse 형식에 맞춰 실제 데이터는 result.data.result에 있음.
      if (result.data && result.data.isSuccess) {
        setResponse(result.data.result);
      } else {
        setError(
          result.data || { message: "API 응답 형식이 올바르지 않습니다." }
        );
      }
    } catch (err) {
      console.error("API Error:", err.response || err);
      setError(
        err.response ? err.response.data : "An unexpected error occurred."
      );
    } finally {
      setLoading(false);
    }
  };

  // 파일 업로드 핸들러
  const handleFileChange = (e) => {
    setFiles(e.target.files);
  };

  // 각 API 호출 함수들
  const getUnsummarizedChapters = () =>
    handleApiCall(() => apiClient.get("/chapters/unsummarized"));
  const getUnsummarizedBooks = () =>
    handleApiCall(() => apiClient.get("/books/unsummarized"));

  const uploadMultipleFiles = (endpoint) => {
    if (!bookId || !files) {
      setError({ message: "Book ID와 파일을 모두 선택해야 합니다." });
      return;
    }
    const formData = new FormData();
    Array.from(files).forEach((file) => {
      formData.append("files", file);
    });
    handleApiCall(() =>
      apiClient.post(`/books/${bookId}/${endpoint}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
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
      })
    );
  };

  const deleteData = (endpoint) => {
    // 각 엔드포인트에 필요한 파라미터가 있는지 확인
    if (endpoint.includes("{bookId}") && !bookId) {
      setError({ message: "삭제 작업을 위해 Book ID를 입력해야 합니다." });
      return;
    }
    if (endpoint.includes("{chapterIdx}") && !chapterIdx) {
      setError({
        message: "삭제 작업을 위해 Chapter Index를 입력해야 합니다.",
      });
      return;
    }
    if (endpoint.includes("{eventIdx}") && !eventIdx) {
      setError({ message: "삭제 작업을 위해 Event Index를 입력해야 합니다." });
      return;
    }

    const finalEndpoint = endpoint
      .replace("{bookId}", bookId)
      .replace("{chapterIdx}", chapterIdx)
      .replace("{eventIdx}", eventIdx);
    handleApiCall(() => apiClient.delete(finalEndpoint));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f8f9fa", // 다른 페이지와 유사한 배경색 적용
      }}
    >
      <div style={{ width: "100%", maxWidth: "960px", padding: "40px 20px" }}>
        <h1 style={{ textAlign: "center", marginBottom: "40px" }}>
          관리자 페이지
        </h1>

        {/* --- 공통 입력 필드 --- */}
        <div style={styles.section}>
          <h3>공통 파라미터</h3>
          <input
            type="text"
            placeholder="Book ID"
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            style={styles.input}
          />
          <input
            type="text"
            placeholder="Chapter Index"
            value={chapterIdx}
            onChange={(e) => setChapterIdx(e.target.value)}
            style={styles.input}
          />
          <input
            type="text"
            placeholder="Event Index"
            value={eventIdx}
            onChange={(e) => setEventIdx(e.target.value)}
            style={styles.input}
          />
        </div>

        {/* --- 데이터 조회 섹션 --- */}
        <div style={styles.section}>
          <h2>데이터 조회</h2>
          <button onClick={getUnsummarizedChapters} style={styles.button}>
            미요약 챕터 목록 조회
          </button>
          <button onClick={getUnsummarizedBooks} style={styles.button}>
            미요약 도서 목록 조회
          </button>
        </div>

        {/* --- 데이터 업로드 섹션 --- */}
        <div style={styles.section}>
          <h2>데이터 업로드</h2>
          <input
            type="file"
            multiple
            onChange={handleFileChange}
            style={styles.input}
          />
          <div style={styles.buttonGroup} title="Book ID와 파일이 필요합니다.">
            <button
              onClick={() => uploadSingleFile("characters")}
              style={styles.button}
              title="단일 JSON 파일(file)을 업로드합니다."
            >
              인물 정보 업로드
            </button>
            <button
              onClick={() => uploadMultipleFiles("events")}
              style={styles.button}
              title="여러 챕터의 이벤트 JSON 파일(files)을 업로드합니다."
            >
              이벤트 정보 업로드
            </button>
            <button
              onClick={() => uploadMultipleFiles("summary")}
              style={styles.button}
              title="여러 챕터의 요약 JSON 파일(files)을 업로드합니다."
            >
              챕터 요약본 업로드
            </button>
            <button
              onClick={() => uploadMultipleFiles("relationships")}
              style={styles.button}
              title="여러 관계 JSON 파일(files)을 업로드합니다."
            >
              관계 정보 업로드
            </button>
          </div>
        </div>

        {/* --- 데이터 삭제 섹션 --- */}
        <div style={styles.section}>
          <h2>데이터 삭제</h2>
          <div style={styles.buttonGroup}>
            <button
              onClick={() => deleteData("/books/{bookId}/characters")}
              style={styles.button}
              title="Book ID가 필요합니다."
            >
              인물 정보 삭제
            </button>
            <button
              onClick={() =>
                deleteData("/books/{bookId}/chapters/{chapterIdx}/events")
              }
              style={styles.button}
              title="Book ID와 Chapter Index가 필요합니다."
            >
              이벤트 정보 삭제
            </button>
            <button
              onClick={() =>
                deleteData("/books/{bookId}/chapters/{chapterIdx}/summary")
              }
              style={styles.button}
              title="Book ID와 Chapter Index가 필요합니다."
            >
              챕터 요약본 삭제
            </button>
            <button
              onClick={() =>
                deleteData(
                  "/books/{bookId}/chapters/{chapterIdx}/events/{eventIdx}/relationships"
                )
              }
              style={styles.button}
              title="Book ID, Chapter Index, Event Index가 필요합니다."
            >
              관계 정보 삭제
            </button>
          </div>
        </div>

        {/* --- API 결과 표시 --- */}
        {loading && <p>Loading...</p>}
        {error && (
          <div style={styles.errorBox}>
            <pre>{JSON.stringify(error, null, 2)}</pre>
          </div>
        )}
        {response && (
          <div style={styles.responseBox}>
            <pre>{JSON.stringify(response, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  section: {
    border: "1px solid #e9ecef",
    borderRadius: "8px",
    padding: "20px",
    marginBottom: "20px",
    background: "#fff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  },
  input: {
    marginRight: "10px",
    padding: "8px",
    borderRadius: "4px",
    border: "1px solid #ccc",
  },
  button: {
    padding: "8px 15px",
    margin: "5px",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "#007bff",
    color: "white",
    cursor: "pointer",
  },
  buttonGroup: {
    marginTop: "10px",
  },
  responseBox: {
    backgroundColor: "#e9f7ef",
    border: "1px solid #b7e4c7",
    padding: "15px",
    marginTop: "20px",
    borderRadius: "8px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  errorBox: {
    backgroundColor: "#fde2e2",
    border: "1px solid #f5c6cb",
    padding: "15px",
    marginTop: "20px",
    borderRadius: "8px",
    color: "#721c24",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};

export default AdminPage;
