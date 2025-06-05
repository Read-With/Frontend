import React, { useState, useEffect, useRef } from 'react';
import "./RelationGraph.css";

function EdgeTooltip({ data, x, y, onClose, sourceNode, targetNode, inViewer = false, style }) {
  const [position, setPosition] = useState({ x: 200, y: 200 });
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
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
    setHasDragged(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none'; // 드래그 중 텍스트 선택 방지
    } else {
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  useEffect(() => {
    if (x !== undefined && y !== undefined && tooltipRef.current && !isDragging && !hasDragged) {
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
  }, [x, y, isDragging, hasDragged]);

  // positivity 값에 따른 색상과 텍스트 결정
  const getRelationStyle = (positivity) => {
    if (positivity > 0.6) return { color: '#15803d', text: '긍정적' };
    if (positivity > 0.3) return { color: '#059669', text: '우호적' };
    if (positivity > -0.3) return { color: '#6b7280', text: '중립적' };
    if (positivity > -0.6) return { color: '#dc2626', text: '비우호적' };
    return { color: '#991b1b', text: '부정적' };
  };

  const relationStyle = getRelationStyle(data.positivity);
  
  // 뷰어 내에서 사용할 때는 z-index를 더 높게 설정
  const zIndexValue = inViewer ? 10000 : 9999;

  return (
    <div
      ref={tooltipRef}
      className="edge-tooltip-container"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: zIndexValue,
        opacity: showContent ? 1 : 0,
        transition: isDragging ? 'none' : 'opacity 0.3s ease-in-out',
        cursor: isDragging ? 'grabbing' : 'grab',
        width: '380px',
        ...(style || {})
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="edge-tooltip-content">
        <button onClick={onClose} className="tooltip-close-btn" onMouseDown={e => e.stopPropagation()}>&times;</button>
        <div className="edge-tooltip-header">
          <div className="relation-tags">
            {data.label.split(', ').map((relation, index) => (
              <span 
                key={index} 
                className="relation-tag"
                style={{ backgroundColor: `${relationStyle.color}15` }}
              >
                {relation}
              </span>
            ))}
          </div>
          <div className="relation-weight">
            <div className="weight-header">
              <span className="weight-label" style={{ color: relationStyle.color }}>
                {relationStyle.text}
              </span>
              <span className="weight-value">{Math.round(data.weight * 10)}%</span>
            </div>
            {/* 20% 단위 막대그래프 (5개, positivity 값에 따라 색칠) */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 28, margin: '12px 0 4px 0', justifyContent: 'center' }}>
              {(() => {
                let p = data.positivity ?? 0;
                p = p * 100;
                let remain = p;
                return Array.from({ length: 5 }).map((_, i) => {
                  let fill;
                  if (remain >= 20) {
                    fill = 1;
                  } else if (remain > 0) {
                    fill = remain / 20;
                  } else {
                    fill = 0;
                  }
                  remain -= 20;
                  let background;
                  if (fill === 1) background = relationStyle.color;
                  else if (fill > 0) background = `linear-gradient(to right, ${relationStyle.color} ${fill * 100}%, #e5e7eb ${fill * 100}%)`;
                  else background = '#e5e7eb';
                  return (
                    <div
                      key={i}
                      style={{
                        width: 80,
                        height: 24,
                        borderRadius: 6,
                        background,
                        opacity: 1,
                        transition: 'background 0.3s',
                        border: '1.5px solid #e5e7eb',
                        boxSizing: 'border-box',
                        marginBottom: 0
                      }}
                    />
                  );
                });
              })()}
            </div>
            {/* 20, 40, 60, 80, 100% 라벨 */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 4 }}>
              {[20, 40, 60, 80, 100].map((step, idx) => (
                <span
                  key={idx}
                  style={{
                    width: 80,
                    textAlign: 'center',
                    fontSize: 12,
                    color: '#6b7280',
                    display: 'inline-block',
                    lineHeight: '1.2',
                  }}
                >
                  {step}%
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="edge-tooltip-body">
          {data.explanation && (
            <div className="relation-explanation">
              <div className="quote-box" style={{ borderLeft: `4px solid ${relationStyle.color}` }}>
                <strong>{data.explanation.split('|')[0]}</strong>
              </div>
              {data.explanation.split('|')[1] && (
                <p className="explanation-text">{data.explanation.split('|')[1]}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EdgeTooltip;