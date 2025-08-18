import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import TimelineControls from './TimelineControls';
import './timeline.css';
import { FaTimes, FaClock, FaBook, FaMapMarkerAlt, FaFilter, FaCheckCircle } from 'react-icons/fa';

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
  
  // 개선된 챕터 데이터 (카테고리와 중요도 추가)
  const timelineData = useMemo(() => [
    { 
      id: 1, 
      title: "챕터 1: 이야기의 시작", 
      description: "주인공이 마을에 도착하는 장면으로 이야기가 시작됩니다.", 
      time: "1920년 봄",
      category: "전개",
      importance: "high",
      progress: 100
    },
    { 
      id: 2, 
      title: "챕터 2: 첫 만남", 
      description: "주인공이 이웃을 처음 만나고 그들과 대화를 나눕니다.", 
      time: "1920년 여름",
      category: "인물",
      importance: "medium",
      progress: 100
    },
    { 
      id: 3, 
      title: "챕터 3: 갈등의 시작", 
      description: "마을에서 첫 번째 사건이 발생하고 갈등이 생깁니다.", 
      time: "1920년 가을",
      category: "갈등",
      importance: "high",
      progress: 100
    },
    { 
      id: 4, 
      title: "챕터 4: 비밀의 단서", 
      description: "주인공이 중요한 단서를 발견하고 비밀을 추적합니다.", 
      time: "1920년 겨울",
      category: "미스터리",
      importance: "high",
      progress: 60
    },
    { 
      id: 5, 
      title: "챕터 5: 진실의 순간", 
      description: "감춰진 진실이 드러나고 인물들 간의 관계가 변화합니다.", 
      time: "1921년 봄",
      category: "전환점",
      importance: "high",
      progress: 30
    },
    { 
      id: 6, 
      title: "챕터 6: 대결", 
      description: "주인공과 적대자 사이에 최종 대결이 일어납니다.", 
      time: "1921년 여름",
      category: "클라이맥스",
      importance: "high",
      progress: 0
    },
    { 
      id: 7, 
      title: "챕터 7: 결말", 
      description: "모든 이야기가 마무리되고 결말을 맞이합니다.", 
      time: "1921년 가을",
      category: "결말",
      importance: "high",
      progress: 0
    },
    { 
      id: 8, 
      title: "챕터 8: 에필로그", 
      description: "이야기 이후의 상황과 인물들의 삶을 보여줍니다.", 
      time: "1922년",
      category: "후일담",
      importance: "medium",
      progress: 0
    },
    { 
      id: 9, 
      title: "챕터 9: 특별 부록", 
      description: "주요 등장인물들의 추가 이야기와 배경.", 
      time: "다양한 시점",
      category: "부록",
      importance: "low",
      progress: 0
    },
    { 
      id: 10, 
      title: "챕터 10: 작가의 말", 
      description: "작가가 작품에 대한 생각과 집필 과정을 설명합니다.", 
      time: "현재",
      category: "부록",
      importance: "low",
      progress: 0
    },
  ], []);

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
          {sortedData.map((chapter, idx) => {
            const isRead = readChapters.includes(chapter.id);
            const isCurrent = currentChapter === chapter.id;
            const isLocked = !isRead;
            
            return (
              <div
                key={chapter.id}
                ref={el => chapterRefs.current[idx] = el}
                className={`timeline-item group relative overflow-hidden transition-all duration-500 transform cursor-pointer ${
                  isCurrent ? 'current animate-enhanced-pulse' : 'hover:scale-[1.02]'
                } ${isLocked ? 'spoiler-protected' : ''}`}
                onClick={() => !isLocked && handleChapterChange(chapter.id)}
                style={{
                  background: isCurrent 
                    ? 'linear-gradient(135deg, #f0f7ff 0%, #e6f3ff 100%)' 
                    : 'white',
                  borderRadius: '16px',
                  padding: '24px',
                  boxShadow: isCurrent 
                    ? '0 8px 32px rgba(108, 142, 255, 0.15)' 
                    : '0 4px 16px rgba(0, 0, 0, 0.08)',
                  borderLeft: `6px solid ${isCurrent ? '#6C8EFF' : chapter.importance === 'high' ? '#f59e0b' : chapter.importance === 'medium' ? '#10b981' : '#6b7280'}`,
                  opacity: isLocked ? 0.4 : 1,
                  filter: isLocked ? 'blur(2px)' : 'none'
                }}
              >
                {/* 카테고리 뱃지 */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      chapter.category === '클라이맥스' ? 'bg-red-100 text-red-700' :
                      chapter.category === '전환점' ? 'bg-yellow-100 text-yellow-700' :
                      chapter.category === '갈등' ? 'bg-orange-100 text-orange-700' :
                      chapter.category === '미스터리' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {chapter.category}
                    </span>
                    {chapter.importance === 'high' && (
                      <span className="text-yellow-500 text-sm">⭐</span>
                    )}
                  </div>
                  
                  {/* 읽기 진행률 */}
                  <div className="flex items-center gap-2">
                    {isRead ? (
                      <FaCheckCircle className="text-green-500" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-gray-300 rounded-full"></div>
                    )}
                    <span className="text-xs text-gray-500">{chapter.progress}%</span>
                  </div>
                </div>

                {/* 제목과 시간 */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
                  <h2 className={`text-xl font-bold transition-colors ${
                    isCurrent ? 'text-blue-700' : 'text-gray-800'
                  }`}>
                    {chapter.title}
                  </h2>
                  <div className="flex items-center gap-2">
                    <FaClock className="text-gray-400 text-sm" />
                    <span className={`timeline-time text-sm font-semibold px-3 py-1 rounded-full ${
                      isCurrent 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {chapter.time}
                    </span>
                  </div>
                </div>

                {/* 설명 */}
                <p className="text-gray-600 leading-relaxed mb-4">{chapter.description}</p>

                {/* 진행률 바 */}
                {isRead && (
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                    <div 
                      className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${chapter.progress}%` }}
                    ></div>
                  </div>
                )}

                {/* 잠김 상태 오버레이 */}
                {isLocked && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm rounded-16">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-2 bg-gray-300 rounded-full flex items-center justify-center">
                        🔒
                      </div>
                      <p className="text-gray-500 font-medium">아직 읽지 않은 챕터</p>
                    </div>
                  </div>
                )}

                {/* 호버 효과 */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-16 pointer-events-none"></div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default TimelineView; 