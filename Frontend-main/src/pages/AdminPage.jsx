import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { getApiBaseUrl } from "../utils/common/urlUtils";
import "./AdminPage.css";

const API_BASE_URL = `${getApiBaseUrl()}/api/v2/admin`;
const POLL_INTERVAL_MS = 5000;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    if (config.headers && typeof config.headers.delete === "function") {
      config.headers.delete("Content-Type");
    } else if (config.headers) {
      delete config.headers["Content-Type"];
    }
  }
  return config;
});

const DELETE_ACTIONS = [
  {
    id: "characters",
    label: "인물 정보 삭제",
    ep: "/books/{bookId}/characters",
    needs: ["bookId"],
    desc: "해당 도서의 모든 인물 정보",
  },
  {
    id: "events",
    label: "이벤트 정보 삭제",
    ep: "/books/{bookId}/chapters/{chapterIdx}/events",
    needs: ["bookId", "chapterIdx"],
    desc: "해당 챕터의 모든 이벤트",
  },
  {
    id: "summary",
    label: "챕터 요약본 삭제",
    ep: "/books/{bookId}/chapters/{chapterIdx}/summary",
    needs: ["bookId", "chapterIdx"],
    desc: "해당 챕터의 요약본",
  },
  {
    id: "relationships",
    label: "관계 정보 삭제",
    ep: "/books/{bookId}/chapters/{chapterIdx}/events/{eventIdx}/relationships",
    needs: ["bookId", "chapterIdx", "eventIdx"],
    desc: "해당 이벤트의 관계 정보",
  },
];

const UPLOAD_ACTIONS = [
  {
    label: "인물 정보",
    endpoint: "characters",
    mode: "single",
    hint: "JSON 파일 1개",
    schema:
      "도서 단위 인물 목록을 담은 JSON 파일 1개만 업로드합니다. 확장자는 .json 이어야 합니다.",
  },
  {
    label: "이벤트 정보",
    endpoint: "events",
    mode: "multiple",
    hint: "JSON 파일 여러 개",
    schema:
      "챕터/이벤트 단위 JSON을 여러 개 올릴 수 있습니다. 보통 챕터별로 파일을 나눕니다.",
  },
  {
    label: "챕터 요약본",
    endpoint: "summary",
    mode: "multiple",
    hint: "JSON 파일 여러 개",
    schema:
      "챕터 요약 JSON을 여러 개 업로드합니다. 요약 대상 챕터와 파일 구성이 맞는지 확인하세요.",
  },
  {
    label: "관계 정보",
    endpoint: "relationships",
    mode: "multiple",
    hint: "JSON 파일 여러 개",
    schema:
      "이벤트 관계 JSON을 여러 개 업로드합니다. 인물·이벤트 ID가 기존 데이터와 일치해야 합니다.",
  },
];

const LOG_PAGE_SIZE = 20;
const PICKER_PAGE_SIZE = 30;
const LOG_LEVEL_FILTERS = [
  { id: "ALL", label: "전체" },
  { id: "ERROR", label: "ERROR" },
  { id: "WARN", label: "WARN" },
  { id: "INFO", label: "INFO" },
];

const DatabaseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
  </svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const LayoutDashboardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);

const BookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
);

