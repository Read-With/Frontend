// 그래프 diff 계산 유틸 (position까지 비교)
export function calcGraphDiff(prevElements, currElements) {
  if (!prevElements || !currElements) return { added: [], removed: [], updated: [] }; // prevElements 또는 currElements가 undefined인 경우 처리
  
  // id가 없는 요소는 필터링
  const validPrevElements = prevElements.filter(e => e && e.id);
  const validCurrElements = currElements.filter(e => e && e.id);
  
  const prevMap = new Map(validPrevElements.map(e => [e.id, e]));
  const currMap = new Map(validCurrElements.map(e => [e.id, e]));

  // 추가: 현재엔 있지만 이전엔 없는 id
  const added = validCurrElements.filter(e => !prevMap.has(e.id));
  // 삭제: 이전엔 있지만 현재엔 없는 id
  const removed = validPrevElements.filter(e => !currMap.has(e.id));
  // 수정: id는 같지만 data 또는 position이 다름
  const updated = validCurrElements.filter(e => {
    const prev = prevMap.get(e.id);
    if (!prev) return false;
    // data 비교
    const dataChanged = JSON.stringify(prev) !== JSON.stringify(e);
    // position 비교 (둘 다 있으면 좌표까지 비교, 없으면 무시)
    const pos1 = prev.position;
    const pos2 = e.position;
    const posChanged = pos1 && pos2
      ? pos1.x !== pos2.x || pos1.y !== pos2.y
      : false;
    return dataChanged || posChanged;
  });

  return { added, removed, updated };
} 