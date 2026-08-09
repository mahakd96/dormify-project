import React, { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { ChartCard, AnalysisEmptyState } from './AnalysisPrimitives';
import { formatNumber, formatPercent, THRESHOLDS } from './analysisUtils';

// Recharts renders its own internal SVG coordinate system, which always
// stays numerically left-to-right regardless of the surrounding page
// direction - wrapping the chart in an explicit dir="ltr" container makes
// that intentional instead of accidental, so the numeric axes are never
// mirrored by inherited RTL CSS while category labels stay in-language.
function ChartLTRBox({ height, children }) {
  return <div className="an-chart-ltr" dir="ltr" style={{ height }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Capacity Pressure Analysis - the dashboard's single primary visualization
// (Section 5). No real historical/time-series capability exists in the data
// model (AllocationRun rows are per-execution events, not periodic
// occupancy snapshots - see DATA_ANALYSIS_REDESIGN_REPORT.md), so rather
// than fabricate a trend this shows the one comparison a KPI card or table
// row cannot: how each district's available capacity relates to its
// waiting demand, side by side, all at once. A district in the upper-left
// (little capacity, lots of waiting) is the one to act on first; a district
// in the lower-right (lots of capacity, little waiting) is the one with
// slack to potentially draw on.
// ---------------------------------------------------------------------------
function pressureColor(row) {
  if (row.waiting > Math.max(row.availableBeds, 0)) return '#dc2626';
  if (row.students > 0 && row.waitingRate >= THRESHOLDS.REGION_HIGH_WAITING_RATE) return '#f59e0b';
  return '#2563eb';
}

function PressureTooltip({ active, payload, t, language }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="an-scatter-tooltip">
      <strong>{row.region}</strong>
      <div>{t.axisAvailableCapacity}: {formatNumber(row.availableBeds, language)}</div>
      <div>{t.axisWaitingDemand}: {formatNumber(row.waiting, language)}</div>
      <div>{t.seriesCapacity}: {formatNumber(row.capacity, language)}</div>
      <div>{t.kpiOccupancy}: {formatPercent(row.occupancyRate, language)}</div>
    </div>
  );
}

export function CapacityPressureScatter({
  regionRows, t, language, insight,
}) {
  const rows = useMemo(() => regionRows.filter((r) => r.capacity > 0 || r.students > 0), [regionRows]);

  if (rows.length < 2) {
    return (
      <ChartCard title={t.pressureTitle} subtitle={t.pressureSubtitle}>
        <AnalysisEmptyState title={t.noData} />
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t.pressureTitle} subtitle={t.pressureSubtitle}>
      <ChartLTRBox height={320}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis
              type="number" dataKey="availableBeds" name={t.axisAvailableCapacity}
              tick={{ fontSize: 11 }} label={{ value: t.axisAvailableCapacity, position: 'insideBottom', offset: -8, fontSize: 11 }}
            />
            <YAxis
              type="number" dataKey="waiting" name={t.axisWaitingDemand}
              tick={{ fontSize: 11 }} label={{ value: t.axisWaitingDemand, angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="capacity" range={[80, 500]} />
            <Tooltip content={<PressureTooltip t={t} language={language} />} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={rows} fillOpacity={0.85}>
              {rows.map((row, i) => (
                <Cell key={row.region || i} fill={pressureColor(row)} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </ChartLTRBox>
      {insight && <p className="an-chart-insight">{insight}</p>}
    </ChartCard>
  );
}
