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
              <span className="weight-value">{Math.round(data.weight * 100)}%</span>
            </div>
            <div className="weight-steps">
              {[0.2, 0.4, 0.6, 0.8, 1.0].map((step, index) => {
                const stepPercentage = data.weight * 100;
                const currentStepStart = step - 0.2;
                const currentStepPercentage = step * 100;
                
                let fillPercentage = 0;
                let isComplete = false;
                let isCurrent = false;

                if (stepPercentage >= currentStepPercentage) {
                  fillPercentage = 100;
                  isComplete = true;
                } else if (stepPercentage > (currentStepPercentage - 20)) {
                  fillPercentage = ((stepPercentage - (currentStepPercentage - 20)) / 20) * 100;
                  isCurrent = true;
                }
                
                return (
                  <div 
                    key={index}
                    className={`weight-step ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''}`}
                  >
                    <div 
                      className="weight-fill"
                      style={{ 
                        width: `${fillPercentage}%`,
                        backgroundColor: relationStyle.color,
                        opacity: 0.4 + (step * 0.6)
                      }}
                    />
                    {(isComplete || (isCurrent && fillPercentage >= 50)) && (
                      <div className="weight-dot" />
                    )}
                    <span className="step-label">{Math.round(step * 100)}%</span>
                  </div>
                );
              })}
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