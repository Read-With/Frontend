import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import "./RelationGraph.css";

function GraphNodeTooltip({ data, x, y, nodeCenter, onClose }) {
  const navigate = useNavigate();
  const { filename } = useParams();
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef(null);

  useEffect(() => {
    setShowContent(true);
  }, []);

  const handleMouseDown = (e) => {
    if (e.target.closest('.tooltip-close-btn')) return;
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
      navigate(`/viewer/${filename}/chat/${data.label}`);
    }
  };

  return (
    <div
      ref={tooltipRef}
      className="graph-node-tooltip"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? 'none' : 'opacity 0.3s ease-in-out',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="tooltip-content business-card">
        <button onClick={onClose} className="tooltip-close-btn">&times;</button>
        
        <div className="business-card-header">
          <div className="profile-image-placeholder">
            <span>이미지</span>
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
            <div className="info-section">
              <i className="info-icon description-icon">📝</i>
              <div className="info-content">
                <label>설명</label>
                <p className="description-text">{data.description}</p>
              </div>
            </div>
          )}
          
          {data.affiliation && (
            <div className="info-section">
              <i className="info-icon affiliation-icon">🏢</i>
              <div className="info-content">
                <label>소속</label>
                <p>{data.affiliation}</p>
              </div>
            </div>
          )}
          
          {data.role && (
            <div className="info-section">
              <i className="info-icon role-icon">💼</i>
              <div className="info-content">
                <label>역할</label>
                <p>{data.role}</p>
              </div>
            </div>
          )}

          <div className="info-section">
            <button 
              className="epub-toolbar-btn epub-toolbar-btn--blue" 
              style={{ 
                width: '100%', 
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'white',
                color: '#6C8EFF',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#6C8EFF';
                e.currentTarget.style.color = 'white';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.color = '#6C8EFF';
              }}
              onClick={handleChatClick}
            >
              <i className="info-icon" style={{ marginRight: '8px' }}>💬</i>
              채팅하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GraphNodeTooltip; 