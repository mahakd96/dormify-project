import React from 'react';
import { Upload, Shuffle } from 'lucide-react';
import { formatNumber, formatTimestamp } from './analysisUtils';

// Compact "where did this data come from" strip - kept deliberately small
// (a handful of chips), never the dominant section on the page.
function DataFreshnessPanel({ data, t, language }) {
  const batch = data?.latest_batch;
  const run = data?.latest_run;
  const recentRuns = (data?.recent_runs || []).slice(0, 5);

  if (!batch && !run && recentRuns.length === 0) return null;

  return (
    <div className="an-recent">
      <h2>{t.freshnessTitle}</h2>
      <div className="an-recent-list">
        {batch && (
          <div className="an-recent-item">
            <span className="an-recent-icon"><Upload size={15} /></span>
            <span className="an-recent-body">
              <span className="an-recent-title"><bdi>{batch.filename}</bdi></span>
              <span className="an-recent-sub">
                {t.latestUpload} · {formatNumber(batch.total_students, language)} {t.students} · {formatTimestamp(batch.created_at, language)}
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

export default DataFreshnessPanel;
