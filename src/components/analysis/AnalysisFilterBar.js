import React from 'react';
import { Search } from 'lucide-react';
import { ActiveFilters } from './AnalysisPrimitives';

// Global filter bar - only filters backed by real data (region, free-text
// search over building/region name). Every dashboard section (KPIs,
// issues, charts, table) consumes the same `filterRegion`/`search` state
// from the parent page, so nothing here silently fails to apply.
function AnalysisFilterBar({
  t, canPickRegion, regions, filterRegion, onRegionChange,
  search, onSearchChange, onReset, hasActiveFilters,
}) {
  const chips = [];
  if (canPickRegion && filterRegion !== 'all') {
    const region = regions.find((r) => String(r.id) === String(filterRegion));
    if (region) {
      chips.push({
        key: 'region', label: `${t.regionFilterLabel}: ${region.name}`,
        onRemove: () => onRegionChange('all'),
      });
    }
  }
  if (search) {
    chips.push({
      key: 'search', label: `${t.searchLabel}: ${search}`,
      onRemove: () => onSearchChange(''),
    });
  }

  return (
    <div className="an-filter-bar">
      {canPickRegion && (
        <div className="an-filter-field">
          <label htmlFor="an-region-select">{t.regionFilterLabel}</label>
          <select
            id="an-region-select"
            value={filterRegion}
            onChange={(e) => onRegionChange(e.target.value)}
          >
            <option value="all">{t.allRegions}</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="an-filter-field an-filter-search">
        <Search size={15} />
        <label htmlFor="an-building-search" className="an-visually-hidden">{t.searchLabel}</label>
        <input
          id="an-building-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.searchPlaceholder}
        />
      </div>
      <ActiveFilters
        chips={chips}
        resetLabel={t.resetFilters}
        onReset={hasActiveFilters ? onReset : null}
        ariaRemove={t.removeFilterAria}
      />
    </div>
  );
}

export default AnalysisFilterBar;
