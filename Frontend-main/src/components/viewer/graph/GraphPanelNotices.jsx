/** 뷰어 분할 그래프 패널 안내: 빈 이벤트 · 로딩 · 오류 · 필터 결과 없음 · 갱신 오버레이 */

import { AlertCircle, Filter, Inbox, Loader2 } from 'lucide-react';
import '../../graph/styles/graph.css';

/** 빈/로딩/에러 패널 (분할 그래프) */
function GraphNoticePanel({ variant, title, description, icon, actions }) {
  const isLoading = variant === 'loading';
  const TitleTag = isLoading ? 'p' : 'h3';

  return (
    <div
      className={`graph-panel-status graph-panel-status--${variant}`}
      role={isLoading ? 'status' : variant === 'error' ? 'alert' : undefined}
      aria-live={isLoading ? 'polite' : undefined}
    >
      <div className={`graph-panel-status-icon graph-panel-status-icon--${variant}`} aria-hidden>
        {icon}
      </div>
      <div className="graph-panel-status-copy">
        <TitleTag className="graph-panel-status-title">{title}</TitleTag>
        {description ? <p className="graph-panel-status-desc">{description}</p> : null}
      </div>
      {actions ? <div className="graph-panel-status-actions">{actions}</div> : null}
    </div>
  );
}

function GraphPanelButton({ variant = 'primary', onClick, children }) {
  return (
    <button type="button" className={`graph-panel-btn graph-panel-btn--${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function GraphEmptyEventsNotice({ onToggleGraph, onOpenRelationGraph }) {
  return (
    <GraphNoticePanel
      variant="empty"
      title="아직 이벤트가 없습니다"
      description="이 챕터에는 표시할 그래프 데이터가 없습니다. 본문을 더 읽거나 그래프를 닫을 수 있습니다."
      icon={<Inbox size={24} strokeWidth={1.75} aria-hidden />}
      actions={
        <>
          {onToggleGraph ? (
            <GraphPanelButton variant="secondary" onClick={onToggleGraph}>그래프 닫기</GraphPanelButton>
          ) : null}
          <GraphPanelButton onClick={onOpenRelationGraph}>전체 관계도 열기</GraphPanelButton>
        </>
      }
    />
  );
}

export function GraphRefreshOverlay() {
  return (
    <div className="graph-refresh-overlay" role="status" aria-live="polite" aria-label="그래프 전환 중">
      <div className="graph-refresh-chip">
        <Loader2 size={16} className="graph-spin" strokeWidth={2} aria-hidden />
        <span>이벤트 반영 중</span>
      </div>
    </div>
  );
}

export function GraphFilteredEmptyNotice({ className, onReset }) {
  return (
    <div className={className}>
      <GraphNoticePanel
        variant="empty"
        title="조건에 맞는 인물이 없습니다"
        description="현재 필터에 해당하는 핵심 인물이 이 챕터에는 없습니다. 필터를 해제하면 전체 인물을 볼 수 있습니다."
        icon={<Filter size={24} strokeWidth={1.75} aria-hidden />}
        actions={<GraphPanelButton onClick={onReset}>필터 해제</GraphPanelButton>}
      />
    </div>
  );
}

export function GraphLoadingNotice({ className, notice }) {
  return (
    <div className={className}>
      <GraphNoticePanel
        variant="loading"
        title={notice.title}
        description={notice.description}
        icon={<Loader2 size={20} className="graph-spin" strokeWidth={2} aria-hidden />}
      />
    </div>
  );
}

export function GraphErrorNotice({ className, error }) {
  return (
    <div className={`${className} graph-fill-overlay--error`}>
      <GraphNoticePanel
        variant="error"
        title={error.message || '문제가 발생했습니다'}
        description={error.details || '잠시 후 다시 시도해 주세요.'}
        icon={<AlertCircle size={24} strokeWidth={2} aria-hidden />}
        actions={error.retry ? <GraphPanelButton onClick={error.retry}>다시 시도</GraphPanelButton> : null}
      />
    </div>
  );
}
