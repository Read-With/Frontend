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
import { GRAPH_COLORS } from "../../../utils/styles/graphStyles";
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

export default function RelationTimelineChart({ lineData, numericPointCount, heightPx, isSidebar, color }) {
  const xAxisBounds = useMemo(() => chartXAxisBounds(lineData.length), [lineData]);
  const sparseTicks = useMemo(
    () => getSparseEdgeTickValues(lineData, { maxTicks: isSidebar ? 7 : 5 }),
    [lineData, isSidebar],
  );
  const visibleXLabelMap = useMemo(() => {
    const map = {};
    lineData.forEach((d) => {
      map[d.x] = d.label;
    });
    return map;
  }, [lineData]);
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

  const renderDot = ({ cx, cy, payload, index }) => {
    if (cx == null || cy == null || payload?.y == null) return null;
    const isCurrent = payload?.isCurrent;
    const show = showDenseDots || isCurrent || payload?.isSignificant || payload?.isChapter;
    if (!show) {
      return (
        <circle
          key={`relation-timeline-dot-hidden-${index}`}
          cx={cx}
          cy={cy}
          r={0}
          fill="transparent"
        />
      );
    }
    const fill = payload?.isChapter ? '#9ca3af' : color;
    return (
      <circle
        key={`relation-timeline-dot-${index ?? `${cx}-${cy}`}`}
        cx={cx}
        cy={cy}
        r={isCurrent ? 6 : longTimeline ? 2.5 : 3.5}
        fill={fill}
        stroke={isCurrent ? GRAPH_COLORS.white : fill}
        strokeWidth={isCurrent ? 2 : 0}
      />
    );
  };

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
