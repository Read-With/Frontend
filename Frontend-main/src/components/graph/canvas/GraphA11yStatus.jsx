/** 그래프 캔버스 스크린리더 요약 (aria-live) */

import { useMemo } from 'react';
import { getCharacterFilterStageLabel, pickCharacterDisplayName } from '../../../utils/graph/graphCore.js';
import { isGraphEdgeElement } from '../../../utils/graph/graphCore';

function countGraphElements(elements) {
  if (!Array.isArray(elements)) return { nodeCount: 0, edgeCount: 0 };
  const edgeCount = elements.filter(isGraphEdgeElement).length;
  return { nodeCount: elements.length - edgeCount, edgeCount };
}

function describeGraphSelection(activeTooltip) {
  if (!activeTooltip) return '';

  if (activeTooltip.type === 'node') {
    const name =
      pickCharacterDisplayName(activeTooltip)
      || pickCharacterDisplayName(activeTooltip.data)
      || '이름 없음';
    return `인물 ${name} 상세가 열렸습니다.`;
  }

  if (activeTooltip.type === 'edge') {
    const src = pickCharacterDisplayName(activeTooltip.sourceEndpoint) || '인물';
    const tgt = pickCharacterDisplayName(activeTooltip.targetEndpoint) || '인물';
    return `${src}와 ${tgt}의 관계 상세가 열렸습니다.`;
  }

  return '';
}

function describeLocation(chapterLabel, eventNum) {
  const num = Number(eventNum);
  const eventLabel = num > 0 ? `이벤트 ${num}` : '이벤트 미확정';
  return `${chapterLabel || '챕터'}, ${eventLabel}.`;
}

/** 검색 중이 아니면 빈 문자열 */
function describeSearch(isSearchActive, searchTerm, nodeCount) {
  const term = typeof searchTerm === 'string' ? searchTerm.trim() : '';
  if (!isSearchActive || !term) return '';
  return nodeCount === 0 ? `"${term}" 검색 결과가 없습니다.` : `"${term}" 검색이 적용되었습니다.`;
}

/** 로딩 · 위치 · 개수 · 필터 · 검색 · 선택(없으면 조작 안내) 순으로 한 문단 */
function buildGraphA11ySummary({
  chapterLabel,
  eventNum,
  nodeCount,
  edgeCount,
  filterLabel,
  isSearchActive,
  searchTerm,
  selectionText,
  isLoading,
}) {
  return [
    isLoading ? '그래프를 불러오는 중입니다.' : '',
    describeLocation(chapterLabel, eventNum),
    `인물 ${nodeCount}명, 관계 ${edgeCount}개.`,
    filterLabel ? `표시 범위 ${filterLabel}.` : '',
    describeSearch(isSearchActive, searchTerm, nodeCount),
    selectionText || '화살표·Enter로 탐색. Escape로 해제.',
  ].filter(Boolean).join(' ');
}

/**
 * 그래프 캔버스용 스크린리더 요약 (시각적으로 숨김, aria-live)
 * 부모 region에 aria-describedby={statusId} 연결
 */
export default function GraphA11yStatus({
  id,
  chapterLabel,
  eventNum,
  elements = [],
  filterStage = 0,
  isSearchActive = false,
  searchTerm = '',
  activeTooltip = null,
  isLoading = false,
  liveAnnouncement = '',
}) {
  const summary = useMemo(() => {
    const { nodeCount, edgeCount } = countGraphElements(elements);
    return buildGraphA11ySummary({
      chapterLabel,
      eventNum,
      nodeCount,
      edgeCount,
      filterLabel: getCharacterFilterStageLabel(filterStage) ?? '전체',
      isSearchActive,
      searchTerm,
      selectionText: describeGraphSelection(activeTooltip),
      isLoading,
    });
  }, [
    chapterLabel,
    eventNum,
    elements,
    filterStage,
    isSearchActive,
    searchTerm,
    activeTooltip,
    isLoading,
  ]);

  return (
    <>
      <p id={id} className="sr-only" aria-live="polite" aria-atomic="true">
        {summary}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </p>
    </>
  );
}
