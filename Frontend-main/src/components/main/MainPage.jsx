import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../common/PageLayout';
import './MainPage.css';

const MainPage = ({ darkMode }) => {
  const navigate = useNavigate();

  return (
    <PageLayout darkMode={darkMode}>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        gap: '3rem',
        marginTop: '4.5rem',
        flexWrap: 'wrap',
        background: 'none',
        boxShadow: 'none',
        borderRadius: 0,
        padding: 0,
      }}>
        {/* EPUB 업로드 카드 */}
        <div
          className="main-card"
          onClick={() => navigate('/upload')}
          style={{ cursor: 'pointer', minWidth: 320, maxWidth: 340 }}
        >
          <div style={{ fontSize: '3rem', color: '#4F6DDE', marginBottom: '1.2rem' }}>⬆️</div>
          <h2 style={{ fontWeight: 700, fontSize: '1.45rem', marginBottom: '0.7rem', color: '#22336b' }}>EPUB 업로드</h2>
          <p style={{ color: '#6b7280', fontSize: '1.08rem', lineHeight: 1.6, textAlign: 'center' }}>
            새로운 EPUB 파일을 업로드하고 읽기 시작하세요
          </p>
        </div>
        {/* 내 서재 카드 */}
        <div
          className="main-card"
          onClick={() => navigate('/library')}
          style={{ cursor: 'pointer', minWidth: 320, maxWidth: 340 }}
        >
          <div style={{ fontSize: '3rem', color: '#4F6DDE', marginBottom: '1.2rem' }}>📘</div>
          <h2 style={{ fontWeight: 700, fontSize: '1.45rem', marginBottom: '0.7rem', color: '#22336b' }}>내 서재</h2>
          <p style={{ color: '#6b7280', fontSize: '1.08rem', lineHeight: 1.6, textAlign: 'center' }}>
            저장된 책들을 관리하고 계속 읽으세요
          </p>
        </div>
        {/* 책 검색 카드 */}
        <div
          className="main-card"
          onClick={() => navigate('/search')}
          style={{ cursor: 'pointer', minWidth: 320, maxWidth: 340 }}
        >
          <div style={{ fontSize: '3rem', color: '#4F6DDE', marginBottom: '1.2rem' }}>🔍</div>
          <h2 style={{ fontWeight: 700, fontSize: '1.45rem', marginBottom: '0.7rem', color: '#22336b' }}>책 검색</h2>
          <p style={{ color: '#6b7280', fontSize: '1.08rem', lineHeight: 1.6, textAlign: 'center' }}>
            새로운 책을 검색하고 찾아보세요
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

export default MainPage;
