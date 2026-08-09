import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home, Bed, Clock, AlertTriangle, ArrowLeftRight, Star,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { analysisAPI, regionsAPI, reportsAPI } from '../services/api';

import AnalysisHeader from '../components/analysis/AnalysisHeader';
import AnalysisFilterBar from '../components/analysis/AnalysisFilterBar';
import AttentionIssuesPanel from '../components/analysis/AttentionIssuesPanel';
import AnalysisTabs from '../components/analysis/AnalysisTabs';
import {
  MetricCard, SecondaryStat, AllocationProgressBar,
  AnalysisLoadingState, AnalysisSkeleton, AnalysisErrorState,
} from '../components/analysis/AnalysisPrimitives';
import { CapacityPressureScatter } from '../components/analysis/RegionPressureCharts';
import DistrictHealthOverview from '../components/analysis/DistrictHealthOverview';
import RecommendedActions from '../components/analysis/RecommendedActions';
import StudentGroupsChart from '../components/analysis/StudentGroupsChart';
import SpecialRequestsPanel from '../components/analysis/SpecialRequestsPanel';
import BuildingAnalyticsTable from '../components/analysis/BuildingAnalyticsTable';
import BuildingDetailsDrawer from '../components/analysis/BuildingDetailsDrawer';
import DataQualityPanel from '../components/analysis/DataQualityPanel';
import { getAnalysisText } from '../components/analysis/analysisTranslations';
import {
  num, pct, formatNumber, formatPercent, formatDaysPending, daysBetween,
  buildRegionRows, buildAttentionIssues, buildRecommendedActions, buildPressureInsight,
  countCriticalBuildings, THRESHOLDS,
} from '../components/analysis/analysisUtils';

function getRoleLabel(role, language) {
  const map = {
    central_admin: { he: 'מנהל מרכזי', en: 'Central Admin' },
    region_boss: { he: 'מנהל אזור', en: 'Region Admin' },
    employee: { he: 'עובד', en: 'Employee' },
  };
  return map[role]?.[language] || '';
}

