import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { getPositivityColor, getPositivityLabel } from '../../../utils/radarChartUtils';
import { COLORS } from '../../../utils/styles/styles';

/**
 * 관계 레이더 차트 컴포넌트
 * @param {object} props
 * @param {Array} props.data - 레이더 차트 데이터
 * @param {string} props.centerNodeName - 중심 노드 이름
 */
function RelationshipRadarChart({ data, centerNodeName }) {
  const [hoveredItem, setHoveredItem] = useState(null);
  const [clickedItemInfo, setClickedItemInfo] = useState(null); // { data, position: { x, y } }
  const containerRef = useRef(null);
  const popoverRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });

  // 드래그 핸들러
  const handleMouseDown = (e) => {
    // X 버튼 클릭은 무시
    if (e.target.closest('button')) return;
    
    setIsDragging(true);
    dragStartPos.current = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const newX = e.clientX - dragStartPos.current.x;
    const newY = e.clientY - dragStartPos.current.y;
    
    setDragOffset({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  // 외부 클릭 감지 - 레이더 차트 영역은 제외
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        // 레이더 차트 영역 내부 클릭은 무시
        if (containerRef.current && containerRef.current.contains(event.target)) {
          return;
        }
        setClickedItemInfo(null);
      }
    };

    if (clickedItemInfo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [clickedItemInfo]);

  // 정보창이 닫힐 때 드래그 오프셋 초기화
  useEffect(() => {
    if (!clickedItemInfo) {
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
    }
  }, [clickedItemInfo]);

  // 데이터에 고유 키 추가
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((item, index) => ({
      ...item,
      id: `${item.connectedNodeId || item.name}-${index}`
    }));
  }, [data]);

  if (!processedData || processedData.length === 0) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          color: COLORS.textSecondary,
          fontSize: '0.875rem',
        }}
      >
        표시할 관계 데이터가 없습니다.
      </div>
    );
  }

  // 축 라벨 커스터마이징
  const renderPolarAngleAxis = ({ payload, x, y, cx, cy, verticalAnchor, ...rest }) => {
    const isHovered = hoveredItem === payload.value;
    const dataPoint = processedData.find(d => d.name === payload.value);
    const color = (dataPoint && dataPoint.positivity !== undefined) 
      ? getPositivityColor(dataPoint.positivity) 
      : COLORS.textPrimary;
    
    return (
      <text
        x={x}
        y={y}
        textAnchor={x > cx ? 'start' : 'end'}
        fill={isHovered ? color : COLORS.textPrimary}
        fontSize={isHovered ? 13 : 12}
        fontWeight={isHovered ? 600 : 500}
        style={{ transition: 'all 0.2s ease' }}
      >
        {payload.value}
      </text>
    );
  };

  // 커스텀 Dot 렌더링 (각 점을 positivity에 따라 다른 색상으로)
  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    
    if (!payload || !cx || !cy) {
      console.warn('⚠️ 점 렌더링 실패:', { cx, cy, hasPayload: !!payload });
      return null;
    }
    
    // processedData에서 완전한 데이터 찾기
    const fullData = processedData.find(d => d.name === payload.name) || payload;
    
    const color = getPositivityColor(fullData.positivity);
    const isHovered = hoveredItem === payload.name;
    const isClicked = clickedItemInfo?.data?.name === payload.name;
    const radius = isClicked ? 10 : (isHovered ? 8 : 5);
    const clickAreaRadius = 15; // 클릭 영역 반지름
    
    const handleClick = (e) => {
      e.stopPropagation();
      
      // 컨테이너 기준 좌표 계산
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const svgElement = e.target.closest('svg');
        if (svgElement) {
          const svgRect = svgElement.getBoundingClientRect();
          const relativeX = cx + (svgRect.left - containerRect.left);
          const relativeY = cy + (svgRect.top - containerRect.top);
          
          // 클릭할 때마다 팝오버 표시 (같은 점이어도)
          setClickedItemInfo({
            data: fullData,
            position: { x: relativeX, y: relativeY }
          });
        }
      }
    };
    
    return (
      <g>
        {/* 투명한 큰 원 - 클릭 영역 확장 및 호버 감지 */}
        <circle
          cx={cx}
          cy={cy}
          r={clickAreaRadius}
          fill="transparent"
          style={{ 
            cursor: 'pointer',
            pointerEvents: 'all'
          }}
          onClick={handleClick}
          onMouseEnter={() => setHoveredItem(fullData.name)}
          onMouseLeave={() => setHoveredItem(null)}
        />
        {/* 실제 표시되는 점 - 동일한 색상, 테두리 없음 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={color}
          style={{ 
            transition: 'all 0.2s ease',
            cursor: 'pointer',
            filter: (isHovered || isClicked) ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' : 'none',
            pointerEvents: 'none'
          }}
        />
      </g>
    );
  };

  // Popover 위치 계산 (fixed 포지션 사용) - 스마트 방향 선택
  const calculatePopoverPosition = () => {
    if (!clickedItemInfo || !containerRef.current) return { left: 0, top: 0 };
    
    const { x, y } = clickedItemInfo.position;
    const containerRect = containerRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 350;
    const offset = 20;
    
    // 화면 기준 좌표로 변환
    const screenX = containerRect.left + x;
    const screenY = containerRect.top + y;
    
    // 팝오버가 나타날 방향 결정
    let left, top;
    
    // 1. 수평 방향 결정 (좌우)
    if (screenX + popoverWidth + offset > window.innerWidth - 10) {
      // 오른쪽에 공간이 부족하면 왼쪽에 표시
      left = screenX - popoverWidth - offset;
    } else {
      // 오른쪽에 표시
      left = screenX + offset;
    }
    
    // 2. 수직 방향 결정 (상하)
    if (screenY + popoverHeight > window.innerHeight - 10) {
      // 아래쪽에 공간이 부족하면 위쪽에 표시
      top = screenY - popoverHeight - offset;
    } else {
      // 아래쪽에 표시
      top = screenY;
    }
    
    // 3. 경계 체크 및 조정
    // 상단 경계
    if (top < 10) {
      top = 10;
    }
    
    // 하단 경계
    if (top + popoverHeight > window.innerHeight - 10) {
      top = window.innerHeight - popoverHeight - 10;
    }
    
    // 좌측 경계
    if (left < 10) {
      left = 10;
    }
    
    // 우측 경계
    if (left + popoverWidth > window.innerWidth - 10) {
      left = window.innerWidth - popoverWidth - 10;
    }
    
    // 드래그 오프셋 적용
    return { 
      left: left + dragOffset.x, 
      top: top + dragOffset.y 
    };
  };

  const popoverPosition = calculatePopoverPosition();

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {/* 설명 */}
      <div
        style={{
          marginTop: '-1rem',
          marginBottom: '1rem',
          padding: '0.75rem 1rem',
          background: '#f8f9fc',
          borderRadius: '0.5rem',
          border: '1px solid #e3e6ef',
          width: '100%',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.9rem',
            lineHeight: '1.5',
            color: COLORS.textSecondary,
            textAlign: 'center',
          }}
        >
          <strong style={{ color: COLORS.primary }}>
            점을 클릭하면 바로 옆에 상세 정보가 표시됩니다.
          </strong>
          <br />
          <span style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
            정보창을 드래그하여 원하는 위치로 이동할 수 있습니다.
          </span>
        </p>
      </div>

      {/* 차트 */}
      <ResponsiveContainer width="100%" height={400}>
      <RadarChart data={processedData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
        <PolarGrid stroke={COLORS.border} />
        <PolarAngleAxis 
          dataKey="name" 
          tick={renderPolarAngleAxis}
        />
        <PolarRadiusAxis 
          angle={90} 
          domain={[0, 100]} 
          tick={{ fontSize: 11, fill: COLORS.textSecondary }}
          tickCount={5}
          tickFormatter={(value) => {
            const normalized = (value / 50) - 1;
            return normalized.toFixed(1);
          }}
        />
        <Radar
          name={centerNodeName}
          dataKey="normalizedValue"
          stroke="#9ca3af"
          fill="#e5e7eb"
          fillOpacity={0.2}
          strokeWidth={2}
          dot={(dotProps) => {
            const { key, ...propsWithoutKey } = dotProps;
            return <CustomDot key={key} {...propsWithoutKey} />;
          }}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>

      {/* 클릭한 점의 정보 Popover - 드래그 가능 */}
      {clickedItemInfo && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            left: `${popoverPosition.left}px`,
            top: `${popoverPosition.top}px`,
            width: '320px',
            maxHeight: '400px',
            overflowY: 'auto',
            padding: '1.25rem',
            background: 'rgba(255, 255, 255, 0.98)',
            border: `2px solid ${getPositivityColor(clickedItemInfo.data.positivity)}`,
            borderRadius: '0.75rem',
            boxShadow: isDragging 
              ? '0 12px 32px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.15)'
              : '0 8px 24px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)',
            zIndex: 99999,
            animation: 'popoverFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            backdropFilter: 'blur(8px)',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={handleMouseDown}
        >
          {/* 화살표 표시 - 클릭된 점을 가리킴 */}
          <div
            style={{
              position: 'absolute',
              width: '0',
              height: '0',
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderBottom: `10px solid ${getPositivityColor(clickedItemInfo.data.positivity)}`,
              left: '50%',
              top: '-10px',
              transform: 'translateX(-50%)',
              zIndex: 1,
            }}
          />
          <style>{`
            @keyframes popoverFadeIn {
              from {
                opacity: 0;
                transform: scale(0.9) translateY(-10px);
              }
              to {
                opacity: 1;
                transform: scale(1) translateY(0);
              }
            }
          `}</style>
          
          <button
            onClick={() => setClickedItemInfo(null)}
            style={{
              position: 'absolute',
              top: '0.75rem',
              right: '0.75rem',
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: COLORS.textSecondary,
              cursor: 'pointer',
              padding: '0.25rem 0.5rem',
              borderRadius: '0.25rem',
              transition: 'all 0.2s ease',
              lineHeight: 1,
              zIndex: 1,
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
          
          {/* 인물 이름 */}
          <div style={{ 
            fontWeight: '800', 
            fontSize: '1.25rem', 
            marginBottom: '1rem', 
            paddingRight: '2rem',
            color: COLORS.textPrimary,
            letterSpacing: '-0.02em'
          }}>
            {clickedItemInfo.data.fullName || clickedItemInfo.data.name}
          </div>
          
          {/* 관계도 점수 */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '1.25rem',
              background: 'linear-gradient(135deg, #f8f9fc 0%, #ffffff 100%)',
              borderRadius: '0.5rem',
              border: '1px solid #e3e6ef'
            }}>
              <span style={{ 
                fontSize: '0.875rem',
                color: getPositivityColor(clickedItemInfo.data.positivity),
                fontWeight: '600',
                letterSpacing: '0.01em'
              }}>
                {getPositivityLabel(clickedItemInfo.data.positivity || 0)}
              </span>
              <span style={{ 
                fontWeight: '800', 
                color: getPositivityColor(clickedItemInfo.data.positivity), 
                fontSize: '2rem',
                lineHeight: '1',
                letterSpacing: '-0.02em'
              }}>
                {Math.round((clickedItemInfo.data.positivity || 0) * 100)}%
              </span>
            </div>
          </div>
          
          {clickedItemInfo.data.relationTags && clickedItemInfo.data.relationTags.length > 0 && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${COLORS.borderLight}` }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {clickedItemInfo.data.relationTags.slice(0, 8).map((tag, i) => (
                  <span
                    key={i}
                    style={{
                      background: COLORS.backgroundLight,
                      color: COLORS.textPrimary,
                      padding: '0.25rem 0.625rem',
                      borderRadius: '0.375rem',
                      fontSize: '0.75rem',
                      border: `1px solid ${COLORS.border}`,
                      fontWeight: '500',
                    }}
                  >
                    {tag}
                  </span>
                ))}
                {clickedItemInfo.data.relationTags.length > 8 && (
                  <span style={{ fontSize: '0.75rem', color: COLORS.textSecondary, alignSelf: 'center' }}>
                    +{clickedItemInfo.data.relationTags.length - 8}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
  );
}

export default React.memo(RelationshipRadarChart);