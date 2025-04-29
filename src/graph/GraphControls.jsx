import React from "react";
import "./RelationGraph.css";

function GraphControls({
  searchInput,
  setSearchInput,
  onSearch,
  filterType,
  setFilterType,
  onReset,
  relationTypes,
  search,
  setSearch,
  onZoomIn,
  onZoomOut,
  zoomLevel, // ✨ 추가됨
}) {
  return (
    <div className="graph-controls">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(searchInput.trim());
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          type="text"
          placeholder="인물 검색 (이름/별칭)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="search-btn">검색</button>
        {search && (
          <button
            type="button"
            className="search-btn"
            style={{ background: "#bbb" }}
            onClick={() => {
              setSearch("");
              setSearchInput("");
            }}
          >
            전체보기
          </button>
        )}
      </form>

      {/* Zoom 제어 버튼 */}
      <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" }}>
        <button type="button" onClick={onZoomIn}>+</button>
        <button type="button" onClick={onZoomOut}>-</button>
        <span style={{ fontSize: "14px", fontWeight: "bold" }}>
          Zoom: {zoomLevel}%
        </span>
      </div>

      {/* 초기화 버튼 */}
      <button
        type="button"
        className="reset-btn"
        onClick={onReset}
        title="그래프를 완전히 초기 상태로 복구"
      >
        초기화
      </button>

      {/* 관계 필터 버튼 */}
      <div className="filter-group">
        <button
          className={filterType === "all" ? "active" : ""}
          onClick={() => setFilterType("all")}
        >
          전체
        </button>
        {relationTypes.map((type) => (
          <button
            key={type}
            className={filterType === type ? "active" : ""}
            onClick={() => setFilterType(type)}
          >
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}

export default GraphControls;
