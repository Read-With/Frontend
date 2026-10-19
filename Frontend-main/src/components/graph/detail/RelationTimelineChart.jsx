/** 간선 관계 긍정도 타임라인 차트 (recharts) */

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip as RechartsTooltip,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { GRAPH_COLORS } from "../../../utils/graph/graphStyles";
import { isLongEdgeTimeline, getSparseEdgeTickValues } from "../../../utils/graph/graphCharts";

function chartXAxisBounds(length) {
  if (length === 0) return { min: 1, max: 1 };
  if (length === 1) return { min: 0.5, max: 1.5 };
  return { min: 1, max: length };
}

function formatPositivityTooltip(value, item, lineData) {
  if (value == null || typeof value !== 'number') {
    return ['관계 없음', '긍정도'];
  }
  const pct = `${Math.round(Number(value) * 100)}%`;
  const idx = item?.payload?.x;
  const prev = Number.isFinite(idx) && idx > 1 ? lineData[idx - 2]?.y : null;
  if (typeof prev === 'number') {
    const d = Math.round((Number(value) - prev) * 100);
    const sign = d > 0 ? '+' : '';
    return [`${pct} (${sign}${d}%p)`, '긍정도'];
  }
  return [pct, '긍정도'];
}

const CHAPTER_DOT_COLOR = '#9ca3af';

/** 점 모양: 현재 위치는 크게 + 흰 테두리, 챕터 경계는 회색, 긴 타임라인은 작게 */
function timelineDotStyle({ isCurrent, isChapter }, { longTimeline, color }) {
  const fill = isChapter ? CHAPTER_DOT_COLOR : color;
  if (isCurrent) return { r: 6, fill, stroke: GRAPH_COLORS.white, strokeWidth: 2 };
  return { r: longTimeline ? 2.5 : 3.5, fill, stroke: fill, strokeWidth: 0 };
}

/** 긴 타임라인은 현재·유의미·챕터 경계 점만 표시 (나머지는 r=0 자리표시) */
function renderTimelineDot({ cx, cy, payload, index }, options) {
  if (cx == null || cy == null || payload?.y == null) return null;
  const visible = options.showDenseDots || payload.isCurrent || payload.isSignificant || payload.isChapter;
  if (!visible) {
    return <circle key={`relation-timeline-dot-hidden-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  }
  return (
    <circle key={`relation-timeline-dot-${index ?? `${cx}-${cy}`}`} cx={cx} cy={cy} {...timelineDotStyle(payload, options)} />
  );
}

export default function RelationTimelineChart({ lineData, numericPointCount, heightPx, isSidebar, color }) {
  const xAxisBounds = useMemo(() => chartXAxisBounds(lineData.length), [lineData]);
  const sparseTicks = useMemo(
    () => getSparseEdgeTickValues(lineData, { maxTicks: isSidebar ? 7 : 5 }),
    [lineData, isSidebar],
  );
  const visibleXLabelMap = useMemo(
    () => Object.fromEntries(lineData.map((d) => [d.x, d.label])),
    [lineData],
  );
  const currentRefX = useMemo(() => lineData.find((d) => d.isCurrent)?.x ?? null, [lineData]);

  if (numericPointCount === 0) return null;
  if (numericPointCount === 1) {
    const only = lineData.find((d) => typeof d.y === 'number');
    return (
      <div className="edge-chart-empty">
        <p className="edge-chart-empty-title">아직 누적 변화가 없습니다</p>
        <p className="edge-chart-empty-value">
          현재 {Math.round((only?.y ?? 0) * 100)}%
        </p>
      </div>
    );
  }

  const longTimeline = isLongEdgeTimeline(lineData.length);
  const showDenseDots = lineData.length <= 6;
  const xTickFontSize = isSidebar ? (longTimeline ? 12 : 13) : (longTimeline ? 10 : 11);

  const dotStyle = { showDenseDots, longTimeline, color };
  const renderDot = (dotProps) => renderTimelineDot(dotProps, dotStyle);

  return (
    <div className="edge-chart-plot">
      <ResponsiveContainer width="100%" height={Math.max(120, heightPx)}>
        <LineChart data={lineData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[xAxisBounds.min, xAxisBounds.max]}
            ticks={sparseTicks}
            tickFormatter={(v) => visibleXLabelMap[Math.round(v)] ?? ''}
            tick={{ fontSize: xTickFontSize, fill: '#6b7280', fontWeight: 700 }}
            axisLine={{ stroke: GRAPH_COLORS.border }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            domain={[-1, 1]}
            width={isSidebar ? 44 : 40}
            tick={{ fontSize: isSidebar ? 12 : 11, fill: '#6b7280', fontWeight: 700 }}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
            axisLine={false}
            tickLine={false}
            ticks={[-1, 0, 1]}
          />
          <RechartsTooltip
            formatter={(value, _name, item) => formatPositivityTooltip(value, item, lineData)}
            labelFormatter={(_l, payload) => payload?.[0]?.payload?.label ?? ''}
          />
          {currentRefX != null && (
            <ReferenceLine x={currentRefX} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
          )}
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={longTimeline ? 1.5 : 2}
            dot={renderDot}
            activeDot={{ r: 5, fill: color }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
