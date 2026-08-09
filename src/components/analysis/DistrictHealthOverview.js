import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ChartCard, StatusBadge, AnalysisEmptyState } from './AnalysisPrimitives';
import {
  formatNumber, formatPercent, num,
  REGION_STATUS_LABELS, REGION_STATUS_COLORS,
} from './analysisUtils';

// Replaces the old grouped/multi-scale "Capacity vs. Demand by Region" bar
// chart, which plotted capacity, assigned, and waiting on one numeric axis -
// misleading because those three numbers are not comparable at the same
// scale (capacity is a ceiling, waiting is a much smaller headcount). This
// is a readable row-based overview instead: one normalized occupancy bar
// per district plus the real counts as plain numbers, never mixed together
// visually.
function DistrictRow({ row, t, language, isHebrew, onDrillDown }) {
  const ChevronIcon = isHebrew ? ChevronLeft : ChevronRight;
  const colors = REGION_STATUS_COLORS[row.statusKey];
  const label = REGION_STATUS_LABELS[language]?.[row.statusKey] || row.statusKey;
  const barPct = Math.min(Math.max(row.occupancyRate, 0), 100);

  return (
    <tr>
      <td className="an-td-text"><bdi>{row.region}</bdi></td>
      <td className="an-dh-bar-cell">
        <div className="an-dh-bar-track" role="img" aria-label={`${row.region}: ${formatPercent(row.occupancyRate, language)}`}>
          <div
            className="an-dh-bar-fill"
            style={{ width: `${barPct}%`, background: colors.dot }}
          />
        </div>
      </td>
      <td className="an-td-num">{formatPercent(row.occupancyRate, language)}</td>
      <td className="an-td-num">{formatNumber(row.availableBeds, language)}</td>
      <td className="an-td-num">{formatNumber(row.waiting, language)}</td>
      <td className="an-td-num">{row.pendingRequests > 0 ? formatNumber(row.pendingRequests, language) : '—'}</td>
      <td>
        <StatusBadge label={label} colors={colors} />
        {row.fullBuildings > 0 && (
          <span className="an-dh-full-note">{formatNumber(row.fullBuildings, language)} {t.colFullBuildings}</span>
        )}
      </td>
      <td className="an-dh-action-cell">
        <button type="button" className="an-link-btn" onClick={() => onDrillDown(row.region)}>
          {t.viewBuildingsAction}
          <ChevronIcon size={14} />
        </button>
      </td>
    </tr>
  );
}

function DistrictHealthOverview({ regionRows, t, language, isHebrew, onDrillDown }) {
  const rows = useMemo(
    () => [...regionRows]
      .filter((r) => r.capacity > 0 || r.students > 0)
      .sort((a, b) => num(b.waiting) - num(a.waiting) || num(b.occupancyRate) - num(a.occupancyRate)),
    [regionRows]
  );

  return (
    <ChartCard title={t.districtHealthTitle} subtitle={t.districtHealthSubtitle}>
      {rows.length === 0 ? (
        <AnalysisEmptyState title={t.noDistrictData} />
      ) : (
        <div className="an-table-wrap">
          <table className="an-table an-dh-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'start' }}>{t.colDistrict}</th>
                <th style={{ textAlign: 'start' }} />
                <th style={{ textAlign: 'end' }}>{t.kpiOccupancy}</th>
                <th style={{ textAlign: 'end' }}>{t.colAvailable}</th>
                <th style={{ textAlign: 'end' }}>{t.colWaitingStudents}</th>
                <th style={{ textAlign: 'end' }}>{t.colSpecialRequests}</th>
                <th style={{ textAlign: 'start' }}>{t.colStatus}</th>
                <th style={{ textAlign: 'start' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DistrictRow key={row.region} row={row} t={t} language={language} isHebrew={isHebrew} onDrillDown={onDrillDown} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

export default DistrictHealthOverview;