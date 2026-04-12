/**
 * 뷰어 서버 진도(getBookProgress)만 콘솔에 남김.
 * 켜기: localStorage.setItem('DEBUG_SERVER_PROGRESS','1'); location.reload()
 * 끄기: localStorage.removeItem('DEBUG_SERVER_PROGRESS'); location.reload()
 */
export function logServerBookProgress(payload) {
  try {
    if (globalThis.localStorage?.getItem('DEBUG_SERVER_PROGRESS') !== '1') return;
    console.info('[서버 진도]', payload);
  } catch {
    /* ignore */
  }
}
