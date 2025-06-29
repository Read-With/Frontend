import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './MyPage.css';

function chunk(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

export default function MyPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/books.json')
      .then(res => {
        if (!res.ok) throw new Error('책 정보를 불러올 수 없습니다.');
        return res.json();
      })
      .then(setBooks)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const rows = chunk(books, 2);

  return (
    <div className="mypage-root">
      <div className="mypage-main">
        {/* 프로필 */}
        <div className="mypage-profile-section">
          <div className="mypage-profile-avatar">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="avatarGrad" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#e3e9f7" />
                  <stop offset="1" stopColor="#b0b8c1" />
                </linearGradient>
              </defs>
              <circle cx="28" cy="28" r="28" />
              <ellipse cx="28" cy="23" rx="10" ry="10" fill="#b0b8c1" />
              <ellipse cx="28" cy="41" rx="15" ry="8" fill="#b0b8c1" />
            </svg>
          </div>
          <div className="mypage-profile-info">
            <div className="mypage-profile-title">User's Nickname</div>
            <div className="mypage-profile-labels">
              <div className="mypage-profile-label">Reading Progress</div>
              <div className="mypage-profile-label">Bookmarks</div>
            </div>
            <div className="mypage-profile-desc">Welcome to your intelligent reading experience!</div>
          </div>
        </div>
        {/* 카드 갤러리 뷰 */}
        <div className="mypage-library-section">
          {loading && <div style={{padding:'40px',textAlign:'center'}}>로딩 중...</div>}
          {error && <div style={{color:'red',padding:'40px',textAlign:'center'}}>{error}</div>}
          <div className="mypage-library-list">
            {rows.map((row, i) => (
              <div className="mypage-library-row" key={i} style={{gap:'24px', display:'flex', flexDirection:'row', justifyContent:'flex-start'}}>
                {row.map((book, idx) => (
                  <div className="mypage-library-card" key={book.title+book.filename} style={{background: '#f8fbff', border:'1.5px solid #bbb', position:'relative', width:'180px', height:'320px', display:'flex', flexDirection:'column', alignItems:'center', gap:'16px', boxSizing:'border-box', padding:'20px 16px'}}>
                    <div className="mypage-library-image-container" style={{width:'80px',height:'120px',marginBottom:'12px',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {book.cover ? (
                        <img src={book.cover} alt={book.title} style={{width:80,height:120,objectFit:'cover',borderRadius:'8px',boxShadow:'0 2px 8px #b0b8c1cc'}} />
                      ) : (
                        <div className="mypage-library-image">
                          <svg width="80" height="120" viewBox="0 0 80 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="10" y="16" width="60" height="88" rx="8" fill="#b0b8c1" />
                            <rect x="18" y="28" width="44" height="64" rx="4" fill="#e3e9f7" />
                            <rect x="22" y="36" width="36" height="6" rx="3" fill="#b0b8c1" />
                            <rect x="22" y="48" width="26" height="6" rx="3" fill="#b0b8c1" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="mypage-library-text-content" style={{flex:1, width:'100%', alignItems:'center', textAlign:'center', display:'flex', flexDirection:'column', gap:'8px', position:'relative', minWidth:0}}>
                      <div style={{width:'100%'}}>
                        <div className="mypage-library-card-title" style={{fontWeight:600, fontSize:'1.08rem', lineHeight:'1.3', minHeight:'1.5em', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis'}}>{book.title}</div>
                        <div className="mypage-library-card-subtitle" style={{fontWeight:400, fontSize:'0.97rem', color:'#333', lineHeight:'1.2', minHeight:'1.5em', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis'}}>{book.author}</div>
                      </div>
                      <div style={{flex:1}} />
                      <div className="mypage-library-card-buttons" style={{display:'flex',gap:'6px',justifyContent:'center',marginTop:'10px'}}>
                        <button className="mypage-btn-primary" style={{padding:'2px 10px',fontSize:'0.8rem',borderRadius:'999px',background:'linear-gradient(90deg,#4F6DDE 0%,#6CA8FF 100%)',color:'#fff',border:'none',fontWeight:600,cursor:'pointer',minWidth:'70px'}} onClick={()=>navigate(`/user/viewer/${book.filename}`)}>읽기</button>
                        <button className="mypage-btn-secondary" style={{padding:'2px 10px',fontSize:'0.8rem',borderRadius:'999px',background:'#f0f4fa',color:'#4F6DDE',border:'none',fontWeight:600,cursor:'pointer',minWidth:'70px'}} onClick={()=>navigate(`/user/graph/${book.filename}`)}>그래프</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
} 