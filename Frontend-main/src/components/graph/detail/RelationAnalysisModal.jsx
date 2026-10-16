import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { GRAPH_LAYOUT_CONSTANTS, RELATION_CONNECTION_KIND } from '../../../utils/graph/graphCore';
import { cycleIndex } from '../../../utils/common/valueUtils.js';
import { joinClasses } from '../../../utils/common/domUtils';
import { NodeProfileAvatar } from './GraphTooltipParts';
import RelationRadarChart from './RelationRadarChart';
import { RelationList, FewConnectionsPanel } from './RelationOptions';
import { useLatestRef } from '../../../hooks/common/hooksShared';
import ModalFrame from '../../common/ModalFrame';
import '../styles/graph.css';

const CONNECTION = RELATION_CONNECTION_KIND;
const TITLE_ID = 'relation-analysis-modal-title';

const SIBLING_NAV = [
  { dir: -1, label: '이전 연결 인물로 분석 전환', text: '‹' },
  { dir: 1, label: '다음 연결 인물로 분석 전환', text: '›' },
];

const ARROW_DIR = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** 연결 종류별 레이아웃: 레이더 차트 여부 + overlay·container·body 클래스 */
function resolveModalLayout(connectionKind) {
  const isCardView = connectionKind === CONNECTION.SINGLE || connectionKind === CONNECTION.PAIR;
  const isEmptyKind = connectionKind === CONNECTION.NONE || connectionKind === CONNECTION.ERROR;
  const hasChart = connectionKind === CONNECTION.SUFFICIENT;
  const isCompact = isCardView || isEmptyKind;
  return {
    hasChart,
    overlayClass: joinClasses('modal-overlay', 'relation-modal-overlay--graph-page', isCompact && 'is-compact'),
    containerClass: joinClasses(
      'modal-container',
      'relation-modal-container',
      isCompact && 'relation-modal-container--compact',
      connectionKind === CONNECTION.PAIR && 'is-pair',
      connectionKind === CONNECTION.SINGLE && 'is-single',
      isEmptyKind && 'is-empty',
    ),
    bodyClass: joinClasses(
      'tooltip-modal-body',
      'relation-modal-body',
      hasChart && 'has-chart',
      isCardView && 'is-card-view',
      isEmptyKind && 'is-empty-view',
    ),
  };
}

/** 챕터 레일·오른쪽 슬라이드바를 피해 모달 위치를 CSS 변수로 */
function buildOverlayStyle(chapterRailWidth, reserveRight, hasChart) {
  const inset = GRAPH_LAYOUT_CONSTANTS.ANALYSIS_MODAL_INSET;
  const left = Math.max(0, Number(chapterRailWidth) || 0) + inset;
  // 레이더를 쓸 만큼 연결이 충분하면 노드 슬라이드바까지 덮어 차트 영역을 최대화
  const rightPad = hasChart ? 0 : Math.max(0, Number(reserveRight) || 0);
  return {
    '--relation-modal-top': `${GRAPH_LAYOUT_CONSTANTS.PAGE_CHROME_OFFSET}px`,
    '--relation-modal-left': `${left}px`,
    '--relation-modal-right': `${rightPad + inset}px`,
    '--relation-modal-inset': `${inset}px`,
  };
}

/** 활성 연결 인물: 데이터가 바뀌면 첫 인물, 화살표 키로 순환 */
function useActiveRelation(nodeId, items) {
  const [activeName, setActiveName] = useState(null);
  const activeNameRef = useLatestRef(activeName);
  const itemsRef = useLatestRef(items);

  useEffect(() => {
    setActiveName(items[0]?.name ?? null);
  }, [nodeId, items]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const dir = ARROW_DIR[e.key];
      const targets = itemsRef.current || [];
      if (!dir || !targets.length) return;
      e.preventDefault();
      const idx = targets.findIndex((item) => item.name === activeNameRef.current);
      setActiveName(targets[cycleIndex(idx, targets.length, dir)].name);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activeNameRef, itemsRef]);

  const activate = useCallback((item) => {
    if (item?.name) setActiveName(item.name);
  }, []);

  return { activeName, activate };
}

function EmptyMessage({ error = false, children }) {
  return (
    <div
      className={joinClasses('relation-modal-empty-message', error && 'is-error')}
      role={error ? 'alert' : 'status'}
    >
      <p>{children}</p>
    </div>
  );
}

