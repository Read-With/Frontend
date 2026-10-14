import { lazy, memo, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  GRAPH_LAYOUT_CONSTANTS,
  buildProcessedNode,
  resolvePovSummary,
  resolveRelationConnectionKind,
  clearPovSpoilerSession,
  NODE_TOOLTIP_VIEW_STATUS,
} from "../../../utils/graph/graphCore";
import { checkNodeAppearance, buildRadarChartData } from "../../../utils/graph/graphCharts.js";
import { useFloatingTooltip } from "../../../hooks/ui/tooltipHooks";
import { getUnifiedEventInfoForTooltip } from "../../../utils/viewer/viewerSession";
import { extractApiBookId } from "../../../utils/common/valueUtils";
import { mergeRefs, nodeDetailAnimations } from "../../../utils/styles/styles.js";
import { GRAPH_COLORS } from "../../../utils/styles/graphStyles.js";
import {
  PersonSilhouette,
  TooltipCloseButton,
  ActionButton,
  NodeTooltipShell,
  CenteredStatus,
  NodeProfileAvatar,
} from './GraphTooltipParts';

const RelationAnalysisModal = lazy(() => import('./RelationAnalysisModal'));

const SUMMARY = { COLLAPSED: 'collapsed', WARNING: 'warning', CONTENT: 'content' };

function RelationAnalysisCta({
  node,
  connectionCount,
  onOpen,
  buttonRef,
}) {
  return (
    <div
      className="sidebar-section tooltip-analysis-section"
      role="region"
      aria-label="관계 분석"
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        className="relation-analysis-btn"
      >
        <div className="tooltip-analysis-copy">
          <h4 className="tooltip-section-title">
            인물 관계 분석
            <span className="tooltip-analysis-badge">관계 {connectionCount}</span>
          </h4>
          <p className="tooltip-analysis-desc">
            {node?.displayName}와 연결된 인물과의 관계를 시각화합니다
          </p>
        </div>
        <span className="tooltip-analysis-cta-label">분석 보기</span>
      </button>
    </div>
  );
}

/** 미등장 안내 문구 (이벤트 이름 → 번호 → 챕터 순) */
function formatNotAppearedHint(eventInfo, currentChapter) {
  if (eventInfo.name) return `챕터 ${currentChapter} 이벤트 "${eventInfo.name}"에서는 등장하지 않습니다`;
  if (eventInfo.eventNum) return `챕터 ${currentChapter} 이벤트 ${eventInfo.eventNum}에서는 등장하지 않습니다`;
  return `챕터 ${currentChapter}에서는 등장하지 않습니다`;
}

