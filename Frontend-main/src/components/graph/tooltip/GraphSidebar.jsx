import React from "react";
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
  // 관계가 없을 때 안내 메시지 표시
  if (hasNoRelations) {
    return (
      <div
        style={{
          position: "absolute",
          top: "60px", // 상단 아래부터 시작
          right: "0px",
          width: "450px",
          height: "calc(100vh - 60px)", // 웹 페이지 맨 아래까지 (상단 60px 제외)
          background: "#fff",
          borderRadius: "0px", // 둥근 모서리 제거
          boxShadow: "2px 0 8px rgba(0,0,0,0.06)", // 챕터 슬라이드바와 동일한 그림자
          borderRight: "1px solid #e5e7eb", // 챕터 슬라이드바와 동일한 테두리
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
          textAlign: "center",
          color: "#6b7280",
          zIndex: 1000,
          overflow: "hidden",
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

  // 툴팁이 없을 때는 아무것도 표시하지 않음
  if (!activeTooltip) {
    return null;
  }

  // 노드 툴팁 렌더링 - UnifiedNodeInfo 사용
  if (activeTooltip.type === "node") {
    return (
      <div
        style={{
          position: "absolute",
          top: "60px", // 상단 아래부터 시작
          right: "0px",
          width: "450px",
          height: "calc(100vh - 60px)", // 웹 페이지 맨 아래까지 (상단 60px 제외)
          background: "#fff",
          borderRadius: "0px", // 둥근 모서리 제거
          boxShadow: "2px 0 8px rgba(0,0,0,0.06)", // 챕터 슬라이드바와 동일한 그림자
          borderRight: "1px solid #e5e7eb", // 챕터 슬라이드바와 동일한 테두리
          zIndex: 1000,
          overflow: "hidden",
        }}
      >
        <UnifiedNodeInfo
          displayMode="sidebar"
          data={activeTooltip.data}
          onClose={onClose}
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
          position: "absolute",
          top: "60px", // 상단 아래부터 시작
          right: "0px",
          width: "450px",
          height: "calc(100vh - 60px)", // 웹 페이지 맨 아래까지 (상단 60px 제외)
          background: "#fff",
          borderRadius: "0px", // 둥근 모서리 제거
          boxShadow: "2px 0 8px rgba(0,0,0,0.06)", // 챕터 슬라이드바와 동일한 그림자
          borderRight: "1px solid #e5e7eb", // 챕터 슬라이드바와 동일한 테두리
          zIndex: 1000,
          overflow: "hidden",
          animation: "slideInFromRight 0.3s ease-out",
          // 반응형 디자인
          "@media (max-width: 768px)": {
            width: "100vw",
            right: "0px",
          },
        }}
      >
        <UnifiedEdgeTooltip
          data={activeTooltip.data}
          onClose={onClose}
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