/** 연결 종류별 본문 패널: 오류 · 카드(1~2명) · 없음 · 목록(레이더 옆) */
function RelationModalPanel({ connectionKind, loadError, items, sourceName, activeName, onSelect, onSwitch }) {
  if (connectionKind === CONNECTION.ERROR) {
    return (
      <EmptyMessage error>
        {loadError || '관계 분석 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
      </EmptyMessage>
    );
  }
  if (connectionKind === CONNECTION.NONE) {
    return <EmptyMessage>이 챕터 범위에서 연결된 인물이 없습니다. 다른 챕터를 선택해 보세요.</EmptyMessage>;
  }
  if (connectionKind === CONNECTION.SINGLE || connectionKind === CONNECTION.PAIR) {
    return (
      <FewConnectionsPanel
        items={items}
        activeName={activeName}
        onSelect={onSelect}
        onSwitch={onSwitch}
        sourceName={sourceName}
        connectionKind={connectionKind}
      />
    );
  }
  return (
    <div className="relation-modal-side">
      <div className="relation-modal-side-title">연결된 인물</div>
      <RelationList items={items} activeName={activeName} onSelect={onSelect} onSwitch={onSwitch} />
    </div>
  );
}

function RelationModalHeader({ node, isError, count, onSibling, closeBtnRef, onClose }) {
  return (
    <div className="modal-header relation-modal-header">
      <div className="relation-modal-header-main">
        <NodeProfileAvatar node={node} size={40} className="relation-modal-avatar" innerClassName={null} />
        <div className="relation-modal-header-copy">
          <h2 id={TITLE_ID} className="tooltip-modal-title">
            {node?.displayName || '인물'} 관계 분석
          </h2>
          {isError ? (
            <span className="relation-modal-chip relation-modal-chip--error">로드 실패</span>
          ) : (
            <span className="relation-modal-chip">연결 {count}명</span>
          )}
        </div>
      </div>
      <div className="relation-modal-header-actions">
        {onSibling && (
          <div className="relation-modal-switcher">
            {SIBLING_NAV.map(({ dir, label, text }) => (
              <button
                key={label}
                type="button"
                className="relation-modal-nav-btn"
                aria-label={label}
                onClick={() => onSibling(dir)}
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
  );
}

function RelationAnalysisModalImpl({
  node,
  radarChartData,
  connectionKind,
  loadError,
  onClose,
  onSelectRelatedNode,
  returnFocusRef,
  chapterRailWidth,
  /** 슬라이드바(툴팁 패널)가 열려 있을 때 오른쪽 예약 너비 (레이더 표시 시엔 무시) */
  reserveRight,
}) {
  const closeBtnRef = useRef(null);
  const { activeName, activate } = useActiveRelation(node?.id, radarChartData);
  const layout = resolveModalLayout(connectionKind);

  const overlayStyle = useMemo(
    () => buildOverlayStyle(chapterRailWidth, reserveRight, layout.hasChart),
    [chapterRailWidth, reserveRight, layout.hasChart],
  );

  const switchToRelated = useCallback((item) => {
    if (!item || !onSelectRelatedNode) return;
    onSelectRelatedNode(item.id || item.name, { keepAnalysisOpen: true });
  }, [onSelectRelatedNode]);

  const activeIndex = radarChartData.findIndex((item) => item.name === activeName);
  const goSibling = useCallback((direction) => {
    if (!radarChartData.length) return;
    switchToRelated(radarChartData[cycleIndex(activeIndex, radarChartData.length, direction)]);
  }, [radarChartData, activeIndex, switchToRelated]);

  const canSwitch = Boolean(onSelectRelatedNode);
  const nodeName = node?.displayName;

  // 포커스 트랩·Escape(캡처 단계)·닫을 때 분석 버튼으로 포커스 복귀
  return (
    <ModalFrame
      open
      onClose={onClose}
      onEscape={onClose}
      overlayClassName={layout.overlayClass}
      overlayStyle={overlayStyle}
      className={layout.containerClass}
      labelledBy={TITLE_ID}
      initialFocusRef={closeBtnRef}
      returnFocusRef={returnFocusRef}
      captureEscape
      lockScroll
    >
      <RelationModalHeader
        node={node}
        isError={connectionKind === CONNECTION.ERROR}
        count={radarChartData.length}
        onSibling={canSwitch && radarChartData.length > 1 ? goSibling : null}
        closeBtnRef={closeBtnRef}
        onClose={onClose}
      />

      <div className={layout.bodyClass}>
        {layout.hasChart ? (
          <RelationRadarChart
            nodeName={nodeName}
            data={radarChartData}
            activeName={activeName}
            onActivate={activate}
          />
        ) : null}
        <RelationModalPanel
          connectionKind={connectionKind}
          loadError={loadError}
          items={radarChartData}
          sourceName={nodeName}
          activeName={activeName}
          onSelect={activate}
          onSwitch={canSwitch ? switchToRelated : null}
        />
      </div>
    </ModalFrame>
  );
}

const RelationAnalysisModal = memo(RelationAnalysisModalImpl);

export default RelationAnalysisModal;
