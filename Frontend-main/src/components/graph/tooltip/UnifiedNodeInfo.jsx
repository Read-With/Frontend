import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  processRelations,
  processRelationTags,
  extractRadarChartData,
  extractApiBookId,
  undirectedPairKey,
  isGraphNodeElement,
} from "../../../utils/graph/graphUtils.js";
import { getEventDataByIndex } from "../../../utils/graph/graphData.js";
import { useTooltipPosition, useClickOutside } from "../../../hooks/ui/tooltipHooks";
import { getUnifiedEventInfoForTooltip } from "../../../utils/viewer/viewerEventProgressUtils";
import { toNumberOrNull } from "../../../utils/common/valueUtils.js";
import { USER_GRAPH_PREFIX } from "../../../utils/common/urlUtils";
import {
  COLORS,
  createButtonStyle,
  mergeRefs,
  unifiedNodeTooltipStyles,
  unifiedNodeAnimations,
} from "../../../utils/styles/styles.js";
import RelationAnalysisModal from './RelationAnalysisModal.jsx';
import './tooltip.css';
import '../RelationGraph.css';

const Z_INDEX_TOOLTIP = 99999;
const SUMMARY = { COLLAPSED: 'collapsed', WARNING: 'warning', CONTENT: 'content' };

/** 뷰어처럼 key remount 되어도 분석 모달을 유지하기 위한 플래그 */
let pendingKeepAnalysisOpen = false;

function normalizeToString(value) {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : "";
  }
  return String(value).trim();
}

function buildProcessedNode(data) {
  const raw = (data && (data.id || data.label))
    ? data
    : (data?.data || { id: data?.id, label: data?.label });
  if (!raw) return null;

  const description = String(raw.personalityText || raw.description || '').trim();
  return {
    ...raw,
    names: processRelationTags(raw.names || [], raw.common_name),
    displayName: raw.common_name || raw.label || "Unknown",
    hasImage: !!raw.image,
    isMainCharacter: !!raw.isMainCharacter,
    description,
  };
}

function buildIdentityContext(nodeLike) {
  const normalizedNodeId = normalizeToString(nodeLike?.id);
  return {
    normalizedNodeId,
    nodeIdNum: toNumberOrNull(normalizedNodeId),
    normalizedNodeName: normalizeToString(
      nodeLike?.common_name ?? nodeLike?.label ?? nodeLike?.name
    ),
  };
}

function isSameIdentifier(candidate, idCtx) {
  if (!candidate) return false;
  const candidateId =
    candidate.id ??
    candidate.character_id ??
    candidate.characterId ??
    candidate.char_id ??
    candidate.pk ??
    candidate.node_id;
  const candidateName =
    candidate.common_name ?? candidate.name ?? candidate.label ?? candidate.displayName;

  const candidateIdStr = normalizeToString(candidateId);
  if (candidateIdStr && idCtx.normalizedNodeId && candidateIdStr === idCtx.normalizedNodeId) {
    return true;
  }

  const candidateIdNum = toNumberOrNull(candidateIdStr);
  if (candidateIdNum !== null && idCtx.nodeIdNum !== null && candidateIdNum === idCtx.nodeIdNum) {
    return true;
  }

  const candidateNameStr = normalizeToString(candidateName);
  return !!(
    candidateNameStr &&
    idCtx.normalizedNodeName &&
    candidateNameStr === idCtx.normalizedNodeName
  );
}

function collectUndirectedRelations(rawRelations, targetNodeId = null) {
  const relationMap = new Map();
  const targetStr = targetNodeId != null ? String(targetNodeId) : null;

  rawRelations.forEach((rel) => {
    const id1 = rel.id1 ?? rel.source;
    const id2 = rel.id2 ?? rel.target;
    if (id1 == null || id2 == null) return;
    if (targetStr != null && String(id1) !== targetStr && String(id2) !== targetStr) return;

    const key = undirectedPairKey(id1, id2);
    if (relationMap.has(key)) return;

    relationMap.set(key, {
      id1,
      id2,
      relation: rel.relation || ['관계'],
      count: rel.count || rel.strength || 1,
      positivity: rel.positivity || 0,
    });
  });

  return Array.from(relationMap.values());
}

