import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { processRelations, processRelationTags, extractRadarChartData, extractApiBookId, undirectedPairKey } from "../../../utils/graph/graphUtils.js";
import { getPositivityColor, getPositivityLabel } from "../../../utils/styles/relationStyles.js";
import { getEventDataByIndex } from "../../../utils/graph/graphData.js";
import { useTooltipPosition, useClickOutside } from "../../../hooks/ui/tooltipHooks";
import { getUnifiedEventInfoForTooltip } from "../../../utils/viewer/viewerEventProgressUtils";
import { toNumberOrNull } from "../../../utils/common/valueUtils.js";
import { USER_GRAPH_PREFIX } from "../../../utils/common/urlUtils";
import { COLORS, createButtonStyle, mergeRefs, unifiedNodeTooltipStyles, unifiedNodeAnimations } from "../../../utils/styles/styles.js";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import './tooltip.css';

const Z_INDEX_TOOLTIP = 99999;
const SUMMARY = { COLLAPSED: 'collapsed', WARNING: 'warning', CONTENT: 'content' };

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

function positivityDisplay(positivity) {
  return {
    color: getPositivityColor(positivity),
    label: getPositivityLabel(positivity || 0),
    percent: Math.round((positivity || 0) * 100),
  };
}

/** viewer tooltip: 현재 이벤트에 노드 등장 여부 */
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
  isSidebar,
  apiBookGraphData,
  elements,
  folderKey,
  eventNum,
}) {
  if (!node?.id || !chapterNum || !isSidebar) return [];

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

function ConnectionStatusPanel({ children }) {
  return <div className="tooltip-connection-panel">{children}</div>;
}

function RelationTagsRow({ tags, compact = false }) {
  if (!tags?.length) return null;
  return (
    <div className={`tooltip-relation-tags${compact ? ' tooltip-relation-tags--compact' : ''}`}>
      {tags.map((tag, i) => (
        <span
          key={i}
          className={`tooltip-relation-tag${compact ? ' tooltip-relation-tag--compact' : ''}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function NameWithDot({ name, positivity, dotSize = 14, fontSize = '1.1rem' }) {
  const { color } = positivityDisplay(positivity);
  return (
    <div
      className="tooltip-name-with-dot"
      style={{ '--dot-color': color, '--dot-size': `${dotSize}px`, '--name-font-size': fontSize }}
    >
      <div className="tooltip-name-dot" />
      <span className="tooltip-name-label">{name}</span>
    </div>
  );
}

function PositivityChip({ positivity, layout = 'row' }) {
  const { color, label, percent } = positivityDisplay(positivity);
  const style = { '--pos-color': color };

  if (layout === 'card') {
    return (
      <div className="tooltip-positivity-chip tooltip-positivity-chip--card" style={style}>
        <span className="tooltip-positivity-label">{label}</span>
        <div className="tooltip-positivity-percent">
          <span className="tooltip-positivity-percent-value">{percent}</span>
          <span className="tooltip-positivity-percent-unit">%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="tooltip-positivity-chip" style={style}>
      <span className="tooltip-positivity-label">{label}</span>
      <div className="tooltip-positivity-percent">{percent}%</div>
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

const UnifiedNodeRadarDot = memo(function UnifiedNodeRadarDot({
  cx,
  cy,
  payload,
  dataMap,
  hoveredName,
  onDotMouseEnter,
  onDotMouseLeave,
}) {
  const fullData =
    payload?.name != null ? (dataMap.get(payload.name) || payload) : null;
  const dotName = fullData?.name ?? payload?.name;

  const handleMouseEnterDot = useCallback(
    (e) => {
      if (!dotName) return;
      e.stopPropagation();
      onDotMouseEnter(dotName, e);
    },
    [dotName, onDotMouseEnter]
  );

  const handleMouseLeaveDot = useCallback(
    (e) => {
      e.stopPropagation();
      onDotMouseLeave();
    },
    [onDotMouseLeave]
  );

  if (!payload || cx == null || cy == null || !fullData) return null;

  const { color } = positivityDisplay(fullData.positivity);
  const isHovered = hoveredName === payload.name;
  const radius = isHovered ? 8 : 5;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={Math.max(15, radius * 3)}
        fill="transparent"
        style={{ cursor: "pointer", pointerEvents: "all", zIndex: 10 }}
        onMouseEnter={handleMouseEnterDot}
        onMouseLeave={handleMouseLeaveDot}
      />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke={isHovered ? "#fff" : "none"}
        strokeWidth={isHovered ? 2 : 0}
        style={{ transition: "all 0.2s ease", pointerEvents: "none" }}
      />
    </g>
  );
});

function FewConnectionsList({ radarChartData }) {
  return (
    <div className="tooltip-few-list">
      <div className="tooltip-few-list-title">연결된 인물</div>

      <div className="tooltip-few-list-items">
        {radarChartData.map((item, index) => (
          <div key={index} className="tooltip-few-list-card">
            <NameWithDot name={item.name} positivity={item.positivity} />
            <PositivityChip positivity={item.positivity} />
            <RelationTagsRow tags={item.relationTags} />
          </div>
        ))}
      </div>

      <div className="tooltip-few-list-hint">
        <div>현재 연결된 인물이 적어 그리드 차트로 표시하기 어려운 상황입니다.</div>
        <div>더 풍부한 관계 분석을 위해 다른 챕터나 이벤트를 확인해보시기 바랍니다.</div>
      </div>
    </div>
  );
}

function HoveredRelationPopup({ item, x, y, onClose }) {
  const { color } = positivityDisplay(item.positivity);

  return (
    <div
      className="tooltip-hover-popup"
      style={{
        left: `${Math.min(x + 15, window.innerWidth - 350)}px`,
        top: `${Math.max(y - 15, 10)}px`,
        '--pos-color': color,
      }}
      onMouseLeave={onClose}
    >
      <div className="tooltip-hover-popup-title">
        <NameWithDot name={item.name} positivity={item.positivity} dotSize={8} />
      </div>
      <PositivityChip positivity={item.positivity} layout="card" />
      {item.relationTags?.length > 0 && (
        <div className="tooltip-hover-popup-tags">
          <div className="tooltip-hover-popup-tags-label">
            <div className="tooltip-hover-popup-tags-dot" />
            관계 태그
          </div>
          <RelationTagsRow tags={item.relationTags} compact />
        </div>
      )}
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
}) {
  const { filename: urlFilename } = useParams();
  const isSidebar = displayMode === 'sidebar';
  const apiBookId = extractApiBookId(filename || urlFilename);
  const folderKey = apiBookId ? `api:${apiBookId}` : null;
  const node = useMemo(() => buildProcessedNode(data), [data]);

  const [appeared, setAppeared] = useState(false);
  const [error, setError] = useState(null);
  const [summaryStage, setSummaryStage] = useState(SUMMARY.COLLAPSED);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hover, setHover] = useState(null);

  const clearHover = useCallback(() => setHover(null), []);
  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    clearHover();
  }, [clearHover]);
  const onRadarHoverEnter = useCallback((name, event) => {
    setHover({ name, x: event.clientX, y: event.clientY });
  }, []);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, closeModal]);

  useEffect(() => {
    setSummaryStage(SUMMARY.COLLAPSED);
    setIsModalOpen(false);
    clearHover();
  }, [node?.id, clearHover]);

  const { position, showContent, isDragging, tooltipRef, handleMouseDown } = useTooltipPosition(
    x, y, { enabled: !isSidebar }
  );

  const clickOutsideRef = useClickOutside(
    () => { if (onClose) onClose(); },
    !isSidebar && showContent,
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
        isSidebar,
        apiBookGraphData,
        elements,
        folderKey,
        eventNum: eventInfo.eventNum,
      }),
    [node, chapterNum, isSidebar, folderKey, elements, apiBookGraphData, eventInfo],
  );

  const connectionKind = useMemo(() => {
    const n = radarChartData.length;
    if (n === 0) return 'no_connections';
    if (n <= 2) return 'few_connections';
    return 'sufficient_connections';
  }, [radarChartData]);

  const dataMap = useMemo(() => {
    const map = new Map();
    radarChartData.forEach((item) => map.set(item.name, item));
    return map;
  }, [radarChartData]);

  const hoveredItem = hover ? dataMap.get(hover.name) : null;
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

  const renderPolarAngleAxis = ({ payload, x: tickX, y: tickY, cx, cy }) => {
    const point = dataMap.get(payload.value);
    const color = point?.positivity !== undefined
      ? positivityDisplay(point.positivity).color
      : COLORS.textPrimary;
    const active = hover?.name === payload.value;
    const dx = tickX - cx;
    const dy = tickY - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = (distance + Math.max(40, 25 + ((payload.value?.length || 0) * 2))) / distance;

    return (
      <text
        x={cx + dx * scale}
        y={cy + dy * scale}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={active ? color : COLORS.textPrimary}
        fontSize={active ? 18 : 16}
        fontWeight={active ? 700 : 600}
        style={{ transition: 'all 0.2s ease' }}
      >
        {payload.value}
      </text>
    );
  };

  const renderModalRadarBody = () => {
    if (connectionKind === 'sufficient_connections') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={radarChartData}
            margin={{ top: 60, right: 60, bottom: 60, left: 60 }}
            style={{ outline: 'none' }}
          >
            <style>{`
              svg:focus, svg *:focus { outline: none !important; }
              * { animation: none !important; transition: none !important; }
            `}</style>
            <PolarGrid stroke={COLORS.border} />
            <PolarAngleAxis dataKey="name" tick={renderPolarAngleAxis} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 14, fill: COLORS.textSecondary, fontWeight: 600 }}
              tickCount={5}
              tickFormatter={(v) => (((v / 100) * 2) - 1).toFixed(1)}
            />
            <Radar
              name={node?.displayName}
              dataKey="normalizedValue"
              stroke="#9ca3af"
              fill="#e5e7eb"
              fillOpacity={0.2}
              strokeWidth={2}
              dot={(dotProps) => {
                const { key, ...rest } = dotProps;
                return (
                  <UnifiedNodeRadarDot
                    key={key}
                    {...rest}
                    dataMap={dataMap}
                    hoveredName={hover?.name}
                    onDotMouseEnter={onRadarHoverEnter}
                    onDotMouseLeave={clearHover}
                  />
                );
              }}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ConnectionStatusPanel>
        {connectionKind === 'few_connections' && radarChartData.length > 0 ? (
          <FewConnectionsList radarChartData={radarChartData} />
        ) : (
          <div className="tooltip-empty-connections">
            다른 인물을 선택하거나 다른 챕터를 확인해보세요.
          </div>
        )}
      </ConnectionStatusPanel>
    );
  };

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
      <NodeTooltipShell
        {...floatingShell}
        containerStyle={unifiedNodeTooltipStyles.tooltipContainer}
        transition={unifiedNodeAnimations.tooltipComplexTransition(isDragging)}
      >
        <div className="tooltip-content business-card">
          <TooltipCloseButton onClose={onClose} />
          {nodeHeaderAndDescription}
        </div>
      </NodeTooltipShell>
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

        <div
          className="sidebar-section tooltip-analysis-section"
          role="region"
          aria-label="관계 분석"
        >
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="relation-analysis-btn"
          >
            <div className="tooltip-analysis-copy">
              <h4 className="tooltip-section-title">인물 관계 분석</h4>
              <p className="tooltip-analysis-desc">
                {node?.displayName}와 연결된 인물들과의 관계를 시각화합니다
              </p>
            </div>
            <span className="tooltip-analysis-plus">+</span>
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="tooltip-modal-title">관계도 - 확대화면</h2>
              <button type="button" onClick={closeModal} className="modal-close-btn">
                ×
              </button>
            </div>

            <div className="tooltip-modal-body">
              {renderModalRadarBody()}
              {hoveredItem && (
                <HoveredRelationPopup
                  item={hoveredItem}
                  x={hover.x}
                  y={hover.y}
                  onClose={clearHover}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(UnifiedNodeInfo);
