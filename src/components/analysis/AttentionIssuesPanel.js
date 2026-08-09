import React from 'react';
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronRight, ChevronLeft,
} from 'lucide-react';
import { SeverityBadge } from './AnalysisPrimitives';

const SEVERITY_ICON = {
  critical: AlertTriangle,
  high: AlertTriangle,
  medium: AlertCircle,
  info: Info,
};

// Ranked, actionable issue list. Every item comes from a deterministic rule
// in analysisUtils.buildAttentionIssues - this component only renders and
// wires up the click action, it never invents or reorders severities.
function AttentionIssuesPanel({ issues, t, isHebrew, onIssueAction }) {
  const ChevronIcon = isHebrew ? ChevronLeft : ChevronRight;

  return (
    <div className={`an-insights-section ${issues.length > 0 ? 'has-items' : 'all-clear'}`}>
      <div className="an-insights-header">
        <div>
          <h2>{t.issuesTitle}</h2>
          <p className="an-section-sub">{t.issuesSubtitle}</p>
        </div>
        {issues.length > 0 && <span className="an-insights-count">{issues.length}</span>}
      </div>

      {issues.length === 0 ? (
        <div className="an-empty-state">
          <CheckCircle2 size={30} color="#10b981" />
          <strong>{t.noIssuesTitle}</strong>
          <span>{t.noIssuesSub}</span>
        </div>
      ) : (
        <ul className="an-insights-list">
          {issues.map((issue) => {
            const Icon = SEVERITY_ICON[issue.severity] || Info;
            const clickable = Boolean(issue.action);
            const severityLabel = {
              critical: t.severityCritical, high: t.severityHigh,
              medium: t.severityMedium, info: t.severityInfo,
            }[issue.severity];

            return (
              <li key={issue.id}>
                <button
                  type="button"
                  className={`an-insight-item an-sev-${issue.severity} ${clickable ? 'clickable' : ''}`}
                  onClick={clickable ? () => onIssueAction(issue.action) : undefined}
                  disabled={!clickable}
                >
                  <span className="an-insight-icon"><Icon size={17} /></span>
                  <span className="an-insight-body">
                    <span className="an-insight-title-row">
                      <SeverityBadge severity={issue.severity} label={severityLabel} />
                      <span className="an-insight-title">{isHebrew ? issue.titleHe : issue.titleEn}</span>
                    </span>
                    <span className="an-insight-desc">{isHebrew ? issue.descHe : issue.descEn}</span>
                  </span>
                  {clickable && <ChevronIcon size={16} className="an-insight-chevron" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default AttentionIssuesPanel;
