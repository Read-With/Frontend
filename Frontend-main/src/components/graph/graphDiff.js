// 그래프 diff 계산 유틸 (id 기준)
export function calcGraphDiff(prevElements, currElements) {
  prevElements = Array.isArray(prevElements) ? prevElements : [];
  currElements = Array.isArray(currElements) ? currElements : [];

  // id가 undefined/null인 경우도 방어
  const prevIds = new Set(prevElements.map(e => String(e.data && e.data.id)).filter(Boolean));
  const currIds = new Set(currElements.map(e => String(e.data && e.data.id)).filter(Boolean));

  // added: 현재에만 있는 id
  const added = [...currIds].filter(id => !prevIds.has(id));
  // removed: 이전엔 있지만 현재엔 없는 id
  const removed = [...prevIds].filter(id => !currIds.has(id));
  // updated: added + removed
  const updated = [...added, ...removed];

  return { added, removed, updated };
} 