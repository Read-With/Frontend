import React from "react";
import "./RelationGraph.css";
import { FaSearch, FaUndo } from "react-icons/fa";

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
      style={{ margin: '0', maxWidth: '400px' }}
      onSubmit={(e) => {
        e.preventDefault();
        handleSearch(searchInput.trim());
      }}
    >
      <input
        className="advanced-search-input"
        style={{ width: '180px' }}
        type="text"
        placeholder="인물 검색 (이름/별칭)"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      <button type="submit" className="advanced-search-btn">
        <FaSearch size={14} />
        <span>검색</span>
      </button>
      {search && (
        <button
          type="button"
          className="advanced-reset-btn"
          onClick={handleReset}
        >
          <FaUndo size={14} />
          <span>초기화</span>
        </button>
      )}
    </form>
  );
}

export default GraphControls;