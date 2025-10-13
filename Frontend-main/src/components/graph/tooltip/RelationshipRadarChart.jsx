import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  const [clickedItemInfo, setClickedItemInfo] = useState(null); // { data, position: { x, y } }
  const containerRef = useRef(null);

  // 외부 클릭 감지 - 레이더 차트 영역은 제외
  useEffect(() => {
    const handleClickOutside = (event) => {
      // 레이더 차트 영역 내부 클릭은 무시
      if (containerRef.current && containerRef.current.contains(event.target)) {
        return;
      }
      setClickedItemInfo(null);
    };

    if (clickedItemInfo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [clickedItemInfo]);

  // 데이터에 고유 키 추가 및 Map 생성으로 성능 최적화
  const { processedData, dataMap } = useMemo(() => {
    if (!data || data.length === 0) return { processedData: [], dataMap: new Map() };
    
    const processed = data.map((item, index) => ({
      ...item,
      id: `${item.connectedNodeId || item.name}-${index}`
    }));
    
    // 빠른 검색을 위한 Map 생성
    const map = new Map();
    processed.forEach(item => {
      map.set(item.name, item);
    });
    
    return { processedData: processed, dataMap: map };
  }, [data]);

  // 축 라벨 커스터마이징 - 단순화
  const renderPolarAngleAxis = useCallback(({ payload, x, y, cx }) => {
    return (
      <text
        x={x}
        y={y}
        textAnchor={x > cx ? 'start' : 'end'}
        fill={COLORS.textPrimary}
        fontSize={12}
        fontWeight={500}
      >
        {payload.value}
      </text>
    );
  }, []);

  // 클릭 핸들러 최적화 - 즉시 정보창 표시
  const handleDotClick = useCallback((e, fullData, cx, cy) => {
    e.stopPropagation();
    
    // 즉시 정보창 표시 (좌표 계산 최적화)
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const svgElement = e.target.closest('svg');
      const svgRect = svgElement?.getBoundingClientRect();
      
      if (svgRect) {
        // 최적화된 좌표 계산
        const relativeX = cx + (svgRect.left - containerRect.left);
        const relativeY = cy + (svgRect.top - containerRect.top);
        
        // 즉시 상태 업데이트
        setClickedItemInfo({
          data: fullData,
          position: { x: relativeX, y: relativeY }
        });
      } else {
        // SVG 요소를 찾을 수 없는 경우 기본 위치 사용
        setClickedItemInfo({
          data: fullData,
          position: { x: cx, y: cy }
        });
      }
    } else {
      // 컨테이너를 찾을 수 없는 경우 기본 위치 사용
      setClickedItemInfo({
        data: fullData,
        position: { x: cx, y: cy }
      });
    }
  }, []);

  // 클릭 핸들러를 미리 바인딩하여 인라인 함수 제거
  const createClickHandler = useCallback((fullData, cx, cy) => {
    return (e) => handleDotClick(e, fullData, cx, cy);
  }, [handleDotClick]);

  // Popover 위치 계산 - 단순화
  const popoverPosition = useMemo(() => {
    if (!clickedItemInfo || !containerRef.current) return { left: 0, top: 0 };
    
    const { x, y } = clickedItemInfo.position;
    const containerRect = containerRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 350;
    const offset = 20;
    
    // 화면 기준 좌표로 변환
    const screenX = containerRect.left + x;
    const screenY = containerRect.top + y;
    
    // 항상 왼쪽 위쪽으로 배치
    let left = screenX - popoverWidth - offset;
    let top = screenY - popoverHeight - offset;
    
    // 경계 체크 및 조정
    if (top < 10) top = 10;
    if (top + popoverHeight > window.innerHeight - 10) top = window.innerHeight - popoverHeight - 10;
    if (left < 10) left = 10;
    if (left + popoverWidth > window.innerWidth - 10) left = window.innerWidth - popoverWidth - 10;
    
    return { left, top };
  }, [clickedItemInfo]);

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

  // 스타일 객체들을 미리 생성하여 재사용
  const transparentStyle = { cursor: 'pointer', pointerEvents: 'all' };
  const dotStyle = { cursor: 'pointer', pointerEvents: 'none' };
  const clickAreaRadius = 15;

  // 커스텀 Dot 렌더링 - 단순화
  const CustomDot = React.memo((props) => {
    const { cx, cy, payload } = props;
    
    if (!payload || !cx || !cy) {
      return null;
    }
    
    // Map을 사용한 빠른 데이터 검색
    const fullData = dataMap.get(payload.name) || payload;
    
    const color = getPositivityColor(fullData.positivity);
    const isClicked = clickedItemInfo?.data?.name === payload.name;
    const radius = isClicked ? 10 : 5;
    
    return (
      <g>
        {/* 투명한 큰 원 - 클릭 영역 */}
        <circle
          cx={cx}
          cy={cy}
          r={clickAreaRadius}
          fill="transparent"
          style={transparentStyle}
          onClick={createClickHandler(fullData, cx, cy)}
        />
        {/* 실제 표시되는 점 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={color}
          style={dotStyle}
        />
      </g>
    );
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        outline: 'none'
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
            점을 클릭하면 상세 정보가 표시됩니다.
          </strong>
        </p>
      </div>

      {/* 차트 */}
      <ResponsiveContainer width="100%" height={400}>
      <RadarChart 
        data={processedData} 
        margin={{ top: 5, right: 20, bottom: 5, left: 20 }}
        style={{ outline: 'none' }}
      >
        <style>{`
          svg:focus {
            outline: none !important;
          }
          svg *:focus {
            outline: none !important;
          }
          * {
            animation: none !important;
            transition: none !important;
          }
        `}</style>
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
          animationBegin={0}
          animationDuration={0}
        />
      </RadarChart>
    </ResponsiveContainer>

      {/* 클릭한 점의 정보 Popover */}
      {clickedItemInfo && (
        <div
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
            boxShadow: '0 8px 24px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)',
            zIndex: 99999,
            backdropFilter: 'blur(8px)',
            userSelect: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
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