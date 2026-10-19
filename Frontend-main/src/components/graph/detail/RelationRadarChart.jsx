/** 관계 분석 레이더 차트: 연결 인물별 긍정도, 축 라벨·점 클릭으로 활성 인물 전환 */

import { memo, useMemo } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { getPositivityDisplay, GRAPH_COLORS, brandAlpha } from '../../../utils/graph/graphStyles';
import { truncateWithEllipsis } from '../../../utils/common/valueUtils.js';
import { joinClasses, onActivationKey } from '../../../utils/common/domUtils';

const NAME_LABEL_MAX = 19; // truncate 시 18자 + …
const RADAR_GRID = brandAlpha(0.22);
const RADAR_AXIS_TICK = '#6f7f6f';
const RADAR_FILL = brandAlpha(0.14);
const RADAR_RADIUS_TICK_LABELS = {
  0: '−100%',
  50: '0%',
  100: '+100%',
};

const formatRadarRadiusTick = (value) => RADAR_RADIUS_TICK_LABELS[value] ?? '';

const RadarDot = memo(function RadarDot({
  cx,
  cy,
  payload,
  dataMap,
  activeName,
  onActivate,
}) {
  if (cx == null || cy == null || payload?.name == null) return null;
  const fullData = dataMap.get(payload.name) || payload;

  const { color } = getPositivityDisplay(fullData.positivity);
  const isActive = activeName === payload.name;
  const radius = isActive ? 7 : 4.5;

  const activate = (e) => {
    e.stopPropagation();
    onActivate(fullData, e);
  };

  return (
    <g className={`relation-radar-dot${isActive ? ' is-active' : ''}`}>
      <circle
        cx={cx}
        cy={cy}
        r={Math.max(16, radius * 3)}
        fill="transparent"
        className="relation-radar-dot-hit"
        onMouseEnter={activate}
        onClick={activate}
        onFocus={activate}
        tabIndex={0}
        role="button"
        aria-label={`${fullData.name} 관계 상세`}
        onKeyDown={onActivationKey(activate)}
      />
      {isActive ? (
        <circle
          cx={cx}
          cy={cy}
          r={radius + 4}
          fill="none"
          stroke={GRAPH_COLORS.primary}
          strokeWidth={1.5}
          strokeOpacity={0.55}
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke={isActive ? '#fff' : 'rgba(255,255,255,0.85)'}
        strokeWidth={isActive ? 2 : 1}
      />
    </g>
  );
});

export default function RelationRadarChart({ nodeName, data, activeName, onActivate }) {
  const dataMap = useMemo(() => new Map(data.map((item) => [item.name, item])), [data]);

  const renderPolarAngleAxis = ({ payload, x: tickX, y: tickY, cx, cy }) => {
    const point = dataMap.get(payload.value);
    const color = point?.positivity !== undefined
      ? getPositivityDisplay(point.positivity).color
      : RADAR_AXIS_TICK;
    const active = activeName === payload.value;
    const dx = tickX - cx;
    const dy = tickY - cy;
    const distance = Math.hypot(dx, dy) || 1;
    const raw = payload.value || '';
    const label = truncateWithEllipsis(raw, NAME_LABEL_MAX);
    const scale = (distance + Math.max(38, 26 + (label.length * 2.2))) / distance;

    return (
      <text
        x={cx + dx * scale}
        y={cy + dy * scale}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={active ? color : RADAR_AXIS_TICK}
        fontSize={active ? 16 : 14}
        fontWeight={active ? 700 : 500}
        letterSpacing={active ? '0.01em' : '0'}
        className={joinClasses('relation-radar-tick', point && 'is-clickable')}
        onClick={() => point && onActivate(point)}
      >
        <title>{raw}</title>
        {label}
      </text>
    );
  };


  return (
  <div className="relation-modal-chart" role="img" aria-label={`${nodeName} 관계 레이더 차트`}>
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart
        data={data}
        margin={{ top: 68, right: 68, bottom: 68, left: 68 }}
      >
        <PolarGrid
          gridType="polygon"
          stroke={RADAR_GRID}
          strokeWidth={1}
          radialLines
        />
        <PolarAngleAxis dataKey="name" tick={renderPolarAngleAxis} />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tickCount={3}
          axisLine={false}
          tick={{
            fontSize: 11,
            fill: RADAR_AXIS_TICK,
            fontWeight: 600,
          }}
          tickFormatter={formatRadarRadiusTick}
        />
        <Radar
          name={nodeName}
          dataKey="normalizedValue"
          stroke={GRAPH_COLORS.primary}
          fill={RADAR_FILL}
          fillOpacity={1}
          strokeWidth={2.25}
          dot={(dotProps) => {
            const { key, ...rest } = dotProps;
            return (
              <RadarDot
                key={key}
                {...rest}
                dataMap={dataMap}
                activeName={activeName}
                onActivate={onActivate}
              />
            );
          }}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>
  </div>
  );
}