function checkNodeAppearance({ isSidebar, data, node, chapterNum, folderKey, eventNum, elements }) {
  const isGraphOnlyPage =
    typeof window !== 'undefined' && window.location.pathname.includes(`${USER_GRAPH_PREFIX}/`);
  if (isSidebar || isGraphOnlyPage) {
    return { appeared: true, error: null };
  }
  if (!data || !chapterNum || chapterNum <= 0) {
    return { appeared: false, error: null };
  }

  try {
    const json = getEventDataByIndex(folderKey, chapterNum, eventNum);
    const idCtx = buildIdentityContext({
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
      return isSameIdentifier(
        { id: el.data?.id ?? el.id, name: el.data?.common_name ?? el.data?.label },
        idCtx,
      );
    });

    if (!json?.relations) {
      return { appeared: inElements, error: null };
    }

    const relations = processRelations(json.relations);
    const inCharacters = Array.isArray(json.characters)
      && json.characters.some((c) => isSameIdentifier(c, idCtx));
    const inRelations = relations.some(
      (rel) =>
        isSameIdentifier({ id: rel.id1, name: rel.name1 }, idCtx) ||
        isSameIdentifier({ id: rel.id2, name: rel.name2 }, idCtx),
    );

    return { appeared: inCharacters || inRelations || inElements, error: null };
  } catch (err) {
    return { appeared: false, error: err.message };
  }
}

function resolvePovSummary(node, chapterNum, povSummaries) {
  if (!node) return "인물에 대한 요약 정보가 없습니다.";

  const list = povSummaries?.povSummaries;
  if (Array.isArray(list) && list.length > 0) {
    const nodeId = Number(node.id);
    let match = Number.isFinite(nodeId)
      ? list.find((s) => Number(s.characterId) === nodeId)
      : null;
    if (!match) {
      const names = [node.common_name, node.label, node.displayName]
        .filter((n) => typeof n === 'string' && n.trim() !== '');
      match = list.find((s) => names.some((n) => n === s.characterName));
    }
    if (match?.summaryText) return match.summaryText;
  }

  return `${node.displayName}에 대한 ${chapterNum || 1}장 관점 요약이 아직 준비되지 않았습니다.`;
}

function buildRadarChartData({
  node,
  chapterNum,
  apiBookGraphData,
  elements,
  folderKey,
  eventNum,
}) {
  if (!node?.id || !chapterNum) return [];

  try {
    if (apiBookGraphData?.relations && apiBookGraphData?.characters) {
      const { relations, characters } = apiBookGraphData;
      const nameToIdMap = {};
      const bookElements = characters.map((char) => {
        const charName = char.common_name || char.name;
        nameToIdMap[charName] = char.id;
        return { data: { id: String(char.id), label: charName, common_name: charName } };
      });

      const targetNodeId = typeof node.id === 'string'
        ? (nameToIdMap[node.label || node.common_name] ?? node.id)
        : node.id;

      return extractRadarChartData(
        targetNodeId,
        collectUndirectedRelations(relations, targetNodeId),
        bookElements,
        8,
      );
    }

    if (!elements?.length) return [];

    const edgeRels = elements
      .filter((el) => el?.data?.source && el?.data?.target)
      .map((el) => ({
        id1: el.data.source,
        id2: el.data.target,
        relation: el.data.relation || ['관계'],
        count: el.data.count || el.data.strength || 1,
        positivity: el.data.positivity || 0,
      }));

    if (edgeRels.length > 0) {
      const nodeElements = elements.filter((el) => isGraphNodeElement(el));
      return extractRadarChartData(
        node.id,
        collectUndirectedRelations(edgeRels, node.id),
        nodeElements,
        8,
      );
    }

    if (!folderKey) return [];
    const json = getEventDataByIndex(folderKey, chapterNum, eventNum);
    if (!json?.relations) return [];

    const relations = collectUndirectedRelations(json.relations);
    const ids = new Set(relations.flatMap((rel) => [String(rel.id1), String(rel.id2)]));
    const filtered = elements.filter(
      (el) => !el.data.source && ids.has(String(el.data.id)),
    );
    return extractRadarChartData(node.id, relations, filtered, 8);
  } catch {
    return [];
  }
}

