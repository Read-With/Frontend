/** 가시 블록 data-chapter-index / data-block-index 확인용
 * 켜기: localStorage.setItem('DEBUG_XHTML_BLOCKS','1'); location.reload()
 * 끄기: localStorage.removeItem('DEBUG_XHTML_BLOCKS'); location.reload()
 */
export function isXhtmlBlocksDebug() {
  try {
    return globalThis.localStorage?.getItem('DEBUG_XHTML_BLOCKS') === '1';
  } catch {
    return false;
  }
}
