import React from "react";
import GraphContainer from "../graph/GraphContainer";
import ViewerTopBar from "./ViewerTopBar";
import { filterMainCharacters } from "../../utils/graphDataUtils";
import { bookUtils } from "../../utils/viewerUtils";

const loadingContainerStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: '20px',
  textAlign: 'center',
  backgroundColor: '#f8f9fa',
  borderRadius: '8px',
  border: '1px solid #e9ecef'
};

const loadingIconStyle = {
  fontSize: '48px',
  marginBottom: '16px',
  color: '#5C6F5C',
  animation: 'spin 1s linear infinite'
};

const errorIconStyle = {
  fontSize: '48px',
  marginBottom: '16px',
  color: '#dc3545'
};

const warningIconStyle = {
  fontSize: '48px',
  marginBottom: '16px',
  color: '#6c757d'
};

const titleStyle = {
  color: '#495057',
  marginBottom: '12px',
  fontSize: '18px',
  fontWeight: '600'
};

const descriptionStyle = {
  color: '#6c757d',
  marginBottom: '20px',
  fontSize: '14px',
  lineHeight: '1.5',
  wordBreak: 'keep-all'
};

const retryButtonStyle = {
  backgroundColor: '#5C6F5C',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  padding: '10px 20px',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'background-color 0.2s'
};

const retryButtonHoverStyle = '#4A5A4A';