function buildRecommendedNodes({ elements, apiBookGraphData, excludeId, limit = 3 }) {
  const exclude = excludeId != null ? String(excludeId) : null;
  const degree = new Map();

  const bump = (id) => {
    const key = String(id);
    if (exclude && key === exclude) return;
    degree.set(key, (degree.get(key) || 0) + 1);
  };

  if (apiBookGraphData?.relations?.length) {
    apiBookGraphData.relations.forEach((rel) => {
      bump(rel.id1 ?? rel.source);
      bump(rel.id2 ?? rel.target);
    });
  } else if (Array.isArray(elements)) {
    elements.forEach((el) => {
      if (!el?.data?.source || !el?.data?.target) return;
      bump(el.data.source);
      bump(el.data.target);
    });
  }

  const nameById = new Map();
  if (apiBookGraphData?.characters?.length) {
    apiBookGraphData.characters.forEach((char) => {
      nameById.set(String(char.id), char.common_name || char.name || `인물 ${char.id}`);
    });
  }
  if (Array.isArray(elements)) {
    elements.forEach((el) => {
      if (!isGraphNodeElement(el)) return;
      const id = String(el.data.id);
      nameById.set(id, el.data.common_name || el.data.label || nameById.get(id) || `인물 ${id}`);
    });
  }

  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({
      id,
      name: nameById.get(id) || `인물 ${id}`,
      positivity: 0,
      relationTags: [`연결 ${count}`],
    }));
}

function handleProfileImageError(e) {
  e.target.style.display = "none";
  if (e.target.nextSibling) e.target.nextSibling.style.display = "block";
}

function PersonSilhouette({ size = 48, circleFill = "#e5e7eb", bodyFill = "#bdbdbd" }) {
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={cx} cy={cx} r={cx} fill={circleFill} />
      <ellipse cx={cx} cy={size * 0.375} rx={size * 0.21} ry={size * 0.21} fill={bodyFill} />
      <ellipse cx={cx} cy={size * 0.79} rx={size * 0.29} ry={size * 0.17} fill={bodyFill} />
    </svg>
  );
}

function TooltipCloseButton({ onClose, ariaLabel, className, style: extraStyle }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={ariaLabel}
      className={['tooltip-close-btn', className].filter(Boolean).join(' ')}
      style={{ ...createButtonStyle('tooltipClose'), ...extraStyle }}
    >
      &times;
    </button>
  );
}

function ActionButton({ variant = 'secondary', onClick, children, ariaLabel, title, minWidth }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`tooltip-action-btn tooltip-action-btn--${isPrimary ? 'primary' : 'secondary'}`}
      style={minWidth ? { minWidth } : undefined}
    >
      {children}
    </button>
  );
}

function NodeTooltipShell({
  children,
  shellRef,
  className = "graph-node-tooltip",
  containerStyle,
  position,
  zIndex,
  showContent,
  isDragging,
  handleMouseDown,
  transition,
  closeButton = null,
}) {
  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        ...containerStyle,
        left: position.x,
        top: position.y,
        zIndex,
        ...(showContent !== undefined
          ? {
              opacity: showContent ? 1 : 0,
              transition,
              cursor: isDragging ? "grabbing" : "grab",
            }
          : null),
      }}
      onMouseDown={handleMouseDown}
    >
      {closeButton}
      {children}
    </div>
  );
}

function CenteredStatus({ children, color = COLORS.textSecondary, fullHeight = true }) {
  return (
    <div
      className={`tooltip-centered-status${fullHeight ? '' : ' tooltip-centered-status--compact'}`}
      style={{ '--status-color': color }}
    >
      {children}
    </div>
  );
}

