import React from "react";
import GraphContainer from "../graph/GraphContainer";
import ViewerTopBar from "./ViewerTopBar";
import { filterMainCharacters } from "../../utils/graph/graphDataUtils";
import { bookUtils } from "../../utils/viewer/viewerUtils";

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

const handleButtonHover = (e, isEntering) => {
  e.target.style.backgroundColor = isEntering ? retryButtonHoverStyle : retryButtonStyle.backgroundColor;
};

const ErrorMessage = ({ icon, title, description, buttonText, onButtonClick }) => (
  <div style={loadingContainerStyle}>
    <div style={icon === '❌' ? errorIconStyle : warningIconStyle}>{icon}</div>
    <h3 style={titleStyle}>{title}</h3>
    <p style={descriptionStyle}>{description}</p>
    {buttonText && onButtonClick && (
      <button
        onClick={onButtonClick}
        style={retryButtonStyle}
        onMouseEnter={(e) => handleButtonHover(e, true)}
        onMouseLeave={(e) => handleButtonHover(e, false)}
      >
        {buttonText}
      </button>
    )}
  </div>
);

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
  
  const { loading, isReloading, isGraphLoading, graphLoading, isDataReady, isDataEmpty } = viewerState;
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
  
  // graphLoading이 false이고 isDataEmpty가 true면 데이터 로드 완료 후 데이터 없음 상태
  // 이 경우 다른 로딩 조건들을 무시하고 데이터 없음 메시지를 우선 표시
  const isDataLoadCompleteAndEmpty = graphLoading === false && isDataEmpty && !hasElements;
  
  // 로딩 중인지 확인 (API 호출 중이거나 데이터를 가져오는 중)
  // 단, 데이터 로드 완료 후 데이터가 없는 경우는 제외
  const isLoading = isDataLoadCompleteAndEmpty 
    ? false 
    : (loading || isReloading || !isLocationDetermined || (!isDataReady && isApiBook && !hasCurrentEvent) || (graphLoading !== false && isGraphLoading));
  
  // 로딩 완료 후 데이터가 없는 경우
  const shouldShowEmptyData = isDataLoadCompleteAndEmpty;
  
  // 로컬 책의 경우 currentEvent가 없어도 elements가 있으면 그래프 표시
  // API 책의 경우 currentEvent와 elements가 모두 필요
  const shouldShowLoading = hasElements ? false : isLoading;

  return (
    <div className="h-full w-full flex flex-col" style={{ minHeight: 0, overflow: "hidden" }}>
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
        ) : shouldShowEmptyData ? (
          <div style={loadingContainerStyle}>
            <div style={warningIconStyle}>📭</div>
            <h3 style={titleStyle}>아직 이벤트가 없습니다</h3>
            <p style={descriptionStyle}>
              현재 챕터에는 그래프 데이터가 없습니다. 이벤트가 생성되면 여기에 표시됩니다.
            </p>
          </div>
        ) : apiError ? (
          <ErrorMessage 
            icon="❌" 
            title={apiError.message} 
            description={apiError.details}
            buttonText="다시 시도"
            onButtonClick={apiError.retry}
          />
        ) : transitionState.error ? (
          <ErrorMessage 
            icon="⚠️" 
            title="일시적인 오류가 발생했습니다" 
            description="새로고침하면 정상적으로 작동할 것입니다."
            buttonText="새로고침"
            onButtonClick={() => window.location.reload()}
          />
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
