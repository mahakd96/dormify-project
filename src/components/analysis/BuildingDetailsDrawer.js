import React, { useEffect, useRef } from 'react';
import { X, ArrowLeftRight, ArrowRightLeft } from 'lucide-react';
import { StatusBadge } from './AnalysisPrimitives';
import {
  formatNumber, formatPercent, classifyBuildingStatus,
  BUILDING_STATUS, BUILDING_STATUS_LABELS, BUILDING_STATUS_COLORS,
} from './analysisUtils';

const REASON_KEY = {
  [BUILDING_STATUS.REVIEW]: 'drawerReasonReview',
  [BUILDING_STATUS.FULL]: 'drawerReasonFull',
  [BUILDING_STATUS.NEARLY_FULL]: 'drawerReasonNearlyFull',
  [BUILDING_STATUS.HEALTHY]: 'drawerReasonHealthy',
  [BUILDING_STATUS.UNDERUTILIZED]: 'drawerReasonUnderutilized',
  [BUILDING_STATUS.NO_ASSIGNMENTS]: 'drawerReasonNoAssignments',
};

// Consistent drill-down surface for a single building row: a side drawer,
// opened from the Buildings table's "Details" action. Anchored to the
// inline-end edge via CSS logical properties, so it always opens on the
// side opposite the app's sidebar (inline-start) in both RTL and LTR,
// never overlapping it.
function BuildingDetailsDrawer({
  row, t, language, isHebrew, onClose, onNavigate, canRunAllocation,
}) {
  const closeBtnRef = useRef(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!row) return null;

  const statusKey = classifyBuildingStatus(row);
  const colors = BUILDING_STATUS_COLORS[statusKey];
  const label = BUILDING_STATUS_LABELS[language]?.[statusKey] || statusKey;
  const reason = t[REASON_KEY[statusKey]] || '';
  const ArrowIcon = isHebrew ? ArrowLeftRight : ArrowRightLeft;

  return (
    <div className="an-drawer-overlay" role="presentation" onClick={onClose}>
      <div
        className="an-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="an-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="an-drawer-header">
          <div>
            <span className="an-drawer-eyebrow">{t.drawerTitle}</span>
            <h2 id="an-drawer-title"><bdi>{row.building}</bdi></h2>
            <span className="an-drawer-sub"><bdi>{row.region}</bdi></span>
          </div>
          <button type="button" ref={closeBtnRef} className="an-drawer-close" aria-label={t.drawerClose} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="an-drawer-status">
          <StatusBadge label={label} colors={colors} />
        </div>

        <dl className="an-drawer-stats">
          <div><dt>{t.colCapacity}</dt><dd>{formatNumber(row.total_beds, language)}</dd></div>
          <div><dt>{t.colAssigned}</dt><dd>{formatNumber(row.assigned, language)}</dd></div>
          <div><dt>{t.colAvailable}</dt><dd>{formatNumber(row.available_beds, language)}</dd></div>
          <div><dt>{t.kpiOccupancy}</dt><dd>{formatPercent(row.occupancy_rate, language)}</dd></div>
        </dl>

        {reason && (
          <div className="an-drawer-reason">
            <span className="an-drawer-reason-label">{t.drawerReasonLabel}</span>
            <p>{reason}</p>
          </div>
        )}

        <div className="an-drawer-actions">
          <button type="button" className="an-action-cta" onClick={() => onNavigate('/buildings')}>
            <ArrowIcon size={14} />
            {t.drawerViewBuildingsAction}
          </button>
          <button type="button" className="an-action-cta" onClick={() => onNavigate('/students')}>
            <ArrowIcon size={14} />
            {t.drawerViewStudentsAction}
          </button>
          {canRunAllocation && (
            <button type="button" className="an-action-cta" onClick={() => onNavigate('/allocation')}>
              <ArrowIcon size={14} />
              {t.drawerRunAllocationAction}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default BuildingDetailsDrawer;