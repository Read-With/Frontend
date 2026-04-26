/**
 * URL / localStorage 의 graphMode 문자열을 뷰어 UI 플래그로 변환
 * @param {string|null|undefined} mode
 * @returns {{ fullScreen: boolean, show: boolean } | null}
 */
export function flagsFromGraphMode(mode) {
  if (mode === 'graph') return { fullScreen: true, show: true };
  if (mode === 'split') return { fullScreen: false, show: true };
  if (mode === 'viewer') return { fullScreen: false, show: false };
  return null;
}
