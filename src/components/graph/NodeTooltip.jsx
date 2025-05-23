import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaFileAlt, FaComments, FaArrowLeft } from 'react-icons/fa';
import "./RelationGraph.css";

function GraphNodeTooltip({ data, x, y, nodeCenter, onClose, inViewer = false, style }) {
  const navigate = useNavigate();
  const { filename } = useParams();
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isFlipped, setIsFlipped] = useState(false);
  const tooltipRef = useRef(null);
  const cardContainerRef = useRef(null);

  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
    if (e.target.closest('.tooltip-close-btn') || e.target.closest('.action-button')) return;
    setIsDragging(true);
    const rect = tooltipRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = Math.min(document.documentElement.clientWidth, window.innerWidth);
    const viewportHeight = Math.min(document.documentElement.clientHeight, window.innerHeight);
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    // 페이지 영역을 벗어나지 않도록 제한
    newX = Math.max(scrollX, Math.min(newX, viewportWidth + scrollX - tooltipRect.width));
    newY = Math.max(scrollY, Math.min(newY, viewportHeight + scrollY - tooltipRect.height));

    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (x !== undefined && y !== undefined && tooltipRef.current) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = Math.min(document.documentElement.clientWidth, window.innerWidth);
      const viewportHeight = Math.min(document.documentElement.clientHeight, window.innerHeight);
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;
      
      let newX = x;
      let newY = y;

      // 페이지 영역을 벗어나지 않도록 제한
      newX = Math.max(scrollX, Math.min(newX, viewportWidth + scrollX - tooltipRect.width));
      newY = Math.max(scrollY, Math.min(newY, viewportHeight + scrollY - tooltipRect.height));

      setPosition({ x: newX, y: newY });
    }
  }, [x, y]);

  const handleChatClick = () => {
    if (data.label) {
      // 뷰어 내에서 사용하는 경우 현재 filename을 사용
      const bookFilename = filename || 'unknown';
      navigate(`/user/character-chat/${bookFilename}/${data.label}`, { 
        state: { 
          book: { 
            title: bookFilename.replace('.epub', '').replace(/([A-Z])/g, ' $1').trim() 
          } 
        } 
      });
    }
  };

  const handleSummaryClick = () => {
    setIsFlipped(!isFlipped);
  };

  // 요약 데이터 - 7줄 분량으로 설정
  const summaryData = {
    summary: data.label ? 
      `${data.label}은(는) ${data.description || '작품의 중요한 인물입니다.'}\n\n` +
      `이 인물은 작품의 중심 서사를 이끌어가는 핵심적인 역할을 담당합니다.\n\n` +
      `주로 1장, 3장, 5장에서 중요한 장면에 등장하며, 작품의 주제를 표현합니다.\n\n` +
      `다른 인물들과의 관계를 통해 작품의 갈등과 긴장감을 고조시킵니다.\n\n` +
      `특히 주인공의 내적 성장에 중요한 영향을 미치는 인물입니다.\n\n` +
      `독자들에게 작가의 메시지를 전달하는 매개체 역할을 합니다.\n\n` +
      `이 인물의 행동과 선택은 작품의 결말에 직접적인 영향을 미칩니다.`
      : '인물에 대한 요약 정보가 없습니다.'
  };

  // 뷰어 내에서 사용할 때는 z-index를 더 높게 설정
  const zIndexValue = inViewer ? 10000 : 9999;

  return (
    <div
      ref={tooltipRef}
      className={`graph-node-tooltip ${isFlipped ? 'flipped' : ''}`}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: zIndexValue,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? 'none' : 'opacity 0.3s ease-in-out, transform 0.6s ease-in-out',
        cursor: isDragging ? 'grabbing' : 'grab',
        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        transformStyle: 'preserve-3d',
        width: '380px',
        height: '400px',
        ...(style || {})
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 앞면 - 기본 정보 */}
      <div 
        className="tooltip-content business-card tooltip-front"
        style={{
          backfaceVisibility: 'hidden',
          position: isFlipped ? 'absolute' : 'relative',
          width: '100%',
          height: '100%',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
        }}
      >
        <button onClick={onClose} className="tooltip-close-btn">&times;</button>
        
        <div className="business-card-header">
          <div className="profile-image-placeholder">
            {data.img ? (
              <img src={data.img} alt={data.label} className="profile-img" />
            ) : (
              <span>👤</span>
            )}
          </div>
          <div className="business-card-title">
            <h3>
              {data.label}
              {data.main && <span className="main-character-badge">주요 인물</span>}
            </h3>
            {data.names && data.names.length > 0 && (
              <div className="alias-tags">
                {data.names.map((name, index) => (
                  <span key={index} className="alias-tag">{name}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="business-card-body">
          {data.description && (
            <div className="info-section" style={{ flex: 1 }}>
              <i className="info-icon description-icon">📝</i>
              <div className="info-content">
                <label>설명</label>
                <p className="description-text">{data.description}</p>
              </div>
            </div>
          )}

          <div className="tooltip-actions">
            <button 
              className="action-button summary-btn"
              onClick={handleSummaryClick}
            >
              <FaFileAlt size={14} />
              요약글
            </button>
            <button 
              className="action-button chat-btn"
              onClick={handleChatClick}
              style={{ color: '#ffffff' }}
            >
              <FaComments size={14} />
              채팅하기
            </button>
          </div>
        </div>
      </div>

      {/* 뒷면 - 요약 정보 */}
      <div 
        className="tooltip-content business-card tooltip-back"
        style={{
          backfaceVisibility: 'hidden',
          position: isFlipped ? 'relative' : 'absolute',
          width: '100%',
          height: '100%',
          transform: 'rotateY(180deg)'
        }}
      >
        <button onClick={onClose} className="tooltip-close-btn">&times;</button>
        
        <div className="business-card-header">
          <div className="profile-image-placeholder">
            {data.img ? (
              <img src={data.img} alt={data.label} className="profile-img" />
            ) : (
              <span>👤</span>
            )}
          </div>
          <div className="business-card-title">
            <h3>
              {data.label} <span className="summary-badge">요약</span>
            </h3>
          </div>
        </div>

        <div className="business-card-body">
          <div className="info-section" style={{ flex: 1 }}>
            <i className="info-icon description-icon">📄</i>
            <div className="info-content">
              <p className="summary-text">{summaryData.summary}</p>
            </div>
          </div>

          <div className="tooltip-actions">
            <button 
              className="action-button back-btn"
              onClick={handleSummaryClick}
            >
              <FaArrowLeft size={14} />
              돌아가기
            </button>
            <button 
              className="action-button chat-btn"
              onClick={handleChatClick}
              style={{ color: '#ffffff' }}
            >
              <FaComments size={14} />
              채팅하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GraphNodeTooltip; 