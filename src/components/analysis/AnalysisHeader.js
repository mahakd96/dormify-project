import React from 'react';
import { RefreshCw, MapPin } from 'lucide-react';
import { ExportButton } from './AnalysisPrimitives';
import { formatTimestamp } from './analysisUtils';

// Compact professional header: title/subtitle, role + region + data-source
// context chips, and the refresh/export actions. Deliberately small - the
// old hero-style header consumed too much vertical space before any real
// content appeared.
function AnalysisHeader({
  t, language, roleLabel, regionContext, latestBatchFilename,
  lastFetchedAt, refreshing, loading, onRefresh,
  onExport, exporting, exportError,
}) {
  return (
    <header className="an-header">
      <div className="an-header-main">
        <h1>{t.pageTitle}</h1>
        <p className="an-subtitle">{t.pageSubtitle}</p>
        <div className="an-context-row">
          {roleLabel && <span className="an-chip">{roleLabel}</span>}
          {regionContext && (
            <span className="an-chip an-chip-outline"><MapPin size={12} />{regionContext}</span>
          )}
          <span className="an-chip an-chip-outline">
            {t.dataSource}: {latestBatchFilename ? <bdi>{latestBatchFilename}</bdi> : t.noBatch}
          </span>
        </div>
      </div>
      <div className="an-header-actions">
        {lastFetchedAt && (
          <span className="an-updated">
            {t.lastUpdated}: <bdi>{formatTimestamp(lastFetchedAt.toISOString(), language)}</bdi>
          </span>
        )}
        <div className="an-header-btn-row">
          <ExportButton
            label={t.exportAction}
            loadingLabel={t.exporting}
            loading={exporting}
            onClick={onExport}
          />
          <button
            type="button"
            className="an-refresh-btn"
            onClick={onRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw size={15} className={refreshing ? 'an-spin' : ''} />
            {refreshing ? t.refreshing : t.refresh}
          </button>
        </div>
        {exportError && <span className="an-export-error" role="alert">{exportError}</span>}
      </div>
    </header>
  );
}

export default AnalysisHeader;