function triggerBlobDownload(blob, filename) {
  const url = window.URL.createObjectURL(new Blob([blob]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// Tabs cover only the analytical dimensions NOT already shown in the
// always-visible command-center sections above them (KPIs, Attention Queue,
// District Health, Capacity Pressure, Recommended Actions, Buildings
// table already cover "overview" and "occupancy & capacity" in full - a
// literal Overview/Occupancy tab repeating that content would violate the
// "avoid duplicated information" principle this dashboard is built around).
const TAB_IDS = ['allocation', 'requests', 'groups', 'quality'];

function AnalysisPage({ language = 'he' }) {
  const isHebrew = language === 'he';
  const auth = useAuth();
  const {
    user, isCentralAdmin, canRunAllocation, canAssignPriority,
  } = auth;
  const navigate = useNavigate();
  const t = getAnalysisText(language);

  const [regions, setRegions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // null = no error; '' or a message string = an error occurred (empty
  // string means the API layer gave no message, so the translated generic
  // fallback is used at render time). The raw, untranslated message is kept
  // in state (not a translated fallback baked in at fetch time) so
  // fetchAnalysis stays fully stable across language switches.
  const [error, setError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const [exportingHeader, setExportingHeader] = useState(false);
  const [exportError, setExportError] = useState('');

  const [filterRegion, setFilterRegion] = useState('all');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(TAB_IDS[0]);
  const [tableRegionFilter, setTableRegionFilter] = useState('all');
  const [tableStatusFilter, setTableStatusFilter] = useState('all');
  const [selectedBuilding, setSelectedBuilding] = useState(null);

  const districtRef = useRef(null);
  const tableRef = useRef(null);
  const tabsRef = useRef(null);

  const fetchAnalysis = useCallback(async (regionId, isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await analysisAPI.getData(regionId && regionId !== 'all' ? regionId : null);
      setData(result);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err?.message || '');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    regionsAPI.getAll()
      .then((list) => { if (alive) setRegions(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setRegions([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    fetchAnalysis(filterRegion);
    // fetchAnalysis is stable ([] deps, see above) - listing it here does
    // not cause extra runs beyond filterRegion changing.
  }, [filterRegion, fetchAnalysis]);

  const resetFilters = () => {
    setFilterRegion('all');
    setSearch('');
    setTableStatusFilter('all');
    setTableRegionFilter('all');
  };
  const hasActiveFilters = filterRegion !== 'all' || Boolean(search);

  const summary = data?.summary || {};
  const roleLabel = getRoleLabel(user?.role, language);
  const regionContext = data?.region?.name || (isCentralAdmin?.() ? t.systemWide : '');
  const canPickRegion = isCentralAdmin?.() && regions.length > 1;
  const canRunAllocationNow = typeof canRunAllocation === 'function' && canRunAllocation();
  const canAssignPriorityNow = typeof canAssignPriority === 'function' && canAssignPriority();

  const totalStudents = num(summary.total_students);
  const unassignedStudents = num(summary.unassigned_students);
  const occupancyRate = num(summary.occupancy_rate);
  const availableBeds = num(summary.available_beds);
  const totalCapacity = num(summary.total_capacity);
  const occupiedBeds = num(summary.occupied_beds);
  const activeBuildings = num(summary.active_buildings);
  const priorityStudents = num(summary.priority_students);
  const priorityUnassigned = num(summary.priority_unassigned_students);
  const priorityAssigned = Math.max(priorityStudents - priorityUnassigned, 0);
  const pendingRequests = num(summary.pending_requests);
  const assignedStudents = num(summary.assigned_students);

  // All buildings the backend returned for the current region scope.
  const occupancyRowsAll = useMemo(() => (data?.occupancy_data || []).map((r) => ({
    building_id: r.building_id,
    building: r.building || t.unknown,
    region: r.region || t.unknown,
    region_id: r.region_id,
    total_beds: num(r.total_beds),
    assigned: num(r.assigned),
    available_beds: num(r.available_beds),
    occupancy_rate: num(r.occupancy_rate),
  })), [data, t.unknown]);

  const regionRows = useMemo(
    () => buildRegionRows(occupancyRowsAll, data?.students_by_region || [], data?.requests_by_region || []),
    [occupancyRowsAll, data]
  );

  // Regions actually present in the current building data - used for the
  // table's own region refinement so it never lists a region with nothing
  // to show (relevant mainly when a central admin views "All Regions").
  const distinctTableRegions = useMemo(() => {
    const map = new Map();
    occupancyRowsAll.forEach((r) => {
      if (r.region_id && !map.has(String(r.region_id))) map.set(String(r.region_id), { id: r.region_id, name: r.region });
    });
    return [...map.values()];
  }, [occupancyRowsAll]);

  const criticalBuildingsCount = useMemo(() => countCriticalBuildings(occupancyRowsAll), [occupancyRowsAll]);

  const issues = useMemo(() => buildAttentionIssues({
    summary,
    occupancyRows: occupancyRowsAll,
    regionRows,
    latestRun: data?.latest_run,
    oldestPendingCreatedAt: data?.oldest_pending_request_created_at,
    canRunAllocation: canRunAllocationNow,
    canAssignPriority: canAssignPriorityNow,
    language,
  }), [
    summary, occupancyRowsAll, regionRows, data, language,
    canRunAllocationNow, canAssignPriorityNow,
  ]);

  const recommendedActions = useMemo(() => buildRecommendedActions({
    summary,
    regionRows,
    occupancyRows: occupancyRowsAll,
    latestBatch: data?.latest_batch,
    canRunAllocation: canRunAllocationNow,
    canAssignPriority: canAssignPriorityNow,
    language,
  }), [summary, regionRows, occupancyRowsAll, data, canRunAllocationNow, canAssignPriorityNow, language]);

  const pressureInsight = useMemo(() => buildPressureInsight(regionRows, language), [regionRows, language]);

  const oldestPendingDays = data?.oldest_pending_request_created_at
    ? daysBetween(data.oldest_pending_request_created_at) : null;

  const scrollTo = useCallback((ref) => {
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  const applyRegionFilter = useCallback((regionName) => {
    if (!regionName) return;
    if (canPickRegion) {
      const match = regions.find((r) => r.name === regionName);
      if (match) setFilterRegion(String(match.id));
    } else {
      setTableRegionFilter('all');
    }
  }, [canPickRegion, regions]);

  // One consistent drill-down handler shared by Attention Queue items,
  // Recommended Action cards, and District Health rows - every action shape
  // ({type, payload, target}) produced by analysisUtils is interpreted
  // exactly once, here.
  const handleAction = useCallback((action) => {
    if (!action) return;
    if (action.type === 'route') { navigate(action.payload); return; }
    if (action.type === 'switch-tab') {
      setActiveTab(action.payload);
      scrollTo(tabsRef);
      return;
    }
    if (action.type === 'filter-region') {
      applyRegionFilter(action.payload);
      scrollTo(action.target === 'table' ? tableRef : districtRef);
      return;
    }
    if (action.type === 'table-filter') {
      if (action.payload?.status) setTableStatusFilter(action.payload.status);
      scrollTo(tableRef);
    }
  }, [navigate, applyRegionFilter, scrollTo]);

  const handleDistrictDrillDown = useCallback((regionName) => {
    applyRegionFilter(regionName);
    setTableStatusFilter('all');
    scrollTo(tableRef);
  }, [applyRegionFilter, scrollTo]);

  const handleHeaderExport = useCallback(async () => {
    setExportingHeader(true);
    setExportError('');
    try {
      const regionId = filterRegion !== 'all' ? filterRegion : null;
      const response = await reportsAPI.downloadCapacityReport(regionId);
      const today = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(response.data, `Dormify_Capacity_Report_${regionId || 'All_Regions'}_${today}.xlsx`);
    } catch {
      setExportError(t.exportError);
    } finally {
      setExportingHeader(false);
    }
  }, [filterRegion, t.exportError]);

  const kpis = useMemo(() => {
    // Same thresholds as building/region status classification - a KPI
    // card and a district/building row will never disagree about what
    // counts as "nearly full" or "underutilized".
    const occupancyStatus = (occupancyRate >= THRESHOLDS.OCCUPANCY_NEARLY_FULL || occupancyRate <= THRESHOLDS.OCCUPANCY_UNDERUTILIZED_MAX)
      ? 'warn'
      : occupancyRate >= THRESHOLDS.OCCUPANCY_HEALTHY_MIN ? 'good' : 'neutral';
    const waitingStatus = unassignedStudents === 0 ? 'good' : (availableBeds === 0 ? 'critical' : 'warn');
    const criticalStatus = criticalBuildingsCount === 0 ? 'good' : 'warn';

    return [
      {
        key: 'occupancy', icon: Home, accent: '#0f172a', bg: '#e2e8f0',
        value: formatPercent(occupancyRate, language), label: t.kpiOccupancy,
        sub: t.bedsOccupiedCtx(occupiedBeds, totalCapacity, language === 'he' ? 'he-IL' : 'en-US'),
        definition: t.kpiOccupancyDef, definitionAria: t.kpiOccupancy,
        status: occupancyStatus, onClick: () => scrollTo(districtRef),
      },
      {
        key: 'available', icon: Bed, accent: '#0d9488', bg: '#ccfbf1',
        value: formatNumber(availableBeds, language), label: t.kpiAvailableBeds,
        sub: t.readyForAssignment, definition: t.kpiAvailableBedsDef, definitionAria: t.kpiAvailableBeds,
        status: 'neutral', onClick: () => scrollTo(districtRef),
      },
      {
        key: 'waiting', icon: Clock, accent: '#d97706', bg: '#fef3c7',
        value: formatNumber(unassignedStudents, language), label: t.kpiWaiting,
        sub: t.stillWaitingCtx(unassignedStudents, language === 'he' ? 'he-IL' : 'en-US'),
        definition: t.kpiWaitingDef, definitionAria: t.kpiWaiting,
        status: waitingStatus, onClick: () => scrollTo(districtRef),
      },
      {
        key: 'critical', icon: AlertTriangle, accent: '#dc2626', bg: '#fee2e2',
        value: formatNumber(criticalBuildingsCount, language), label: t.kpiCriticalBuildings,
        sub: criticalBuildingsCount > 0
          ? t.criticalBuildingsCtx(criticalBuildingsCount, activeBuildings, language === 'he' ? 'he-IL' : 'en-US')
          : t.noCriticalBuildings,
        definition: t.kpiCriticalBuildingsDef, definitionAria: t.kpiCriticalBuildings,
        status: criticalStatus, onClick: () => scrollTo(tableRef),
      },
    ];
  }, [
    occupancyRate, unassignedStudents, availableBeds, occupiedBeds, totalCapacity,
    criticalBuildingsCount, activeBuildings, language, t, scrollTo,
  ]);

  const tabs = [
    { id: 'allocation', label: t.tabAllocation },
    { id: 'requests', label: t.tabRequests },
    { id: 'groups', label: t.tabGroups },
    { id: 'quality', label: t.tabQuality },
  ];

  return (
    <div className="analysis-page" dir={isHebrew ? 'rtl' : 'ltr'}>
      <AnalysisHeader
        t={t} language={language} roleLabel={roleLabel} regionContext={regionContext}
        latestBatchFilename={data?.latest_batch?.filename}
        lastFetchedAt={lastFetchedAt} refreshing={refreshing} loading={loading}
        onRefresh={() => fetchAnalysis(filterRegion, true)}
        onExport={handleHeaderExport} exporting={exportingHeader} exportError={exportError}
      />

      <AnalysisFilterBar
        t={t} canPickRegion={canPickRegion} regions={regions}
        filterRegion={filterRegion} onRegionChange={setFilterRegion}
        search={search} onSearchChange={setSearch}
        onReset={resetFilters} hasActiveFilters={hasActiveFilters}
      />

      {loading && (
        <>
          <AnalysisLoadingState text={t.loadingTitle} />
          <AnalysisSkeleton />
        </>
      )}

      {!loading && error !== null && (
        <AnalysisErrorState text={error || t.loadError} retryLabel={t.retry} onRetry={() => fetchAnalysis(filterRegion)} />
      )}

      {!loading && error === null && data && (
        <>
          <div className="an-kpi-row">
            {kpis.map((k) => (
              <MetricCard
                key={k.key}
                icon={k.icon} accent={k.accent} bg={k.bg} value={k.value} label={k.label}
                sub={k.sub} definition={k.definition} definitionAria={k.definitionAria}
                status={k.status} onClick={k.onClick}
              />
            ))}
          </div>

          <div className="an-secondary-strip">
            <SecondaryStat
              icon={ArrowLeftRight} label={t.kpiPendingRequests} value={formatNumber(pendingRequests, language)}
              tone={pendingRequests > 0 ? 'warn' : 'good'} onClick={() => navigate('/transfers')}
            />
            <SecondaryStat
              icon={Star} label={t.secondaryPriorityWaiting} value={formatNumber(priorityUnassigned, language)}
              tone={priorityUnassigned > 0 ? 'warn' : 'good'}
              onClick={canAssignPriorityNow ? () => navigate('/priority') : undefined}
            />
            {oldestPendingDays !== null && (
              <span className="an-secondary-note">
                {t.secondaryOldestRequest(formatDaysPending(oldestPendingDays, language))}
              </span>
            )}
          </div>

          <AttentionIssuesPanel
            issues={issues} t={t} language={language} isHebrew={isHebrew}
            onIssueAction={handleAction}
          />

          <div ref={districtRef}>
            <DistrictHealthOverview
              regionRows={regionRows} t={t} language={language} isHebrew={isHebrew}
              onDrillDown={handleDistrictDrillDown}
            />
          </div>

          <CapacityPressureScatter regionRows={regionRows} t={t} language={language} insight={pressureInsight} />

          <RecommendedActions actions={recommendedActions} t={t} isHebrew={isHebrew} onAction={handleAction} />

          <div ref={tableRef}>
            <BuildingAnalyticsTable
              rows={occupancyRowsAll}
              regions={distinctTableRegions}
              t={t} language={language} isHebrew={isHebrew}
              regionFilter={tableRegionFilter} onRegionFilterChange={setTableRegionFilter}
              statusFilter={tableStatusFilter} onStatusFilterChange={setTableStatusFilter}
              search={search} onSearchChange={setSearch}
              onOpenDetails={setSelectedBuilding}
            />
          </div>

          <div ref={tabsRef}>
            <AnalysisTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel={t.tabsAriaLabel} />

            <div
              role="tabpanel"
              id={`an-tabpanel-${activeTab}`}
              aria-labelledby={`an-tab-${activeTab}`}
              className="an-tabpanel"
            >
              {activeTab === 'allocation' && (
                <div className="an-section-card">
                  <h2>{t.tabAllocation}</h2>
                  <AllocationProgressBar
                    label={t.kpiTotalStudents}
                    total={totalStudents}
                    segments={[
                      { key: 'assigned', label: t.assigned, value: assignedStudents, color: '#059669' },
                      { key: 'waiting', label: t.waiting, value: unassignedStudents, color: '#e2e8f0', textColor: '#475569' },
                    ]}
                    formatNumber={formatNumber} pct={pct} language={language}
                  />
                  {priorityStudents > 0 && (
                    <AllocationProgressBar
                      label={t.dimPriority}
                      total={priorityStudents}
                      segments={[
                        { key: 'p-assigned', label: t.assigned, value: priorityAssigned, color: '#2563eb' },
                        { key: 'p-waiting', label: t.waiting, value: priorityUnassigned, color: '#fde68a', textColor: '#92400e' },
                      ]}
                      formatNumber={formatNumber} pct={pct} language={language}
                    />
                  )}
                </div>
              )}

              {activeTab === 'requests' && (
                <SpecialRequestsPanel data={data} t={t} language={language} isHebrew={isHebrew} />
              )}

              {activeTab === 'groups' && (
                <StudentGroupsChart data={data} summary={summary} language={language} isHebrew={isHebrew} t={t} />
              )}

              {activeTab === 'quality' && (
                <DataQualityPanel data={data} t={t} language={language} />
              )}
            </div>
          </div>
        </>
      )}

      {selectedBuilding && (
        <BuildingDetailsDrawer
          row={selectedBuilding} t={t} language={language} isHebrew={isHebrew}
          canRunAllocation={canRunAllocationNow}
          onClose={() => setSelectedBuilding(null)}
          onNavigate={(path) => { setSelectedBuilding(null); navigate(path); }}
        />
      )}

      <style>{`
        .analysis-page { padding: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 100%; }
        .an-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

        /* Header */
        .an-header {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap;
          background: linear-gradient(120deg, #0f172a 0%, #1e293b 60%, #1e3a8a 140%);
          border-radius: 16px; padding: 18px 24px; box-shadow: 0 8px 24px rgba(15,23,42,0.2);
        }
        .an-header-main { min-width: 0; flex: 1; }
        .an-header h1 { font-size: 21px; font-weight: 800; color: white; margin: 0 0 4px; }
        .an-subtitle { color: #cbd5e1; font-size: 13px; margin: 0 0 10px; max-width: 640px; }
        .an-context-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .an-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px;
          font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.14); color: white;
        }
        .an-chip-outline { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #cbd5e1; }
        .an-header-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
        [dir="rtl"] .an-header-actions { align-items: flex-start; }
        .an-updated { font-size: 11px; color: #93c5fd; white-space: nowrap; }
        .an-header-btn-row { display: flex; gap: 8px; }
        .an-refresh-btn, .an-export-btn {
          display: flex; align-items: center; gap: 7px; padding: 9px 15px; border-radius: 9px;
          font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; white-space: nowrap; border: none;
        }
        .an-refresh-btn { background: white; color: #1d4ed8; }
        .an-refresh-btn:hover:not(:disabled) { background: #eff6ff; }
        .an-export-btn-dark { background: rgba(255,255,255,0.14); color: white; border: 1px solid rgba(255,255,255,0.25); }
        .an-export-btn-dark:hover:not(:disabled) { background: rgba(255,255,255,0.22); }
        .an-export-btn-light { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .an-export-btn-light:hover:not(:disabled) { background: #dbeafe; }
        .an-refresh-btn:disabled, .an-export-btn:disabled { opacity: 0.65; cursor: default; }
        .an-export-error { font-size: 11px; color: #fecaca; max-width: 260px; text-align: end; }
        .an-spin { animation: an-spin 1s linear infinite; }
        @keyframes an-spin { to { transform: rotate(360deg); } }

        /* Filter bar */
        .an-filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .an-filter-field { display: flex; align-items: center; gap: 8px; }
        .an-filter-field label { font-size: 12.5px; font-weight: 700; color: #475569; }
        .an-filter-field select {
          padding: 9px 12px; border-radius: 9px; border: 1px solid #dbe4ef; font-size: 13.5px;
          color: #0f172a; background: white; cursor: pointer; min-width: 170px; max-width: 260px; font-family: inherit;
        }
        .an-filter-search {
          background: white; border: 1px solid #dbe4ef; border-radius: 9px; padding: 0 12px; min-width: 240px; color: #94a3b8;
        }
        .an-filter-search input {
          border: none; outline: none; padding: 10px 8px; font-size: 13.5px; width: 100%; color: #0f172a; font-family: inherit;
        }
        .an-active-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .an-filter-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
          background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 700; max-width: 260px;
        }
        .an-filter-chip button { border: none; background: none; color: inherit; cursor: pointer; display: flex; padding: 0; }
        .an-reset-btn {
          padding: 9px 14px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 9px;
          font-size: 13px; font-weight: 700; color: #475569; cursor: pointer; font-family: inherit;
        }
        .an-reset-btn:hover { background: #e2e8f0; }

        /* States */
        .an-state-panel {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; padding: 32px 24px; background: white; border-radius: 16px;
          color: #64748b; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .an-error-panel { color: #b91c1c; }
        .an-retry-btn {
          display: flex; align-items: center; gap: 6px; padding: 8px 18px;
          background: #2563eb; color: white; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .an-empty-inline {
          display: flex; align-items: center; gap: 12px; padding: 26px 16px; color: #94a3b8;
          justify-content: center; text-align: start;
        }
        .an-empty-inline strong { display: block; color: #475569; font-size: 13.5px; }
        .an-empty-inline span { display: block; font-size: 12px; color: #94a3b8; margin-top: 2px; }

        /* Loading skeleton */
        .an-skeleton { display: flex; flex-direction: column; gap: 16px; }
        .an-skeleton-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .an-skeleton-card {
          background: linear-gradient(90deg, #eef2f7 25%, #f6f8fb 37%, #eef2f7 63%);
          background-size: 400% 100%; animation: an-shimmer 1.4s ease infinite; border-radius: 14px;
        }
        .an-skeleton-kpi { height: 96px; }
        .an-skeleton-block { height: 160px; }
        @keyframes an-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

        /* KPI cards */
        .an-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .an-kpi-card {
          display: flex; flex-direction: column; gap: 8px; padding: 15px 16px; text-align: start;
          background: white; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-top: 3px solid var(--accent, #94a3b8); cursor: pointer; font-family: inherit;
          transition: transform 0.15s, box-shadow 0.15s; min-width: 0; width: 100%;
        }
        .an-kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
        .an-kpi-top { display: flex; align-items: flex-start; justify-content: space-between; }
        .an-kpi-icon {
          width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center;
          background: var(--bg, #f1f5f9); color: var(--accent, #64748b);
        }
        .an-kpi-value { font-size: 24px; font-weight: 800; color: #1e293b; line-height: 1; }
        .an-kpi-label { font-size: 12.5px; color: #64748b; font-weight: 600; }
        .an-kpi-sub { font-size: 11.5px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .an-kpi-warn .an-kpi-sub { color: #b45309; }
        .an-kpi-critical .an-kpi-sub { color: #b91c1c; }
        .an-kpi-good .an-kpi-sub { color: #047857; }

        .an-def-wrap { position: relative; display: inline-flex; }
        .an-def-trigger {
          border: none; background: none; color: #94a3b8; cursor: pointer; padding: 2px; display: flex; border-radius: 4px;
        }
        .an-def-trigger:hover, .an-def-trigger:focus-visible { color: #2563eb; outline: 2px solid #93c5fd; outline-offset: 1px; }
        .an-def-bubble {
          position: absolute; top: 22px; inset-inline-end: 0; z-index: 20; width: 220px; padding: 10px 12px;
          background: #0f172a; color: white; font-size: 11.5px; line-height: 1.5; border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25); text-align: start;
        }

        /* Secondary indicator strip */
        .an-secondary-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .an-secondary-stat {
          display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 10px;
          background: white; border: 1px solid #eef2f7; font-family: inherit; cursor: default;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        button.an-secondary-stat { cursor: pointer; }
        button.an-secondary-stat:hover { border-color: #cbd5e1; }
        .an-secondary-warn { color: #b45309; }
        .an-secondary-warn svg { color: #d97706; }
        .an-secondary-good { color: #166534; }
        .an-secondary-good svg { color: #059669; }
        .an-secondary-neutral { color: #475569; }
        .an-secondary-value { font-weight: 800; font-size: 13.5px; }
        .an-secondary-label { font-size: 12px; font-weight: 600; }
        .an-secondary-note { font-size: 12px; color: #94a3b8; }

        /* Issues panel */
        .an-insights-section {
          background: white; border-radius: 16px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-inline-start: 4px solid #cbd5e1;
        }
        .an-insights-section.has-items { border-inline-start-color: #dc2626; }
        .an-insights-section.all-clear { border-inline-start-color: #10b981; }
        .an-insights-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .an-insights-header h2 { font-size: 15.5px; font-weight: 800; color: #1e293b; margin: 0; }
        .an-insights-count { font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 20px; background: #fee2e2; color: #b91c1c; flex-shrink: 0; }
        .an-insights-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; list-style: none; margin: 0; padding: 0; }
        .an-insight-item {
          display: flex; align-items: flex-start; gap: 12px; padding: 12px 13px;
          background: #f8fafc; border-radius: 12px; text-align: start;
          border: 1px solid #eef2f7; border-inline-start: 3px solid transparent;
          width: 100%; cursor: default; font-family: inherit; transition: all 0.15s;
        }
        .an-insight-item.clickable { cursor: pointer; }
        .an-insight-item.clickable:hover { background: white; box-shadow: 0 4px 14px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .an-sev-critical { border-inline-start-color: #dc2626; }
        .an-sev-high { border-inline-start-color: #f97316; }
        .an-sev-medium { border-inline-start-color: #f59e0b; }
        .an-sev-info { border-inline-start-color: #3b82f6; }
        .an-insight-icon { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .an-sev-critical .an-insight-icon { background: #fee2e2; color: #dc2626; }
        .an-sev-high .an-insight-icon { background: #ffedd5; color: #ea580c; }
        .an-sev-medium .an-insight-icon { background: #fef3c7; color: #d97706; }
        .an-sev-info .an-insight-icon { background: #dbeafe; color: #2563eb; }
        .an-insight-body { flex: 1; min-width: 0; }
        .an-insight-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .an-insight-title { font-weight: 700; font-size: 13px; color: #1e293b; }
        .an-insight-desc { display: block; font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.45; }
        .an-insight-chevron { color: #cbd5e1; flex-shrink: 0; margin-top: 4px; }
        .an-empty-state {
          display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 20px 12px; color: #64748b;
        }
        .an-empty-state strong { color: #166534; font-size: 14px; }
        .an-empty-state span { font-size: 12.5px; max-width: 420px; }

        .an-status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 800; white-space: nowrap; }
        .an-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* District Health Overview */
        .an-dh-table th, .an-dh-table td { white-space: nowrap; }
        .an-dh-bar-cell { min-width: 140px; }
        .an-dh-bar-track { width: 100%; min-width: 120px; height: 8px; border-radius: 999px; background: #f1f5f9; overflow: hidden; }
        .an-dh-bar-fill { height: 100%; border-radius: 999px; transition: width 0.3s; }
        .an-dh-action-cell { text-align: start; }
        .an-dh-full-note { display: block; font-size: 10.5px; color: #94a3b8; margin-top: 3px; }

        /* Recommended actions */
        .an-actions-list { display: flex; flex-direction: column; gap: 10px; list-style: none; margin: 0; padding: 0; }
        .an-action-card {
          display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
          padding: 13px 15px; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 12px;
        }
        .an-action-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
        .an-action-title { font-weight: 700; font-size: 13.5px; color: #1e293b; }
        .an-action-desc { font-size: 12.5px; color: #64748b; line-height: 1.5; }
        .an-action-cta {
          display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px;
          background: #2563eb; color: white; border: none; font-size: 12.5px; font-weight: 700;
          cursor: pointer; font-family: inherit; white-space: nowrap; flex-shrink: 0;
        }
        .an-action-cta:hover:not(:disabled) { background: #1d4ed8; }
        .an-action-cta:disabled { background: #e2e8f0; color: #94a3b8; cursor: not-allowed; }

        /* Tabs */
        .an-tabs { display: flex; gap: 4px; background: white; padding: 5px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); flex-wrap: wrap; }
        .an-tab-btn {
          padding: 9px 16px; border-radius: 9px; border: none; background: none; color: #64748b;
          font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .an-tab-btn:hover { background: #f1f5f9; color: #334155; }
        .an-tab-btn.active { background: #2563eb; color: white; }
        .an-tab-btn:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }

        .an-tabpanel { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
        .an-tab-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }

        /* Chart cards (shared) */
        .an-section-card { background: white; border-radius: 16px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .an-section-card h2 { font-size: 15.5px; font-weight: 800; color: #1e293b; margin: 0 0 4px; }
        .an-section-sub { font-size: 12.5px; color: #94a3b8; margin: 0 0 14px; }
        .an-chart-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
        .an-chart-card-actions { flex-shrink: 0; }
        .an-chart-ltr { width: 100%; }
        .an-chart-insight { margin: 12px 0 0; padding: 10px 12px; background: #eff6ff; border-radius: 9px; font-size: 12.5px; color: #1e40af; line-height: 1.5; }
        .an-scatter-tooltip {
          background: #0f172a; color: white; font-size: 12px; padding: 10px 12px; border-radius: 8px; line-height: 1.6;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        }
        .an-scatter-tooltip strong { display: block; margin-bottom: 4px; font-size: 12.5px; }

        .an-dim-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
        .an-dim-btn {
          padding: 7px 14px; border-radius: 999px; border: 1px solid #dbe4ef; background: white;
          color: #334155; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .an-dim-btn:hover { border-color: #93c5fd; }
        .an-dim-btn.active { background: #2563eb; border-color: #2563eb; color: white; box-shadow: 0 4px 12px rgba(37,99,235,0.25); }

        /* Allocation progress bars */
        .an-perf-block { margin-bottom: 16px; }
        .an-perf-block:last-child { margin-bottom: 0; }
        .an-perf-label-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
        .an-perf-label { font-size: 13.5px; font-weight: 700; color: #334155; }
        .an-perf-total { font-size: 12px; color: #94a3b8; }
        .an-progress-track { display: flex; width: 100%; height: 28px; border-radius: 8px; overflow: hidden; background: #f1f5f9; }
        .an-progress-segment { display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 700; white-space: nowrap; overflow: hidden; transition: width 0.3s; }
        .an-perf-legend { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
        .an-perf-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; }
        .an-perf-swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }

        /* Special requests */
        .an-requests-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: start; }
        .an-requests-summary { display: flex; flex-direction: column; gap: 10px; }
        .an-requests-stat { display: flex; flex-direction: column; }
        .an-requests-stat-value { font-size: 30px; font-weight: 800; color: #1e293b; line-height: 1; }
        .an-requests-stat-label { font-size: 12.5px; color: #64748b; margin-top: 4px; }
        .an-requests-oldest { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #92400e; background: #fef3c7; padding: 8px 12px; border-radius: 9px; }
        .an-link-btn {
          display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; align-self: flex-start;
          border: none; background: none; color: #2563eb; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; padding: 0;
        }
        .an-link-btn:hover { text-decoration: underline; }

        /* Building analytics table */
        .an-table-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
        .an-table-export { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        [dir="rtl"] .an-table-export { align-items: flex-start; }
        .an-table-export-error { font-size: 11px; color: #dc2626; max-width: 220px; text-align: end; }
        .an-table-top-note { font-size: 12px; color: #94a3b8; margin: 0 0 10px; }
        .an-table-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
        .an-table-search, .an-table-controls select {
          padding: 8px 12px; border-radius: 9px; border: 1px solid #dbe4ef; font-size: 13px; font-family: inherit; color: #0f172a; background: white;
        }
        .an-table-search { min-width: 220px; flex: 1; max-width: 320px; }
        .an-table-controls select { cursor: pointer; max-width: 220px; }
        .an-table-count { font-size: 12px; color: #94a3b8; white-space: nowrap; margin-inline-start: auto; }
        .an-table-wrap { overflow-x: auto; }
        .an-table { width: 100%; border-collapse: collapse; min-width: 680px; }
        .an-table th {
          padding: 10px 14px; text-align: start; color: #475569; font-size: 12px; font-weight: 800;
          white-space: nowrap; background: #f8fafc; cursor: pointer; user-select: none; position: sticky; top: 0;
        }
        .an-th-btn {
          display: inline-flex; align-items: center; gap: 4px; border: none; background: none; font: inherit;
          color: inherit; cursor: pointer; padding: 0;
        }
        .an-table td { padding: 10px 14px; color: #1e293b; font-size: 13px; white-space: nowrap; border-top: 1px solid #eef2f7; }
        .an-td-text { text-align: start; }
        .an-td-num { text-align: end; font-variant-numeric: tabular-nums; }
        .an-row-details-btn {
          display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 7px;
          border: 1px solid #dbe4ef; background: white; color: #334155; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit;
        }
        .an-row-details-btn:hover { border-color: #93c5fd; color: #1d4ed8; }
        .an-table-show-all { display: flex; justify-content: center; margin-top: 14px; }
        .an-table-show-less { margin-inline-end: 8px; }
        .an-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 14px; flex-wrap: wrap; }
        .an-pagination button {
          padding: 7px 14px; border-radius: 8px; border: 1px solid #dbe4ef; background: white; color: #334155;
          font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit;
        }
        .an-pagination button:disabled { opacity: 0.45; cursor: default; }
        .an-pagination span { font-size: 12.5px; color: #64748b; }

        /* Data quality panel */
        .an-quality-warning {
          display: flex; align-items: center; gap: 8px; padding: 10px 13px; margin-bottom: 12px;
          background: #fffbeb; border: 1px solid #fde68a; border-radius: 9px; color: #92400e; font-size: 12.5px;
        }
        .an-recent-list { display: flex; flex-wrap: wrap; gap: 10px; }
        .an-recent-item {
          display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f8fafc;
          border-radius: 10px; border: 1px solid #eef2f7; flex: 1; min-width: 240px;
        }
        .an-recent-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: #dbeafe; color: #2563eb; }
        .an-recent-body { min-width: 0; }
        .an-recent-title { font-size: 12.5px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .an-recent-sub { font-size: 11.5px; color: #94a3b8; }
        .an-recent-runs { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e2e8f0; }
        .an-recent-runs-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
        .an-recent-runs-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .an-recent-runs-list li { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #334155; }
        .an-run-dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; flex-shrink: 0; }
        .an-run-completed { background: #059669; }
        .an-run-failed { background: #dc2626; }
        .an-run-running, .an-run-queued { background: #f59e0b; }
        .an-run-meta { color: #94a3b8; }

        /* Building details drawer */
        .an-drawer-overlay {
          position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 100;
          display: flex; justify-content: flex-end;
        }
        [dir="rtl"] .an-drawer-overlay { justify-content: flex-start; }
        .an-drawer {
          width: 100%; max-width: 400px; height: 100%; background: white; box-shadow: -8px 0 32px rgba(0,0,0,0.18);
          padding: 22px 22px 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;
          animation: an-drawer-in 0.2s ease;
        }
        @keyframes an-drawer-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        [dir="rtl"] .an-drawer { animation-name: an-drawer-in-rtl; }
        @keyframes an-drawer-in-rtl { from { transform: translateX(-24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .an-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .an-drawer-eyebrow { display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .an-drawer-header h2 { font-size: 17px; font-weight: 800; color: #1e293b; margin: 4px 0 2px; }
        .an-drawer-sub { font-size: 12.5px; color: #64748b; }
        .an-drawer-close {
          border: none; background: #f1f5f9; color: #475569; border-radius: 8px; padding: 6px; cursor: pointer; flex-shrink: 0;
        }
        .an-drawer-close:hover { background: #e2e8f0; }
        .an-drawer-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0; }
        .an-drawer-stats > div { background: #f8fafc; border-radius: 10px; padding: 10px 12px; }
        .an-drawer-stats dt { font-size: 11.5px; color: #94a3b8; margin: 0 0 3px; }
        .an-drawer-stats dd { font-size: 17px; font-weight: 800; color: #1e293b; margin: 0; }
        .an-drawer-reason { background: #f8fafc; border-radius: 10px; padding: 12px 13px; }
        .an-drawer-reason-label { font-size: 11.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
        .an-drawer-reason p { margin: 6px 0 0; font-size: 13px; color: #334155; line-height: 1.55; }
        .an-drawer-actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
        .an-drawer-actions .an-action-cta { justify-content: center; }

        @media (max-width: 1300px) {
          .an-kpi-row { grid-template-columns: repeat(2, 1fr); }
          .an-skeleton-kpi-row { grid-template-columns: repeat(2, 1fr); }
          .an-requests-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 900px) {
          .an-header { flex-direction: column; }
          .an-header-actions { align-items: stretch; width: 100%; }
          [dir="rtl"] .an-header-actions { align-items: stretch; }
          .an-export-error { text-align: start; max-width: 100%; }
        }
        @media (max-width: 640px) {
          .an-kpi-row { grid-template-columns: 1fr 1fr; }
          .an-insights-list { grid-template-columns: 1fr; }
          .an-drawer { max-width: 100%; }
        }
      `}</style>
    </div>
  );
}

export default AnalysisPage;