function NodeProfileAvatar({ node }) {
  const hasImage = !!node?.hasImage;
  return (
    <div className="profile-image-placeholder">
      <div className="profile-img">
        {hasImage ? (
          <img
            src={node.image}
            alt={node?.displayName || "character"}
            crossOrigin="anonymous"
            onError={handleProfileImageError}
          />
        ) : null}
        <div style={{ display: hasImage ? "none" : "block" }}>
          <PersonSilhouette size={48} />
        </div>
      </div>
    </div>
  );
}

function RelationAnalysisCta({
  node,
  connectionCount,
  onOpen,
  buttonRef,
  compact = false,
}) {
  return (
    <div
      className={`sidebar-section tooltip-analysis-section${compact ? ' tooltip-analysis-section--compact' : ''}`}
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
  chapterNum,
  eventNum,
  elements = [],
  filename,
  currentEvent = null,
  prevValidEvent = null,
  povSummaries = null,
  apiBookGraphData = null,
  onSelectRelatedNode = null,
  onOpenChapterSidebar = null,
}) {
  const { filename: urlFilename } = useParams();
  const isSidebar = displayMode === 'sidebar';
  const apiBookId = extractApiBookId(filename || urlFilename);
  const folderKey = apiBookId ? `api:${apiBookId}` : null;
  const node = useMemo(() => buildProcessedNode(data), [data]);

  const [appeared, setAppeared] = useState(false);
  const [error, setError] = useState(null);
  const [summaryStage, setSummaryStage] = useState(SUMMARY.COLLAPSED);
  const [isModalOpen, setIsModalOpen] = useState(() => {
    if (pendingKeepAnalysisOpen) {
      pendingKeepAnalysisOpen = false;
      return true;
    }
    return false;
  });
  const keepModalOpenRef = useRef(false);
  const analysisBtnRef = useRef(null);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => {
    pendingKeepAnalysisOpen = false;
    setIsModalOpen(false);
  }, []);

  const handleSelectRelatedNode = useCallback((idOrName, options = {}) => {
    if (!onSelectRelatedNode) return false;
    if (options.keepAnalysisOpen) {
      keepModalOpenRef.current = true;
      pendingKeepAnalysisOpen = true;
    } else {
      pendingKeepAnalysisOpen = false;
      keepModalOpenRef.current = false;
    }
    return onSelectRelatedNode(idOrName, options);
  }, [onSelectRelatedNode]);

  useEffect(() => {
    setSummaryStage(SUMMARY.COLLAPSED);
    if (keepModalOpenRef.current) {
      keepModalOpenRef.current = false;
      setIsModalOpen(true);
    } else {
      setIsModalOpen(false);
    }
  }, [node?.id]);

  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(
    x, y, { enabled: !isSidebar }
  );

  const clickOutsideRef = useClickOutside(
    () => { if (onClose) onClose(); },
    !isSidebar && showContent && !isModalOpen,
    true
  );

  const eventInfo = useMemo(
    () => getUnifiedEventInfoForTooltip({ currentEvent, prevValidEvent, eventNum }),
    [currentEvent, prevValidEvent, eventNum],
  );

  useEffect(() => {
    const result = checkNodeAppearance({
      isSidebar,
      data,
      node,
      chapterNum,
      folderKey,
      eventNum: eventInfo.eventNum,
      elements,
    });
    setAppeared(result.appeared);
    setError(result.error);
  }, [data, node, chapterNum, eventInfo, folderKey, elements, isSidebar]);

  const summaryText = useMemo(
    () => resolvePovSummary(node, chapterNum, povSummaries),
    [node, chapterNum, povSummaries],
  );

  const radarChartData = useMemo(
    () =>
      buildRadarChartData({
        node,
        chapterNum,
        apiBookGraphData,
        elements,
        folderKey,
        eventNum: eventInfo.eventNum,
      }),
    [node, chapterNum, folderKey, elements, apiBookGraphData, eventInfo],
  );

  const connectionKind = useMemo(() => {
    const n = radarChartData.length;
    if (n === 0) return 'no_connections';
    if (n <= 2) return 'few_connections';
    return 'sufficient_connections';
  }, [radarChartData]);

  const recommendedNodes = useMemo(
    () => buildRecommendedNodes({
      elements,
      apiBookGraphData,
      excludeId: node?.id,
      limit: 3,
    }),
    [elements, apiBookGraphData, node?.id],
  );

  const isWarning = summaryStage === SUMMARY.WARNING;
  const isContent = summaryStage === SUMMARY.CONTENT;

  const floatingShell = {
    shellRef: mergeRefs(tooltipRef, clickOutsideRef),
    position,
    zIndex: Z_INDEX_TOOLTIP,
    showContent,
    isDragging,
    handleMouseDown,
  };

  const analysisModal = isModalOpen ? (
    <RelationAnalysisModal
      node={node}
      chapterNum={chapterNum}
      chapterScopeLabel={
        isSidebar
          ? (chapterNum != null ? `챕터 1–${chapterNum} 누적` : null)
          : (chapterNum != null ? `챕터 ${chapterNum}` : null)
      }
      radarChartData={radarChartData}
      connectionKind={connectionKind}
      recommendedNodes={recommendedNodes}
      onClose={closeModal}
      onSelectRelatedNode={onSelectRelatedNode ? handleSelectRelatedNode : null}
      onOpenChapterSidebar={onOpenChapterSidebar}
      returnFocusRef={analysisBtnRef}
    />
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
          containerStyle={unifiedNodeTooltipStyles.errorContainer}
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
      ? `챕터 ${chapterNum} 이벤트 "${eventInfo.name}"에서는 등장하지 않습니다`
      : eventInfo.eventNum
        ? `챕터 ${chapterNum} 이벤트 ${eventInfo.eventNum}에서는 등장하지 않습니다`
        : `챕터 ${chapterNum}에서는 등장하지 않습니다`;

    return (
      <NodeTooltipShell
        {...floatingShell}
        containerStyle={unifiedNodeTooltipStyles.notAppearedContainer}
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
      <>
        <NodeTooltipShell
          {...floatingShell}
          containerStyle={unifiedNodeTooltipStyles.tooltipContainer}
          transition={unifiedNodeAnimations.tooltipComplexTransition(isDragging)}
        >
          <div className="tooltip-content business-card">
            <TooltipCloseButton onClose={onClose} />
            {nodeHeaderAndDescription}
            <RelationAnalysisCta
              node={node}
              connectionCount={radarChartData.length}
              onOpen={openModal}
              buttonRef={analysisBtnRef}
              compact
            />
          </div>
        </NodeTooltipShell>
        {analysisModal}
      </>
    );
  }

  return (
    <div className="graph-sidebar-panel">
      <TooltipCloseButton onClose={onClose} ariaLabel="사이드바 닫기" />

      <div className="graph-sidebar-body">
        {nodeHeaderAndDescription}

        <div
          className={`sidebar-section tooltip-summary-section tooltip-summary-section--${
            isWarning ? 'warning' : isContent ? 'content' : 'collapsed'
          }`}
          role="region"
          aria-label="인물 시점 요약"
        >
          <button
            type="button"
            onClick={() =>
              setSummaryStage((s) =>
                s === SUMMARY.COLLAPSED ? SUMMARY.WARNING : SUMMARY.COLLAPSED
              )
            }
            className="summary-toggle-btn"
          >
            <h4 className="tooltip-section-title">해당 인물 시점의 요약</h4>
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
                  onClick={() => setSummaryStage(SUMMARY.CONTENT)}
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
                <p className={`tooltip-summary-text${isContent ? ' is-animated' : ''}`}>
                  {summaryText}
                </p>
              </div>
            </div>
          </div>
        </div>

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

export default memo(UnifiedNodeInfo);
