import { memo, useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useFloatingTooltip } from "../../../hooks/ui/tooltipHooks";
import { useRelationData } from "../../../hooks/graph/useApiGraphData";
import { getPositivityDisplay, getRelationColor } from "../../../utils/styles/graphStyles";
import { ANIMATION_VALUES, mergeRefs } from "../../../utils/styles/styles";
import { toPositivityOrNull, toNumberOrNull, toPositiveNumberOrNull } from "../../../utils/common/valueUtils";
import { buildRelationTagDisplayItems } from "../../../utils/graph/graphCore";
import { buildEdgeRechartsLineData } from "../../../utils/graph/graphCharts";
import { TooltipCloseButton, NodeTooltipShell } from './GraphTooltipParts';
import RelationTimelineChart from './RelationTimelineChart';

const NO_RELATION_MESSAGE = '이 위치에서는 표시할 관계가 없습니다.';

const VIEW_TABS = [
  { id: 'info', label: '요약' },
  { id: 'chart', label: '변화' },
];

const TAG_TONE_TITLE = {
  added: '이 위치에서 처음 추가된 관계',
  changed: '이 위치에서 갱신된 관계',
  prior: '이전에 추가된 관계',
};

function EndpointAvatar({ endpoint }) {
  const label = endpoint?.label || '?';
  if (endpoint?.image) {
    return (
      <img
        className="edge-tooltip-endpoint-avatar"
        src={endpoint.image}
        alt={label}
        crossOrigin="anonymous"
        decoding="async"
        loading="eager"
      />
    );
  }
  return (
    <div className="edge-tooltip-endpoint-avatar" aria-hidden>
      {label.charAt(0)}
    </div>
  );
}

/** "주요 문장|보충 설명" 형식 */
function parseExplanation(explanation) {
  if (typeof explanation !== 'string' || !explanation) {
    return { hasExplanation: false, primary: null, secondary: null };
  }
  const [primary, secondary] = explanation.split('|');
  return { hasExplanation: true, primary: primary ?? '', secondary: secondary || null };
}

function EdgeEndpoints({ data, sourceEndpoint, targetEndpoint }) {
  return (
    <div className="edge-tooltip-endpoints">
      <div className="edge-tooltip-endpoint">
        <EndpointAvatar endpoint={sourceEndpoint} />
        <span className="edge-tooltip-endpoint-name">
          {sourceEndpoint?.label || data?.source || '—'}
        </span>
      </div>
      <span className="edge-tooltip-endpoint-arrow" aria-hidden>→</span>
      <div className="edge-tooltip-endpoint">
        <EndpointAvatar endpoint={targetEndpoint} />
        <span className="edge-tooltip-endpoint-name">
          {targetEndpoint?.label || data?.target || '—'}
        </span>
      </div>
    </div>
  );
}

