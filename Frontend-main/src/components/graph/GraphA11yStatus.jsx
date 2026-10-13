/** 그래프 캔버스 스크린리더 요약 (aria-live) */

import { useId, useMemo } from 'react';
import { getCharacterFilterStageLabel, isGraphEdgeElement } from '../../utils/graph/graphCore.js';

function countGraphElements(elements) {
  if (!Array.isArray(elements)) return { nodeCount: 0, edgeCount: 0 };
  const edgeCount = elements.filter(isGraphEdgeElement).length;
  return { nodeCount: elements.length - edgeCount, edgeCount };
}

function describeGraphSelection(activeTooltip) {
  if (!activeTooltip) return '';

  if (activeTooltip.type === 'node') {
    const name =
      activeTooltip.common_name
      || activeTooltip.name
      || activeTooltip.label
      || activeTooltip.data?.common_name
      || activeTooltip.data?.name
      || activeTooltip.data?.label
      || '이름 없음';
    return `인물 ${name} 상세가 열렸습니다.`;
  }

  if (activeTooltip.type === 'edge') {
    const src =
      activeTooltip.sourceEndpoint?.label
      || activeTooltip.sourceEndpoint?.common_name
      || '인물';
    const tgt =
      activeTooltip.targetEndpoint?.label
      || activeTooltip.targetEndpoint?.common_name
      || '인물';
    return `${src}와 ${tgt}의 관계 상세가 열렸습니다.`;
  }

  return '';
}

function buildGraphA11ySummary({
  chapterLabel,
  eventNum,
  nodeCount = 0,
  edgeCount = 0,
  filterLabel,
  isSearchActive = false,
  searchTerm = '',
  selectionText = '',
  isLoading = false,
}) {
  const parts = [];

  if (isLoading) {
    parts.push('그래프를 불러오는 중입니다.');
  }

  const chapter = chapterLabel || '챕터';
  const eventLabel =
    Number.isFinite(Number(eventNum)) && Number(eventNum) > 0
      ? `이벤트 ${Number(eventNum)}`
      : '이벤트 미확정';
  parts.push(`${chapter}, ${eventLabel}.`);
  parts.push(`인물 ${nodeCount}명, 관계 ${edgeCount}개.`);

  if (filterLabel) {
    parts.push(`표시 범위 ${filterLabel}.`);
  }

  const term = typeof searchTerm === 'string' ? searchTerm.trim() : '';
  if (isSearchActive && term) {
    parts.push(
      nodeCount === 0
        ? `"${term}" 검색 결과가 없습니다.`
        : `"${term}" 검색이 적용되었습니다.`,
    );
  }

  if (selectionText) {
    parts.push(selectionText);
  } else {
    parts.push('화살표·Enter로 탐색. Escape로 해제.');
  }

  return parts.join(' ');
}

/**
 * 그래프 캔버스용 스크린리더 요약 (시각적으로 숨김, aria-live)
 * 부모 region에 aria-describedby={statusId} 연결
 */
export default function GraphA11yStatus({
  id: idProp = null,
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
  const generatedId = useId();
  const statusId = idProp || generatedId;

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
      <p id={statusId} className="sr-only" aria-live="polite" aria-atomic="true">
        {summary}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </p>
    </>
  );
}
