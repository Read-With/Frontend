import React, { useRef, useMemo } from "react";
import GraphContainer from "../graph/GraphContainer";
import ViewerTopBar from "./ViewerTopBar";
import { filterMainCharacters } from "../../utils/graph/graphDataUtils";

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
  bookId = null,
  book = null,
  cachedLocation = null,
  /** 서버 재진입 시 getBookProgress 기반 앵커(이벤트 인덱스 없어도 챕터·locator 확정) */
  resumeAnchor = null,
}) {
  const { activeTooltip, onClearTooltip, onSetActiveTooltip, graphClearRef } = tooltipProps;
  const graphContainerRef = useRef(null);
  const {
    searchTerm: searchTermValue = "",
    isSearchActive: isSearchActiveValue = false,
    filteredElements: filteredElementsValue = [],
    isResetFromSearch: isResetFromSearchValue = false,
    fitNodeIds: searchFitNodeIds = [],
    suggestions: suggestionsValue = [],
    showSuggestions: showSuggestionsValue = false,
    selectedIndex: selectedSuggestionIndex = -1,
  } = searchState;
  
  const { loading, isReloading, isGraphLoading, graphLoading, isDataReady, isDataEmpty } = viewerState;
  const { elements, currentEvent, currentChapter } = graphState;
  const { filterStage } = graphActions;

  const hasResumeLocator = useMemo(() => {
    const loc = resumeAnchor?.startLocator ?? resumeAnchor?.start;
    if (!loc) return false;
    const ch = Number(loc.chapterIndex ?? loc.chapterIdx);
    return Number.isFinite(ch) && ch >= 1;
  }, [resumeAnchor]);

  const hasCachedLocation = useMemo(() => {
    const loc =
      cachedLocation?.startLocator ??
      cachedLocation?.locator ??
      cachedLocation?.anchor?.startLocator ??
      cachedLocation?.anchor?.start;
    if (loc && typeof loc === 'object') {
      const ch = Number(loc.chapterIndex ?? loc.chapterIdx);
      if (Number.isFinite(ch) && ch >= 1) {
        return true;
      }
    }
    if (!cachedLocation) {
      return false;
    }
    const cachedChapter = Number(cachedLocation.chapterIdx);
    if (!Number.isFinite(cachedChapter) || cachedChapter < 1) {
      return false;
    }
    const cachedEvent = Number(cachedLocation.eventNum ?? 0);
    return Number.isFinite(cachedEvent) && cachedEvent > 0;
  }, [cachedLocation]);

  const hasLocationHint = hasCachedLocation || hasResumeLocator;

  const isLocationDetermined = useMemo(() => {
    if (!currentChapter || currentChapter < 1) {
      return hasLocationHint;
    }
    if (!currentEvent) {
      return hasLocationHint;
    }
    return true;
  }, [currentChapter, currentEvent, hasLocationHint]);

  const filteredMainCharacters = useMemo(
    () => filterMainCharacters(elements, filterStage),
    [elements, filterStage]
  );

  const finalElements = useMemo(() => {
    if (isSearchActiveValue && filteredElementsValue && filteredElementsValue.length > 0) {
      return filteredElementsValue;
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return elements;
  }, [isSearchActiveValue, filteredElementsValue, filterStage, filteredMainCharacters, elements]);

  const prevValidEventForGraph = graphState.prevValidEvent ?? null;

  const hasCurrentEvent = !!currentEvent;
  const hasElements = elements && Array.isArray(elements) && elements.length > 0;
  
  // graphLoading이 false이고 isDataEmpty가 true면 데이터 로드 완료 후 데이터 없음 상태
  // 이 경우 다른 로딩 조건들을 무시하고 데이터 없음 메시지를 우선 표시
  const isDataLoadCompleteAndEmpty = graphLoading === false && isDataEmpty && !hasElements;
  
  // 로딩 중인지 확인 (API 호출 중이거나 데이터를 가져오는 중)
  // 단, 데이터 로드 완료 후 데이터가 없는 경우는 제외
  const isLoading = isDataLoadCompleteAndEmpty 
    ? false 
    : (loading || isReloading || !isLocationDetermined || (!isDataReady && !hasCurrentEvent) || (graphLoading !== false && isGraphLoading));
  
  // 로딩 완료 후 데이터가 없는 경우
  const shouldShowEmptyData = isDataLoadCompleteAndEmpty;
  
  // 요소가 없고 로딩 조건을 만족하면 로딩 UI 표시
  const shouldShowLoading = !hasElements && isLoading;

  const topBarSearchState = useMemo(() => ({
    searchTerm: searchTermValue,
    isSearchActive: isSearchActiveValue,
    suggestions: suggestionsValue,
    showSuggestions: showSuggestionsValue,
    selectedIndex: selectedSuggestionIndex,
  }), [searchTermValue, isSearchActiveValue, suggestionsValue, showSuggestionsValue, selectedSuggestionIndex]);

  return (
    <div className="h-full w-full flex flex-col" style={{ minHeight: 0, overflow: "hidden" }}>
      <ViewerTopBar
        graphState={graphState}
        graphActions={graphActions}
        viewerState={viewerState}
        searchState={topBarSearchState}
        searchActions={searchActions}
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
          <div className="h-full w-full relative" style={{ minHeight: 0, minWidth: 0 }}>
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
              prevValidEvent={prevValidEventForGraph}
              events={graphState.events || []}
              activeTooltip={activeTooltip}
              onClearTooltip={onClearTooltip}
              onSetActiveTooltip={onSetActiveTooltip}
              graphClearRef={graphClearRef}
              isEventTransition={transitionState.type === 'event' && transitionState.inProgress}
              bookId={book?.id ?? bookId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default GraphSplitArea;