function GraphSplitArea({
  graphState,
  graphActions,
  viewerState,
  searchState = {},
  searchActions,
  tooltipProps,
  transitionState,
  apiError,
  isFromLibrary = false,
  previousPage = null,
  bookId = null,
  book = null,
  cachedLocation = null,
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const graphContainerRef = React.useRef(null);
  const searchTermValue = searchState?.searchTerm ?? "";
  const isSearchActiveValue = searchState?.isSearchActive ?? false;
  const filteredElementsValue = searchState?.filteredElements ?? [];
  const isResetFromSearchValue = searchState?.isResetFromSearch ?? false;
  const searchFitNodeIds = searchState?.fitNodeIds ?? [];
  const suggestionsValue = searchState?.suggestions ?? [];
  const showSuggestionsValue = searchState?.showSuggestions ?? false;
  const selectedSuggestionIndex = searchState?.selectedIndex ?? -1;
  
  const { loading, isReloading, isGraphLoading, isDataReady } = viewerState;
  const { elements, currentEvent, currentChapter } = graphState;
  const { filterStage } = graphActions;
  
  const isApiBook = React.useMemo(() => {
    return bookUtils.isApiBook(book, bookId);
  }, [book, bookId]);
  
  const hasCachedLocation = React.useMemo(() => {
    if (!cachedLocation) {
      return false;
    }
    const cachedChapter = Number(cachedLocation.chapterIdx);
    if (!Number.isFinite(cachedChapter) || cachedChapter < 1) {
      return false;
    }
    if (isApiBook) {
      const cachedEvent = Number(cachedLocation.eventIdx ?? cachedLocation.eventNum ?? 0);
      return Number.isFinite(cachedEvent) && cachedEvent > 0;
    }
    return true;
  }, [cachedLocation, isApiBook]);

  const isLocationDetermined = React.useMemo(() => {
    if (!currentChapter || currentChapter < 1) {
      return hasCachedLocation;
    }
    if (isApiBook && !currentEvent) {
      return hasCachedLocation;
    }
    return true;
  }, [currentChapter, currentEvent, isApiBook, hasCachedLocation]);

  const filteredMainCharacters = React.useMemo(() => {
    return filterMainCharacters(elements, filterStage);
  }, [elements, filterStage]);

  const finalElements = React.useMemo(() => {
    if (isSearchActiveValue && filteredElementsValue && filteredElementsValue.length > 0) {
      return filteredElementsValue;
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return elements;
  }, [isSearchActiveValue, filteredElementsValue, filterStage, filteredMainCharacters, elements]);

  const hasCurrentEvent = !!currentEvent;
  const hasElements = elements && Array.isArray(elements) && elements.length > 0;
  
  // 로컬 책의 경우 currentEvent가 없어도 elements가 있으면 그래프 표시
  // API 책의 경우 currentEvent와 elements가 모두 필요
  const shouldShowLoading = hasElements
    ? false
    : (loading || isReloading || !isLocationDetermined || (!isDataReady && isApiBook && !hasCurrentEvent));

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        width: "100%",
        overflow: "hidden",
        alignItems: "stretch",
        justifyContent: "stretch",
        boxSizing: "border-box",
        padding: 0,
      }}
    >
      <ViewerTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={viewerState}
        searchState={{
          searchTerm: searchTermValue,
          isSearchActive: isSearchActiveValue,
          elements: graphState.elements ?? [],
          filteredElements: filteredElementsValue,
          isResetFromSearch: isResetFromSearchValue,
          fitNodeIds: searchFitNodeIds,
          suggestions: suggestionsValue,
          showSuggestions: showSuggestionsValue,
          selectedIndex: selectedSuggestionIndex,
        }}
        searchActions={searchActions}
        isFromLibrary={isFromLibrary}
        previousPage={previousPage}
      />
      
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        {shouldShowLoading ? (
          <div style={loadingContainerStyle}>
            <div style={loadingIconStyle}>⏳</div>
            <h3 style={titleStyle}>
              {!isLocationDetermined ? '위치 정보를 확인하는 중...' : 
               transitionState.type === 'chapter' ? '챕터 전환 중...' : 
               '그래프 정보를 불러오는 중...'}
            </h3>
            <p style={descriptionStyle}>
              {!isLocationDetermined ? '현재 읽고 있는 위치를 파악하고 있습니다. 잠시만 기다려주세요.' :
               transitionState.type === 'chapter' ? '새로운 챕터의 이벤트를 준비하고 있습니다.' : 
               '관계 데이터를 분석하고 있습니다.'}
            </p>
          </div>
        ) : apiError ? (
          <div style={loadingContainerStyle}>
            <div style={errorIconStyle}>❌</div>
            <h3 style={titleStyle}>{apiError.message}</h3>
            <p style={descriptionStyle}>{apiError.details}</p>
            <button
              onClick={apiError.retry}
              style={retryButtonStyle}
              onMouseEnter={(e) => { e.target.style.backgroundColor = retryButtonHoverStyle; }}
              onMouseLeave={(e) => { e.target.style.backgroundColor = retryButtonStyle.backgroundColor; }}
            >
              다시 시도
            </button>
          </div>
        ) : transitionState.error ? (
          <div style={loadingContainerStyle}>
            <div style={warningIconStyle}>⚠️</div>
            <h3 style={titleStyle}>일시적인 오류가 발생했습니다</h3>
            <p style={descriptionStyle}>새로고침하면 정상적으로 작동할 것입니다.</p>
            <button
              onClick={() => window.location.reload()}
              style={retryButtonStyle}
              onMouseEnter={(e) => { e.target.style.backgroundColor = retryButtonHoverStyle; }}
              onMouseLeave={(e) => { e.target.style.backgroundColor = retryButtonStyle.backgroundColor; }}
            >
              새로고침
            </button>
          </div>
        ) : (
          <GraphContainer
            ref={graphContainerRef}
            currentPosition={graphState.currentCharIndex}
            currentEvent={graphState.currentEvent}
            currentChapter={graphState.currentChapter}
            edgeLabelVisible={graphState.edgeLabelVisible}
            filename={viewerState.filename}
            elements={finalElements}
            searchTerm={searchTermValue}
            isSearchActive={isSearchActiveValue}
            filteredElements={filteredElementsValue}
            fitNodeIds={searchFitNodeIds}
            isResetFromSearch={isResetFromSearchValue}
            prevValidEvent={graphState.currentEvent && graphState.currentEvent.chapter === graphState.currentChapter ? graphState.currentEvent : null}
            events={graphState.events || []}
            activeTooltip={activeTooltip}
            onClearTooltip={onClearTooltip}
            onSetActiveTooltip={onSetActiveTooltip}
            graphClearRef={graphClearRef}
            isEventTransition={transitionState.type === 'event' && transitionState.inProgress}
            bookId={book?.id ?? bookId}
          />
        )}
      </div>
    </div>
  );
}

export default GraphSplitArea;
