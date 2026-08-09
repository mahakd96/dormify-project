import React, { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, Eye } from 'lucide-react';
import { StatusBadge, AnalysisEmptyState, ExportButton } from './AnalysisPrimitives';
import {
  formatNumber, formatPercent, classifyBuildingStatus, computeBuildingUrgency,
  BUILDING_STATUS, BUILDING_STATUS_LABELS, BUILDING_STATUS_COLORS, THRESHOLDS,
} from './analysisUtils';

const PAGE_SIZE = 12;

// Exports exactly what is currently on screen (search + region + status
// filters, current sort) as an .xlsx workbook, using the `xlsx` package
// already listed in package.json (no new dependency). This is a client-side
// export of already-authorized, already-fetched data only - it never
// requests anything new from the backend, so it cannot exceed the current
// user's authorized scope.
async function exportRowsToExcel(rows, t, language) {
  const XLSX = await import('xlsx');
  const header = [t.colBuilding, t.colRegion, t.colCapacity, t.colAssigned, t.colAvailable, t.colOccupancy, t.colStatus];
  const body = rows.map((row) => [
    row.building,
    row.region,
    row.total_beds,
    row.assigned,
    row.available_beds,
    `${row.occupancy_rate}%`,
    BUILDING_STATUS_LABELS[language]?.[row.statusKey] || row.statusKey,
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Buildings');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Dormify_Building_Analytics_${today}.xlsx`);
}

// The central operational tool of the dashboard (Section 7 - "Buildings
// Requiring Attention"): real capacity/occupancy numbers, a deterministic
// status, and controls to get from a high-level signal down to the exact
// rows that caused it. Defaults to a collapsed view of only the top ~10
// most urgent buildings (by computeBuildingUrgency, not just occupancy%) so
// the overview never dumps every building on screen at once; "show all"
// reveals the full search/filter/sort/paginate experience.
function BuildingAnalyticsTable({
  rows, regions, t, language, isHebrew,
  regionFilter, onRegionFilterChange,
  statusFilter, onStatusFilterChange,
  search, onSearchChange,
  onOpenDetails,
}) {
  const [sort, setSort] = useState({ key: 'urgency', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const decorated = useMemo(() => rows.map((row) => ({
    ...row,
    statusKey: classifyBuildingStatus(row),
    urgency: computeBuildingUrgency(row),
  })), [rows]);

  const filtered = useMemo(() => {
    let result = decorated;
    const searchLower = search.trim().toLowerCase();
    if (searchLower) {
      result = result.filter((r) =>
        r.building.toLowerCase().includes(searchLower) || r.region.toLowerCase().includes(searchLower));
    }
    if (regionFilter !== 'all') {
      result = result.filter((r) => String(r.region_id) === String(regionFilter) || r.region === regionFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.statusKey === statusFilter);
    }
    return result;
  }, [decorated, search, regionFilter, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
  }, [filtered, sort]);

  // Whenever a filter/search/sort is actively used, expand automatically -
  // a user who just typed a search term or picked a status filter expects
  // to see the matching rows, not a truncated "top 10 urgent" list that may
  // not include their match at all.
  const isFilteredView = expanded || Boolean(search.trim()) || regionFilter !== 'all' || statusFilter !== 'all';
  const visibleRows = isFilteredView ? sorted : sorted.slice(0, THRESHOLDS.TOP_URGENT_BUILDINGS);

  const totalPages = Math.max(Math.ceil(visibleRows.length / PAGE_SIZE), 1);

  useEffect(() => { setPage(1); }, [search, regionFilter, statusFilter, sort, expanded]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageRows = isFilteredView ? visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : visibleRows;

  const toggleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const columns = [
    { key: 'building', label: t.colBuilding, align: 'start' },
    { key: 'region', label: t.colRegion, align: 'start' },
    { key: 'total_beds', label: t.colCapacity, align: 'end' },
    { key: 'assigned', label: t.colAssigned, align: 'end' },
    { key: 'available_beds', label: t.colAvailable, align: 'end' },
    { key: 'occupancy_rate', label: t.colOccupancy, align: 'end' },
    { key: 'statusKey', label: t.colStatus, align: 'start' },
  ];

  const statusOptions = [
    BUILDING_STATUS.REVIEW, BUILDING_STATUS.FULL, BUILDING_STATUS.NEARLY_FULL,
    BUILDING_STATUS.HEALTHY, BUILDING_STATUS.UNDERUTILIZED, BUILDING_STATUS.NO_ASSIGNMENTS,
  ];

  return (
    <div className="an-section-card">
      <div className="an-table-header">
        <div>
          <h2>{t.tableTitle}</h2>
          <p className="an-section-sub">{t.tableSubtitle}</p>
        </div>
        <div className="an-table-export">
          <ExportButton
            label={t.exportTableAction}
            loadingLabel={t.exporting}
            loading={exporting}
            variant="light"
            disabled={sorted.length === 0}
            onClick={async () => {
              setExporting(true);
              setExportError('');
              try {
                await exportRowsToExcel(sorted, t, language);
              } catch {
                setExportError(t.exportError);
              } finally {
                setExporting(false);
              }
            }}
          />
          {exportError && <span className="an-table-export-error" role="alert">{exportError}</span>}
        </div>
      </div>

      {!isFilteredView && rows.length > 0 && (
        <p className="an-table-top-note">{t.topUrgentNote(Math.min(THRESHOLDS.TOP_URGENT_BUILDINGS, sorted.length))}</p>
      )}

      <div className="an-table-controls">
        <input
          className="an-table-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.tableSearchPlaceholder}
          aria-label={t.tableSearchPlaceholder}
        />
        {regions.length > 1 && (
          <select
            value={regionFilter}
            onChange={(e) => onRegionFilterChange(e.target.value)}
            aria-label={t.regionFilterLabel}
          >
            <option value="all">{t.filterRegionAll}</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          aria-label={t.filterStatusLabel}
        >
          <option value="all">{t.filterStatusAll}</option>
          {statusOptions.map((key) => (
            <option key={key} value={key}>{BUILDING_STATUS_LABELS[language]?.[key] || key}</option>
          ))}
        </select>
        <span className="an-table-count">
          {isFilteredView
            ? `${t.showing} ${sorted.length ? Math.min(sorted.length, (page - 1) * PAGE_SIZE + 1) : 0}–${Math.min(page * PAGE_SIZE, sorted.length)} ${t.of} ${sorted.length}`
            : `${t.showing} ${pageRows.length} ${t.of} ${sorted.length}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <AnalysisEmptyState title={t.noData} />
      ) : sorted.length === 0 ? (
        <AnalysisEmptyState title={t.noMatch} sub={t.noMatchSub} />
      ) : (
        <>
          <div className="an-table-wrap">
            <table className="an-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} onClick={() => toggleSort(col.key)} style={{ textAlign: col.align }}>
                      <button type="button" className="an-th-btn" aria-label={t.sortAria(col.label)}>
                        {col.label}
                        {sort.key === col.key && (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                      </button>
                    </th>
                  ))}
                  <th style={{ textAlign: 'start' }}>{t.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const colors = BUILDING_STATUS_COLORS[row.statusKey];
                  const label = BUILDING_STATUS_LABELS[language]?.[row.statusKey] || row.statusKey;
                  return (
                    <tr key={row.building_id || row.building}>
                      <td className="an-td-text"><bdi>{row.building}</bdi></td>
                      <td className="an-td-text"><bdi>{row.region}</bdi></td>
                      <td className="an-td-num">{formatNumber(row.total_beds, language)}</td>
                      <td className="an-td-num">{formatNumber(row.assigned, language)}</td>
                      <td className="an-td-num">{formatNumber(row.available_beds, language)}</td>
                      <td className="an-td-num">{formatPercent(row.occupancy_rate, language)}</td>
                      <td><StatusBadge label={label} colors={colors} /></td>
                      <td>
                        <button type="button" className="an-row-details-btn" onClick={() => onOpenDetails(row)}>
                          <Eye size={13} />
                          {t.detailsAction}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!isFilteredView && sorted.length > THRESHOLDS.TOP_URGENT_BUILDINGS && (
            <div className="an-table-show-all">
              <button type="button" className="an-reset-btn" onClick={() => setExpanded(true)}>
                {t.showAllAction(sorted.length)}
              </button>
            </div>
          )}

          {isFilteredView && (
            <div className="an-pagination">
              {expanded && !search.trim() && regionFilter === 'all' && statusFilter === 'all' && (
                <button type="button" className="an-reset-btn an-table-show-less" onClick={() => setExpanded(false)}>
                  {t.showLessAction}
                </button>
              )}
              {totalPages > 1 && (
                <>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
                    {isHebrew ? '›' : '‹'} {t.prevPage}
                  </button>
                  <span>{t.pageOf(page, totalPages)}</span>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
                    {t.nextPage} {isHebrew ? '‹' : '›'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BuildingAnalyticsTable;
