import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { ChartCard, AnalysisEmptyState } from './AnalysisPrimitives';
import {
  formatNumber, classifyBuildingStatus, BUILDING_STATUS_COLORS,
  RANKING_VIEWS, sortForRankingView, THRESHOLDS,
} from './analysisUtils';

function ChartLTRBox({ height, children }) {
  return <div className="an-chart-ltr" dir="ltr" style={{ height }}>{children}</div>;
}

// Ranked building occupancy view (top N only - never every building in one
// chart). View-mode toggle switches which real, building-level measure the
// ranking is sorted by; every option here is backed by data that actually
// exists per building (highest/lowest occupancy_rate, most available_beds).
// "Largest shortage" and "highest waiting demand" are intentionally not
// offered here - waiting demand is only known at region granularity, not
// per building, so those views would have to invent per-building numbers.
function OccupancyRankingChart({ occupancyRows, t, language, onSelectBuilding }) {
  const [view, setView] = useState(RANKING_VIEWS.HIGHEST);

  const rows = useMemo(
    () => sortForRankingView(occupancyRows, view).slice(0, THRESHOLDS.RANKING_DEFAULT_SIZE),
    [occupancyRows, view]
  );

  const viewOptions = [
    { key: RANKING_VIEWS.HIGHEST, label: t.viewHighest },
    { key: RANKING_VIEWS.LOWEST, label: t.viewLowest },
    { key: RANKING_VIEWS.MOST_AVAILABLE, label: t.viewMostAvailable },
  ];

  const metricKey = view === RANKING_VIEWS.MOST_AVAILABLE ? 'available_beds' : 'occupancy_rate';

  return (
    <ChartCard
      title={t.occupancyRankingTitle}
      subtitle={t.occupancyRankingSubtitle}
      actions={(
        <div className="an-dim-buttons">
          {viewOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`an-dim-btn ${view === opt.key ? 'active' : ''}`}
              onClick={() => setView(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    >
      {rows.length === 0 ? (
        <AnalysisEmptyState title={t.noData} />
      ) : (
        <ChartLTRBox height={Math.max(rows.length * 34, 160)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit={metricKey === 'occupancy_rate' ? '%' : ''} allowDecimals={false} />
              <YAxis dataKey="building" type="category" width={170} tick={{ fontSize: 11.5 }} />
              <Tooltip
                formatter={(value, key, entry) => {
                  const row = entry.payload;
                  if (metricKey === 'occupancy_rate') {
                    return [`${formatNumber(row.assigned, language)}/${formatNumber(row.total_beds, language)} (${value}%)`, t.colOccupancy];
                  }
                  return [`${formatNumber(value, language)} ${t.unitBeds}`, t.colAvailable];
                }}
                labelFormatter={(label, payload) => {
                  const region = payload?.[0]?.payload?.region;
                  return region ? `${label} · ${region}` : label;
                }}
              />
              <Bar
                dataKey={metricKey}
                radius={[0, 8, 8, 0]}
                maxBarSize={22}
                onClick={(d) => onSelectBuilding(d?.building)}
                cursor="pointer"
              >
                {rows.map((row) => {
                  const statusKey = classifyBuildingStatus(row);
                  const colors = BUILDING_STATUS_COLORS[statusKey];
                  return <Cell key={row.building_id || row.building} fill={colors.dot} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartLTRBox>
      )}
    </ChartCard>
  );
}

export default OccupancyRankingChart;
