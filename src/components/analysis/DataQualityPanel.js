import React from 'react';
import { Upload, Shuffle, AlertTriangle } from 'lucide-react';
import { formatNumber, formatTimestamp, daysBetween, formatDaysPending } from './analysisUtils';

const STALE_DAYS = 14;

// Content for the "Data Quality" tab: where the numbers on this dashboard
// come from and how current they are. Deliberately kept out of the main
// overview (it's technical/provenance information, not an operational
// decision signal) but always reachable via its own tab, per the design
// brief's "move source/import info into a dedicated area" requirement.
function DataQualityPanel({ data, t, language }) {
  const batch = data?.latest_batch;
  const run = data?.latest_run;
  const recentRuns = (data?.recent_runs || []).slice(0, 5);

  const batchAgeDays = batch?.created_at ? daysBetween(batch.created_at) : null;
  const isStale = batchAgeDays !== null && batchAgeDays >= STALE_DAYS;

  if (!batch && !run && recentRuns.length === 0) {
    return (
      <div className="an-section-card">
        <h2>{t.freshnessTitle}</h2>
        <p className="an-section-sub">{t.dataQualityIntro}</p>
        <div className="an-empty-inline">
          <span>{t.noSourceData}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="an-section-card">
      <h2>{t.freshnessTitle}</h2>
      <p className="an-section-sub">{t.dataQualityIntro}</p>

      {batch && isStale && (
        <div className="an-quality-warning" role="alert">
          <AlertTriangle size={15} />
          <span>{t.dataStaleWarning(formatDaysPending(batchAgeDays, language))}</span>
        </div>
      )}

      <div className="an-recent-list">
        {batch && (
          <div className="an-recent-item">
            <span className="an-recent-icon"><Upload size={15} /></span>
            <span className="an-recent-body">
              <span className="an-recent-title"><bdi>{batch.filename}</bdi></span>
              <span className="an-recent-sub">
                {t.latestUpload} · {formatNumber(batch.total_students, language)} {t.students} · {formatTimestamp(batch.created_at, language)}
                {batchAgeDays !== null && ` · ${t.dataFreshWithinDays(formatDaysPending(batchAgeDays, language))}`}
              </span>
            </span>
          </div>
        )}
        {run && (
          <div className="an-recent-item">
            <span className="an-recent-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}><Shuffle size={15} /></span>
            <span className="an-recent-body">
              <span className="an-recent-title">
                {run.region_name || ''} — {t.runStatus[run.status] || run.status_display || run.status}
              </span>
              <span className="an-recent-sub">
                {t.latestRun} · {formatNumber(run.successful_assignments, language)} {t.assignments} · {formatTimestamp(run.completed_at || run.started_at, language)}
              </span>
            </span>
          </div>
        )}
      </div>

      {recentRuns.length > 1 && (
        <div className="an-recent-runs">
          <span className="an-recent-runs-label">{t.recentRunsTitle}</span>
          <ul className="an-recent-runs-list">
            {recentRuns.map((r) => (
              <li key={r.id}>
                <span className={`an-run-dot an-run-${r.status}`} />
                <bdi>{r.region_name}</bdi>
                <span className="an-run-meta">
                  {t.runStatus[r.status] || r.status} · {formatNumber(r.successful_assignments, language)} {t.assignments} · {formatTimestamp(r.completed_at || r.started_at, language)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default DataQualityPanel;