const ProcessingIcon = ({ className = "w-5 h-5", strokeWidth = 1.5 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const ListBulletIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
);

const CloseIcon = ({ className = "w-5 h-5", strokeWidth = 1.5 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ChevronIcon = ({ className = "w-5 h-5", strokeWidth = 1.5 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

const toArray = (data) => {
  if (Array.isArray(data)) return data;
  if (data == null) return [];
  if (Array.isArray(data.content)) return data.content;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.list)) return data.list;
  return [];
};

const extractErrorMessage = (payload) => {
  if (!payload) return "요청에 실패했습니다.";
  if (typeof payload === "string") return payload;
  return (
    payload.message ||
    payload.errorMessage ||
    payload.error ||
    (typeof payload.result === "string" ? payload.result : null) ||
    "요청에 실패했습니다."
  );
};

const summarizeResult = (data) => {
  const list = toArray(data);
  if (list.length > 0 || Array.isArray(data)) return `${list.length}건의 결과가 있습니다.`;
  if (data == null) return "작업이 완료되었습니다.";
  if (typeof data === "string") return data;
  if (typeof data === "object" && data.message) return data.message;
  return "작업이 완료되었습니다.";
};

const charStatusOf = (c) => c.imageGenerationStatus || c.image_generation_status || "PENDING";

const filterBooksByQuery = (list, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (b) =>
      String(b.id).includes(q) ||
      (b.title || "").toLowerCase().includes(q) ||
      (b.author || "").toLowerCase().includes(q),
  );
};

const fileKey = (f) => `${f.name}-${f.size}-${f.lastModified}`;

const INPUT_CLASS =
  "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm";

const SEARCH_INPUT_CLASS =
  "px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500";

const REFRESH_BTN_CLASS = "text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50";

const SECTION_CARD_CLASS = "bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden";

const STATUS_PILL_CLASS = "px-2 py-1 rounded-full text-xs font-semibold";

const filterChipClass = (active) =>
  `px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
    active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

const countCharStatuses = (list) =>
  list.reduce(
    (acc, c) => {
      const s = charStatusOf(c);
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    { COMPLETED: 0, GENERATING: 0, FAILED: 0, PENDING: 0 },
  );

const DELETE_NEED_ERRORS = {
  bookId: "삭제하려면 Book ID가 필요합니다.",
  chapterIdx: "삭제하려면 챕터 번호가 필요합니다.",
  eventIdx: "삭제하려면 이벤트 번호가 필요합니다.",
};

const INT_FIELD_ERRORS = {
  bookId: "Book ID는 0 이상의 정수여야 합니다.",
  chapterIdx: "챕터 번호는 0 이상의 정수여야 합니다.",
  eventIdx: "이벤트 번호는 0 이상의 정수여야 합니다.",
};

const isNonNegativeIntString = (value) => /^\d+$/.test(String(value ?? "").trim());

const canRetryNormalizationJob = (status) => {
  const s = String(status ?? "").toUpperCase();
  return s === "FAILED" || s === "ERROR";
};

const statusBadgeClass = (status) => {
  const s = String(status ?? "").toUpperCase();
  if (s === "COMPLETED") return "bg-green-100 text-green-700";
  if (s === "GENERATING" || s === "PROCESSING" || s === "IN_PROGRESS") {
    return "bg-blue-100 text-blue-700 animate-pulse";
  }
  if (s === "FAILED" || s === "ERROR") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-600";
};

const formatDateTime = (value) => {
  if (value == null || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

const PanelMessage = ({ tone = "muted", children }) => (
  <div className={`text-center py-12 ${tone === "error" ? "text-red-600" : "text-gray-500"}`}>{children}</div>
);

const TableMessageRow = ({ colSpan, tone = "muted", children }) => (
  <tr>
    <td colSpan={colSpan} className={`px-6 py-12 text-center ${tone === "error" ? "text-red-600" : "text-gray-500"}`}>
      {children}
    </td>
  </tr>
);

const SectionCardHeader = ({ icon: Icon, title, count, trailing }) => (
  <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center space-x-2">
      {Icon ? <Icon /> : null}
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      {count != null && count !== "" ? <span className="text-xs text-gray-400">{count}</span> : null}
    </div>
    {trailing}
  </div>
);

const RefreshButton = ({ onClick, disabled, label = "새로고침" }) => (
  <button type="button" onClick={onClick} disabled={disabled} className={REFRESH_BTN_CLASS}>
    {label}
  </button>
);

const getFocusableElements = (panel) =>
  panel
    ? Array.from(
        panel.querySelectorAll(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      )
    : [];

const useStableCallback = (fn) => {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current?.(...args), []);
};

const useFocusTrap = ({ open, onClose, loading = false }) => {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseStable = useStableCallback(onClose);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const panel = panelRef.current;
    const focusables = getFocusableElements(panel);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape" && !loading) {
        e.preventDefault();
        onCloseStable();
        return;
      }
      if (e.key !== "Tab" || focusables.length === 0) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocusRef.current instanceof HTMLElement) previousFocusRef.current.focus();
    };
  }, [open, loading, onCloseStable]);

  return panelRef;
};

const AdminBookCard = ({ book, onSelect }) => {
  const [imageError, setImageError] = useState(false);
  const coverUrl = book.coverImgUrl;

  return (
    <button
      type="button"
      onClick={() => onSelect(book)}
      className="group w-full text-left bg-gray-50 rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-indigo-200 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <div className="aspect-[3/4] overflow-hidden bg-gray-200 relative">
        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt=""
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200" aria-hidden="true">
            <svg width="100%" height="100%" viewBox="0 0 120 180" fill="none">
              <rect x="15" y="24" width="90" height="132" rx="8" fill="#b0b8c1" />
              <rect x="27" y="42" width="66" height="96" rx="6" fill="#e8f5e8" />
              <rect x="33" y="54" width="54" height="9" rx="4" fill="#b0b8c1" />
              <rect x="33" y="72" width="39" height="9" rx="4" fill="#b0b8c1" />
            </svg>
          </div>
        )}
        <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
          ID: {book.id}
        </div>
      </div>
      <div className="p-3">
        <h4 className="font-semibold text-sm text-gray-800 truncate mb-1">{book.title}</h4>
        <p className="text-xs text-gray-500 truncate">{book.author}</p>
      </div>
    </button>
  );
};

const Toast = ({ toast, onClose }) => {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div className="fixed bottom-6 right-6 z-[110] max-w-sm" role="status" aria-live="polite">
      <div
        className={`rounded-lg border px-4 py-3 shadow-lg flex items-start gap-3 ${
          isError ? "bg-red-50 border-red-200 text-red-800" : "bg-green-50 border-green-200 text-green-800"
        }`}
      >
        <p className="text-sm flex-1">{toast.message}</p>
        <button type="button" onClick={onClose} className="text-xs font-bold opacity-60 hover:opacity-100" aria-label="닫기">
          닫기
        </button>
      </div>
    </div>
  );
};

const ConfirmModal = ({ open, title, children, confirmLabel, onConfirm, onCancel, loading, danger = true }) => {
  const onCancelStable = useStableCallback(onCancel);
  const onConfirmStable = useStableCallback(onConfirm);
  const panelRef = useFocusTrap({ open, onClose: onCancelStable, loading });

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancelStable}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        className="w-full max-w-md rounded-xl bg-white border border-gray-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 id="admin-confirm-title" className="text-lg font-semibold text-gray-900">
            {title}
          </h3>
        </div>
        <div className="px-6 py-5 text-sm text-gray-700 space-y-3">{children}</div>
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelStable}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirmStable}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {loading ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const ResultPanel = ({ feedback, onDismiss, loading }) => {
  if (!feedback && !loading) return null;
  const isError = feedback?.type === "error";
  const rows = toArray(feedback?.data);
  const columns = rows.length > 0 ? Object.keys(rows[0]).slice(0, 6) : [];

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">실행 결과</h3>
        {feedback && (
          <button type="button" onClick={onDismiss} className="text-xs font-medium text-gray-500 hover:text-gray-800">
            닫기
          </button>
        )}
      </div>
      <div className="p-6 space-y-4">
        {loading && (
          <div className="flex items-center text-indigo-600 text-sm font-medium">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            데이터를 처리하고 있습니다...
          </div>
        )}
        {feedback && (
          <div
            className={`text-sm p-4 rounded-lg border ${
              isError ? "text-red-700 bg-red-50 border-red-100" : "text-green-700 bg-green-50 border-green-100"
            }`}
          >
            <p className="font-medium mb-2">{feedback.message}</p>
            {rows.length > 0 ? (
              <div className="overflow-x-auto mt-3 bg-white/60 rounded border border-current/10">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-black/5">
                      {columns.map((key) => (
                        <th key={key} className="px-3 py-2 font-semibold">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((row, idx) => (
                      <tr key={idx} className="border-t border-current/10">
                        {columns.map((key) => (
                          <td key={key} className="px-3 py-2 max-w-[180px] truncate" title={String(row[key] ?? "")}>
                            {typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && <p className="px-3 py-2 text-gray-500">외 {rows.length - 50}건...</p>}
              </div>
            ) : (
              feedback.data != null && (
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-80">
                  {JSON.stringify(feedback.data, null, 2)}
                </pre>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ImageZoomModal = ({ src, onClose }) => {
  const onCloseStable = useStableCallback(onClose);
  const panelRef = useFocusTrap({ open: Boolean(src), onClose: onCloseStable });
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onCloseStable}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="인물 이미지 확대"
        className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute -top-12 right-0 text-white hover:text-gray-300"
          onClick={onCloseStable}
          aria-label="닫기"
        >
          <CloseIcon className="w-8 h-8" strokeWidth={2} />
        </button>
        <img src={src} alt="확대된 인물 이미지" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
      </div>
    </div>
  );
};

const PayloadModal = ({ payload, onClose }) => {
  const onCloseStable = useStableCallback(onClose);
  const panelRef = useFocusTrap({ open: payload != null, onClose: onCloseStable });
  if (payload == null) return null;

  let formatted = String(payload);
  try {
    formatted = JSON.stringify(typeof payload === "string" ? JSON.parse(payload) : payload, null, 2);
  } catch {
    // keep raw string
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onCloseStable}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-gray-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-log-payload-title"
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h3 id="admin-log-payload-title" className="text-lg font-bold text-gray-800">
            페이로드 상세 정보
          </h3>
          <button type="button" onClick={onCloseStable} className="text-gray-400 hover:text-gray-600" aria-label="닫기">
            <CloseIcon className="w-6 h-6" strokeWidth={2} />
          </button>
        </div>
        <div className="p-6 overflow-auto">
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 overflow-x-auto">
            <pre>{formatted}</pre>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onCloseStable}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [bookId, setBookId] = useState("");
  const [chapterIdx, setChapterIdx] = useState("");
  const [eventIdx, setEventIdx] = useState("");
  const [files, setFiles] = useState([]);
  const [uploadEndpoint, setUploadEndpoint] = useState(UPLOAD_ACTIONS[0].endpoint);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const [feedback, setFeedback] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingAction, setLoadingAction] = useState(null);
  const [books, setBooks] = useState([]);
  const [booksError, setBooksError] = useState(null);
  const [normalizationJobs, setNormalizationJobs] = useState([]);
  const [normalizationError, setNormalizationError] = useState(null);
  const [jobLogs, setJobLogs] = useState([]);
  const [logsError, setLogsError] = useState(null);
  const [logLevelFilter, setLogLevelFilter] = useState("ALL");
  const [logQuery, setLogQuery] = useState("");
  const [logPage, setLogPage] = useState(0);

  const [selectedBook, setSelectedBook] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [isViewingCharacters, setIsViewingCharacters] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [selectedLogPayload, setSelectedLogPayload] = useState(null);
  const [imageGenerationStatus, setImageGenerationStatus] = useState(null);
  const [isGeneratingReference, setIsGeneratingReference] = useState(false);
  const [isSelectingReference, setIsSelectingReference] = useState(false);

  const loadingSeqRef = useRef(0);
  const charsRequestRef = useRef(0);
  const selectedBookRef = useRef(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [pickerExpanded, setPickerExpanded] = useState(true);
  const [pickerVisibleCount, setPickerVisibleCount] = useState(PICKER_PAGE_SIZE);
  const [manualBookIdOpen, setManualBookIdOpen] = useState(false);
  const [paramsCardOpen, setParamsCardOpen] = useState(false);
  const [bookListQuery, setBookListQuery] = useState("");
  const [bookPickerQuery, setBookPickerQuery] = useState("");

  const [dashboardStats, setDashboardStats] = useState({
    books: null,
    unsummarizedBooks: null,
    unsummarizedChapters: null,
    unsummarizedBookList: [],
    unsummarizedChapterList: [],
    loading: false,
    error: null,
  });

  const isAction = (key) => loadingAction === key;
  const isActionPrefix = (prefix) => Boolean(loadingAction?.startsWith(prefix));
  const showPanelLoading = Boolean(loadingAction) && !isActionPrefix("regen-") && loadingAction !== "delete";

  const selectedParamBook = useMemo(
    () => books.find((b) => String(b.id) === String(bookId)) || null,
    [books, bookId],
  );

  const filteredBooks = useMemo(() => filterBooksByQuery(books, bookListQuery), [books, bookListQuery]);
  const filteredPickerBooks = useMemo(
    () => filterBooksByQuery(books, bookPickerQuery),
    [books, bookPickerQuery],
  );

  const selectedUpload = useMemo(
    () => UPLOAD_ACTIONS.find((item) => item.endpoint === uploadEndpoint) || UPLOAD_ACTIONS[0],
    [uploadEndpoint],
  );

  const filteredJobLogs = useMemo(() => {
    let list = jobLogs;
    if (logLevelFilter !== "ALL") {
      list = list.filter((log) => String(log.level || "").toUpperCase() === logLevelFilter);
    }
    const q = logQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (log) =>
          String(log.bookTitle || "")
            .toLowerCase()
            .includes(q) ||
          String(log.message || "")
            .toLowerCase()
            .includes(q) ||
          String(log.jobId ?? "").includes(q) ||
          String(log.step || "")
            .toLowerCase()
            .includes(q),
      );
    }
    return list;
  }, [jobLogs, logLevelFilter, logQuery]);

  const logPageCount = Math.max(1, Math.ceil(filteredJobLogs.length / LOG_PAGE_SIZE) || 1);
  const pagedJobLogs = useMemo(() => {
    const start = logPage * LOG_PAGE_SIZE;
    return filteredJobLogs.slice(start, start + LOG_PAGE_SIZE);
  }, [filteredJobLogs, logPage]);

  const hasGeneratingCharacters = useMemo(
    () => characters.some((c) => charStatusOf(c) === "GENERATING"),
    [characters],
  );

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    selectedBookRef.current = selectedBook;
  }, [selectedBook]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setLogPage(0);
  }, [logLevelFilter, logQuery, jobLogs]);

  useEffect(() => {
    setPickerVisibleCount(PICKER_PAGE_SIZE);
  }, [bookPickerQuery, books]);

  const resetCharacterView = () => {
    charsRequestRef.current += 1;
    setIsViewingCharacters(false);
    setSelectedBook(null);
    setCharacters([]);
    setStatusFilter("ALL");
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    resetCharacterView();
    setFeedback(null);
    setMobileNavOpen(false);
  };

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileNavOpen]);

  const emitFeedback = (type, message, data, showResultPanel) => {
    if (showResultPanel) setFeedback({ type, message, data });
    else showToast(type, message);
  };

  const handleApiCall = async (actionKey, apiFunction, options = {}) => {
    const {
      updateState,
      successMessage,
      showResultPanel = true,
      shouldApply,
      notifySuccess = true,
      notifyError = true,
    } = options;
    const seq = ++loadingSeqRef.current;
    setLoadingAction(actionKey);
    setFeedback(null);
    try {
      const result = await apiFunction();
      if (result.data && result.data.isSuccess) {
        const data = result.data.result;
        const applyOk = typeof shouldApply !== "function" || shouldApply();
        if (applyOk && typeof updateState === "function") updateState(data);
        if (applyOk && notifySuccess) {
          if (showResultPanel) {
            emitFeedback("success", successMessage || summarizeResult(data), data, true);
          } else if (successMessage) {
            showToast("success", successMessage);
          }
        }
        return applyOk ? data : null;
      }
      if (notifyError) {
        emitFeedback("error", extractErrorMessage(result.data), result.data, showResultPanel);
      }
      return null;
    } catch (err) {
      console.error("API Error:", err.response || err);
      const payload = err.response?.data ?? { message: err?.message ?? "예기치 않은 오류가 발생했습니다." };
      if (notifyError) {
        emitFeedback("error", extractErrorMessage(payload), payload, showResultPanel);
      }
      return null;
    } finally {
      if (seq === loadingSeqRef.current) setLoadingAction(null);
    }
  };

  const fetchBooks = useCallback(async () => {
    const result = await apiClient.get("/books");
    if (!result.data?.isSuccess) throw new Error(extractErrorMessage(result.data));
    const list = toArray(result.data.result);
    setBooks(list);
    setBooksError(null);
    return list;
  }, []);

  const ensureBooksLoaded = useCallback(async () => {
    if (books.length > 0) return books;
    try {
      return await fetchBooks();
    } catch (err) {
      console.error(err);
      setBooksError("도서 목록을 불러오지 못했습니다.");
      return [];
    }
  }, [books, fetchBooks]);

  const loadDashboard = useCallback(async () => {
    setDashboardStats((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [bookList, unBooksRes, unChaptersRes] = await Promise.all([
        fetchBooks(),
        apiClient.get("/books/unsummarized"),
        apiClient.get("/chapters/unsummarized"),
      ]);
      const unBooksOk = Boolean(unBooksRes.data?.isSuccess);
      const unChaptersOk = Boolean(unChaptersRes.data?.isSuccess);
      const unBooks = unBooksOk ? toArray(unBooksRes.data.result) : [];
      const unChapters = unChaptersOk ? toArray(unChaptersRes.data.result) : [];
      const partialErrors = [];
      if (!unBooksOk) partialErrors.push("미요약 도서");
      if (!unChaptersOk) partialErrors.push("미요약 챕터");
      setDashboardStats({
        books: bookList.length,
        unsummarizedBooks: unBooksOk ? unBooks.length : null,
        unsummarizedChapters: unChaptersOk ? unChapters.length : null,
        unsummarizedBookList: unBooks,
        unsummarizedChapterList: unChapters,
        loading: false,
        error:
          partialErrors.length > 0
            ? `${partialErrors.join(", ")} 통계를 불러오지 못했습니다.`
            : null,
      });
    } catch (err) {
      console.error(err);
      setDashboardStats((prev) => ({
        ...prev,
        loading: false,
        error: "대시보드 통계를 불러오지 못했습니다.",
      }));
    }
  }, [fetchBooks]);

  useEffect(() => {
    if (activeTab === "dashboard") loadDashboard();
  }, [activeTab, loadDashboard]);

  useEffect(() => {
    if (activeTab === "upload" || activeTab === "delete") ensureBooksLoaded();
  }, [activeTab, ensureBooksLoaded]);

  const refreshCharactersSilent = useCallback(async (book) => {
    if (!book?.id) return;
    const bookIdAtStart = book.id;
    try {
      const result = await apiClient.get(`/books/${bookIdAtStart}/characters`);
      if (!result.data?.isSuccess) return;
      if (selectedBookRef.current?.id !== bookIdAtStart) return;
      setCharacters(toArray(result.data.result));
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!isViewingCharacters || !selectedBook || !hasGeneratingCharacters) return undefined;
    const id = setInterval(() => refreshCharactersSilent(selectedBook), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isViewingCharacters, selectedBook, hasGeneratingCharacters, refreshCharactersSilent]);

  const loadAdminList = async ({ actionKey, request, setList, setError, errorMessage }) => {
    setError(null);
    const data = await handleApiCall(actionKey, request, {
      updateState: (result) => setList(toArray(result)),
      showResultPanel: false,
      notifySuccess: false,
      notifyError: false,
    });
    if (data == null) setError(errorMessage);
    return data;
  };

  const getBooksList = () =>
    loadAdminList({
      actionKey: "books",
      request: () => apiClient.get("/books"),
      setList: setBooks,
      setError: setBooksError,
      errorMessage: "도서 목록을 불러오지 못했습니다.",
    });

  const openBooksTab = () => {
    switchTab("books");
    getBooksList();
  };

  const openDashboardDrilldown = (kind) => {
    if (kind === "books") {
      openBooksTab();
      return;
    }
    if (dashboardStats.loading) {
      showToast("error", "통계를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const isUnBooks = kind === "unBooks";
    const list = isUnBooks ? dashboardStats.unsummarizedBookList : dashboardStats.unsummarizedChapterList;
    const label = isUnBooks ? "미요약 도서" : "미요약 챕터";
    setFeedback({
      type: "success",
      message: list.length > 0 ? `${label} ${list.length}건` : `${label}가 없습니다.`,
      data: list,
    });
  };

  const getNormalizationJobs = () =>
    loadAdminList({
      actionKey: "normalization",
      request: () => apiClient.get("/normalization/jobs/latest"),
      setList: setNormalizationJobs,
      setError: setNormalizationError,
      errorMessage: "정규화 작업 목록을 불러오지 못했습니다.",
    });

  const getJobLogs = () =>
    loadAdminList({
      actionKey: "logs",
      request: () => apiClient.get("/jobs/logs/latest"),
      setList: setJobLogs,
      setError: setLogsError,
      errorMessage: "작업 로그를 불러오지 못했습니다.",
    });

  const getImageGenerationStatus = async (bookId) => {
    try {
        const result = await apiClient.get(
            `/image-generation/books/${bookId}`
        );

        if (result.data?.isSuccess) {
            setImageGenerationStatus(result.data.result);
        } else {
            setImageGenerationStatus(null);
        }
    } catch (e) {
        console.error(e);
        setImageGenerationStatus(null);
    }
  };

  const generateReferenceCandidates = async () => {
    if (!selectedBook) return;
    const confirmed = window.confirm(
        "대표 캐릭터 후보사진을 생성하시겠습니까?\n\n기존 후보사진은 새 후보사진으로 덮어쓰게 됩니다."
    );

    if (!confirmed) return;
    try {
        setIsGeneratingReference(true);
        await apiClient.post(
            `/image-generation/books/${selectedBook.id}/reference-candidates`
        );
        await getImageGenerationStatus(selectedBook.id);
    } catch (e) {
        console.error(e);
    } finally {
        setIsGeneratingReference(false);
    }
  };

  const selectReferenceCandidate = async (candidateId) => {
    if (!selectedBook) return;

    const confirmed = window.confirm(
        "이 후보 이미지를 대표 이미지로 선택하시겠습니까?\n\n선택 후 나머지 캐릭터 이미지 생성(Batch fan-out)이 시작됩니다."
    );

    if (!confirmed) return;

    try {
        setIsSelectingReference(true);
        const result = await apiClient.post(
            `/image-generation/books/${selectedBook.id}/reference-candidates/${candidateId}/select`
        );
        if (result.data?.isSuccess) {
            setImageGenerationStatus(result.data.result);
        }
    } catch (e) {
        console.error(e);
    } finally {
        setIsSelectingReference(false);
    }
  };

  const getBookCharacters = (book) => {
    const requestId = ++charsRequestRef.current;
    setSelectedBook(book);
setBookId(String(book.id));
setStatusFilter("ALL");
getImageGenerationStatus(book.id);

handleApiCall(`chars-${book.id}`, () => apiClient.get(`/books/${book.id}/characters`), {
  shouldApply: () => requestId === charsRequestRef.current,
  updateState: (data) => {
    setCharacters(toArray(data));
    setIsViewingCharacters(true);
  },
  showResultPanel: false,
  notifySuccess: false,
});
  };

  const selectBookForParams = (book) => {
    setBookId(String(book.id));
    setPickerExpanded(false);
    setManualBookIdOpen(false);
    if (activeTab === "upload") setParamsCardOpen(false);
  };

  const clearSelectedBook = () => {
    setBookId("");
    setPickerExpanded(true);
    setManualBookIdOpen(false);
    setParamsCardOpen(true);
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter(
      (f) => f.type === "application/json" || f.name.toLowerCase().endsWith(".json"),
    );
    if (incoming.length === 0) {
      showToast("error", "JSON 파일만 선택할 수 있습니다.");
      return;
    }
    setFiles((prev) => {
      if (selectedUpload.mode === "single") {
        return [incoming[incoming.length - 1]];
      }
      const map = new Map(prev.map((f) => [fileKey(f), f]));
      incoming.forEach((f) => map.set(fileKey(f), f));
      return Array.from(map.values());
    });
  };

  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const selectUploadType = (endpoint) => {
    if (endpoint === uploadEndpoint) return;
    setFiles([]);
    setUploadEndpoint(endpoint);
  };

  const uploadFiles = (endpoint, mode) => {
    if (!bookId) {
      showToast("error", "Book ID를 선택하거나 입력해 주세요.");
      return;
    }
    if (!isNonNegativeIntString(bookId)) {
      showToast("error", INT_FIELD_ERRORS.bookId);
      return;
    }
    if (files.length === 0) {
      showToast("error", "업로드할 JSON 파일을 선택해 주세요.");
      return;
    }
    if (mode === "single" && files.length > 1) {
      showToast("error", "이 업로드는 파일 1개만 필요합니다. 목록에서 하나만 남겨 주세요.");
      return;
    }
    const formData = new FormData();
    if (mode === "single") {
      formData.append("file", files[0]);
    } else {
      files.forEach((file) => formData.append("files", file));
    }
    handleApiCall(`upload-${endpoint}`, () => apiClient.post(`/books/${bookId}/${endpoint}`, formData)).then(
      (data) => {
        if (data != null) setFiles([]);
      },
    );
  };

  const requestDelete = (action) => {
    const values = { bookId, chapterIdx, eventIdx };
    for (const need of action.needs) {
      if (!values[need]) {
        showToast("error", DELETE_NEED_ERRORS[need]);
        return;
      }
    }
    if (!isNonNegativeIntString(bookId)) {
      showToast("error", INT_FIELD_ERRORS.bookId);
      return;
    }
    if (action.needs.includes("chapterIdx") && !isNonNegativeIntString(chapterIdx)) {
      showToast("error", INT_FIELD_ERRORS.chapterIdx);
      return;
    }
    if (action.needs.includes("eventIdx") && !isNonNegativeIntString(eventIdx)) {
      showToast("error", INT_FIELD_ERRORS.eventIdx);
      return;
    }
    setDeleteTarget(action);
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    const label = deleteTarget.label;
    const finalEndpoint = deleteTarget.ep
      .replace("{bookId}", bookId)
      .replace("{chapterIdx}", chapterIdx)
      .replace("{eventIdx}", eventIdx);

    await handleApiCall("delete", () => apiClient.delete(finalEndpoint), {
      successMessage: `${label} 작업이 완료되었습니다.`,
      updateState: () => setDeleteTarget(null),
    });
  };

  const closeConfirmDialog = useCallback(() => {
    if (!loadingAction) setConfirmDialog(null);
  }, [loadingAction]);

  const closeDeleteTarget = useCallback(() => {
    if (loadingAction !== "delete") setDeleteTarget(null);
  }, [loadingAction]);

  const runConfirmDialog = useCallback(() => {
    confirmDialog?.run?.();
  }, [confirmDialog]);

  const openConfirm = ({ title, confirmLabel, message, danger = false, run }) => {
    setConfirmDialog({ title, confirmLabel, message, danger, run });
  };

  const handleRegenerate = (char) => {
    const name = char.commonName || char.name;
    openConfirm({
      title: "이미지 재생성",
      confirmLabel: "재생성",
      message: `인물 [${name}]의 이미지를 재생성할까요?`,
      run: async () => {
        const data = await handleApiCall(
          `regen-${char.id}`,
          () => apiClient.post(`/characters/${char.id}/regenerate-image`),
          {
            showResultPanel: false,
            successMessage: `인물 [${name}] 재생성 요청이 접수되었습니다.`,
          },
        );
        if (data != null) {
          setConfirmDialog(null);
          if (selectedBook) await refreshCharactersSilent(selectedBook);
        }
      },
    });
  };

  const handleRegenerateFailed = () => {
    const failed = characters.filter((c) => charStatusOf(c) === "FAILED");
    if (failed.length === 0) {
      showToast("error", "실패한 인물이 없습니다.");
      return;
    }
    openConfirm({
      title: "실패 인물 일괄 재생성",
      confirmLabel: `${failed.length}건 재생성`,
      message: `실패한 인물 ${failed.length}건의 이미지를 다시 생성할까요?`,
      run: async () => {
        const seq = ++loadingSeqRef.current;
        setLoadingAction("regen-failed");
        let ok = 0;
        let fail = 0;
        try {
          for (const char of failed) {
            try {
              const result = await apiClient.post(`/characters/${char.id}/regenerate-image`);
              if (result.data?.isSuccess) ok += 1;
              else fail += 1;
            } catch {
              fail += 1;
            }
          }
          showToast(
            fail === 0 ? "success" : "error",
            `일괄 재생성: 성공 ${ok}건${fail ? `, 실패 ${fail}건` : ""}.`,
          );
          setConfirmDialog(null);
          if (selectedBook) await refreshCharactersSilent(selectedBook);
        } finally {
          if (seq === loadingSeqRef.current) setLoadingAction(null);
        }
      },
    });
  };

  const retryNormalizationJob = (jobId) => {
    openConfirm({
      title: "정규화 재시도",
      confirmLabel: "재시도",
      message: `ID #${jobId} 정규화 작업을 재시도할까요?`,
      run: async () => {
        const data = await handleApiCall(
          `retry-${jobId}`,
          () => apiClient.post(`/normalization/jobs/${jobId}/retry`),
          { showResultPanel: false, notifySuccess: false },
        );
        if (data != null) {
          setConfirmDialog(null);
          getNormalizationJobs();
        }
      },
    });
  };

  const navButtonClass = (tab, danger = false) => {
    const active = activeTab === tab;
    if (danger) {
      return `w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
        active ? "bg-red-50 text-red-700" : "text-gray-600 hover:bg-red-50 hover:text-red-600"
      }`;
    }
    return `w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
      active ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
    }`;
  };

  const navItems = [
    { id: "dashboard", label: "대시보드 홈", Icon: LayoutDashboardIcon, onClick: () => switchTab("dashboard") },
    { id: "books", label: "도서 목록", Icon: BookIcon, onClick: openBooksTab },
    {
      id: "normalization",
      label: "정규화 작업",
      Icon: ProcessingIcon,
      onClick: () => {
        switchTab("normalization");
        getNormalizationJobs();
      },
    },
    {
      id: "logs",
      label: "작업 로그",
      Icon: ListBulletIcon,
      onClick: () => {
        switchTab("logs");
        getJobLogs();
      },
    },
    { id: "upload", label: "데이터 업로드", Icon: UploadIcon, onClick: () => switchTab("upload") },
    { id: "delete", label: "데이터 삭제", Icon: TrashIcon, onClick: () => switchTab("delete"), danger: true },
  ];

  const renderNavContent = () => (
    <>
      <div className="px-6 py-8 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <DatabaseIcon />
          <h2 className="text-xl font-bold text-gray-800 tracking-tight truncate">관리자 대시보드</h2>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="md:hidden p-2 -mr-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          aria-label="메뉴 닫기"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        {navItems.map(({ id, label, Icon, onClick, danger }) => (
          <button key={id} type="button" onClick={onClick} className={navButtonClass(id, danger)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </>
  );

  const renderNav = () => (
    <>
      <nav className="w-64 flex-shrink-0 bg-white shadow-sm border-r border-gray-200 hidden md:flex md:flex-col">
        {renderNavContent()}
      </nav>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[90] md:hidden" role="dialog" aria-modal="true" aria-label="관리자 메뉴">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="메뉴 닫기"
            onClick={() => setMobileNavOpen(false)}
          />
          <nav className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col">
            {renderNavContent()}
          </nav>
        </div>
      )}
    </>
  );

  const renderBookPicker = () => {
    const visibleBooks = filteredPickerBooks.slice(0, pickerVisibleCount);
    const hasMore = filteredPickerBooks.length > pickerVisibleCount;
    const canCollapse = Boolean(bookId);

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-medium text-gray-700">도서</span>
            <span className="text-xs text-gray-400 truncate">
              {bookPickerQuery.trim()
                ? `검색 ${filteredPickerBooks.length}권`
                : `전체 ${books.length}권`}
              {filteredPickerBooks.length > 0 &&
                ` · ${Math.min(pickerVisibleCount, filteredPickerBooks.length)}권 표시`}
            </span>
          </div>
          {canCollapse ? (
            <button
              type="button"
              onClick={() => setPickerExpanded((v) => !v)}
              className="text-xs text-indigo-600 hover:text-indigo-800 shrink-0"
            >
              {pickerExpanded ? "목록 접기" : "목록 펼치기"}
            </button>
          ) : (
            <span className="text-xs text-gray-400 shrink-0">목록에서 선택</span>
          )}
        </div>

        {bookId && (
          <div className="px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-sm text-indigo-800 flex items-start justify-between gap-2">
            <div className="min-w-0">
              {selectedParamBook ? (
                <>
                  <p className="font-semibold truncate">{selectedParamBook.title}</p>
                  <p className="text-xs text-indigo-700/80 truncate mt-0.5">
                    {selectedParamBook.author || "저자 미상"} · ID {selectedParamBook.id}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Book ID {bookId}</p>
                  <p className="text-xs text-indigo-700/80 mt-0.5">목록에 없는 ID로 지정됨</p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={clearSelectedBook}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-900 shrink-0"
            >
              선택 해제
            </button>
          </div>
        )}

        {(pickerExpanded || !canCollapse) && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <input
              type="search"
              value={bookPickerQuery}
              onChange={(e) => setBookPickerQuery(e.target.value)}
              placeholder="제목·저자·ID 검색"
              className="w-full px-3 py-2 text-sm border-b border-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
              aria-label="도서 검색"
            />
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
              {filteredPickerBooks.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400 text-center">검색 결과가 없습니다.</p>
              ) : (
                visibleBooks.map((book) => {
                  const selected = String(book.id) === String(bookId);
                  return (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => selectBookForParams(book)}
                      aria-pressed={selected}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-indigo-50 focus:outline-none focus-visible:bg-indigo-50 ${
                        selected ? "bg-indigo-50" : "bg-white"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium truncate ${
                            selected ? "text-indigo-900" : "text-gray-800"
                          }`}
                        >
                          {book.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {book.author || "저자 미상"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                          selected
                            ? "bg-indigo-100 border-indigo-200 text-indigo-800"
                            : "bg-gray-50 border-gray-200 text-gray-500"
                        }`}
                      >
                        ID {book.id}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {hasMore && (
              <div className="border-t border-gray-100 px-3 py-2 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setPickerVisibleCount((n) => n + PICKER_PAGE_SIZE)}
                  className="w-full text-xs font-medium text-indigo-600 hover:text-indigo-800 py-1"
                >
                  더보기 ({filteredPickerBooks.length - pickerVisibleCount}권 남음)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderBookIdField = () => {
    if (!manualBookIdOpen) {
      return (
        <button
          type="button"
          onClick={() => {
            setManualBookIdOpen(true);
            setPickerExpanded(true);
          }}
          className="text-xs text-gray-500 hover:text-indigo-600 underline-offset-2 hover:underline"
        >
          목록에 없는 도서는 ID로 직접 입력
        </button>
      );
    }

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm font-medium text-gray-700" htmlFor="admin-manual-book-id">
            Book ID 직접 입력
          </label>
          <button
            type="button"
            onClick={() => setManualBookIdOpen(false)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            닫기
          </button>
        </div>
        <input
          id="admin-manual-book-id"
          type="text"
          inputMode="numeric"
          className={INPUT_CLASS}
          placeholder="예: 123"
          value={bookId}
          onChange={(e) => setBookId(e.target.value.trim())}
        />
        <p className="text-xs text-gray-400">가능하면 위 목록에서 선택하세요.</p>
      </div>
    );
  };

  const renderIndexField = ({ id, label, hint, value, onChange, placeholder = "예: 1" }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor={id}>
        {label}
        <span className="ml-1 text-xs font-normal text-gray-400">{hint}</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className={INPUT_CLASS}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      />
    </div>
  );

  const paramsCardSummary = selectedParamBook
    ? `${selectedParamBook.title} · ID ${selectedParamBook.id}`
    : bookId
      ? `Book ID ${bookId}`
      : "도서를 선택해 주세요";

  const renderParamsCard = (title, children) => (
    <div className={`${SECTION_CARD_CLASS} admin-params-card`}>
      <button
        type="button"
        onClick={() => setParamsCardOpen((v) => !v)}
        aria-expanded={paramsCardOpen}
        className={`admin-params-card__toggle${paramsCardOpen ? " is-open" : ""}`}
      >
        <div className="admin-params-card__toggle-text">
          <h3 className="admin-params-card__title">{title}</h3>
          <p
            className={`admin-params-card__summary${
              paramsCardOpen ? "" : " is-visible"
            } ${bookId ? "is-selected" : "is-empty"}`}
          >
            {paramsCardSummary}
          </p>
        </div>
        <ChevronIcon
          className={`admin-params-card__chevron${paramsCardOpen ? " is-open" : ""}`}
        />
      </button>
      <div className={`admin-params-card__panel${paramsCardOpen ? " is-open" : ""}`}>
        <div className="admin-params-card__panel-clip">
          <div className={`admin-params-card__panel-body${paramsCardOpen ? " is-open" : ""}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  const renderUploadParams = () =>
    renderParamsCard(
      "업로드할 도서",
      <>
        {renderBookPicker()}
        {renderBookIdField()}
      </>,
    );

  const renderDeleteParams = () =>
    renderParamsCard(
      "삭제 대상 도서",
      <>
        {renderBookPicker()}
        {renderBookIdField()}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderIndexField({
            id: "admin-chapter-idx",
            label: "챕터 번호",
            hint: "(이벤트/요약/관계 삭제 시)",
            value: chapterIdx,
            onChange: setChapterIdx,
          })}
          {renderIndexField({
            id: "admin-event-idx",
            label: "이벤트 번호",
            hint: "(관계 삭제 시)",
            value: eventIdx,
            onChange: setEventIdx,
          })}
        </div>
      </>,
    );

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">카드를 클릭하면 상세 목록을 볼 수 있습니다.</p>
        <RefreshButton onClick={loadDashboard} disabled={dashboardStats.loading} label="통계 새로고침" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { key: "books", label: "전체 도서", value: dashboardStats.books, hint: "도서 목록으로 이동" },
          {
            key: "unBooks",
            label: "미요약 도서",
            value: dashboardStats.unsummarizedBooks,
            hint: "목록 보기",
          },
          {
            key: "unChapters",
            label: "미요약 챕터",
            value: dashboardStats.unsummarizedChapters,
            hint: "목록 보기",
          },
        ].map((stat) => (
          <button
            key={stat.key}
            type="button"
            onClick={() => openDashboardDrilldown(stat.key)}
            disabled={dashboardStats.loading}
            className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors disabled:opacity-60"
          >
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{stat.label}</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {dashboardStats.loading ? "…" : (stat.value ?? "—")}
            </p>
            <p className="mt-2 text-xs text-indigo-600 font-medium">{stat.hint}</p>
          </button>
        ))}
      </div>
      {dashboardStats.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{dashboardStats.error}</p>
      )}
    </div>
  );

  const renderCharactersSection = () => {
    const statusCounts = countCharStatuses(characters);
    const { COMPLETED: completedCount, FAILED: failedCount, PENDING: pendingCount, GENERATING: generatingCount } =
      statusCounts;
    const totalCount = characters.length;
    const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    const filteredCharacters =
      statusFilter === "ALL" ? characters : characters.filter((c) => charStatusOf(c) === statusFilter);
    const statusFilters = [
      { id: "ALL", label: `전체 ${totalCount}` },
      { id: "COMPLETED", label: `완료 ${completedCount}` },
      { id: "GENERATING", label: `생성 중 ${generatingCount}` },
      { id: "FAILED", label: `실패 ${failedCount}` },
      { id: "PENDING", label: `대기 ${pendingCount}` },
    ];

    return (
      <div className={SECTION_CARD_CLASS}>
        <div className="px-6 py-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-6">
            <button
              type="button"
              onClick={() => setIsViewingCharacters(false)}
              className="p-2 hover:bg-gray-100 rounded-full"
              aria-label="도서 목록으로"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div className="flex flex-col space-y-1">
              <h3 className="text-xl font-bold text-gray-900">{selectedBook?.title}</h3>
              <div className="flex items-center space-x-3">
                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                  BOOK ID: {selectedBook?.id}
                </span>
                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                  전체 인물: {totalCount}
                </span>
                {hasGeneratingCharacters && (
                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                    자동 갱신 중
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-1.5 min-w-[200px] border-l border-gray-100 pl-6 ml-6">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">이미지 생성</span>
                <span className="text-lg font-black text-indigo-600 tracking-tighter">{percentage}%</span>
              </div>
              <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200/50">
                <div
                  className={`h-full transition-all duration-1000 ease-out ${percentage === 100 ? "bg-green-500" : "bg-indigo-500"}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="text-[13px] text-gray-400 font-medium text-right">
                완료 {completedCount} · 실패 {failedCount} · 생성 중 {generatingCount}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {failedCount > 0 && (
              <button
                type="button"
                onClick={handleRegenerateFailed}
                disabled={isAction("regen-failed")}
                className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-xs font-bold disabled:opacity-50"
              >
                실패 {failedCount}건 일괄 재생성
              </button>
            )}
            <button
              type="button"
              onClick={() => getBookCharacters(selectedBook)}
              disabled={isActionPrefix("chars-")}
              className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 text-xs font-bold disabled:opacity-50"
            >
              <ProcessingIcon
                className={`w-3.5 h-3.5 ${isActionPrefix("chars-") ? "animate-spin" : ""}`}
                strokeWidth={2}
              />
              <span>현황 갱신</span>
            </button>
          </div>
        </div>
        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          {statusFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={filterChipClass(statusFilter === f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="px-6 pt-6 flex justify-end">
          <button
            onClick={generateReferenceCandidates}
            disabled={isGeneratingReference}
            className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
          >
            {isGeneratingReference
              ? "후보사진 생성 중..."
              : "후보사진 생성"}
          </button>
        </div>

        {imageGenerationStatus && (
          <div className="m-6 mb-4 rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h4 className="text-lg font-semibold mb-4">
              이미지 생성 현황
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-semibold text-gray-600">
                  전체 상태
                </div>
                <div className="mt-1 text-indigo-600 font-bold">
                    {imageGenerationStatus.status}
                </div>
            </div>
            <div>
              <div className="font-semibold text-gray-600">
                다음 작업
              </div>
              <div className="mt-1">
                {imageGenerationStatus.nextAction}
              </div>
            </div>
            <div>
              <div className="font-semibold text-gray-600">
                대표 캐릭터
              </div>
              <div className="mt-1">
                {imageGenerationStatus.referenceCharacter?.name ?? "-"}
              </div>
            </div>
            <div>
              <div className="font-semibold text-gray-600">
                선택된 후보
              </div>
              <div className="mt-1">
                {imageGenerationStatus.selectedReferenceCandidateId ?? "없음"}
              </div>
            </div>
        </div>

        {imageGenerationStatus.referenceCandidates?.length > 0 && (
          <div className="mt-6">
            <h5 className="text-sm font-semibold mb-3">
              대표 후보 이미지
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {imageGenerationStatus.referenceCandidates.map(candidate => (
                <div
                  key={candidate.id}
                  className={`rounded-lg border overflow-hidden bg-white transition cursor-pointer hover:shadow-md ${
                    candidate.id === imageGenerationStatus.selectedReferenceCandidateId
                      ? "border-indigo-500 ring-2 ring-indigo-200"
                      : "border-gray-200"
                  }`}
                >
                  <div className="aspect-square bg-gray-100">
                    {candidate.imageUrl ? (
                      <img
                        src={candidate.imageUrl}
                        alt={`slot-${candidate.slotNo}`}
                        className="w-full h-full object-cover cursor-zoom-in"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomedImage(candidate.imageUrl);
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                        이미지 없음
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-xs text-gray-500">
                      Slot {candidate.slotNo}
                    </div>
                    <div className="font-semibold mt-1">
                      {candidate.status}
                    </div>
                    {candidate.failureCode && (
                      <div className="text-xs text-red-500 mt-1">
                        {candidate.failureCode}
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={() => selectReferenceCandidate(candidate.id)}
                      disabled={
                        isSelectingReference ||
                        candidate.id === imageGenerationStatus.selectedReferenceCandidateId ||
                        candidate.status === "FAILED"
                      }
                      className={`w-full rounded-md px-3 py-2 text-sm font-medium transition ${
                        candidate.id === imageGenerationStatus.selectedReferenceCandidateId
                          ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                          : candidate.status === "FAILED"
                          ? "bg-red-100 text-red-500 cursor-not-allowed"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      }`}
                    >
                      {candidate.id === imageGenerationStatus.selectedReferenceCandidateId
                        ? "선택됨"
                        : candidate.status === "FAILED"
                        ? "선택 불가"
                        : "대표사진 선택"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )}
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold border-b">ID</th>
                <th className="px-6 py-3 font-semibold border-b">프로필</th>
                <th className="px-6 py-3 font-semibold border-b">이름</th>
                <th className="px-6 py-3 font-semibold border-b">이미지 생성 상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCharacters.length === 0 ? (
                <TableMessageRow colSpan={4}>
                  {characters.length === 0 ? "인물 데이터가 없습니다." : "해당 상태의 인물이 없습니다."}
                </TableMessageRow>
              ) : (
                filteredCharacters.map((char) => {
                  const status = charStatusOf(char);
                  return (
                    <tr key={char.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-mono text-gray-500">{char.id}</td>
                      <td className="px-6 py-4">
                        {char.profileImage ? (
                          <button
                            type="button"
                            onClick={() => setZoomedImage(char.profileImage)}
                            className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 cursor-zoom-in hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            aria-label={`${char.commonName || char.name} 이미지 확대`}
                          >
                            <img
                              src={char.profileImage}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-800">{char.commonName || char.name}</td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center space-x-3">
                          <span className={`${STATUS_PILL_CLASS} ${statusBadgeClass(status)}`}>
                            {status}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRegenerate(char)}
                            disabled={isAction(`regen-${char.id}`) || isAction("regen-failed")}
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 uppercase tracking-tighter border border-indigo-200 px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            재생성
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderBooksSection = () => {
    if (isViewingCharacters) return renderCharactersSection();

    return (
      <div className={SECTION_CARD_CLASS}>
        <SectionCardHeader
          icon={BookIcon}
          title="도서 목록"
          count={`${filteredBooks.length}/${books.length}`}
          trailing={
            <div className="flex items-center gap-3">
              <input
                type="search"
                value={bookListQuery}
                onChange={(e) => setBookListQuery(e.target.value)}
                placeholder="제목·저자·ID 검색"
                className={`${SEARCH_INPUT_CLASS} w-56`}
                aria-label="도서 검색"
              />
              <RefreshButton onClick={getBooksList} disabled={isAction("books")} />
            </div>
          }
        />
        <div className="p-6">
          {booksError ? (
            <PanelMessage tone="error">{booksError}</PanelMessage>
          ) : books.length === 0 && !isAction("books") ? (
            <PanelMessage>도서 데이터가 없습니다.</PanelMessage>
          ) : filteredBooks.length === 0 ? (
            <PanelMessage>검색 결과가 없습니다.</PanelMessage>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
              {filteredBooks.map((book) => (
                <AdminBookCard key={book.id} book={book} onSelect={getBookCharacters} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderNormalizationSection = () => (
    <div className={SECTION_CARD_CLASS}>
      <SectionCardHeader
        icon={ProcessingIcon}
        title="정규화 작업 현황"
        trailing={<RefreshButton onClick={getNormalizationJobs} disabled={isAction("normalization")} />}
      />
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
              <th className="px-6 py-3 font-semibold border-b">ID</th>
              <th className="px-6 py-3 font-semibold border-b">도서명</th>
              <th className="px-6 py-3 font-semibold border-b">상태</th>
              <th className="px-6 py-3 font-semibold border-b">생성일시</th>
              <th className="px-6 py-3 font-semibold border-b">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {normalizationError ? (
              <TableMessageRow colSpan={5} tone="error">
                {normalizationError}
              </TableMessageRow>
            ) : normalizationJobs.length === 0 ? (
              <TableMessageRow colSpan={5}>정규화 작업 내역이 없습니다.</TableMessageRow>
            ) : (
              normalizationJobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-500">{job.id}</td>
                  <td className="px-6 py-4 text-sm text-gray-800">
                    {job.bookTitle || job.book_title || `Book ${job.bookId}`}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`${STATUS_PILL_CLASS} ${statusBadgeClass(job.status)}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDateTime(job.createdAt || job.created_at)}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {canRetryNormalizationJob(job.status) ? (
                      <button
                        type="button"
                        onClick={() => retryNormalizationJob(job.id)}
                        disabled={isAction(`retry-${job.id}`)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
                      >
                        재시도
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderLogsSection = () => (
    <div className={SECTION_CARD_CLASS}>
      <SectionCardHeader
        icon={ListBulletIcon}
        title="최신 작업 로그"
        count={`${filteredJobLogs.length}/${jobLogs.length}`}
        trailing={<RefreshButton onClick={getJobLogs} disabled={isAction("logs")} />}
      />
      <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="로그 레벨 필터">
          {LOG_LEVEL_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setLogLevelFilter(f.id)}
              className={filterChipClass(logLevelFilter === f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={logQuery}
          onChange={(e) => setLogQuery(e.target.value)}
          placeholder="도서·메시지·Job ID·단계 검색"
          className={`${SEARCH_INPUT_CLASS} w-full sm:w-64`}
          aria-label="로그 검색"
        />
      </div>
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
              <th className="px-6 py-3 font-semibold border-b">Job ID</th>
              <th className="px-6 py-3 font-semibold border-b">도서명</th>
              <th className="px-6 py-3 font-semibold border-b">단계</th>
              <th className="px-6 py-3 font-semibold border-b text-center">레벨</th>
              <th className="px-6 py-3 font-semibold border-b">메시지</th>
              <th className="px-6 py-3 font-semibold border-b">생성일시</th>
              <th className="px-6 py-3 font-semibold border-b text-center">상세</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logsError ? (
              <TableMessageRow colSpan={7} tone="error">
                {logsError}
              </TableMessageRow>
            ) : jobLogs.length === 0 ? (
              <TableMessageRow colSpan={7}>로그 데이터가 없습니다.</TableMessageRow>
            ) : filteredJobLogs.length === 0 ? (
              <TableMessageRow colSpan={7}>필터 조건에 맞는 로그가 없습니다.</TableMessageRow>
            ) : (
              pagedJobLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-indigo-600">#{log.jobId}</td>
                  <td className="px-6 py-4 text-sm text-gray-800 max-w-[150px] truncate" title={log.bookTitle}>
                    {log.bookTitle}
                  </td>
                  <td className="px-6 py-4 text-xs font-bold text-gray-500">{log.step}</td>
                  <td className="px-6 py-4 text-sm text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.level === "ERROR"
                          ? "bg-red-100 text-red-700"
                          : log.level === "WARN"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-blue-50 text-blue-600"
                      }`}
                    >
                      {log.level}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-[300px] truncate" title={log.message}>
                    {log.message}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">{formatDateTime(log.createdAt)}</td>
                  <td className="px-6 py-4 text-sm text-center">
                    {log.payloadJson && (
                      <button
                        type="button"
                        onClick={() => setSelectedLogPayload(log.payloadJson)}
                        className="text-gray-400 hover:text-indigo-600"
                        aria-label={`로그 #${log.id} payload 보기`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filteredJobLogs.length > 0 && (
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {logPage * LOG_PAGE_SIZE + 1}–
            {Math.min((logPage + 1) * LOG_PAGE_SIZE, filteredJobLogs.length)} / {filteredJobLogs.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLogPage((p) => Math.max(0, p - 1))}
              disabled={logPage === 0}
              className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              이전
            </button>
            <span className="text-xs text-gray-600">
              {logPage + 1} / {logPageCount}
            </span>
            <button
              type="button"
              onClick={() => setLogPage((p) => Math.min(logPageCount - 1, p + 1))}
              disabled={logPage >= logPageCount - 1}
              className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderUploadSection = () => (
    <div className={SECTION_CARD_CLASS}>
      <SectionCardHeader icon={UploadIcon} title="데이터 업로드" />
      <div className="p-6 space-y-6">
        <div>
          <p className="block text-sm font-medium text-gray-700 mb-2">업로드 타입</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" role="radiogroup" aria-label="업로드 타입">
            {UPLOAD_ACTIONS.map((item) => {
              const active = item.endpoint === selectedUpload.endpoint;
              return (
                <button
                  key={item.endpoint}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => selectUploadType(item.endpoint)}
                  className={`px-3 py-3 rounded-lg border text-left text-sm transition-colors ${
                    active
                      ? "border-indigo-400 bg-indigo-50 text-indigo-800"
                      : "border-gray-200 bg-white text-gray-700 hover:border-indigo-200"
                  }`}
                >
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-[11px] text-gray-400 mt-1">
                    {item.mode === "single" ? "단일 파일" : "다중 파일"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
            <p className="font-medium mb-1">
              {selectedUpload.label} · {selectedUpload.hint}
            </p>
            <p className="text-xs text-indigo-800/80 leading-relaxed">{selectedUpload.schema}</p>
            <p className="text-[11px] text-indigo-700/70 mt-2">타입을 바꾸면 선택한 파일 목록이 초기화됩니다.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">파일 선택</label>
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-xl transition-colors ${
              dragActive ? "border-indigo-400 bg-indigo-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
            }`}
          >
            <div className="space-y-1 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="flex text-sm text-gray-600 justify-center">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 p-1"
                >
                  파일 선택
                </button>
                <p className="pl-1 pt-1">또는 드래그 앤 드롭</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple={selectedUpload.mode === "multiple"}
                accept=".json,application/json"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
                className="sr-only"
              />
              <p className="text-xs text-gray-500 mt-2">
                JSON만 허용 · 현재 {selectedUpload.mode === "single" ? "1개" : "여러 개"} 필요
              </p>
            </div>
          </div>
          {files.length > 0 && (
            <ul className="mt-3 space-y-1">
              {files.map((file, idx) => (
                <li
                  key={`${fileKey(file)}-${idx}`}
                  className="flex items-center justify-between text-sm bg-indigo-50 text-indigo-800 px-3 py-1.5 rounded-lg"
                >
                  <span className="truncate mr-2">{file.name}</span>
                  <button type="button" onClick={() => removeFile(idx)} className="text-xs font-bold text-indigo-600 hover:text-indigo-900">
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => uploadFiles(selectedUpload.endpoint, selectedUpload.mode)}
          disabled={isAction(`upload-${selectedUpload.endpoint}`)}
          className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {isAction(`upload-${selectedUpload.endpoint}`)
            ? "업로드 중..."
            : `${selectedUpload.label} 업로드`}
        </button>
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
          <strong>경고:</strong> 데이터베이스에서 영구적으로 삭제됩니다. 확인 모달에서 대상을 다시 검토하세요.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DELETE_ACTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => requestDelete(item)}
              disabled={isAction("delete")}
              className="flex flex-col items-start p-4 bg-white border border-red-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors text-left disabled:opacity-50"
            >
              <span className="font-medium text-red-700">{item.label}</span>
              <span className="text-xs text-red-400 mt-1">{item.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const tabTitle = navItems.find((item) => item.id === activeTab)?.label ?? "";

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {renderNav()}

      <div className="flex-1 overflow-auto flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-2 -ml-1 rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label="메뉴 열기"
            aria-expanded={mobileNavOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate">{tabTitle}</p>
            <p className="text-[11px] text-gray-500 truncate">관리자 대시보드</p>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6 w-full">
          <div className="mb-4 md:mb-8 hidden md:block">
            <h1 className="text-2xl font-bold text-gray-900">{tabTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">시스템 데이터를 관리하고 제어합니다.</p>
          </div>

          {activeTab === "upload" && renderUploadParams()}
          {activeTab === "delete" && renderDeleteParams()}

          {activeTab === "dashboard" && renderDashboard()}
          {activeTab === "books" && renderBooksSection()}
          {activeTab === "normalization" && renderNormalizationSection()}
          {activeTab === "logs" && renderLogsSection()}
          {activeTab === "upload" && renderUploadSection()}
          {activeTab === "delete" && renderDeleteSection()}

          <ResultPanel feedback={feedback} onDismiss={() => setFeedback(null)} loading={showPanelLoading} />
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="삭제 확인"
        confirmLabel="영구 삭제"
        onConfirm={executeDelete}
        onCancel={closeDeleteTarget}
        loading={isAction("delete")}
        danger
      >
        <p>
          <strong>{deleteTarget?.label}</strong> 작업을 실행합니다. 이 작업은 되돌릴 수 없습니다.
        </p>
        <ul className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-1 text-red-800">
          <li>대상: {deleteTarget?.desc}</li>
          <li>
            Book ID: <strong>{bookId || "—"}</strong>
            {selectedParamBook ? ` (${selectedParamBook.title})` : ""}
          </li>
          {deleteTarget?.needs.includes("chapterIdx") && (
            <li>
              챕터 번호: <strong>{chapterIdx || "—"}</strong>
            </li>
          )}
          {deleteTarget?.needs.includes("eventIdx") && (
            <li>
              이벤트 번호: <strong>{eventIdx || "—"}</strong>
            </li>
          )}
        </ul>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ""}
        confirmLabel={confirmDialog?.confirmLabel || "확인"}
        onConfirm={runConfirmDialog}
        onCancel={closeConfirmDialog}
        loading={Boolean(loadingAction && confirmDialog)}
        danger={confirmDialog?.danger}
      >
        <p>{confirmDialog?.message}</p>
      </ConfirmModal>

      <ImageZoomModal src={zoomedImage} onClose={() => setZoomedImage(null)} />
      <PayloadModal payload={selectedLogPayload} onClose={() => setSelectedLogPayload(null)} />
    </div>
  );
};

export default AdminPage;
