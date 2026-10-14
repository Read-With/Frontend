import "../styles/graph.css";

/** 분할·전체 그래프 상단 챕터/사건 메타 (공통) */
export function GraphTopBarMeta({ chapterLabel, chapterTitle, eventLabel }) {
  return (
    <div className="graph-topbar-meta">
      <span
        className="graph-topbar-meta-chapter"
        title={chapterTitle || chapterLabel}
      >
        {chapterLabel}
      </span>
      {eventLabel != null ? (
        <span className="graph-topbar-meta-event">{eventLabel}</span>
      ) : null}
    </div>
  );
}
