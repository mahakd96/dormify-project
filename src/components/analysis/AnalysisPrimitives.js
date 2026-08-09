import React, { useId, useState } from 'react';
import {
  Info, AlertTriangle, RefreshCw, Inbox, X, Download,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Small, shared presentational building blocks for the Analysis dashboard.
// All CSS for these lives in the single stylesheet at the bottom of
// AnalysisPage.js (same "one page, one <style> block" convention already
// used across this codebase) - these files only carry class names.
// ---------------------------------------------------------------------------

export function MetricDefinitionTooltip({ text, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="an-def-wrap">
      <button
        type="button"
        className="an-def-trigger"
        aria-label={ariaLabel}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        <Info size={13} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="an-def-bubble">{text}</span>
      )}
    </span>
  );
}

export function MetricCard({
  icon: Icon, accent, bg, value, label, sub, definition, definitionAria, status, onClick,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`an-kpi-card ${status ? `an-kpi-${status}` : ''}`}
      style={{ '--accent': accent, '--bg': bg }}
      onClick={onClick}
    >
      <span className="an-kpi-top">
        <span className="an-kpi-icon"><Icon size={17} /></span>
        {definition && <MetricDefinitionTooltip text={definition} ariaLabel={definitionAria} />}
      </span>
      <span className="an-kpi-value">{value}</span>
      <span className="an-kpi-label">{label}</span>
      {sub && <span className="an-kpi-sub">{sub}</span>}
    </Tag>
  );
}

export function ChartCard({ title, subtitle, actions, children, className = '' }) {
  return (
    <div className={`an-section-card ${className}`}>
      <div className="an-chart-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="an-section-sub">{subtitle}</p>}
        </div>
        {actions && <div className="an-chart-card-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function StatusBadge({ label, colors, showDot = true }) {
  return (
    <span className="an-status-badge" style={{ background: colors.bg, color: colors.color }}>
      {showDot && <span className="an-status-dot" style={{ background: colors.dot }} />}
      {label}
    </span>
  );
}

const SEVERITY_COLORS = {
  critical: { bg: '#fee2e2', color: '#b91c1c', dot: '#dc2626' },
  high: { bg: '#ffedd5', color: '#c2410c', dot: '#f97316' },
  medium: { bg: '#fef3c7', color: '#92400e', dot: '#d97706' },
  info: { bg: '#dbeafe', color: '#1e40af', dot: '#2563eb' },
};

export function SeverityBadge({ severity, label }) {
  const colors = SEVERITY_COLORS[severity] || SEVERITY_COLORS.info;
  return <StatusBadge label={label} colors={colors} />;
}

export function ActiveFilters({ chips, resetLabel, onReset, ariaRemove }) {
  if (!chips.length) return null;
  return (
    <div className="an-active-filters">
      {chips.map((chip) => (
        <span key={chip.key} className="an-filter-chip">
          {chip.label}
          {chip.onRemove && (
            <button type="button" aria-label={`${ariaRemove}: ${chip.label}`} onClick={chip.onRemove}>
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {onReset && (
        <button type="button" className="an-reset-btn" onClick={onReset}>{resetLabel}</button>
      )}
    </div>
  );
}

export function AnalysisLoadingState({ text }) {
  return (
    <div className="an-state-panel" role="status" aria-live="polite">
      <RefreshCw size={22} className="an-spin" />
      <p>{text}</p>
    </div>
  );
}

export function AnalysisErrorState({ text, retryLabel, onRetry }) {
  return (
    <div className="an-state-panel an-error-panel" role="alert">
      <AlertTriangle size={22} />
      <p>{text}</p>
      {onRetry && (
        <button type="button" className="an-retry-btn" onClick={onRetry}>
          <RefreshCw size={16} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function AnalysisEmptyState({ title, sub }) {
  return (
    <div className="an-empty-inline">
      <Inbox size={22} />
      <div>
        <strong>{title}</strong>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

// Preserves the pre-redesign "allocation performance" progress bars
// (assigned vs. waiting, as a share of a given population) - still real,
// still useful, now living in the Allocation tab instead of the old flat
// page. formatNumber/pct are passed in so this stays a pure view.
export function AllocationProgressBar({ label, total, segments, formatNumber, pct, language }) {
  return (
    <div className="an-perf-block">
      <div className="an-perf-label-row">
        <span className="an-perf-label">{label}</span>
        <span className="an-perf-total">{formatNumber(total, language)}</span>
      </div>
      <div className="an-progress-track">
        {segments.map((seg) => {
          const width = total > 0 ? (seg.value / total) * 100 : 0;
          if (width <= 0) return null;
          return (
            <div
              key={seg.key}
              className="an-progress-segment"
              style={{ width: `${width}%`, background: seg.color, color: seg.textColor || 'white' }}
              title={`${seg.label}: ${seg.value}`}
            >
              {width > 10 ? `${Math.round(width)}%` : ''}
            </div>
          );
        })}
      </div>
      <div className="an-perf-legend">
        {segments.map((seg) => (
          <span className="an-perf-legend-item" key={seg.key}>
            <span className="an-perf-swatch" style={{ background: seg.color }} />
            {seg.label}: {formatNumber(seg.value, language)} ({pct(seg.value, total)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

// `variant="dark"` (default) is for use on the dark header gradient;
// `variant="light"` is for use on a plain white card (e.g. the building
// table), where the dark-header styling would render as low-contrast
// white-on-white.
export function ExportButton({ label, loadingLabel, loading, onClick, disabled, variant = 'dark' }) {
  return (
    <button
      type="button"
      className={`an-export-btn an-export-btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      <Download size={15} className={loading ? 'an-spin' : ''} />
      {loading ? loadingLabel : label}
    </button>
  );
}
