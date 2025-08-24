import React, { useState, useEffect, useRef } from "react";
import StandaloneRelationGraph from "./RelationGraph_Graphpage";
import EdgeLabelToggle from "./tooltip/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes, FaBars, FaChevronLeft } from 'react-icons/fa';

import { convertRelationsToElements, calcGraphDiff } from '../../utils/graphDataUtils.js';
import { getCharactersData, getEventDataByIndex, getLastEventIndexForChapter,getFolderKeyFromFilename} from '../../utils/graphData';
import { normalizeRelation, isValidRelation } from '../../utils/relationUtils';
import { DEFAULT_LAYOUT, SEARCH_LAYOUT } from '../../utils/graphStyles';
import { useGraphSearch } from '../../hooks/useGraphSearch';

function RelationGraphWrapper() {
  const navigate = useNavigate();
  const { filename } = useParams();
  
  const [currentChapter, setCurrentChapter] = useState(() => {
    const saved = localStorage.getItem('lastGraphChapter');
    return saved ? Number(saved) : 1;
  });
  const [elements, setElements] = useState([]);
  const [maxChapter, setMaxChapter] = useState(9);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [eventNum, setEventNum] = useState(0);
  const [maxEventNum, setMaxEventNum] = useState(0);
  const [graphViewState, setGraphViewState] = useState(null);
  const [newNodeIds, setNewNodeIds] = useState([]);
  const [chapterEvents, setChapterEvents] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [currentChapterData, setCurrentChapterData] = useState(null);
  
  // 검색 관련 상태를 useGraphSearch 훅으로 관리
  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    handleSearchSubmit,
    clearSearch
  } = useGraphSearch(elements, (searchState) => {
    // 검색 상태 변경 시 레이아웃 업데이트
    if (searchState.isSearchActive && searchState.filteredElements.length > 0) {
      setCurrentLayout(SEARCH_LAYOUT);
    } else {
      setCurrentLayout(DEFAULT_LAYOUT);
    }
  }, currentChapterData);

  // 레이아웃 상태
  const [currentLayout, setCurrentLayout] = useState(DEFAULT_LAYOUT);

  // 이전 elements 참조 (diff 계산용)
  const prevElementsRef = useRef([]);

  // 챕터 변경 시 해당 챕터의 마지막 이벤트 번호를 찾아서 elements 세팅
  useEffect(() => {
    // filename을 기반으로 folderKey 결정
    const folderKey = getFolderKeyFromFilename(filename);
    
    // graphData.js를 사용하여 데이터 로드
    const lastEventIndex = getLastEventIndexForChapter(folderKey, currentChapter);
    if (lastEventIndex === 0) {
      setElements([]);
      setNewNodeIds([]);
      setMaxEventNum(0);
      setEventNum(0);
      return;
    }

    setMaxEventNum(lastEventIndex);
    setEventNum(lastEventIndex);

    // 마지막 이벤트 데이터 로드
    const eventData = getEventDataByIndex(folderKey, currentChapter, lastEventIndex);
    if (!eventData) {
      setElements([]);
      setNewNodeIds([]);
      return;
    }

    // 캐릭터 데이터 로드
    const charData = getCharactersData(folderKey, currentChapter);
    
    // 현재 챕터 데이터 저장 (검색 필터링용)
    setCurrentChapterData(charData);
    
    // elements 변환 (viewer와 동일하게 idToName에 common_name 우선)
    let idToName = {}, idToDesc = {}, idToMain = {}, idToNames = {};
    
    if (charData?.characters && Array.isArray(charData.characters)) {
      charData.characters.forEach(c => {
        const id = String(c.id);
        idToName[id] = c.common_name || c.name || id;
        idToDesc[id] = c.description || '';
        idToMain[id] = c.main_character || false;
        idToNames[id] = Array.isArray(c.names) ? c.names : [];
      });
    }
    
    // relationUtils.js를 사용하여 관계 데이터 정규화 및 검증
    const normalizedRelations = (eventData.relations || [])
      .map(rel => normalizeRelation(rel))
      .filter(rel => isValidRelation(rel));
    
    const convertedElements = convertRelationsToElements(
      normalizedRelations,
      idToName,
      idToDesc,
      idToMain,
      idToNames
    );
    
    // graphDiff.js를 사용하여 변경사항 계산
    const diff = calcGraphDiff(prevElementsRef.current, convertedElements);
    prevElementsRef.current = convertedElements;
    
    setElements(convertedElements);
    setNewNodeIds(diff.added.filter(el => !el.data?.source).map(el => el.data.id));
    
    // localStorage에 현재 챕터 저장
    localStorage.setItem('lastGraphChapter', currentChapter.toString());
  }, [currentChapter]);



  // 사이드바 토글 함수
  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // 챕터 선택 함수
  const handleChapterSelect = (chapter) => {
    setCurrentChapter(chapter);
  };



  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f4f7fb', overflow: 'hidden', display: 'flex' }}>
      {/* 사이드바 */}
      <div 
        style={{
          width: isSidebarOpen ? '240px' : '60px',
          height: '100vh',
          background: '#fff',
          borderRight: '1px solid #e5e7eb',
          boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
          transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
        }}
      >
        {/* 사이드바 헤더 */}
        <div style={{
          height: '54px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '12px',
          padding: '0 16px',
          borderBottom: '1px solid #e5e7eb',
          background: '#f8f9fc',
        }}>
          <button
            onClick={toggleSidebar}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: '1px solid #e3e6ef',
              background: '#fff',
              color: '#6C8EFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.18s',
              outline: 'none',
            }}
            title={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          >
            {isSidebarOpen ? <FaChevronLeft /> : <FaBars />}
          </button>
          <span style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#22336b',
            textAlign: 'left',
            opacity: isSidebarOpen ? 1 : 0,
            transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-20px)',
            transition: isSidebarOpen 
              ? 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.2s' 
              : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            width: isSidebarOpen ? 'auto' : '0px',
            display: 'inline-block',
            minWidth: isSidebarOpen ? 'auto' : '0px',
          }}>
            챕터 선택
          </span>
        </div>

        {/* 챕터 목록 */}
        <div style={{
          flex: 1,
          padding: '16px 0',
          overflowY: 'auto',
        }}>
          {Array.from({ length: maxChapter }, (_, i) => i + 1).map((chapter) => (
            <button
              key={chapter}
              onClick={() => handleChapterSelect(chapter)}
              style={{
                width: '100%',
                height: '48px',
                padding: '0 16px',
                border: 'none',
                background: currentChapter === chapter ? '#EEF2FF' : 'transparent',
                color: currentChapter === chapter ? '#22336b' : '#6C8EFF',
                fontSize: '14px',
                fontWeight: currentChapter === chapter ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.18s',
                borderLeft: currentChapter === chapter ? '4px solid #6C8EFF' : '4px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarOpen ? 'flex-start' : 'center',
                position: 'relative',
              }}
              title={!isSidebarOpen ? `Chapter ${chapter}` : ''}
            >
              <span style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: currentChapter === chapter ? '#6C8EFF' : '#e3e6ef',
                color: currentChapter === chapter ? '#fff' : '#6C8EFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: '600',
                marginRight: '12px',
                transition: 'all 0.3s ease',
                flexShrink: 0,
                minWidth: '24px',
                minHeight: '24px',
              }}>
                {chapter}
              </span>
              <span style={{
                opacity: isSidebarOpen ? 1 : 0,
                transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-30px)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                width: isSidebarOpen ? 'auto' : '0px',
                transition: isSidebarOpen 
                  ? 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.2s' 
                  : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'inline-block',
                minWidth: isSidebarOpen ? 'auto' : '0px',
              }}>
                Chapter {chapter}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 상단바: 검색, 독립 인물 버튼, 닫기 버튼 */}
        <div style={{
          width: '100%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
          zIndex: 10001,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 0,
          paddingLeft: 0,
          paddingRight: 0,
        }}
        onWheel={e => e.preventDefault()}
        >
          {/* 상단바: 독립 인물 버튼 + 검색 + 닫기 버튼 */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'row', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            gap: 12, 
            paddingLeft: 16, 
            paddingRight: 16, 
            paddingTop: 0, 
            paddingBottom: 0,
            height: 54, 
            width: '100%',
            background: '#fff',
          }}>
            {/* 왼쪽 영역: 검색 컨트롤 + 독립 인물 토글 */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: 12,
              flex: 1,
            }}>
              
              {/* 그래프 검색 기능 */}
              <GraphControls
                onSearchSubmit={handleSearchSubmit}
                searchTerm={searchTerm}
                isSearchActive={isSearchActive}
                clearSearch={clearSearch}
                elements={elements}
              />
              
              {/* 간선 라벨 스위치 토글 */}
              <EdgeLabelToggle
                isVisible={edgeLabelVisible}
                onToggle={() => setEdgeLabelVisible(!edgeLabelVisible)}
              />
              
              {/* 독립 인물 버튼 */}
              <button
                onClick={() => setHideIsolated(!hideIsolated)}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: '1.5px solid #e3e6ef',
                  background: hideIsolated ? '#f8f9fc' : '#EEF2FF',
                  color: hideIsolated ? '#6C8EFF' : '#22336b',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: hideIsolated ? 'none' : '0 2px 8px rgba(108,142,255,0.15)',
                  minWidth: '140px',
                  justifyContent: 'center',
                }}
                title={hideIsolated ? '독립 인물을 표시합니다' : '독립 인물을 숨깁니다'}
              >
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: hideIsolated ? '#6C8EFF' : '#22336b',
                  opacity: hideIsolated ? 0.6 : 1,
                }} />
                {hideIsolated ? '독립 인물 표시' : '독립 인물 숨기기'}
              </button>
            </div>
            
            {/* 중앙 영역: 여백 */}
            <div style={{ flex: 1 }} />
            
            {/* 오른쪽 영역: 뷰어로 돌아가기 (상대적으로 왼쪽으로 이동) */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: 8,
              marginRight: '28px',
            }}>
              <button
                onClick={() => navigate(`/user/viewer/${filename}`)}
                style={{
                  height: 36,
                  width: 36,
                  borderRadius: 8,
                  border: '1.5px solid #e3e6ef',
                  background: '#fff',
                  color: '#22336b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                  fontSize: 14,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                }}
                title="뷰어로 돌아가기"
                onMouseEnter={(e) => {
                  e.target.style.background = '#f8f9fc';
                  e.target.style.color = '#6C8EFF';
                  e.target.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = '#fff';
                  e.target.style.color = '#22336b';
                  e.target.style.transform = 'scale(1)';
                }}
              >
                <FaTimes />
              </button>
            </div>
          </div>
        </div>

        {/* 그래프 본문 */}
        <div className="flex-1 relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
          {maxEventNum > 0 ? (
            elements.length > 0 ? (
              <StandaloneRelationGraph 
                elements={isSearchActive && filteredElements.length > 0 ? filteredElements : elements} 
                inViewer={false}
                fullScreen={true}
                graphViewState={graphViewState}
                setGraphViewState={setGraphViewState}
                chapterNum={currentChapter}
                eventNum={eventNum}
                hideIsolated={hideIsolated}
                maxEventNum={maxEventNum}
                newNodeIds={newNodeIds}
                maxChapter={maxChapter}
                edgeLabelVisible={edgeLabelVisible}
                fitNodeIds={fitNodeIds}
                searchTerm={searchTerm}
                isSearchActive={isSearchActive}
                filteredElements={filteredElements}
                layout={currentLayout}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#6C8EFF' }}>
                그래프 데이터를 불러오는 중...
              </div>
            )
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#6C8EFF' }}>
              이벤트 정보를 불러오는 중...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RelationGraphWrapper;