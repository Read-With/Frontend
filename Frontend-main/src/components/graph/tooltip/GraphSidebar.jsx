import React, { useState, useEffect } from "react";
import UnifiedNodeInfo from "./UnifiedNodeInfo";
import UnifiedEdgeTooltip from "./UnifiedEdgeTooltip";

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
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // 공통 스타일 객체
  const commonSidebarStyles = {
    position: "absolute",
    top: "54px",
    right: isClosing ? "-450px" : (isVisible ? "0px" : "-450px"),
    width: "450px",
    height: "calc(100vh - 54px)",
    background: "#fff",
    borderRadius: "0px",
    boxShadow: "2px 0 8px rgba(0,0,0,0.06)",
    borderRight: "1px solid #e5e7eb",
    zIndex: 1000,
    overflow: "hidden",
    transition: "right 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
  };

  // 슬라이드바가 열릴 때 애니메이션 처리
  useEffect(() => {
    if (activeTooltip || hasNoRelations) {
      // 스르륵 애니메이션을 위해 먼저 숨김 상태로 시작
      setIsVisible(false);
      setIsClosing(false);
      
      // 다음 프레임에서 애니메이션 시작
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      setIsClosing(false);
    }
  }, [activeTooltip, hasNoRelations]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
      setIsVisible(false);
    }, 700); // 애니메이션 시간과 동일
  };
  // 관계가 없을 때 안내 메시지 표시
  if (hasNoRelations) {
    return (
      <div
        style={{
          ...commonSidebarStyles,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
          textAlign: "center",
          color: "#6b7280",
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
            opacity: 0.5,
          }}
        >
          📊
        </div>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 8,
            color: "#374151",
          }}
        >
          관계 데이터가 없습니다
        </h3>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            maxWidth: 280,
          }}
        >
          현재 챕터와 이벤트에서 인물 간의 관계 정보가 없습니다.
        </p>
      </div>
    );
  }

  // 슬라이드바가 완전히 숨겨져 있을 때만 렌더링하지 않음
  if (!isVisible && !isClosing && !activeTooltip && !hasNoRelations) {
    return null;
  }

  // 노드 툴팁 렌더링 - UnifiedNodeInfo 사용
  if (activeTooltip.type === "node") {
    return (
      <div style={commonSidebarStyles}>
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
        />
      </div>
    );
  }

  // 간선 툴팁 렌더링
  if (activeTooltip.type === "edge") {
    return (
      <div
        style={{
          ...commonSidebarStyles,
          // 반응형 디자인
          "@media (max-width: 768px)": {
            width: "100vw",
            right: isClosing ? "-100vw" : (isVisible ? "0px" : "-100vw"),
          },
        }}
      >
        <UnifiedEdgeTooltip
          data={activeTooltip.data}
          onClose={handleClose}
          chapterNum={chapterNum}
          eventNum={eventNum}
          maxChapter={maxChapter}
          elements={elements}
          displayMode="sidebar"
        />
      </div>
    );
  }

  return null;
}

export default GraphSidebar; 