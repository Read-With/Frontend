import React, { useState, useEffect, useRef } from "react";
import RelationGraphMain from "./RelationGraphMain";
import EdgeLabelToggle from "../common/EdgeLabelToggle";
import GraphControls from "./GraphControls";
import "./RelationGraph.css";
import { useNavigate, useParams } from "react-router-dom";
import { FaTimes, FaBars, FaChevronLeft } from 'react-icons/fa';
import { convertRelationsToElements } from './graphElementUtils';
import { filterGraphElements } from './graphFilter';

// characters.json, 이벤트별 relations.json glob import
const characterModules = import.meta.glob('../../data/gatsby/c_chapter*_0.json', { eager: true });
const eventModules = import.meta.glob('../../data/gatsby/chapter*_relationships_event_*.json', { eager: true });

const getChapterCharacters = (chapter) => {
  const num = String(chapter).padStart(1, '0');
  // characters.json 구조: { characters: [...] }
  const data = characterModules[`../../data/gatsby/c_chapter${num}_0.json`]?.default;
  if (!data) return [];
  return data.characters || [];
};

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // 사이드바 열림/닫힘 상태
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true); // 간선 라벨 가시성 상태
  
  // 검색 관련 상태 추가
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredElements, setFilteredElements] = useState([]);
  const [fitNodeIds, setFitNodeIds] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);

  // === 1. 챕터별/이벤트별 모든 relations.json을 미리 누적 구조로 준비 ===
  const allEventsDataRef = useRef({}); // { [chapterNum]: [ {nodes, edges} ... ] }
  const allEventFilesRef = useRef({}); // { [chapterNum]: [파일경로, ...] }
  const allCharactersRef = useRef({}); // { [chapterNum]: [캐릭터배열] }

  // 챕터 변경 시 해당 챕터의 마지막 이벤트 번호를 찾아서 elements 세팅
  useEffect(() => {
    const num = String(currentChapter).padStart(1, '');
    // 해당 챕터의 모든 이벤트 관계 파일 경로 추출
    const eventFiles = Object.keys(eventModules).filter(path =>
      path.includes(`chapter${currentChapter}_relationships_event_`)
    );
    if (eventFiles.length === 0) {
      setElements([]);
      setNewNodeIds([]);
      return;
    }
    // 파일명에서 이벤트 번호 추출, 가장 큰 값 찾기
    const maxEventNum = Math.max(...eventFiles.map(path => {
      const match = path.match(/event_(\d+)\.json$/);
      return match ? Number(match[1]) : 0;
    }));
    setMaxEventNum(maxEventNum);
    // 가장 마지막 이벤트 파일 경로
    const lastEventFile = eventFiles.find(path => path.includes(`${maxEventNum}.json`));
    const eventData = lastEventFile ? eventModules[lastEventFile]?.default : null;
    if (!eventData) {
      setElements([]);
      setNewNodeIds([]);
      return;
    }
    // 인물 데이터 로딩
    const charFile = Object.keys(characterModules).find(path => path.includes(`c_chapter${currentChapter}_0.json`));
    const charData = charFile ? characterModules[charFile]?.default : null;
    
    // elements 변환 (viewer와 동일하게 idToName에 common_name 우선)
    let idToName = {}, idToDesc = {}, idToMain = {}, idToNames = {};
    
    // characters 배열이 있는 경우
    if (charData?.characters && Array.isArray(charData.characters)) {
      charData.characters.forEach(c => {
        const id = String(c.id);
        idToName[id] = c.common_name || c.name || id;
        idToDesc[id] = c.description || '';
        idToMain[id] = c.main_character || false;
        idToNames[id] = Array.isArray(c.names) ? c.names : [];
      });
    }
    
    // id1 혹은 id2가 0인 간선과 id1 === id2인 경우의 간선은 제외
    const filteredRelations = eventData.relations?.filter(rel => {
      return rel.id1 !== 0 && rel.id2 !== 0 && rel.id1 !== rel.id2;
    }) || [];
    
    const convertedElements = convertRelationsToElements(
      filteredRelations,
      idToName,
      idToDesc,
      idToMain,
      idToNames
    );
    
    setElements(convertedElements);
    setNewNodeIds(convertedElements.filter(el => el.data?.isNew).map(el => el.data.id));
    
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

  // 검색 제출 함수
  const handleSearchSubmit = (searchTerm) => {
    setSearchTerm(searchTerm);
    setIsSearchActive(!!searchTerm.trim());
    
    if (searchTerm.trim()) {
      const { filteredElements: filtered, fitNodeIds: fitIds } = filterGraphElements(elements, searchTerm);
      setFilteredElements(filtered);
      setFitNodeIds(fitIds);
      
      if (filtered.length > 0) {
        // 검색 결과가 있을 때만 처리
      }
    } else {
      // 검색어가 비어있으면 모든 요소 표시
      setFilteredElements(elements);
      setFitNodeIds([]);
      setIsSearchActive(false);
    }
  };

  // 검색 초기화 함수
  const clearSearch = () => {
    setSearchTerm("");
    setFilteredElements(elements);
    setFitNodeIds([]);
    setIsSearchActive(false);
  };

  // elements가 변경될 때 검색 결과도 업데이트
  useEffect(() => {
    if (isSearchActive && searchTerm.trim()) {
      const { filteredElements: filtered, fitNodeIds: fitIds } = filterGraphElements(elements, searchTerm);
      if (filtered.length > 0) {
        setFilteredElements(filtered);
        setFitNodeIds(fitIds);
      } else {
        setFilteredElements(elements);
        setFitNodeIds([]);
      }
    } else if (!isSearchActive) {
      setFilteredElements(elements);
    }
  }, [elements]); // searchTerm, isSearchActive 제거

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
                isFullScreen={true}
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
              <RelationGraphMain 
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