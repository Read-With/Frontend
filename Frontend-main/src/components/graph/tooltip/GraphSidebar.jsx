import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import UnifiedNodeInfo from "./UnifiedNodeInfo";
import UnifiedEdgeTooltip from "./UnifiedEdgeTooltip";

// ─── 모듈 상수 ─────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 480;
const TOP_OFFSET = 54;
const ANIMATION_DURATION = 700;

const sidebarBaseStyle = {
  position: "fixed",
  top: `${TOP_OFFSET}px`,
  width: `${SIDEBAR_WIDTH}px`,
  height: `calc(100vh - ${TOP_OFFSET}px)`,
  background: "#fff",
  borderRadius: "0px",
  boxShadow: "2px 0 8px rgba(0,0,0,0.06)",
  borderRight: "1px solid #e5e7eb",
  zIndex: 99999,
  overflow: "hidden",
  transition: `right ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
};

const noRelationsOverlayStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 20px",
  textAlign: "center",
  color: "#6b7280",
};

const noRelationsIconStyle = {
  fontSize: 48,
  marginBottom: 16,
  opacity: 0.5,
};

const noRelationsTitleStyle = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 8,
  color: "#374151",
};

const noRelationsDescStyle = {
  fontSize: 14,
  lineHeight: 1.5,
  maxWidth: 280,
};

// ─── GraphSidebar ──────────────────────────────────────────────────────────────
function GraphSidebar({
  activeTooltip,
  onClose,
  chapterNum,
  eventNum,
  maxChapter,
  hasNoRelations = false,
  filename,
  elements = [],
  isSearchActive = false,
  filteredElements = [],
  searchTerm = "",
  onStartClosing,
  onClearGraph,
  forceClose,
  povSummaries = null,
  apiMacroData = null,
  apiFineData = null,
  bookId = null,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);

  // right 위치는 isClosing/isVisible 상태에만 의존
  const sidebarStyle = useMemo(() => ({
    ...sidebarBaseStyle,
    right: isClosing || !isVisible ? `-${SIDEBAR_WIDTH}px` : "0px",
  }), [isClosing, isVisible]);

  const handleClose = useCallback(() => {
    if (onClearGraph && !forceClose) {
      onClearGraph();
    }
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    onStartClosing?.();

    setIsClosing(true);
    animationTimeoutRef.current = setTimeout(() => {
      onClose();
      setIsClosing(false);
      setIsVisible(false);
      animationTimeoutRef.current = null;
    }, ANIMATION_DURATION);
  }, [onClearGraph, forceClose, onStartClosing, onClose]);

  // 열기 / 닫기 애니메이션
  useEffect(() => {
    const prevActiveTooltip = previousActiveTooltipRef.current;

    if ((activeTooltip || hasNoRelations) && !prevActiveTooltip) {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      setIsClosing(false);
      setIsVisible(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    }

    if (!activeTooltip && !hasNoRelations && prevActiveTooltip) {
      setIsClosing(true);
      animationTimeoutRef.current = setTimeout(() => {
        onClose();
        setIsClosing(false);
        setIsVisible(false);
      }, ANIMATION_DURATION);
    }

    previousActiveTooltipRef.current = activeTooltip;
  }, [activeTooltip, hasNoRelations, onClose]);

  // 외부 강제 닫기
  useEffect(() => {
    if (forceClose && !isClosing) {
      handleClose();
    }
  }, [forceClose, isClosing, handleClose]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  // 완전히 숨겨진 상태
  if (!isVisible && !isClosing && !activeTooltip && !hasNoRelations) {
    return null;
  }

  // 관계 없음 안내
  if (hasNoRelations) {
    return (
      <div style={{ ...sidebarStyle, ...noRelationsOverlayStyle }} data-testid="graph-sidebar">
        <div style={noRelationsIconStyle}>📊</div>
        <h3 style={noRelationsTitleStyle}>관계 데이터가 없습니다</h3>
        <p style={noRelationsDescStyle}>
          현재 챕터와 이벤트에서 인물 간의 관계 정보가 없습니다.
        </p>
      </div>
    );
  }

  // 닫기 애니메이션 중이고 tooltip이 이미 클리어된 경우 — 빈 컨테이너 유지
  if (!activeTooltip) {
    return <div style={sidebarStyle} data-testid="graph-sidebar" />;
  }

  // 노드 툴팁
  if (activeTooltip.type === "node") {
    return (
      <div style={sidebarStyle} data-testid="graph-sidebar">
        <UnifiedNodeInfo
          displayMode="sidebar"
          data={activeTooltip.data}
          onClose={handleClose}
          chapterNum={chapterNum}
          eventNum={eventNum}
          maxChapter={maxChapter}
          elements={elements}
          isSearchActive={isSearchActive}
          filteredElements={filteredElements}
          searchTerm={searchTerm}
          filename={filename}
          povSummaries={povSummaries}
          apiMacroData={apiMacroData}
          apiFineData={apiFineData}
        />
      </div>
    );
  }

  // 간선 툴팁
  return (
    <div style={sidebarStyle} data-testid="graph-sidebar">
      <UnifiedEdgeTooltip
        data={activeTooltip.data}
        sourceNode={activeTooltip.sourceNode}
        targetNode={activeTooltip.targetNode}
        onClose={handleClose}
        chapterNum={chapterNum}
        eventNum={eventNum}
        maxChapter={maxChapter}
        elements={elements}
        displayMode="sidebar"
        filename={filename}
        bookId={bookId}
      />
    </div>
  );
}

export default GraphSidebar;
