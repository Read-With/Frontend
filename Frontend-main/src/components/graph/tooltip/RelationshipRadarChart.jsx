import React, { useState, useCallback, useEffect } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { COLORS } from '../../../utils/styles/styles';

/**
 * 관계 레이더 차트 컴포넌트
 * @param {object} props
 * @param {Array} props.data - 레이더 차트 데이터
 * @param {string} props.centerNodeName - 중심 노드 이름
 */
function RelationshipRadarChart({ data, centerNodeName }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 모달 핸들러
  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && isModalOpen) {
        handleCloseModal();
      }
    };

    if (isModalOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, handleCloseModal]);

  return (
    <div>
      {/* 확대 화면 버튼 */}
      <button
        onClick={handleOpenModal}
        style={{
          padding: '0.75rem 1.5rem',
          background: COLORS.primary,
          border: 'none',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: '600',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontSize: '1.25rem' }}>+</span>
        확대 화면
      </button>

      {/* 확대 화면 모달 */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
          }}
          onClick={handleCloseModal}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '1rem',
              padding: '2rem',
              maxWidth: '90vw',
              maxHeight: '90vh',
              width: '1000px',
              height: '750px',
              position: 'relative',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
                paddingBottom: '1rem',
                borderBottom: `2px solid ${COLORS.borderLight}`,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  color: COLORS.textPrimary,
                }}
              >
                관계도 - 확대화면
              </h2>
              <button
                onClick={handleCloseModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  color: COLORS.textSecondary,
                  cursor: 'pointer',
                  padding: '0.5rem',
                  borderRadius: '0.375rem',
                  transition: 'all 0.2s ease',
                  width: '2rem',
                  height: '2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = COLORS.backgroundLight;
                  e.target.style.color = COLORS.textPrimary;
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'none';
                  e.target.style.color = COLORS.textSecondary;
                }}
              >
                ×
              </button>
            </div>

            {/* 확대된 차트 */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart 
                  data={data} 
                  margin={{ top: 60, right: 60, bottom: 60, left: 60 }}
                  style={{ outline: 'none' }}
                >
                  <PolarGrid stroke={COLORS.border} />
                  <PolarAngleAxis 
                    dataKey="name" 
                    tick={({ payload, x, y, cx, cy }) => {
                      const dx = x - cx;
                      const dy = y - cy;
                      const distance = Math.sqrt(dx * dx + dy * dy);
                      const nameLength = payload.value ? payload.value.length : 0;
                      const offset = Math.max(40, 25 + (nameLength * 2));
                      const scale = (distance + offset) / distance;
                      const newX = cx + dx * scale;
                      const newY = cy + dy * scale;
                      return (
                        <text
                          x={newX}
                          y={newY}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={COLORS.textPrimary}
                          fontSize={14}
                          fontWeight={600}
                        >
                          {payload.value}
                        </text>
                      );
                    }}
                  />
                  <PolarRadiusAxis 
                    angle={90} 
                    domain={[0, 100]} 
                    tick={{ fontSize: 12, fill: COLORS.textSecondary }}
                    tickCount={5}
                  />
                  <Radar
                    name={centerNodeName}
                    dataKey="normalizedValue"
                    stroke="#9ca3af"
                    fill="#e5e7eb"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(RelationshipRadarChart);