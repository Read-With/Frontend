import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { GRAPH_LAYOUT_CONSTANTS, RELATION_CONNECTION_KIND } from "../../../utils/graph/graphCore";
import { cycleIndex } from '../../../utils/common/valueUtils.js';
import { joinClasses } from '../../../utils/styles/styles.js';
import { NodeProfileAvatar } from './GraphTooltipParts';
import RelationRadarChart from './RelationRadarChart';
import { RelationList, FewConnectionsPanel } from './RelationOptions';
import { useLatestRef, useModalFocusTrap, useBodyScrollLock } from '../../../hooks/common/hooksShared';
import '../styles/graph.css';

const CONNECTION = RELATION_CONNECTION_KIND;

const SIBLING_NAV = [
  { dir: -1, label: '이전 연결 인물로 분석 전환', text: '‹' },
  { dir: 1, label: '다음 연결 인물로 분석 전환', text: '›' },
];

function RelationAnalysisModalImpl({
  node,
  radarChartData = [],
  connectionKind,
  loadError = null,
  onClose,
  onSelectRelatedNode,
  returnFocusRef,
  chapterRailWidth = GRAPH_LAYOUT_CONSTANTS.SIDEBAR.OPEN_WIDTH,
  /**
   * 슬라이드바(툴팁 패널)가 열려 있을 때 오른쪽 예약 너비.
   * 연결이 충분해 레이더를 쓸 때는 0으로 두어 슬라이드바 영역까지 펼침.
   */
  reserveRight = 0,
}) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const [activeName, setActiveName] = useState(null);
  const activeNameRef = useLatestRef(activeName);
  const switchTargetsRef = useLatestRef(radarChartData);

  const overlayStyle = useMemo(() => {
    const inset = GRAPH_LAYOUT_CONSTANTS.ANALYSIS_MODAL_INSET;
    const top = GRAPH_LAYOUT_CONSTANTS.PAGE_CHROME_OFFSET;
    const left = Math.max(0, Number(chapterRailWidth) || 0) + inset;
    // sufficient_connections: 노드 슬라이드바까지 덮어 레이더 영역을 최대화
    const rightPad =
      connectionKind === CONNECTION.SUFFICIENT
        ? 0
        : Math.max(0, Number(reserveRight) || 0);
    const right = rightPad + inset;
    return {
      '--relation-modal-top': `${top}px`,
      '--relation-modal-left': `${left}px`,
      '--relation-modal-right': `${right}px`,
      '--relation-modal-inset': `${inset}px`,
    };
  }, [chapterRailWidth, reserveRight, connectionKind]);

  const activeIndex = radarChartData.findIndex((item) => item.name === activeName);

  useEffect(() => {
    setActiveName(radarChartData[0]?.name ?? null);
  }, [node?.id, radarChartData]);

  // 포커스 트랩·Escape(캡처 단계)·닫을 때 분석 버튼으로 포커스 복귀
  useModalFocusTrap(true, dialogRef, onClose, {
    initialFocusRef: closeBtnRef,
    returnFocusRef,
    capture: true,
  });
  useBodyScrollLock();

  // 화살표: 연결 인물 순환 선택
  useEffect(() => {
    const onKeyDown = (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const targets = switchTargetsRef.current || [];
      if (!dir || !targets.length) return;
      e.preventDefault();
      const idx = targets.findIndex((item) => item.name === activeNameRef.current);
      setActiveName(targets[cycleIndex(idx, targets.length, dir)].name);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activeNameRef, switchTargetsRef]);

  const activateItem = useCallback((item) => {
    if (!item?.name) return;
    setActiveName(item.name);
  }, []);

  const switchToRelated = useCallback((item) => {
    if (!item || !onSelectRelatedNode) return;
    onSelectRelatedNode(item.id || item.name, { keepAnalysisOpen: true });
  }, [onSelectRelatedNode]);

  const goSibling = useCallback((direction) => {
    if (!radarChartData.length) return;
    switchToRelated(radarChartData[cycleIndex(activeIndex, radarChartData.length, direction)]);
  }, [radarChartData, activeIndex, switchToRelated]);

  const isCardView =
    connectionKind === CONNECTION.SINGLE || connectionKind === CONNECTION.PAIR;
  const isEmptyKind =
    connectionKind === CONNECTION.NONE || connectionKind === CONNECTION.ERROR;
  const isCompactModal = isCardView || isEmptyKind;

  let bodyPanel = null;
  if (connectionKind === CONNECTION.ERROR) {
    bodyPanel = (
      <div className="relation-modal-empty-message is-error" role="alert">
        <p>
          {loadError || '관계 분석 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
        </p>
      </div>
    );
  } else if (isCardView) {
    bodyPanel = (
      <FewConnectionsPanel
        items={radarChartData}
        activeName={activeName}
        onSelect={activateItem}
        onSwitch={onSelectRelatedNode ? switchToRelated : null}
        sourceName={node?.displayName}
        connectionKind={connectionKind}
      />
    );
  } else if (connectionKind === CONNECTION.NONE) {
    bodyPanel = (
      <div className="relation-modal-empty-message" role="status">
        <p>
          이 챕터 범위에서 연결된 인물이 없습니다. 다른 챕터를 선택해 보세요.
        </p>
      </div>
    );
  } else {
    bodyPanel = (
      <div className="relation-modal-side">
        <div className="relation-modal-side-title">연결된 인물</div>
        <RelationList
          items={radarChartData}
          activeName={activeName}
          onSelect={activateItem}
          onSwitch={onSelectRelatedNode ? switchToRelated : null}
        />
      </div>
    );
  }

  const titleId = 'relation-analysis-modal-title';
  const bodyClassName = joinClasses(
    'tooltip-modal-body',
    'relation-modal-body',
    connectionKind === CONNECTION.SUFFICIENT && 'has-chart',
    isCardView && 'is-card-view',
    isEmptyKind && 'is-empty-view',
  );

  const containerClassName = joinClasses(
    'modal-container',
    'relation-modal-container',
    isCompactModal && 'relation-modal-container--compact',
    connectionKind === CONNECTION.PAIR && 'is-pair',
    connectionKind === CONNECTION.SINGLE && 'is-single',
    isEmptyKind && 'is-empty',
  );

  return (
    <div
      className={joinClasses(
        'modal-overlay',
        'relation-modal-overlay--graph-page',
        isCompactModal && 'is-compact',
      )}
      style={overlayStyle}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={containerClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header relation-modal-header">
          <div className="relation-modal-header-main">
            <NodeProfileAvatar
              node={node}
              size={40}
              className="relation-modal-avatar"
              innerClassName={null}
            />
            <div className="relation-modal-header-copy">
              <h2 id={titleId} className="tooltip-modal-title">
                {node?.displayName || '인물'} 관계 분석
              </h2>
              {connectionKind === CONNECTION.ERROR ? (
                <span className="relation-modal-chip relation-modal-chip--error">로드 실패</span>
              ) : (
                <span className="relation-modal-chip">연결 {radarChartData.length}명</span>
              )}
            </div>
          </div>
          <div className="relation-modal-header-actions">
            {onSelectRelatedNode && radarChartData.length > 1 && (
              <div className="relation-modal-switcher">
                {SIBLING_NAV.map(({ dir, label, text }) => (
                  <button
                    key={label}
                    type="button"
                    className="relation-modal-nav-btn"
                    aria-label={label}
                    onClick={() => goSibling(dir)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="modal-close-btn"
              aria-label="관계 분석 닫기"
            >
              ×
            </button>
          </div>
        </div>

        <div className={bodyClassName}>
          {connectionKind === CONNECTION.SUFFICIENT ? (
            <RelationRadarChart
              nodeName={node?.displayName}
              data={radarChartData}
              activeName={activeName}
              onActivate={activateItem}
            />
          ) : null}
          {bodyPanel}
        </div>
      </div>
    </div>
  );
}

const RelationAnalysisModal = memo(RelationAnalysisModalImpl);

export default RelationAnalysisModal;