function EdgeViewTabs({ viewMode, onChange }) {
  return (
    <div className="edge-tooltip-tabs" role="tablist">
      {VIEW_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={viewMode === id}
          className={`edge-tooltip-tab${viewMode === id ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
      <span
        className={`edge-tooltip-tab-indicator${viewMode === 'chart' ? ' chart' : ''}`}
        aria-hidden
      />
    </div>
  );
}

function EdgeStatusMessage({ message, error = false, action = null }) {
  return (
    <div className={`edge-tooltip-status${error ? ' edge-tooltip-status--error' : ' edge-tooltip-status--muted'}`}>
      <span>{message}</span>
      {action}
    </div>
  );
}

function EdgeSkeleton({ message }) {
  return (
    <div className="edge-tooltip-status">
      <span>{message}</span>
      <div className="edge-tooltip-skeleton">
        <div className="edge-tooltip-skeleton-line" />
        <div className="edge-tooltip-skeleton-line short" />
        <div className="edge-tooltip-skeleton-line" />
      </div>
    </div>
  );
}

function RetryButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="edge-tooltip-retry-btn">
      다시 시도
    </button>
  );
}

function EdgeInfoView({ showNoRelation, tagItems, positivityDisplay, positivityPercentage, explanation }) {
  if (showNoRelation) return <EdgeStatusMessage message={NO_RELATION_MESSAGE} />;

  return (
    <>
      {tagItems.length > 0 && (
        <div className="relation-tags">
          {tagItems.map((item, index) => (
            <span
              key={`${item.text}-${index}`}
              className={`relation-tag relation-tag--${item.tone}`}
              style={{ '--tag-color': getRelationColor(item.positivity) }}
              title={TAG_TONE_TITLE[item.tone] || TAG_TONE_TITLE.prior}
            >
              {item.text}
            </span>
          ))}
        </div>
      )}
      <div className="relation-weight">
        <div className="weight-header">
          <span className="weight-label">{positivityDisplay.label}</span>
          <span className="weight-value">
            {positivityPercentage != null ? `${positivityPercentage}%` : '—'}
          </span>
        </div>
        {positivityPercentage != null && (
          <div className="positivity-track">
            <div className="positivity-fill" />
          </div>
        )}
      </div>
      {explanation.hasExplanation && (
        <div className="edge-tooltip-body">
          <div className="relation-explanation">
            <div className="quote-box">
              <strong>{explanation.primary}</strong>
            </div>
            {explanation.secondary && (
              <p className="explanation-text">{explanation.secondary}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function incompleteHintText(incomplete, usedProbe) {
  if (!incomplete) {
    return '챕터 구조 정보가 없어 이벤트 범위를 추정했습니다. 결과가 부정확할 수 있습니다.';
  }
  return `일부 이벤트를 불러오지 못했습니다.${usedProbe ? ' 이벤트 범위는 추정값입니다.' : ''}`;
}

function EdgeChartPanel({ relation, chart, title, missingEvent, heightPx, isSidebar, color }) {
  if (relation.loading) return <EdgeSkeleton message="데이터를 불러오는 중..." />;
  if (missingEvent) {
    return <EdgeStatusMessage message="이벤트 정보가 없어 관계 변화를 표시할 수 없습니다." />;
  }
  // 로드 실패는 단점 합성보다 항상 우선
  if (relation.error) {
    return (
      <EdgeStatusMessage
        message="데이터를 불러올 수 없습니다"
        error
        action={<RetryButton onClick={relation.fetchData} />}
      />
    );
  }
  if (!chart.hasChartData) return <EdgeStatusMessage message={NO_RELATION_MESSAGE} />;

  return (
    <div className="edge-chart-panel">
      <div className="edge-chart-title">{title}</div>
      {(relation.incomplete || relation.usedProbe) && (
        <p className="edge-chart-incomplete-hint">
          {incompleteHintText(relation.incomplete, relation.usedProbe)}
          {' '}
          <RetryButton onClick={relation.fetchData} />
        </p>
      )}
      <RelationTimelineChart
        lineData={chart.rechartsLineData}
        numericPointCount={chart.numericPointCount}
        heightPx={heightPx}
        isSidebar={isSidebar}
        color={color}
      />
    </div>
  );
}

/** 툴팁·사이드바 공통 데이터: 관계 타임라인 조회 · 태그 · 긍정도 · 차트 */
function useEdgeDetailModel({ data, isViewer, currentChapter, eventNum, bookId }) {
  const { filename } = useParams();
  const edge = data ?? {};

  const displayEventNum = toPositiveNumberOrNull(eventNum) ?? 0;
  const numericBookId = useMemo(
    () => toPositiveNumberOrNull(bookId) ?? toPositiveNumberOrNull(filename),
    [bookId, filename],
  );

  const relation = useRelationData(
    isViewer ? 'viewer' : 'cumulative',
    toNumberOrNull(edge.source),
    toNumberOrNull(edge.target),
    currentChapter,
    displayEventNum,
    numericBookId,
  );

  const edgePositivity = useMemo(() => toPositivityOrNull(edge.positivity), [edge.positivity]);

  const relationTagItems = useMemo(
    () =>
      buildRelationTagDisplayItems({
        relation: edge.relation,
        label: edge.label,
        labelHistory: edge.labelHistory,
        latestLabels: edge.latestLabels,
        currentEventId: edge.snapshotEventId ?? edge.latestEventId ?? null,
        fallbackPositivity: edgePositivity,
      }),
    [
      edge.relation,
      edge.label,
      edge.labelHistory,
      edge.latestLabels,
      edge.snapshotEventId,
      edge.latestEventId,
      edgePositivity,
    ]
  );

  const explanation = useMemo(() => parseExplanation(edge.explanation), [edge.explanation]);

  // 뷰어는 현재 이벤트까지만 열 표시
  const effectiveEventColumns = isViewer && displayEventNum > 0 ? displayEventNum : Number.POSITIVE_INFINITY;

  const chart = useMemo(
    () =>
      buildEdgeRechartsLineData({
        timeline: relation.timeline,
        labels: relation.labels,
        edgePositivity,
        displayEventNum,
        isViewer,
        effectiveEventColumns,
        relationError: relation.error,
      }),
    [
      relation.timeline,
      relation.labels,
      edgePositivity,
      displayEventNum,
      isViewer,
      effectiveEventColumns,
      relation.error,
    ],
  );

  const hasCurrentEdgeRelationData =
    relationTagItems.length > 0 ||
    edgePositivity != null ||
    (typeof edge.explanation === 'string' && edge.explanation.trim().length > 0);
  const effectiveNoRelation =
    relation.noRelation && !hasCurrentEdgeRelationData && !chart.hasChartData && !relation.error;

  const positivityDisplay = getPositivityDisplay(edgePositivity);
  const positivityPercentage = edgePositivity != null ? positivityDisplay.percent : null;
  const positivityBarWidth =
    positivityPercentage != null ? Math.min(100, Math.abs(positivityPercentage)) : 0;

  const infoView = (
    <EdgeInfoView
      showNoRelation={isViewer && effectiveNoRelation}
      tagItems={relationTagItems}
      positivityDisplay={positivityDisplay}
      positivityPercentage={positivityPercentage}
      explanation={explanation}
    />
  );
  const renderChartPanel = (heightPx) => (
    <EdgeChartPanel
      relation={relation}
      chart={chart}
      title={isViewer ? `챕터 ${currentChapter} 관계 변화` : `챕터 ${currentChapter}까지의 누적 관계 변화`}
      missingEvent={isViewer && displayEventNum <= 0}
      heightPx={heightPx}
      isSidebar={!isViewer}
      color={positivityDisplay.color}
    />
  );

  return { edge, infoView, renderChartPanel, color: positivityDisplay.color, positivityBarWidth };
}

/** 닫기 버튼 + 긍정도 테마 + 양 끝 인물 헤더. children은 본문 패널 */
function EdgeDetailFrame({ model, data, sourceEndpoint, targetEndpoint, onClose, closeLabel, contentClassName, children }) {
  return (
    <>
      <TooltipCloseButton onClose={onClose} ariaLabel={closeLabel} />
      <div
        className={contentClassName}
        style={{ '--rel-color': model.color, '--pos-width': `${model.positivityBarWidth}%` }}
      >
        <div className="edge-tooltip-header">
          <EdgeEndpoints data={data} sourceEndpoint={sourceEndpoint} targetEndpoint={targetEndpoint} />
        </div>
        {children}
      </div>
    </>
  );
}

/** 그래프 페이지 사이드바: 요약과 누적 변화 차트를 함께 표시 */
function EdgeDetailSidebar({ data, onClose, currentChapter = 1, eventNum = 1, bookId = null, sourceEndpoint = null, targetEndpoint = null }) {
  const model = useEdgeDetailModel({ data, isViewer: false, currentChapter, eventNum, bookId });
  return (
    <div
      className="graph-sidebar-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      tabIndex={0}
    >
      <EdgeDetailFrame
        model={model}
        data={data}
        sourceEndpoint={sourceEndpoint}
        targetEndpoint={targetEndpoint}
        onClose={onClose}
        closeLabel="사이드바 닫기"
        contentClassName="edge-tooltip-content edge-tooltip-themed edge-tooltip-content--sidebar"
      >
        <div className="edge-tooltip-panel edge-tooltip-panel--sidebar">
          {model.infoView}
          {model.renderChartPanel(240)}
        </div>
      </EdgeDetailFrame>
    </div>
  );
}

/** 뷰어 플로팅 툴팁: 요약/변화 탭 전환, 드래그·바깥 클릭 닫기 */
function EdgeDetailTooltip({
  data,
  x,
  y,
  onClose,
  currentChapter = 1,
  eventNum = 1,
  bookId = null,
  sourceEndpoint = null,
  targetEndpoint = null,
  tooltipBoundsRef = null,
}) {
  const model = useEdgeDetailModel({ data, isViewer: true, currentChapter, eventNum, bookId });
  const { edge } = model;

  const { position, showContent, isDragging, tooltipRef, handleMouseDown, clickOutsideRef } =
    useFloatingTooltip(x, y, {
      enabled: true,
      center: edge.edgeCenter,
      boundsRef: tooltipBoundsRef,
      onClose,
    });

  const [viewMode, setViewMode] = useState("info");

  useEffect(() => {
    setViewMode("info");
  }, [edge.id, edge.source, edge.target]);

  return (
    <NodeTooltipShell
      shellRef={mergeRefs(tooltipRef, clickOutsideRef)}
      className="edge-tooltip-container"
      position={position}
      showContent={showContent}
      isDragging={isDragging}
      handleMouseDown={handleMouseDown}
      transition={isDragging ? 'none' : `opacity ${ANIMATION_VALUES.DURATION.NORMAL} ease-in-out`}
    >
      <EdgeDetailFrame
        model={model}
        data={data}
        sourceEndpoint={sourceEndpoint}
        targetEndpoint={targetEndpoint}
        onClose={onClose}
        contentClassName="edge-tooltip-content edge-tooltip-themed"
      >
        <EdgeViewTabs viewMode={viewMode} onChange={setViewMode} />
        <div className="edge-tooltip-panel">
          <div key={viewMode} className="edge-tooltip-panel-swap">
            {viewMode === 'info' ? model.infoView : model.renderChartPanel(280)}
          </div>
        </div>
      </EdgeDetailFrame>
    </NodeTooltipShell>
  );
}

/** variant: 'graphPage'(사이드바) | 'viewer'(플로팅 툴팁) */
function EdgeDetail({ variant = 'graphPage', ...props }) {
  return variant === 'graphPage' ? <EdgeDetailSidebar {...props} /> : <EdgeDetailTooltip {...props} />;
}

export default memo(EdgeDetail);