function NodeIdentity({ node }) {
  return (
    <>
      <div className="node-tooltip-header">
        <NodeProfileAvatar node={node} />
        <div className="node-tooltip-identity">
          <div className="node-tooltip-name-row">
            <span className="node-tooltip-name">{node?.displayName}</span>
            {node?.isMainCharacter && (
              <span className="node-tooltip-badge">주요 인물</span>
            )}
          </div>
          {node?.names?.length > 0 && (
            <div className="node-tooltip-aliases">
              {node.names
                .filter((name) => name !== node.common_name)
                .map((name, i) => (
                  <span key={i} className="relation-tag">{name}</span>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className="business-card-description">
        {node?.description ? (
          <span>{node.description}</span>
        ) : (
          <span className="tooltip-desc-empty">설명 정보가 없습니다.</span>
        )}
      </div>
    </>
  );
}

/** 등장 여부 확인 실패 (툴팁 전용 — 사이드바는 등장 검사를 하지 않음) */
function NodeErrorView({ error, onClose, shellRef, position }) {
  return (
    <NodeTooltipShell
      shellRef={shellRef}
      className="graph-node-tooltip error"
      position={position}
    >
      <div className="tooltip-error-block">
        <h4 className="tooltip-error-title">오류가 발생했습니다</h4>
        <p className="tooltip-error-msg">{error}</p>
        <button type="button" onClick={onClose} className="tooltip-error-close-btn">
          닫기
        </button>
      </div>
    </NodeTooltipShell>
  );
}

/** 인물 시점 요약: 접힘 → 스포일러 경고 → 본문 */
function PovSummarySection({ title, stage, onToggle, onCollapse, onConfirm, text, status, onRetry }) {
  const isWarning = stage === SUMMARY.WARNING;
  const isContent = stage === SUMMARY.CONTENT;
  const isError = status === NODE_TOOLTIP_VIEW_STATUS.ERROR;
  const isLoading = status === NODE_TOOLTIP_VIEW_STATUS.LOADING;
  const isPending = status === NODE_TOOLTIP_VIEW_STATUS.PENDING;
  const fading = isWarning ? ' is-fading' : '';
  const stageClass = isWarning ? 'warning' : isContent ? 'content' : 'collapsed';
  const textClass = `tooltip-summary-text${isContent ? ' is-animated' : ''}${
    isError ? ' tooltip-summary-text--error' : ''
  }${isPending ? ' tooltip-summary-text--pending' : ''}`;

  return (
    <div
      className={`sidebar-section tooltip-summary-section tooltip-summary-section--${stageClass}`}
      role="region"
      aria-label="인물 시점 요약"
    >
      <button type="button" onClick={onToggle} className="summary-toggle-btn">
        <h4 className="tooltip-section-title">{title}</h4>
        <span
          className={`tooltip-summary-chevron${
            stage !== SUMMARY.COLLAPSED ? ' tooltip-summary-chevron--open' : ''
          }`}
        >
          ▼
        </span>
      </button>

      <div className={`tooltip-collapsible tooltip-collapsible--warning${isWarning ? ' is-open' : ''}`}>
        <div className="tooltip-spoiler-body">
          <h3 className={`tooltip-spoiler-title${fading}`}>스포일러 포함</h3>
          <p className={`tooltip-spoiler-text${fading}`}>
            스토리의 중요한 내용을 담고 있습니다.
            <br />
            내용을 확인하시겠습니까?
          </p>
          <div className={`tooltip-spoiler-actions${fading}`}>
            <ActionButton onClick={onCollapse} ariaLabel="접기" title="접기">
              취소
            </ActionButton>
            <ActionButton variant="primary" onClick={onConfirm} ariaLabel="스포일러 내용 확인하기">
              확인하고 보기
            </ActionButton>
          </div>
        </div>
      </div>

      <div
        className={`tooltip-collapsible tooltip-collapsible--content${isContent ? ' is-open' : ''}`}
        aria-hidden={!isContent}
      >
        <div className="tooltip-summary-content">
          <div className="tooltip-summary-quote">
            {isLoading ? (
              <p className="tooltip-summary-text tooltip-summary-text--loading" aria-live="polite">
                <span className="tooltip-summary-spinner" aria-hidden />
                {text}
              </p>
            ) : (
              <p className={textClass}>{text}</p>
            )}
            {isError && onRetry && <ActionButton onClick={onRetry}>다시 시도</ActionButton>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 인물 시점 요약 단계. 스포일러 확인한 노드는 이 인스턴스 동안 바로 본문 */
function usePovSummaryStage(nodeId) {
  const [stage, setStage] = useState(SUMMARY.COLLAPSED);
  const unlockedRef = useRef(new Set());
  const key = nodeId == null || nodeId === '' ? null : String(nodeId);

  useEffect(() => {
    clearPovSpoilerSession();
    setStage(SUMMARY.COLLAPSED);
  }, [nodeId]);

  useEffect(() => () => {
    unlockedRef.current.clear();
    clearPovSpoilerSession();
  }, []);

  const toggle = useCallback(() => {
    setStage((s) => {
      if (s !== SUMMARY.COLLAPSED) return SUMMARY.COLLAPSED;
      return key && unlockedRef.current.has(key) ? SUMMARY.CONTENT : SUMMARY.WARNING;
    });
  }, [key]);

  const collapse = useCallback(() => setStage(SUMMARY.COLLAPSED), []);

  const confirm = useCallback(() => {
    if (key) unlockedRef.current.add(key);
    setStage(SUMMARY.CONTENT);
  }, [key]);

  return { stage, toggle, collapse, confirm };
}

/**
 * 관계 분석 모달 열림 상태. 관련 인물 선택 시 keepAnalysisOpen이면 다음 노드에서도 유지.
 * pendingKeepAnalysisOpenRef: 뷰어처럼 key remount 되어도 유지하기 위한 플래그. 없으면 인스턴스 전용 ref.
 */
function useAnalysisModalState(pendingKeepAnalysisOpenRef, onSelectRelatedNode, nodeId) {
  const ownPendingRef = useRef(false);
  const pendingRef = pendingKeepAnalysisOpenRef || ownPendingRef;
  const [isOpen, setIsOpen] = useState(() => Boolean(pendingRef.current));
  const keepOpenRef = useRef(false);

  useEffect(() => {
    if (pendingRef.current) {
      pendingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (keepOpenRef.current) {
      keepOpenRef.current = false;
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [nodeId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    pendingRef.current = false;
    setIsOpen(false);
  }, [pendingRef]);

  const selectRelatedNode = useCallback((idOrName, options = {}) => {
    keepOpenRef.current = Boolean(options.keepAnalysisOpen);
    pendingRef.current = Boolean(options.keepAnalysisOpen);
    return onSelectRelatedNode(idOrName, options);
  }, [onSelectRelatedNode, pendingRef]);

  return { isOpen, open, close, selectRelatedNode: onSelectRelatedNode ? selectRelatedNode : null };
}

/** 툴팁·사이드바 공통: 노드 가공 · 이벤트 정보 · 시점 요약 섹션 */
function useNodeDetailBase({
  data,
  currentChapter,
  eventNum,
  filename,
  currentEvent = null,
  prevValidEvent = null,
  povSummaries = null,
  povError = null,
  povIsLoading = false,
  povCached = null,
  onRetryPov = null,
  showPovSummary = true,
}) {
  const { filename: urlFilename } = useParams();
  const serverBookId = extractApiBookId(filename || urlFilename);
  const folderKey = serverBookId ? `api:${serverBookId}` : null;
  const node = useMemo(() => buildProcessedNode(data), [data]);
  const summary = usePovSummaryStage(node?.id);

  const eventInfo = useMemo(
    () => getUnifiedEventInfoForTooltip({
      currentEvent,
      prevValidEvent,
      eventNum,
      currentChapter,
    }),
    [currentEvent, prevValidEvent, eventNum, currentChapter],
  );

  // 뷰어 툴팁(showPovSummary=false)에선 요약을 그리지 않으므로 계산도 생략
  const povSummary = useMemo(
    () =>
      showPovSummary
        ? resolvePovSummary(node, currentChapter, povSummaries, povError, {
          isLoading: povIsLoading,
          povCached,
        })
        : null,
    [showPovSummary, node, currentChapter, povSummaries, povError, povIsLoading, povCached],
  );
  const chapterSummaryTitle =
    currentChapter != null && Number(currentChapter) >= 1
      ? `챕터 ${currentChapter} 시점 요약`
      : '해당 인물 시점의 요약';

  const povSummarySection = povSummary && (
    <PovSummarySection
      title={chapterSummaryTitle}
      stage={summary.stage}
      onToggle={summary.toggle}
      onCollapse={summary.collapse}
      onConfirm={summary.confirm}
      text={povSummary.text}
      status={povSummary.status}
      onRetry={typeof onRetryPov === 'function' ? onRetryPov : null}
    />
  );

  return { node, folderKey, eventInfo, povSummarySection };
}

/** 뷰어 플로팅 툴팁: 드래그·바깥 클릭 닫기, 미등장/오류 안내 */
function NodeDetailTooltip(props) {
  const {
    data,
    x,
    y,
    onClose,
    currentChapter,
    elements = [],
    showPovSummary = true,
    tooltipBoundsRef = null,
  } = props;
  const { node, folderKey, eventInfo, povSummarySection } = useNodeDetailBase(props);

  const { position, showContent, isDragging, tooltipRef, handleMouseDown, clickOutsideRef } =
    useFloatingTooltip(x, y, {
      enabled: true,
      center: data?.nodeCenter,
      boundsRef: tooltipBoundsRef,
      onClose,
    });

  const { appeared, error } = useMemo(
    () => checkNodeAppearance({
      data,
      node,
      currentChapter,
      folderKey,
      eventNum: eventInfo.eventNum,
      elements,
    }),
    [data, node, currentChapter, eventInfo, folderKey, elements],
  );

  const floatingShell = {
    shellRef: mergeRefs(tooltipRef, clickOutsideRef),
    position,
    showContent,
    isDragging,
    handleMouseDown,
  };

  if (error) {
    return <NodeErrorView error={error} onClose={onClose} shellRef={tooltipRef} position={position} />;
  }

  if (!appeared) {
    return (
      <NodeTooltipShell
        {...floatingShell}
        className="graph-node-tooltip is-not-appeared"
        transition={nodeDetailAnimations.tooltipSimpleTransition(isDragging)}
        closeButton={(
          <TooltipCloseButton
            onClose={onClose}
            className="tooltip-close-btn--offset"
          />
        )}
      >
        <CenteredStatus fullHeight={false}>
          <div className="tooltip-not-appeared-avatar">
            <PersonSilhouette size={40} bodyFill={GRAPH_COLORS.textSecondary} />
          </div>
          <h3 className="tooltip-not-appeared-title">{node?.displayName}</h3>
          <p className="tooltip-not-appeared-msg">아직 등장하지 않은 인물입니다</p>
          <p className="tooltip-not-appeared-hint">{formatNotAppearedHint(eventInfo, currentChapter)}</p>
        </CenteredStatus>
      </NodeTooltipShell>
    );
  }

  return (
    <NodeTooltipShell
      {...floatingShell}
      transition={nodeDetailAnimations.tooltipComplexTransition(isDragging)}
    >
      <div className="tooltip-content business-card">
        <TooltipCloseButton onClose={onClose} />
        <NodeIdentity node={node} />
        {showPovSummary ? povSummarySection : null}
      </div>
    </NodeTooltipShell>
  );
}

/** 그래프 페이지 사이드바: 시점 요약 + 관계 분석(레이더 모달). 그래프 전용 페이지라 등장 검사 생략 */
function NodeDetailSidebar(props) {
  const {
    onClose,
    currentChapter,
    elements = [],
    showPovSummary = true,
    apiBookGraphData = null,
    onSelectRelatedNode = null,
    chapterRailWidth = null,
    pendingKeepAnalysisOpenRef = null,
  } = props;
  const { node, folderKey, eventInfo, povSummarySection } = useNodeDetailBase(props);
  const modal = useAnalysisModalState(pendingKeepAnalysisOpenRef, onSelectRelatedNode, node?.id);
  const analysisBtnRef = useRef(null);

  const radarResult = useMemo(
    () => buildRadarChartData({
      node,
      currentChapter,
      apiBookGraphData,
      elements,
      folderKey,
      eventNum: eventInfo.eventNum,
    }),
    [node, currentChapter, folderKey, elements, apiBookGraphData, eventInfo],
  );

  const radarChartData = radarResult.items;
  const hasRadarError = radarResult.status === NODE_TOOLTIP_VIEW_STATUS.ERROR;
  const connectionKind = useMemo(
    () => resolveRelationConnectionKind(radarChartData.length, { enabled: true, hasError: hasRadarError }),
    [hasRadarError, radarChartData.length],
  );

  return (
    <div className="graph-sidebar-panel">
      <TooltipCloseButton onClose={onClose} ariaLabel="사이드바 닫기" />

      <div className="graph-sidebar-body">
        <NodeIdentity node={node} />

        {showPovSummary ? povSummarySection : null}

        <RelationAnalysisCta
          node={node}
          connectionCount={radarChartData.length}
          onOpen={modal.open}
          buttonRef={analysisBtnRef}
        />
      </div>

      {modal.isOpen ? (
        <Suspense fallback={<div role="status" aria-live="polite">관계 분석을 불러오는 중…</div>}>
          <RelationAnalysisModal
            node={node}
            radarChartData={radarChartData}
            connectionKind={connectionKind}
            loadError={hasRadarError ? radarResult.error : null}
            onClose={modal.close}
            onSelectRelatedNode={modal.selectRelatedNode}
            returnFocusRef={analysisBtnRef}
            chapterRailWidth={chapterRailWidth ?? GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH}
            reserveRight={GRAPH_LAYOUT_CONSTANTS.TOOLTIP_SIDEBAR_WIDTH}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** displayMode: 'tooltip'(뷰어 플로팅) | 'sidebar'(그래프 페이지 패널) */
function NodeDetail({ displayMode = 'tooltip', ...props }) {
  return displayMode === 'sidebar' ? <NodeDetailSidebar {...props} /> : <NodeDetailTooltip {...props} />;
}

export default memo(NodeDetail);
