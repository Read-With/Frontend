// 그래프 diff 계산 유틸 (position까지 비교)
export function calcGraphDiff(prevElements, currElements) {
  const prevMap = new Map(prevElements.map(e => [e.data.id, e]));
  const currMap = new Map(currElements.map(e => [e.data.id, e]));

  // 추가: 현재엔 있지만 이전엔 없는 id
  const added = currElements.filter(e => !prevMap.has(e.data.id));
  // 삭제: 이전엔 있지만 현재엔 없는 id
  const removed = prevElements.filter(e => !currMap.has(e.data.id));
  // 수정: id는 같지만 data 또는 position이 다름
  const updated = currElements.filter(e => {
    const prev = prevMap.get(e.data.id);
    if (!prev) return false;
    // data 비교
    const dataChanged = JSON.stringify(prev.data) !== JSON.stringify(e.data);
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