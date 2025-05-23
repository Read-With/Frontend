import React from 'react';
import { useNavigate } from 'react-router-dom';
import './MainPage.css';

const MainPage = () => {
  const navigate = useNavigate();
  return (
    <div className="main-root">
      {/* 상단 Hero 섹션 */}
      <section className="main-hero-section">
        <div className="main-hero-container">
          <div className="main-hero-title">전자책으로 더 쉽게, 더 편하게</div>
          <div className="main-hero-description">언제 어디서나 나만의 전자책 서재를 경험하세요</div>
          <div className="main-hero-buttons">
            <button className="main-btn-secondary" onClick={() => navigate('/signup')}>회원가입</button>
            <button className="main-btn-primary" onClick={() => navigate('/login')}>로그인</button>
          </div>
          <div className="main-hero-tabs">
            <div className="main-tab">간편 업로드</div>
            <div className="main-tab">내 서재</div>
            <div className="main-tab">책 검색</div>
          </div>
        </div>
        <div className="main-hero-image-container">
          <div className="main-hero-image" />
        </div>
      </section>

      {/* 리스트 섹션 */}
      <section className="main-list-section">
        <div className="main-list-container">
          <div className="main-list-title">이런 기능을 제공합니다</div>
          <div className="main-list-description">전자책 관리부터 독서 기록까지 한 번에!</div>
          <div className="main-list-buttons">
            <button className="main-btn-primary">서비스 시작하기</button>
          </div>
        </div>
        <div className="main-list-list">
          <div className="main-list-row">
            <div className="main-list-item">
              <div className="main-list-frame"><span className="main-list-icon">⬆️</span></div>
              <div className="main-list-item-content">
                <div className="main-list-item-title">EPUB 업로드</div>
                <div className="main-list-item-subtitle">간편하게 파일을 올리고 바로 읽기</div>
              </div>
            </div>
            <div className="main-list-item">
              <div className="main-list-frame"><span className="main-list-icon">📚</span></div>
              <div className="main-list-item-content">
                <div className="main-list-item-title">내 서재</div>
                <div className="main-list-item-subtitle">내가 저장한 책을 한눈에</div>
              </div>
            </div>
            <div className="main-list-item">
              <div className="main-list-frame"><span className="main-list-icon">🔍</span></div>
              <div className="main-list-item-content">
                <div className="main-list-item-title">책 검색</div>
                <div className="main-list-item-subtitle">원하는 책을 빠르게 찾기</div>
              </div>
            </div>
            <div className="main-list-item">
              <div className="main-list-frame"><span className="main-list-icon">📝</span></div>
              <div className="main-list-item-content">
                <div className="main-list-item-title">독서 기록</div>
                <div className="main-list-item-subtitle">읽은 책, 남긴 메모 관리</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 제품/리뷰 섹션 */}
      <section className="main-products-section">
        <div className="main-products-container">
          <div className="main-products-title">추천 전자책</div>
          <div className="main-products-description">지금 인기 있는 전자책을 만나보세요</div>
          <div className="main-products-buttons">
            <button className="main-btn-primary">더 많은 책 보기</button>
          </div>
        </div>
        <div className="main-products-list">
          <div className="main-products-row">
            <div className="main-products-card">
              <div className="main-products-image-container">
                <div className="main-products-image" />
                <div className="main-products-tag">베스트셀러</div>
              </div>
              <div className="main-products-text-content">
                <div className="main-products-card-title">책 제목 예시 1</div>
                <div className="main-products-card-subtitle">저자명 · 출판사</div>
              </div>
            </div>
            <div className="main-products-card">
              <div className="main-products-image-container">
                <div className="main-products-image" />
                <div className="main-products-tag">신간</div>
              </div>
              <div className="main-products-text-content">
                <div className="main-products-card-title">책 제목 예시 2</div>
                <div className="main-products-card-subtitle">저자명 · 출판사</div>
              </div>
            </div>
            <div className="main-products-card">
              <div className="main-products-image-container">
                <div className="main-products-image" />
                <div className="main-products-tag">추천</div>
              </div>
              <div className="main-products-text-content">
                <div className="main-products-card-title">책 제목 예시 3</div>
                <div className="main-products-card-subtitle">저자명 · 출판사</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 리뷰 섹션 */}
      <section className="main-reviews-section">
        <div className="main-reviews-container">
          <div className="main-reviews-title">실제 이용자 후기</div>
          <div className="main-reviews-description">많은 분들이 만족하고 있어요!</div>
        </div>
        <div className="main-reviews-list">
          <div className="main-reviews-row">
            <div className="main-reviews-card">
              <div className="main-reviews-user">
                <div className="main-reviews-avatar" />
                <div className="main-reviews-username">홍길동</div>
                <div className="main-reviews-rating">★★★★★</div>
              </div>
              <div className="main-reviews-card-title">정말 편리하게 전자책을 관리할 수 있어요!</div>
            </div>
            <div className="main-reviews-card">
              <div className="main-reviews-user">
                <div className="main-reviews-avatar" />
                <div className="main-reviews-username">김영희</div>
                <div className="main-reviews-rating">★★★★☆</div>
              </div>
              <div className="main-reviews-card-title">책 검색 기능이 정말 좋아요.</div>
            </div>
            <div className="main-reviews-card">
              <div className="main-reviews-user">
                <div className="main-reviews-avatar" />
                <div className="main-reviews-username">이철수</div>
                <div className="main-reviews-rating">★★★★★</div>
              </div>
              <div className="main-reviews-card-title">언제 어디서나 읽을 수 있어서 만족합니다.</div>
            </div>
          </div>
        </div>
      </section>
      </div>
  );
};

export default MainPage;
