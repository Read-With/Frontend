import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import TimelineControls from './TimelineControls';
import './timeline.css';
import { FaTimes } from 'react-icons/fa';

const HEADER_HEIGHT = 64; // px

const TimelineView = () => {
  const { filename } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const book = location.state?.book || {
    title: filename || "알 수 없는 책",
    path: "/"+ filename,
  };
  
  const [currentChapter, setCurrentChapter] = useState(1);
  const [totalChapters, setTotalChapters] = useState(10); // 예시 데이터
  const [readChapters, setReadChapters] = useState([1, 2, 3]); // 예시 데이터: 읽은 챕터
  const [sortMode, setSortMode] = useState('time'); // 'time' 또는 'structure'
  
  // 예시 챕터 데이터
  const timelineData = [
    { id: 1, title: "챕터 1: 이야기의 시작", description: "주인공이 마을에 도착하는 장면으로 이야기가 시작됩니다.", time: "1920년 봄" },
    { id: 2, title: "챕터 2: 첫 만남", description: "주인공이 이웃을 처음 만나고 그들과 대화를 나눕니다.", time: "1920년 여름" },
    { id: 3, title: "챕터 3: 갈등의 시작", description: "마을에서 첫 번째 사건이 발생하고 갈등이 생깁니다.", time: "1920년 가을" },
    { id: 4, title: "챕터 4: 비밀의 단서", description: "주인공이 중요한 단서를 발견하고 비밀을 추적합니다.", time: "1920년 겨울" },
    { id: 5, title: "챕터 5: 진실의 순간", description: "감춰진 진실이 드러나고 인물들 간의 관계가 변화합니다.", time: "1921년 봄" },
    { id: 6, title: "챕터 6: 대결", description: "주인공과 적대자 사이에 최종 대결이 일어납니다.", time: "1921년 여름" },
    { id: 7, title: "챕터 7: 결말", description: "모든 이야기가 마무리되고 결말을 맞이합니다.", time: "1921년 가을" },
    { id: 8, title: "챕터 8: 에필로그", description: "이야기 이후의 상황과 인물들의 삶을 보여줍니다.", time: "1922년" },
    { id: 9, title: "챕터 9: 특별 부록", description: "주요 등장인물들의 추가 이야기와 배경.", time: "다양한 시점" },
    { id: 10, title: "챕터 10: 작가의 말", description: "작가가 작품에 대한 생각과 집필 과정을 설명합니다.", time: "현재" },
  ];

  // 챕터별 ref 배열 생성
  const chapterRefs = useRef([]);

  // 챕터 변경 시 해당 챕터로 스크롤
  useEffect(() => {
    if (chapterRefs.current[currentChapter - 1]) {
      chapterRefs.current[currentChapter - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentChapter]);

  useEffect(() => {
    setTotalChapters(timelineData.length);
  }, [timelineData]);

  const handleChapterChange = (chapter) => {
    setCurrentChapter(chapter);
    if (!readChapters.includes(chapter)) {
      setReadChapters([...readChapters, chapter]);
    }
  };

  const handleSortModeChange = (mode) => {
    setSortMode(mode);
  };

  // 정렬된 데이터 계산
  const sortedData = [...timelineData].sort((a, b) => {
    if (sortMode === 'time') {
      return a.id - b.id;
    } else {
      return b.id - a.id;
    }
  });

  // 닫기 버튼 핸들러
  const handleClose = () => {
    navigate(-1);
  };

  if (!location.state?.book && !filename) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg text-center max-w-lg">
          <h1 className="text-2xl font-bold text-red-600 mb-4">잘못된 접근</h1>
          <p className="text-gray-700 mb-6">
            타임라인을 볼 수 있는 책 정보가 없습니다. 메인페이지에서 책을 선택하거나 관계도 페이지에서 타임라인 버튼을 눌러주세요.
          </p>
          <button
            onClick={() => navigate('/')}
            className="bg-[#6C8EFF] hover:bg-[#5A7DEE] text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 flex items-center justify-center mx-auto"
          >
            메인페이지로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-root bg-gray-100 min-h-screen flex flex-col">
      {/* 상단 고정 헤더 */}
      <header className="timeline-header fixed top-0 left-0 w-full h-16 flex items-center px-8 bg-white shadow z-40" style={{height: HEADER_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <h1 className="flex-1 min-w-0 text-xl md:text-2xl font-bold text-[#22336b] truncate">{book.title} - 타임라인</h1>
        <div className="flex items-center w-full" style={{ maxWidth: '600px' }}>
          {/* 왼쪽: 정렬 버튼 + 드롭다운 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSortModeChange('time')}
              style={{
                height: 38,
                minWidth: 80,
                fontSize: '1.08rem',
                borderRadius: 8,
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(79,109,222,0.07)',
                border: sortMode === 'time' ? '2px solid #6C8EFF' : '2px solid #e7eaf7',
                background: sortMode === 'time' ? '#6C8EFF' : '#fff',
                color: sortMode === 'time' ? '#fff' : '#4F6DDE',
                marginRight: '0.7rem',
                padding: '0 1.3rem',
                transition: 'all 0.18s',
                cursor: 'pointer',
              }}
              onMouseOver={e => { if (sortMode !== 'time') e.currentTarget.style.background = '#EEF2FF'; }}
              onMouseOut={e => { if (sortMode !== 'time') e.currentTarget.style.background = '#fff'; }}
            >
              시간순
            </button>
            <button
              onClick={() => handleSortModeChange('structure')}
              style={{
                height: 38,
                minWidth: 80,
                fontSize: '1.08rem',
                borderRadius: 8,
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(79,109,222,0.07)',
                border: sortMode === 'structure' ? '2px solid #6C8EFF' : '2px solid #e7eaf7',
                background: sortMode === 'structure' ? '#6C8EFF' : '#fff',
                color: sortMode === 'structure' ? '#fff' : '#4F6DDE',
                marginRight: '0.7rem',
                padding: '0 1.3rem',
                transition: 'all 0.18s',
                cursor: 'pointer',
              }}
              onMouseOver={e => { if (sortMode !== 'structure') e.currentTarget.style.background = '#EEF2FF'; }}
              onMouseOut={e => { if (sortMode !== 'structure') e.currentTarget.style.background = '#fff'; }}
            >
              구성순
            </button>
            <div className="ml-2 flex-shrink-0">
              <TimelineControls
                currentChapter={currentChapter}
                totalChapters={totalChapters}
                onChapterChange={handleChapterChange}
                readChapters={readChapters}
                buttonStyle={{
                  height: 38,
                  minWidth: 80,
                  fontSize: '1.08rem',
                  borderRadius: 8,
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(79,109,222,0.07)',
                  border: '2px solid #e7eaf7',
                  background: '#fff',
                  color: '#4F6DDE',
                  padding: '0 1.3rem',
                  transition: 'all 0.18s',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>
          {/* 오른쪽: X 버튼 */}
          <button onClick={handleClose} className="close-btn ml-auto flex-shrink-0" style={{ marginLeft: 'auto' }}>
            <FaTimes size={22} />
          </button>
        </div>
      </header>

      {/* 본문 타임라인 (스크롤 영역) */}
      <main
        className="timeline-main flex-1 overflow-y-auto pt-24 pb-10 px-2 md:px-8"
        style={{marginTop: HEADER_HEIGHT}}
      >
        <div className="timeline-container space-y-8">
          {sortedData.map((chapter, idx) => (
            <div
              key={chapter.id}
              ref={el => chapterRefs.current[idx] = el}
              className={`timeline-item bg-white rounded-lg shadow-md p-6 transition-all duration-300 transform hover:scale-[1.01] border-l-4 ${
                currentChapter === chapter.id ? 'border-[#6C8EFF] current' : 'border-gray-200'
              } ${!readChapters.includes(chapter.id) ? 'spoiler-protected' : ''}`}
              onClick={() => handleChapterChange(chapter.id)}
            >
              <div className="flex flex-row items-center gap-4 mb-2">
                <h2 className="text-xl font-semibold text-gray-800 mr-2">{chapter.title}</h2>
                <span className="timeline-time text-base font-bold text-[#4F6DDE] bg-[#EEF2FF] px-3 py-1 ml-2 rounded-full">{chapter.time}</span>
              </div>
              <p className="text-gray-600 mt-3">{chapter.description}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default TimelineView; 