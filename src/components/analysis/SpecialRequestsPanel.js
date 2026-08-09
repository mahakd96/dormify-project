import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { Clock, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { ChartCard, AnalysisEmptyState } from './AnalysisPrimitives';
import { formatNumber, daysBetween, formatDaysPending } from './analysisUtils';

function ChartLTRBox({ height, children }) {
  return <div className="an-chart-ltr" dir="ltr" style={{ height }}>{children}</div>;
}

function RequestBarChart({ rows, labelKey, valueLabel, language, t, emptyLabel }) {
  if (rows.length === 0) return <AnalysisEmptyState title={emptyLabel} />;
  return (
    <ChartLTRBox height={Math.max(rows.length * 38, 120)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis dataKey={labelKey} type="category" width={150} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [formatNumber(value, language), valueLabel]} />
          <Bar dataKey="count" fill="#7c3aed" radius={[0, 8, 8, 0]} maxBarSize={22}>
            <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v, language)} style={{ fontSize: 11, fill: '#334155', fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartLTRBox>
  );
}

// Analytical summary of pending StudentRequest records - deliberately does
// not duplicate the full requests table that already exists on the
// dedicated /transfers page; it links there for record-level action.
function SpecialRequestsPanel({ data, t, language }) {
  const navigate = useNavigate();
  const requestsByType = data?.requests_by_type || [];
  const requestsByRegion = data?.requests_by_region || [];
  const oldestPendingCreatedAt = data?.oldest_pending_request_created_at || null;
  const pendingRequests = data?.summary?.pending_requests || 0;

  const typeRows = useMemo(() => [...requestsByType]
    .map((row) => ({
      request_type: t.requestType[row.request_type] || row.request_type,
      count: row.count,
    }))
    .sort((a, b) => b.count - a.count), [requestsByType, t]);

  const regionRows = useMemo(() => [...requestsByRegion].sort((a, b) => b.count - a.count), [requestsByRegion]);

  const oldestDays = oldestPendingCreatedAt ? daysBetween(oldestPendingCreatedAt) : null;

  return (
    <div className="an-requests-grid">
      <div className="an-section-card an-requests-summary">
        <h2>{t.requestsTitle}</h2>
        <p className="an-section-sub">{t.requestsSubtitle}</p>

        {pendingRequests === 0 ? (
          <div className="an-empty-state">
            <CheckCircle2 size={28} color="#10b981" />
            <strong>{t.noRequests}</strong>
            <span>{t.noRequestsSub}</span>
          </div>
        ) : (
          <>
            <div className="an-requests-stat">
              <span className="an-requests-stat-value">{formatNumber(pendingRequests, language)}</span>
              <span className="an-requests-stat-label">{t.kpiPendingRequests}</span>
            </div>
            {oldestDays !== null && (
              <div className="an-requests-oldest">
                <Clock size={15} />
                <span>{t.oldestPendingLabel}: <strong>{formatDaysPending(oldestDays, language)}</strong></span>
              </div>
            )}
          </>
        )}

        <button type="button" className="an-link-btn" onClick={() => navigate('/transfers')}>
          <ArrowLeftRight size={14} />
          {t.viewAllRequestsAction}
        </button>
      </div>

      <ChartCard title={t.requestsByTypeTitle} subtitle={t.requestsByTypeSubtitle}>
        <RequestBarChart
          rows={typeRows} labelKey="request_type" valueLabel={t.kpiPendingRequests}
          language={language} t={t} emptyLabel={t.noRequests}
        />
      </ChartCard>

      <ChartCard title={t.requestsByRegionTitle} subtitle={t.requestsByRegionSubtitle}>
        <RequestBarChart
          rows={regionRows} labelKey="region" valueLabel={t.kpiPendingRequests}
          language={language} t={t} emptyLabel={t.noRequests}
        />
      </ChartCard>
    </div>
  );
}

export default SpecialRequestsPanel;
