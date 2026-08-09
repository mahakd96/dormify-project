import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell,
} from 'recharts';
import { ChartCard, AnalysisEmptyState } from './AnalysisPrimitives';
import { formatNumber, formatPercent, num, THRESHOLDS } from './analysisUtils';

const PALETTE = {
  capacity: '#94a3b8',
  assigned: '#059669',
  waiting: '#f59e0b',
};

// Recharts renders its own internal SVG coordinate system, which always
// stays numerically left-to-right regardless of the surrounding page
// direction - wrapping every chart in an explicit dir="ltr" container makes
// that intentional instead of accidental, so numeric axes are never
// mirrored by inherited RTL CSS while category labels stay in-language.
function ChartLTRBox({ height, children }) {
  return <div className="an-chart-ltr" dir="ltr" style={{ height }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Capacity vs. Demand by Region - grouped horizontal bar.
// ---------------------------------------------------------------------------
export function CapacityDemandChart({ regionRows, t, language, onSelectRegion }) {
  const rows = useMemo(
    () => [...regionRows]
      .filter((r) => r.capacity > 0 || r.students > 0)
      .sort((a, b) => b.waiting - a.waiting),
    [regionRows]
  );

  if (rows.length === 0) {
    return (
      <ChartCard title={t.capacityDemandTitle} subtitle={t.capacityDemandSubtitle}>
        <AnalysisEmptyState title={t.noData} />
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t.capacityDemandTitle} subtitle={t.capacityDemandSubtitle}>
      <ChartLTRBox height={Math.max(rows.length * 56, 180)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis dataKey="region" type="category" width={130} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, key) => {
                const label = { capacity: t.seriesCapacity, assignedStudents: t.seriesAssigned, waiting: t.seriesWaiting }[key] || key;
                const unit = key === 'capacity' ? t.unitBeds : t.unitStudents;
                return [`${formatNumber(value, language)} ${unit}`, label];
              }}
            />
            <Legend formatter={(key) => ({ capacity: t.seriesCapacity, assignedStudents: t.seriesAssigned, waiting: t.seriesWaiting }[key] || key)} />
            <Bar
              dataKey="capacity" name="capacity" fill={PALETTE.capacity} radius={[0, 6, 6, 0]} maxBarSize={14}
              onClick={(d) => onSelectRegion(d?.region)}
              cursor="pointer"
            />
            <Bar
              dataKey="assignedStudents" name="assignedStudents" fill={PALETTE.assigned} radius={[0, 6, 6, 0]} maxBarSize={14}
              onClick={(d) => onSelectRegion(d?.region)}
              cursor="pointer"
            />
            <Bar
              dataKey="waiting" name="waiting" fill={PALETTE.waiting} radius={[0, 6, 6, 0]} maxBarSize={14}
              onClick={(d) => onSelectRegion(d?.region)}
              cursor="pointer"
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartLTRBox>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Allocation Status by Region - 100% stacked horizontal bar.
// ---------------------------------------------------------------------------
export function AllocationStatusChart({ regionRows, t, language, onSelectRegion }) {
  const rows = useMemo(() => [...regionRows]
    .filter((r) => r.students > 0)
    .map((r) => ({
      region: r.region,
      students: r.students,
      assignedStudents: r.assignedStudents,
      waiting: r.waiting,
      assignedPct: r.students > 0 ? (r.assignedStudents / r.students) * 100 : 0,
      waitingPct: r.students > 0 ? (r.waiting / r.students) * 100 : 0,
    }))
    .sort((a, b) => b.waitingPct - a.waitingPct), [regionRows]);

  if (rows.length === 0) {
    return (
      <ChartCard title={t.allocationStatusTitle} subtitle={t.allocationStatusSubtitle}>
        <AnalysisEmptyState title={t.noData} />
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t.allocationStatusTitle} subtitle={t.allocationStatusSubtitle}>
      <ChartLTRBox height={Math.max(rows.length * 40, 160)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis dataKey="region" type="category" width={130} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, key, entry) => {
                if (key === 'assignedPct') return [`${formatNumber(entry.payload.assignedStudents, language)} (${Math.round(value)}%)`, t.seriesAssigned];
                return [`${formatNumber(entry.payload.waiting, language)} (${Math.round(value)}%)`, t.seriesWaiting];
              }}
            />
            <Legend formatter={(key) => (key === 'assignedPct' ? t.seriesAssigned : t.seriesWaiting)} />
            <Bar dataKey="assignedPct" stackId="alloc" fill={PALETTE.assigned} onClick={(d) => onSelectRegion(d?.region)} cursor="pointer" />
            <Bar dataKey="waitingPct" stackId="alloc" fill={PALETTE.waiting} radius={[0, 6, 6, 0]} onClick={(d) => onSelectRegion(d?.region)} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </ChartLTRBox>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Capacity Pressure Analysis - scatter, one point per region. Only rendered
// when there is more than one region with real capacity/demand data;
// otherwise a scatter would be visually meaningless (a single point) and a
// ranked table communicates the same information better.
// ---------------------------------------------------------------------------
function pressureColor(row) {
  if (row.waiting > 0 && row.occupancyRate >= THRESHOLDS.OCCUPANCY_NEARLY_FULL) return '#dc2626';
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

export function CapacityPressureScatter({ regionRows, t, language }) {
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
      <ChartLTRBox height={340}>
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
    </ChartCard>
  );
}
