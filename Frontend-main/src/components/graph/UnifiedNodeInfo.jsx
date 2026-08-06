import { lazy, memo, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import { useParams } from "react-router-dom";
import {
  processRelations,
  extractRadarChartData,
  extractApiBookId,
  isGraphNodeElement,
  GRAPH_LAYOUT_CONSTANTS,
  buildProcessedNode,
  buildNodeIdentityContext,
  isSameNodeIdentifier,
  collectUndirectedRelations,
  resolvePovSummary,
  resolveRelationConnectionKind,
  clearPovSpoilerSession,
  NODE_TOOLTIP_VIEW_STATUS,
} from "../../utils/graph/graphCore";
import { getEventDataByIndex } from "../../utils/graph/graphFetch.js";
import { hasGraphPayload } from "../../utils/api/graphApi.js";
import { useTooltipPosition, useClickOutside, useCanvasAvoidPoint } from "../../hooks/ui/tooltipHooks";
import { getUnifiedEventInfoForTooltip } from "../../utils/viewer/viewerSession";
import { USER_GRAPH_PREFIX } from "../../utils/common/urlUtils";
import { finitePositivityOrZero } from "../../utils/styles/graphStyles";
import {
  COLORS,
  mergeRefs,
  unifiedNodeAnimations,
} from "../../utils/styles/styles.js";
import {
  PersonSilhouette,
  TooltipCloseButton,
  ActionButton,
  NodeTooltipShell,
  CenteredStatus,
  NodeProfileAvatar,
} from './GraphControls';

const RelationAnalysisModal = lazy(() => import('./RelationAnalysisModal'));

const RADAR_EMPTY = Object.freeze({ items: [], status: NODE_TOOLTIP_VIEW_STATUS.NO_DATA });
const radarOk = (items) => ({
  items,
  status: items.length > 0 ? NODE_TOOLTIP_VIEW_STATUS.OK : NODE_TOOLTIP_VIEW_STATUS.NO_DATA,
});
const radarError = (message) => ({
  items: [],
  status: NODE_TOOLTIP_VIEW_STATUS.ERROR,
  error: message || '관계 분석 데이터를 만들지 못했습니다.',
});

const Z_INDEX_TOOLTIP = 99999;
const SUMMARY = { COLLAPSED: 'collapsed', WARNING: 'warning', CONTENT: 'content' };

function checkNodeAppearance({ isSidebar, data, node, currentChapter, folderKey, eventNum, elements }) {
  const isGraphOnlyPage =
    typeof window !== 'undefined' && window.location.pathname.includes(`${USER_GRAPH_PREFIX}/`);
  if (isSidebar || isGraphOnlyPage) {
    return { appeared: true, error: null };
  }
  if (!data || !currentChapter || currentChapter <= 0) {
    return { appeared: false, error: null };
  }

  try {
    const json = getEventDataByIndex(folderKey, currentChapter, eventNum);
    const idCtx = buildNodeIdentityContext({
      id: node?.id ?? data?.id ?? data?.data?.id,
      common_name:
        node?.common_name ??
        node?.label ??
        data?.common_name ??
        data?.label ??
        data?.data?.common_name ??
        data?.data?.label,
    });

    const inElements = Array.isArray(elements) && elements.some((el) => {
      if (!el || el.data?.source) return false;
      return isSameNodeIdentifier(
        { id: el.data?.id ?? el.id, name: el.data?.common_name ?? el.data?.label },
        idCtx,
      );
    });

    if (!json?.relations) {
      return { appeared: inElements, error: null };
    }

    const relations = processRelations(json.relations);
    const inCharacters = Array.isArray(json.characters)
      && json.characters.some((c) => isSameNodeIdentifier(c, idCtx));
    const inRelations = relations.some(
      (rel) =>
        isSameNodeIdentifier({ id: rel.id1, name: rel.name1 }, idCtx) ||
        isSameNodeIdentifier({ id: rel.id2, name: rel.name2 }, idCtx),
    );

    return { appeared: inCharacters || inRelations || inElements, error: null };
  } catch (err) {
    return { appeared: false, error: err.message };
  }
}

function buildRadarChartData({
  node,
  currentChapter,
  apiBookGraphData,
  elements,
  folderKey,
  eventNum,
}) {
  if (!node?.id || !currentChapter) return RADAR_EMPTY;

  try {
    // 빈 []도 truthy이므로 hasGraphPayload로 실제 데이터가 있을 때만 API 소스 사용
    if (hasGraphPayload(apiBookGraphData)) {
      const { relations, characters } = apiBookGraphData;
      const bookElements = characters.map((char) => {
        const charName = char.common_name || char.name || '';
        return {
          data: {
            id: String(char.id),
            label: charName || `인물 ${char.id}`,
            common_name: charName || `인물 ${char.id}`,
          },
        };
      });

      const targetNodeId = node.id;
      return radarOk(
        extractRadarChartData(
          targetNodeId,
          collectUndirectedRelations(relations, targetNodeId),
          bookElements,
          8,
        ),
      );
    }

    if (!elements?.length) return RADAR_EMPTY;

    const edgeRels = elements
      .filter((el) => el?.data?.source && el?.data?.target)
      .map((el) => ({
        id1: el.data.source,
        id2: el.data.target,
        relation: el.data.relation || ['관계'],
        count: el.data.count || el.data.strength || 1,
        positivity: finitePositivityOrZero(el.data.positivity),
      }));

    if (edgeRels.length > 0) {
      const nodeElements = elements.filter((el) => isGraphNodeElement(el));
      return radarOk(
        extractRadarChartData(
          node.id,
          collectUndirectedRelations(edgeRels, node.id),
          nodeElements,
          8,
        ),
      );
    }

    if (!folderKey) return RADAR_EMPTY;
    const json = getEventDataByIndex(folderKey, currentChapter, eventNum);
    if (!json?.relations) return RADAR_EMPTY;

    const relations = collectUndirectedRelations(json.relations);
    const ids = new Set(relations.flatMap((rel) => [String(rel.id1), String(rel.id2)]));
    const filtered = elements.filter(
      (el) => !el.data.source && ids.has(String(el.data.id)),
    );
    return radarOk(extractRadarChartData(node.id, relations, filtered, 8));
  } catch (err) {
    return radarError(err?.message);
  }
}

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

function UnifiedNodeInfo({
  displayMode = 'tooltip',
  data,
  x,
  y,
  onClose,
  currentChapter,
  eventNum,
  elements = [],
  filename,
  currentEvent = null,
  prevValidEvent = null,
  povSummaries = null,
  povError = null,
  povIsLoading = false,
  povCached = null,
  onRetryPov = null,
  showPovSummary = true,
  apiBookGraphData = null,
  onSelectRelatedNode = null,
  chapterRailWidth = null,
  tooltipBoundsRef = null,
  pendingKeepAnalysisOpenRef = null,
}) {
  const { filename: urlFilename } = useParams();
  const isSidebar = displayMode === 'sidebar';
  const apiBookId = extractApiBookId(filename || urlFilename);
  const folderKey = apiBookId ? `api:${apiBookId}` : null;
  const node = useMemo(() => buildProcessedNode(data), [data]);

  /** 뷰어처럼 key remount 되어도 분석 모달을 유지하기 위한 플래그. 호출부가 넘긴 ref가 없으면 이 인스턴스 전용 ref로 대체(remount 시엔 유지되지 않음). */
  const ownPendingRef = useRef(false);
  const pendingRef = pendingKeepAnalysisOpenRef || ownPendingRef;

  const [appeared, setAppeared] = useState(false);
  const [error, setError] = useState(null);
  const [summaryStage, setSummaryStage] = useState(SUMMARY.COLLAPSED);
  const [isModalOpen, setIsModalOpen] = useState(() => {
    if (pendingRef.current) {
      pendingRef.current = false;
      return true;
    }
    return false;
  });
  const keepModalOpenRef = useRef(false);
  const analysisBtnRef = useRef(null);
  const unlockedPovNodeIdsRef = useRef(new Set());

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => {
    pendingRef.current = false;
    setIsModalOpen(false);
  }, [pendingRef]);

  const handleSelectRelatedNode = useCallback((idOrName, options = {}) => {
    if (!onSelectRelatedNode) return false;
    if (options.keepAnalysisOpen) {
      keepModalOpenRef.current = true;
      pendingRef.current = true;
    } else {
      pendingRef.current = false;
      keepModalOpenRef.current = false;
    }
    return onSelectRelatedNode(idOrName, options);
  }, [onSelectRelatedNode, pendingRef]);

  const isPovUnlockedForNode = useCallback((nodeId) => {
    if (nodeId == null || nodeId === '') return false;
    return unlockedPovNodeIdsRef.current.has(String(nodeId));
  }, []);

  useEffect(() => {
    clearPovSpoilerSession();
    setSummaryStage(SUMMARY.COLLAPSED);
    if (keepModalOpenRef.current) {
      keepModalOpenRef.current = false;
      setIsModalOpen(true);
    } else {
      setIsModalOpen(false);
    }
  }, [node?.id]);

  useEffect(() => () => {
    unlockedPovNodeIdsRef.current.clear();
    clearPovSpoilerSession();
  }, []);

  const avoidPoint = useCanvasAvoidPoint(data?.nodeCenter);

  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(
    x, y, {
      enabled: !isSidebar,
      bounds: 'canvas',
      avoidPoint,
      boundsRef: tooltipBoundsRef,
    }
  );

  const clickOutsideRef = useClickOutside(
    () => { if (onClose) onClose(); },
    !isSidebar && showContent && !isModalOpen,
    true
  );

  const eventInfo = useMemo(
    () => getUnifiedEventInfoForTooltip({
      currentEvent,
      prevValidEvent,
      eventNum,
      currentChapter,
    }),
    [currentEvent, prevValidEvent, eventNum, currentChapter],
  );

  useEffect(() => {
    const result = checkNodeAppearance({
      isSidebar,
      data,
      node,
      currentChapter,
      folderKey,
      eventNum: eventInfo.eventNum,
      elements,
    });
    setAppeared(result.appeared);
    setError(result.error);
  }, [data, node, currentChapter, eventInfo, folderKey, elements, isSidebar]);

  const { text: summaryText, status: summaryStatus } = useMemo(
    () =>
      resolvePovSummary(node, currentChapter, povSummaries, povError, {
        isLoading: povIsLoading,
        povCached,
      }),
    [node, currentChapter, povSummaries, povError, povIsLoading, povCached],
  );
  const summaryIsError = summaryStatus === NODE_TOOLTIP_VIEW_STATUS.ERROR;
  const summaryIsLoading = summaryStatus === NODE_TOOLTIP_VIEW_STATUS.LOADING;
  const summaryIsPending = summaryStatus === NODE_TOOLTIP_VIEW_STATUS.PENDING;
  const chapterSummaryTitle =
    currentChapter != null && Number(currentChapter) >= 1
      ? `챕터 ${currentChapter} 시점 요약`
      : '해당 인물 시점의 요약';

  const openSummarySection = useCallback(() => {
    setSummaryStage((s) => {
      if (s !== SUMMARY.COLLAPSED) return SUMMARY.COLLAPSED;
      return isPovUnlockedForNode(node?.id) ? SUMMARY.CONTENT : SUMMARY.WARNING;
    });
  }, [isPovUnlockedForNode, node?.id]);

  const confirmSpoiler = useCallback(() => {
    if (node?.id != null && node.id !== '') {
      unlockedPovNodeIdsRef.current.add(String(node.id));
    }
    setSummaryStage(SUMMARY.CONTENT);
  }, [node?.id]);

  const radarResult = useMemo(() => {
    if (!isSidebar) return RADAR_EMPTY;
    return buildRadarChartData({
      node,
      currentChapter,
      apiBookGraphData,
      elements,
      folderKey,
      eventNum: eventInfo.eventNum,
    });
  }, [isSidebar, node, currentChapter, folderKey, elements, apiBookGraphData, eventInfo]);

  const radarChartData = radarResult.items;
  const radarLoadError =
    radarResult.status === NODE_TOOLTIP_VIEW_STATUS.ERROR ? radarResult.error : null;

  const connectionKind = useMemo(
    () =>
      resolveRelationConnectionKind(radarChartData.length, {
        enabled: isSidebar,
        hasError: radarResult.status === NODE_TOOLTIP_VIEW_STATUS.ERROR,
      }),
    [isSidebar, radarResult.status, radarChartData.length],
  );

  const isWarning = summaryStage === SUMMARY.WARNING;
  const isContent = summaryStage === SUMMARY.CONTENT;

  const povSummarySection = (
    <div
      className={`sidebar-section tooltip-summary-section tooltip-summary-section--${
        isWarning ? 'warning' : isContent ? 'content' : 'collapsed'
      }`}
      role="region"
      aria-label="인물 시점 요약"
    >
      <button
        type="button"
        onClick={openSummarySection}
        className="summary-toggle-btn"
      >
        <h4 className="tooltip-section-title">{chapterSummaryTitle}</h4>
        <span
          className={`tooltip-summary-chevron${
            summaryStage !== SUMMARY.COLLAPSED ? ' tooltip-summary-chevron--open' : ''
          }`}
        >
          ▼
        </span>
      </button>

      <div
        className={`tooltip-collapsible tooltip-collapsible--warning${
          isWarning ? ' is-open' : ''
        }`}
      >
        <div className="tooltip-spoiler-body">
          <h3 className={`tooltip-spoiler-title${isWarning ? ' is-fading' : ''}`}>
            스포일러 포함
          </h3>
          <p className={`tooltip-spoiler-text${isWarning ? ' is-fading' : ''}`}>
            스토리의 중요한 내용을 담고 있습니다.
            <br />
            내용을 확인하시겠습니까?
          </p>
          <div className={`tooltip-spoiler-actions${isWarning ? ' is-fading' : ''}`}>
            <ActionButton
              onClick={() => setSummaryStage(SUMMARY.COLLAPSED)}
              ariaLabel="접기"
              title="접기"
            >
              취소
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={confirmSpoiler}
              ariaLabel="스포일러 내용 확인하기"
            >
              확인하고 보기
            </ActionButton>
          </div>
        </div>
      </div>

      <div
        className={`tooltip-collapsible tooltip-collapsible--content${
          isContent ? ' is-open' : ''
        }`}
        aria-hidden={!isContent}
      >
        <div className="tooltip-summary-content">
          <div className="tooltip-summary-quote">
            {summaryIsLoading ? (
              <p className="tooltip-summary-text tooltip-summary-text--loading" aria-live="polite">
                <span className="tooltip-summary-spinner" aria-hidden />
                {summaryText}
              </p>
            ) : (
              <p
                className={`tooltip-summary-text${isContent ? ' is-animated' : ''}${
                  summaryIsError ? ' tooltip-summary-text--error' : ''
                }${summaryIsPending ? ' tooltip-summary-text--pending' : ''}`}
              >
                {summaryText}
              </p>
            )}
            {summaryIsError && typeof onRetryPov === 'function' && (
              <ActionButton onClick={onRetryPov}>
                다시 시도
              </ActionButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const floatingShell = {
    shellRef: mergeRefs(tooltipRef, clickOutsideRef),
    position,
    zIndex: Z_INDEX_TOOLTIP,
    showContent,
    isDragging,
    handleMouseDown,
  };

  const analysisModal = isSidebar && isModalOpen ? (
    <Suspense fallback={<div role="status" aria-live="polite">관계 분석을 불러오는 중…</div>}>
      <RelationAnalysisModal
        node={node}
        radarChartData={radarChartData}
        connectionKind={connectionKind}
        loadError={radarLoadError}
        onClose={closeModal}
        onSelectRelatedNode={onSelectRelatedNode ? handleSelectRelatedNode : null}
        returnFocusRef={analysisBtnRef}
        chapterRailWidth={
          chapterRailWidth ?? GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH
        }
        reserveRight={GRAPH_LAYOUT_CONSTANTS.TOOLTIP_SIDEBAR_WIDTH}
      />
    </Suspense>
  ) : null;

  if (error) {
    const errorContent = (
      <div className="tooltip-error-block">
        <h4 className="tooltip-error-title">오류가 발생했습니다</h4>
        <p className="tooltip-error-msg">{error}</p>
        <button type="button" onClick={onClose} className="tooltip-error-close-btn">
          닫기
        </button>
      </div>
    );

    if (!isSidebar) {
      return (
        <NodeTooltipShell
          shellRef={tooltipRef}
          className="graph-node-tooltip error"
          position={position}
          zIndex={Z_INDEX_TOOLTIP}
        >
          {errorContent}
        </NodeTooltipShell>
      );
    }

    return <CenteredStatus color="#d32f2f">{errorContent}</CenteredStatus>;
  }

  if (!appeared) {
    const eventHint = eventInfo.name
      ? `챕터 ${currentChapter} 이벤트 "${eventInfo.name}"에서는 등장하지 않습니다`
      : eventInfo.eventNum
        ? `챕터 ${currentChapter} 이벤트 ${eventInfo.eventNum}에서는 등장하지 않습니다`
        : `챕터 ${currentChapter}에서는 등장하지 않습니다`;

    return (
      <NodeTooltipShell
        {...floatingShell}
        className="graph-node-tooltip is-not-appeared"
        transition={unifiedNodeAnimations.tooltipSimpleTransition(isDragging)}
        closeButton={(
          <TooltipCloseButton
            onClose={onClose}
            className="tooltip-close-btn--offset"
          />
        )}
      >
        <CenteredStatus fullHeight={false}>
          <div className="tooltip-not-appeared-avatar">
            <PersonSilhouette
              size={40}
              circleFill={COLORS.border}
              bodyFill={COLORS.textSecondary}
            />
          </div>
          <h3 className="tooltip-not-appeared-title">{node?.displayName}</h3>
          <p className="tooltip-not-appeared-msg">아직 등장하지 않은 인물입니다</p>
          <p className="tooltip-not-appeared-hint">{eventHint}</p>
        </CenteredStatus>
      </NodeTooltipShell>
    );
  }

  const nodeHeaderAndDescription = (
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

  if (!isSidebar) {
    return (
      <NodeTooltipShell
        {...floatingShell}
        transition={unifiedNodeAnimations.tooltipComplexTransition(isDragging)}
      >
        <div className="tooltip-content business-card">
          <TooltipCloseButton onClose={onClose} />
          {nodeHeaderAndDescription}
          {showPovSummary ? povSummarySection : null}
        </div>
      </NodeTooltipShell>
    );
  }

  return (
    <div className="graph-sidebar-panel">
      <TooltipCloseButton onClose={onClose} ariaLabel="사이드바 닫기" />

      <div className="graph-sidebar-body">
        {nodeHeaderAndDescription}

        {showPovSummary ? povSummarySection : null}

        <RelationAnalysisCta
          node={node}
          connectionCount={radarChartData.length}
          onOpen={openModal}
          buttonRef={analysisBtnRef}
        />
      </div>

      {analysisModal}
    </div>
  );
}

UnifiedNodeInfo.propTypes = {
  displayMode: PropTypes.oneOf(['tooltip', 'sidebar']),
  data: PropTypes.object,
  x: PropTypes.number,
  y: PropTypes.number,
  onClose: PropTypes.func,
  currentChapter: PropTypes.number,
  eventNum: PropTypes.number,
  elements: PropTypes.array,
  filename: PropTypes.string,
  currentEvent: PropTypes.any,
  prevValidEvent: PropTypes.any,
  povSummaries: PropTypes.any,
  povError: PropTypes.string,
  povIsLoading: PropTypes.bool,
  povCached: PropTypes.bool,
  onRetryPov: PropTypes.func,
  showPovSummary: PropTypes.bool,
  apiBookGraphData: PropTypes.object,
  onSelectRelatedNode: PropTypes.func,
  chapterRailWidth: PropTypes.number,
  tooltipBoundsRef: PropTypes.shape({ current: PropTypes.any }),
  pendingKeepAnalysisOpenRef: PropTypes.shape({ current: PropTypes.bool }),
};

export default memo(UnifiedNodeInfo);
