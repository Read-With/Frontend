import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'70vh',gap:'32px'}}>
      <h1 style={{fontSize:'2.2rem',fontWeight:700,marginBottom:'8px'}}>나만의 독서 공간</h1>
      <p style={{fontSize:'1.1rem',color:'#6b7a90',maxWidth:'400px',textAlign:'center'}}>책을 모으고, 읽고, 관리하는 가장 간단한 방법.<br/>지금 바로 나만의 서재를 시작하세요!</p>
      <button style={{padding:'16px 36px',fontSize:'1.1rem',borderRadius:'999px',background:'#4F6DDE',color:'#fff',border:'none',fontWeight:600,cursor:'pointer',boxShadow:'0 2px 8px rgba(79,109,222,0.10)'}} onClick={()=>navigate('/mypage')}>내 서재로 가기</button>
    </div>
  );
} 