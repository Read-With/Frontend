import React from "react";
import "./RelationGraph.css";

function GraphControls({
  searchInput,
  setSearchInput,
  handleSearch,
  handleReset,
  handleFitView,
  search,
  setSearch,
  handleViewTimeline
}) {
  return (
    <form
      className="advanced-search-form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSearch(searchInput.trim());
      }}
    >
      <input
        className="advanced-search-input"
        type="text"
        placeholder="인물 검색 (이름/별칭)"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      <button type="submit" className="advanced-search-btn">
        검색
      </button>
      <button
        type="button"
        className="advanced-fit-btn"
        onClick={handleViewTimeline}
      >
        타임라인
      </button>
      {search && (
        <button
          type="button"
          className="advanced-reset-btn"
          onClick={() => {
            window.location.reload();
          }}
        >
          초기화
        </button>
      )}
    </form>
  );
}

export default GraphControls;