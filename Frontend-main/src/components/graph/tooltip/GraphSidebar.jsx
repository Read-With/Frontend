import React, { useState, useEffect, useRef } from "react";
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
  onStartClosing,
  onClearGraph,
  forceClose,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const previousActiveTooltipRef = useRef(null);
  const animationTimeoutRef = useRef(null);

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
    const prevActiveTooltip = previousActiveTooltipRef.current;
    
    // 새로운 activeTooltip이 생겼을 때 (열기)
    if ((activeTooltip || hasNoRelations) && !prevActiveTooltip) {
      setIsClosing(false);
      setIsVisible(false);
      
      // 다음 프레임에서 애니메이션 시작
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    }
    
    // activeTooltip이 제거될 때 (닫기)
    if (!activeTooltip && !hasNoRelations && prevActiveTooltip) {
      setIsClosing(true);
      
      // 애니메이션 완료 후 닫기
      animationTimeoutRef.current = setTimeout(() => {
        onClose();
        setIsClosing(false);
        setIsVisible(false);
      }, 700);
    }
    
    previousActiveTooltipRef.current = activeTooltip;
  }, [activeTooltip, hasNoRelations, onClose]);

  // 외부에서 강제로 닫기 요청이 있을 때
  useEffect(() => {
    if (forceClose && !isClosing) {
      handleClose();
    }
  }, [forceClose, isClosing]);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    // X 버튼 클릭 시에만 그래프 초기화 (그래프 영역 클릭 시에는 이미 초기화됨)
    if (onClearGraph && !forceClose) {
      onClearGraph();
    }
    if (onStartClosing) {
      onStartClosing(); // 외부에서 애니메이션 시작 알림
    }
    
    // 애니메이션 시작과 동시에 상태 초기화
    setIsClosing(true);
    
    // 애니메이션 완료 후 완전히 닫기 (transition 시간에 맞춤)
    setTimeout(() => {
      onClose();
      setIsClosing(false);
      setIsVisible(false);
    }, 700); // transition: "right 0.7s" 에 맞춤
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
        data-testid="graph-sidebar"
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
  if (activeTooltip?.type === "node") {
    return (
      <div style={commonSidebarStyles} data-testid="graph-sidebar">
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
  if (activeTooltip?.type === "edge") {
    return (
      <div style={commonSidebarStyles} data-testid="graph-sidebar">
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

  return (
    <div
      style={commonSidebarStyles}
      data-testid="graph-sidebar"
      className="graph-sidebar"
    >
      <div style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative"
      }}>
        {/* 헤더 영역 */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
          background: "#f9fafb"
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px"
          }}>
            <div style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: activeTooltip?.type === "node" ? "#3b82f6" : "#10b981"
            }} />
            <span style={{
              fontSize: "16px",
              fontWeight: "600",
              color: "#111827"
            }}>
              {activeTooltip?.type === "node" ? "인물 정보" : "관계 정보"}
            </span>
          </div>
          
          <button
            onClick={handleClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "18px",
              color: "#6b7280",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.target.style.background = "#f3f4f6";
              e.target.style.color = "#374151";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "none";
              e.target.style.color = "#6b7280";
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>

        {/* 내용 영역 */}
        <div style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}>
          {activeTooltip?.type === "node" ? (
            <UnifiedNodeInfo
              nodeData={activeTooltip.data}
              chapterNum={chapterNum}
              eventNum={eventNum}
              maxChapter={maxChapter}
              filename={filename}
              elements={elements}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
              searchTerm={searchTerm}
            />
          ) : (
            <UnifiedEdgeTooltip
              edgeData={activeTooltip.data}
              sourceNode={activeTooltip.sourceNode}
              targetNode={activeTooltip.targetNode}
              chapterNum={chapterNum}
              eventNum={eventNum}
              maxChapter={maxChapter}
              filename={filename}
              elements={elements}
              isSearchActive={isSearchActive}
              filteredElements={filteredElements}
              searchTerm={searchTerm}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default GraphSidebar; 