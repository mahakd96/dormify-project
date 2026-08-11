import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, AlertTriangle, ArrowRight, ChevronDown, ChevronUp,
  Percent, BedDouble, Users, ClipboardList, Lightbulb, Building2, MapPin,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { analysisAPI, regionsAPI } from '../services/api';
import { localizeRegionName, localizeById, localizeBuildingLabel } from '../utils/locationNames';

// ---------------------------------------------------------------------
// v4 — visual analytics redesign.
//
// Product idea unchanged from v3: ONE analysis at a time, real backend
// data only, same /api/analysis/ payload, same permissions/RTL/perf
// characteristics. What changed is entirely the information design:
//
//   - No Homepage-style KPI row. The page moves straight into choosing
//     and reading an analysis.
//   - Each analysis gets a chart form suited to its own question
//     (column / stacked column / grouped column / donut), not one
//     repeated horizontal-bar template.
//   - Charts are hand-built (HTML/CSS/SVG, no charting library) so RTL
//     is correct by construction instead of mirrored-by-luck.
//   - A second, genuinely different visual appears next to the detail
//     panel where it adds a real second cut on the data (a capacity
//     rollup for Occupancy, a "most room" list for Available Beds, a
//     demand-share donut for Demand) - never added just to fill space.
//
// See DATA_ANALYSIS_REDESIGN_V3_FINAL_REPORT.md, "Visual Analytics
// Redesign" section, for the full design rationale.
// ---------------------------------------------------------------------

const COLOR = {
  healthy: '#16a34a',
  caution: '#d97706',
  critical: '#dc2626',
  primary: '#2563eb',
  neutral: '#94a3b8',
};

// Per-analysis identity - reuses the exact accent/tint pairs the
// Homepage already uses for these same metrics (occupancy=blue,
// beds=teal, unassigned/waiting=amber, requests=violet), so this page
// reads as the same product without copying the Homepage's layout.
const ANALYSIS_META = {
  occupancy: { accent: '#2563eb', tint: '#eff6ff', iconBg: '#dbeafe', Icon: Percent },
  available: { accent: '#0d9488', tint: '#f0fdfa', iconBg: '#ccfbf1', Icon: BedDouble },
  demand: { accent: '#d97706', tint: '#fffbeb', iconBg: '#fef3c7', Icon: Users },
  requests: { accent: '#7c3aed', tint: '#faf5ff', iconBg: '#ede9fe', Icon: ClipboardList },
};

// Validated categorical order (dataviz skill default palette) - used
// wherever this page needs to tell more than ~3 same-kind entities
// apart by identity (request types, regions in the demand-share donut).
// Adjacent-pair CVD deltaE and normal-vision deltaE both pass; the sub-
// 3:1 contrast slots (aqua/yellow/magenta) always ship with a visible
// label next to them here, never color alone.
const CATEGORICAL_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

const REQUEST_TYPE_ORDER = ['add_student', 'remove_student', 'room', 'apartment', 'swap', 'region_transfer', 'other'];
const REQUEST_TYPE_COLORS = {
  add_student: CATEGORICAL_PALETTE[0],
  remove_student: CATEGORICAL_PALETTE[1],
  room: CATEGORICAL_PALETTE[2],
  apartment: CATEGORICAL_PALETTE[3],
  swap: CATEGORICAL_PALETTE[4],
  region_transfer: CATEGORICAL_PALETTE[5],
  other: CATEGORICAL_PALETTE[6],
};

const TOP_N = 12;

const REQUEST_TYPE_LABELS = {
  he: {
    add_student: 'הוספת סטודנט',
    remove_student: 'הסרת סטודנט',
    room: 'שינוי חדר',
    apartment: 'מעבר דירה',
    swap: 'חילוף בין סטודנטים',
    region_transfer: 'העברה בין אזורים',
    other: 'בקשה אחרת',
  },
  en: {
    add_student: 'Add student',
    remove_student: 'Remove student',
    room: 'Room change',
    apartment: 'Apartment change',
    swap: 'Student swap',
    region_transfer: 'Region transfer',
    other: 'Other request',
  },
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function formatNumber(value, language) {
  return num(value).toLocaleString(language === 'he' ? 'he-IL' : 'en-US');
}

function roundPct(value) {
  return Math.round(num(value));
}

function formatTimestamp(iso, language) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(language === 'he' ? 'he-IL' : 'en-US', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Blend a hex color toward white - used to build the "muted" (de-
// emphasized) step of an otherwise-identity color when one slice/row
// is selected and the rest recede. Computed, not hand-picked, so it
// stays correct if a palette value ever changes.
function mixWithWhite(hex, amount) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return hex;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const mix = (v) => Math.round(v + (255 - v) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function nounSingularPlural(count, groupBy, isHebrew) {
  const isRegion = groupBy === 'region';
  if (isHebrew) {
    if (isRegion) return count === 1 ? 'אזור' : 'אזורים';
    return count === 1 ? 'בניין' : 'בניינים';
  }
  if (isRegion) return count === 1 ? 'region' : 'regions';
  return count === 1 ? 'building' : 'buildings';
}

function nounPlural(kind, isHebrew) {
  if (kind === 'region') return isHebrew ? 'אזורים' : 'Regions';
  return isHebrew ? 'בניינים' : 'Buildings';
}

function defaultSortFor(analysis) {
  return { occupancy: 'high', available: 'low', demand: 'high', requests: 'high' }[analysis] || 'high';
}

// Semantic status tone per row - drives bar/column colour, badges, and
// the status chip row at the bottom of the main chart.
function getRowTone(analysis, row) {
  if (analysis === 'occupancy') {
    if (row.occupancy_rate >= 95) return 'critical';
    if (row.occupancy_rate >= 80) return 'caution';
    return 'healthy';
  }
  if (analysis === 'available') {
    if (row.total_beds <= 0) return 'neutral';
    const availPct = (row.available_beds / row.total_beds) * 100;
    if (availPct <= 5) return 'critical';
    if (availPct <= 20) return 'caution';
    return 'healthy';
  }
  if (analysis === 'demand') {
    if (row.available_in_region != null && row.unassigned_students > row.available_in_region) return 'critical';
    return 'healthy';
  }
  return 'primary';
}

// Ratio strings like "12/50" mix weak-directional digits with a neutral
// separator. Inside an RTL paragraph that combination can visually
// reorder itself (bidi reordering) unless isolated - <bdi> pins it to a
// stable left-to-right reading order.
function NumRatio({ a, b, language }) {
  return <bdi>{formatNumber(a, language)} / {formatNumber(b, language)}</bdi>;
}

function rowContext(analysis, row, t, language) {
  if (analysis === 'occupancy') {
    return (
      <>
        <NumRatio a={row.assigned} b={row.total_beds} language={language} /> {t.bedsOccupied} · {formatNumber(row.available_beds, language)} {t.availableBedsWord}
      </>
    );
  }
  if (analysis === 'available') {
    return `${formatNumber(row.available_beds, language)} ${t.availableBedsWord} · ${formatNumber(row.total_beds, language)} ${t.totalBedsWord}`;
  }
  if (analysis === 'demand') {
    return (
      <>
        {formatNumber(row.unassigned_students, language)} {t.waitingWord} · <NumRatio a={row.assigned_students} b={row.total_students} language={language} /> {t.assignedWord}
      </>
    );
  }
  return `${formatNumber(row.count, language)} ${t.pendingWord}`;
}

function AnalysisPage({ language = 'he' }) {
  const isHebrew = language === 'he';
  const auth = useAuth();
  const { isCentralAdmin } = auth;
  const navigate = useNavigate();

  const [regions, setRegions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const [filterRegion, setFilterRegion] = useState('all');
  const [analysis, setAnalysis] = useState('occupancy');
  const [groupByOverride, setGroupByOverride] = useState(null);
  const [sort, setSort] = useState('high');
  const [selectedKey, setSelectedKey] = useState(null);
  const [viewAll, setViewAll] = useState(false);

  const t = {
    he: {
      eyebrow: 'אנליטיקה',
      title: 'ניתוח נתונים',
      subtitle: 'בחרו שאלה לבדיקה, השוו בין אזורים ובניינים ואתרו בעיות קיבולת בזמן אמת.',
      refresh: 'רענון',
      refreshing: 'מרענן...',
      lastUpdated: 'עודכן',
      loading: 'טוען נתוני ניתוח...',
      loadError: 'אירעה שגיאה בטעינת נתוני הניתוח',
      retry: 'נסו שוב',
      noData: 'אין נתונים להצגה עבור הבחירה הנוכחית',

      analyzeLabel: 'ניתוח',
      occupancyLabel: 'תפוסה',
      availableLabel: 'מיטות פנויות',
      demandLabel: 'ביקוש / המתנה',
      requestsLabel: 'בקשות מיוחדות',

      regionLabel: 'אזור',
      allRegions: 'כל האזורים',

      groupByLabel: 'קיבוץ',
      groupByBuilding: 'בניין',
      groupByRegion: 'אזור',

      sortLabel: 'מיון',
      sortHigh: 'גבוה ← נמוך',
      sortLow: 'נמוך ← גבוה',
      sortAlpha: 'א־ב',

      resetFilters: 'איפוס',

      overallOccupancy: 'תפוסה כוללת',
      highest: 'הגבוה ביותר',
      lowest: 'הנמוך ביותר',

      totalAvailable: 'מיטות פנויות',
      mostAvailable: 'הזמינות הגבוהה',

      totalWaiting: 'ממתינים לשיבוץ',
      highestDemand: 'הביקוש הגבוה',

      totalPending: 'בקשות ממתינות',
      mostCommon: 'הסוג הנפוץ',

      listOccupancyBuilding: 'תפוסה לפי בניין',
      listOccupancyRegion: 'תפוסה לפי אזור',
      listAvailableBuilding: 'זמינות לפי בניין',
      listAvailableRegion: 'זמינות לפי אזור',
      listDemand: 'ביקוש מול קיבולת לפי אזור',
      listRequests: 'בקשות ממתינות לפי סוג',

      occSubRegion: 'תפוסת המגורים הנוכחית בכל אזורי דורמיפיי',
      occSubBuilding: 'תפוסת המגורים הנוכחית לפי בניין',
      availSubRegion: 'קיבולת פנויה לפי אזור — תפוסות מול פנויות',
      availSubBuilding: 'קיבולת פנויה לפי בניין — תפוסות מול פנויות',
      demandSub: 'סטודנטים הממתינים לשיבוץ מול המיטות הפנויות, לפי אזור',
      requestsSub: 'התפלגות הבקשות הממתינות לפי סוג הבקשה',

      viewAll: (n) => `הצגת כל ${formatNumber(n, 'he')}`,
      showTop: (n) => `הצגת ${formatNumber(n, 'he')} מובילים`,

      findingsTitle: 'ממצאים עיקריים',
      noInsights: 'אין ממצאים משמעותיים כרגע',

      statusCritical: 'קריטי',
      statusCaution: 'קרוב לקיבולת',
      statusHealthy: 'תקין',
      statusOverCapacity: 'מעל לקיבולת',
      statusWithinCapacity: 'בתוך הקיבולת',

      legendOccupied: 'תפוסות',
      legendAvailable: 'פנויות',
      legendWaiting: 'ממתינים',
      legendCapacity: 'קיבולת פנויה',

      capacityBreakdownTitle: 'פילוח קיבולת',
      capacityBreakdownSub: 'תפוסות מול פנויות, בתצוגה הנוכחית',
      topAvailableTitle: 'הזמינות הגבוהה ביותר',
      topAvailableSub: 'למי יש כרגע הכי הרבה מקום',
      demandShareTitle: 'נתח הביקוש לפי אזור',
      demandShareSub: 'מתוך סך כל הממתינים לשיבוץ',

      selectedLabel: 'נבחר',
      shareOfPending: '% מכלל הבקשות הממתינות',

      occupancyRate: 'אחוז תפוסה',
      bedsOccupied: 'מיטות תפוסות',
      availableBedsWord: 'מיטות פנויות',
      totalBedsWord: 'סה"כ מיטות',
      waitingWord: 'ממתינים',
      assignedWord: 'משובצים',
      pendingWord: 'ממתינות',
      buildingsWord: 'בניינים',

      viewBuildingDetails: 'צפייה בפרטי הבניין',
      viewBuildingsInRegion: 'צפייה בבנייני האזור',
      reviewRequests: 'צפייה בבקשות',
      unknown: 'לא ידוע',
      of: 'מתוך',
    },
    en: {
      eyebrow: 'Analytics',
      title: 'Data Analysis',
      subtitle: 'Choose a question, compare regions and buildings, and spot capacity issues as they happen.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      lastUpdated: 'Updated',
      loading: 'Loading analysis…',
      loadError: 'Something went wrong while loading analysis data',
      retry: 'Retry',
      noData: 'No data to display for the current selection',

      analyzeLabel: 'Analyze',
      occupancyLabel: 'Occupancy',
      availableLabel: 'Available Beds',
      demandLabel: 'Demand / Waiting',
      requestsLabel: 'Special Requests',

      regionLabel: 'Region',
      allRegions: 'All Regions',

      groupByLabel: 'Group',
      groupByBuilding: 'Building',
      groupByRegion: 'Region',

      sortLabel: 'Sort',
      sortHigh: 'High → Low',
      sortLow: 'Low → High',
      sortAlpha: 'A–Z',

      resetFilters: 'Reset',

      overallOccupancy: 'Overall occupancy',
      highest: 'Highest',
      lowest: 'Lowest',

      totalAvailable: 'Available beds',
      mostAvailable: 'Highest availability',

      totalWaiting: 'Waiting for assignment',
      highestDemand: 'Highest demand',

      totalPending: 'Pending requests',
      mostCommon: 'Most common type',

      listOccupancyBuilding: 'Occupancy by Building',
      listOccupancyRegion: 'Occupancy by Region',
      listAvailableBuilding: 'Availability by Building',
      listAvailableRegion: 'Availability by Region',
      listDemand: 'Demand vs. Capacity by Region',
      listRequests: 'Pending Requests by Type',

      occSubRegion: 'Current housing utilization across all regions',
      occSubBuilding: 'Current housing utilization by building',
      availSubRegion: 'Remaining capacity by region — occupied vs. available',
      availSubBuilding: 'Remaining capacity by building — occupied vs. available',
      demandSub: 'Students waiting for assignment compared with available beds, by region',
      requestsSub: 'Distribution of pending requests by request type',

      viewAll: (n) => `View all ${formatNumber(n, 'en')}`,
      showTop: (n) => `Show top ${formatNumber(n, 'en')}`,

      findingsTitle: 'Key Findings',
      noInsights: 'Nothing significant to flag right now',

      statusCritical: 'Critical',
      statusCaution: 'Near capacity',
      statusHealthy: 'Healthy',
      statusOverCapacity: 'Over capacity',
      statusWithinCapacity: 'Within capacity',

      legendOccupied: 'Occupied',
      legendAvailable: 'Available',
      legendWaiting: 'Waiting',
      legendCapacity: 'Available capacity',

      capacityBreakdownTitle: 'Capacity Breakdown',
      capacityBreakdownSub: 'Occupied vs. available in the current view',
      topAvailableTitle: 'Highest Availability',
      topAvailableSub: 'Who has the most room right now',
      demandShareTitle: 'Share of Demand by Region',
      demandShareSub: 'Out of all students waiting for assignment',

      selectedLabel: 'Selected',
      shareOfPending: '% of all pending requests',

      occupancyRate: 'Occupancy',
      bedsOccupied: 'beds occupied',
      availableBedsWord: 'available beds',
      totalBedsWord: 'total beds',
      waitingWord: 'waiting',
      assignedWord: 'assigned',
      pendingWord: 'pending',
      buildingsWord: 'Buildings',

      viewBuildingDetails: 'View building details',
      viewBuildingsInRegion: 'View buildings in this region',
      reviewRequests: 'Review requests',
      unknown: 'Unknown',
      of: 'of',
    },
  }[language] || {};

  // =========================
  // Data loading - one API call per region-filter change. Analyze /
  // group-by / sort / selection never trigger a new request: they all
  // reshape the same payload on the client.
  // =========================
  const fetchAnalysis = useCallback(async (regionId, isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await analysisAPI.getData(regionId && regionId !== 'all' ? regionId : null);
      setData(result);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err?.message || t.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line
  }, [t.loadError]);

  useEffect(() => {
    let alive = true;
    regionsAPI.getAll()
      .then((list) => { if (alive) setRegions(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setRegions([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    fetchAnalysis(filterRegion);
    // eslint-disable-next-line
  }, [filterRegion]);

  const canPickRegion = isCentralAdmin?.() && regions.length > 1;

  // =========================
  // Base rows from the real payload
  // =========================
  const buildingRows = useMemo(() => (data?.occupancy_data || []).map((r) => ({
    key: `building-${r.building_id}`,
    label: localizeBuildingLabel(r.building, language) || t.unknown,
    region: r.region || t.unknown,
    region_id: r.region_id || '',
    building_id: r.building_id,
    total_beds: num(r.total_beds),
    assigned: num(r.assigned),
    available_beds: num(r.available_beds),
    occupancy_rate: num(r.occupancy_rate),
  })), [data, language, t.unknown]);

  const regionRows = useMemo(() => {
    const map = new Map();
    buildingRows.forEach((b) => {
      const key = b.region_id || b.region;
      if (!key) return;
      if (!map.has(key)) map.set(key, { key: `region-${key}`, label: localizeById(b.region_id, b.region, language), region: b.region, region_id: b.region_id, total_beds: 0, assigned: 0 });
      const acc = map.get(key);
      acc.total_beds += b.total_beds;
      acc.assigned += b.assigned;
    });
    return Array.from(map.values()).map((r) => ({
      ...r,
      available_beds: Math.max(r.total_beds - r.assigned, 0),
      occupancy_rate: r.total_beds > 0 ? (r.assigned / r.total_beds) * 100 : 0,
    }));
  }, [buildingRows, language]);

  const regionAvailableMap = useMemo(() => {
    const map = new Map();
    regionRows.forEach((r) => map.set(r.region, r.available_beds));
    return map;
  }, [regionRows]);

  const demandRows = useMemo(() => (data?.unassigned_by_region || []).map((r) => ({
    key: `region-${r.region_id || r.region}`,
    label: localizeById(r.region_id, r.region, language) || t.unknown,
    region: r.region,
    region_id: r.region_id || '',
    total_students: num(r.total_students),
    assigned_students: num(r.assigned_students),
    unassigned_students: num(r.unassigned_students),
    available_in_region: regionAvailableMap.has(r.region) ? regionAvailableMap.get(r.region) : null,
  })), [data, regionAvailableMap, language, t.unknown]);

  const requestRows = useMemo(() => (data?.pending_requests_by_type || []).map((r) => ({
    key: `type-${r.request_type}`,
    label: REQUEST_TYPE_LABELS[language]?.[r.request_type] || r.request_type || t.unknown,
    request_type: r.request_type,
    count: num(r.count),
  })), [data, language, t.unknown]);

  const hasMultipleRegionsInView = useMemo(
    () => new Set(buildingRows.map((b) => b.region_id || b.region).filter(Boolean)).size > 1,
    [buildingRows]
  );

  // Stable region -> color assignment. Keyed by the raw region_id/region
  // value (never by the localized `label`) and sorted by that same raw
  // value, so a region keeps the same donut colour regardless of the
  // sort control, the numbers, OR the display language - switching
  // Hebrew/English must never repaint the demand-share donut.
  const regionColorMap = useMemo(() => {
    const keys = Array.from(new Set(demandRows.map((r) => r.region_id || r.region))).sort((a, b) => String(a).localeCompare(String(b)));
    const map = new Map();
    keys.forEach((key, i) => map.set(key, CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]));
    return map;
  }, [demandRows]);

  // =========================
  // Group-by resolution
  // =========================
  const canGroupByRegion = analysis === 'occupancy' || analysis === 'available';
  const groupByChoicesAvailable = canGroupByRegion && hasMultipleRegionsInView;
  const defaultGroupBy = canGroupByRegion
    ? (hasMultipleRegionsInView ? 'region' : 'building')
    : (analysis === 'demand' ? 'region' : 'type');
  const groupBy = groupByOverride || defaultGroupBy;

  // =========================
  // Rows for the selected analysis + grouping
  // =========================
  const rows = useMemo(() => {
    if (!data) return [];
    if (analysis === 'occupancy' || analysis === 'available') {
      const source = groupBy === 'region' ? regionRows : buildingRows;
      return source.map((r) => ({
        ...r,
        metric: analysis === 'occupancy' ? r.occupancy_rate : r.available_beds,
      }));
    }
    if (analysis === 'demand') {
      return demandRows.map((r) => ({ ...r, metric: r.unassigned_students }));
    }
    return requestRows.map((r) => ({ ...r, metric: r.count }));
  }, [data, analysis, groupBy, buildingRows, regionRows, demandRows, requestRows]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    if (sort === 'alpha') {
      arr.sort((a, b) => a.label.localeCompare(b.label, isHebrew ? 'he' : 'en'));
    } else if (sort === 'high') {
      arr.sort((a, b) => b.metric - a.metric);
    } else {
      arr.sort((a, b) => a.metric - b.metric);
    }
    return arr;
  }, [rows, sort, isHebrew]);

  const displayRows = viewAll ? sortedRows : sortedRows.slice(0, TOP_N);
  const scrollableChart = viewAll && sortedRows.length > TOP_N;

  // Fixed ring order for the requests donut - independent of the Sort
  // control and of the backend's count-desc ordering, so slice colours
  // never shuffle around the circle as the numbers change.
  const requestRingRows = useMemo(
    () => REQUEST_TYPE_ORDER.map((type) => rows.find((r) => r.request_type === type)).filter(Boolean),
    [rows]
  );

  // Always-visible selected-item panel: auto-select the first row of the
  // current sort whenever the row set or sort order changes, but this
  // effect does NOT depend on selectedKey itself, so clicking a row never
  // re-triggers it - only a real change to what's being analyzed/sorted does.
  useEffect(() => {
    setSelectedKey(sortedRows.length > 0 ? sortedRows[0].key : null);
  }, [sortedRows]);

  const selectedRow = selectedKey ? rows.find((r) => r.key === selectedKey) : null;

  // =========================
  // Handlers
  // =========================
  const handleAnalysisChange = (value) => {
    setAnalysis(value);
    setGroupByOverride(null);
    setSort(defaultSortFor(value));
    setViewAll(false);
  };

  const handleRegionChange = (value) => {
    setFilterRegion(value);
    setGroupByOverride(null);
    setViewAll(false);
  };

  const handleGroupByChange = (value) => {
    setGroupByOverride(value);
    setViewAll(false);
  };

  const handleSortChange = (value) => setSort(value);

  const handleSelectRow = (key) => setSelectedKey(key);

  const isDefaultView = analysis === 'occupancy' && filterRegion === 'all'
    && groupByOverride === null && sort === defaultSortFor('occupancy');

  const handleReset = () => {
    setAnalysis('occupancy');
    setFilterRegion('all');
    setGroupByOverride(null);
    setSort(defaultSortFor('occupancy'));
    setViewAll(false);
  };

  // =========================
  // Insights - deterministic facts computed from the same rows, capped
  // at 3, never fabricated.
  // =========================
  const insights = useMemo(
    () => buildInsights(analysis, { rows, data, groupBy, isHebrew }),
    [analysis, rows, data, groupBy, isHebrew]
  );

  const statusSummary = useMemo(
    () => buildStatusSummary(analysis, rows, t),
    [analysis, rows, t]
  );

  const meta = ANALYSIS_META[analysis];

  const chartTitle = (() => {
    if (analysis === 'occupancy') return groupBy === 'region' ? t.listOccupancyRegion : t.listOccupancyBuilding;
    if (analysis === 'available') return groupBy === 'region' ? t.listAvailableRegion : t.listAvailableBuilding;
    if (analysis === 'demand') return t.listDemand;
    return t.listRequests;
  })();

  const chartSubtitle = (() => {
    if (analysis === 'occupancy') return groupBy === 'region' ? t.occSubRegion : t.occSubBuilding;
    if (analysis === 'available') return groupBy === 'region' ? t.availSubRegion : t.availSubBuilding;
    if (analysis === 'demand') return t.demandSub;
    return t.requestsSub;
  })();

  const analyzeOptions = [
    { value: 'occupancy', label: t.occupancyLabel, Icon: ANALYSIS_META.occupancy.Icon },
    { value: 'available', label: t.availableLabel, Icon: ANALYSIS_META.available.Icon },
    { value: 'demand', label: t.demandLabel, Icon: ANALYSIS_META.demand.Icon },
    { value: 'requests', label: t.requestsLabel, Icon: ANALYSIS_META.requests.Icon },
  ];
  const sortOptions = [
    { value: 'high', label: t.sortHigh },
    { value: 'low', label: t.sortLow },
    { value: 'alpha', label: t.sortAlpha },
  ];
  const groupByOptions = [
    { value: 'region', label: t.groupByRegion },
    { value: 'building', label: t.groupByBuilding },
  ];

  const summary = data?.summary || {};

  // =========================
  // Context stat pills for the chart header - independent of the
  // current Sort/viewAll state, always computed from the full row set.
  // =========================
  const contextStats = useMemo(() => {
    if (!rows.length) return [];
    if (analysis === 'occupancy') {
      const top = [...rows].sort((a, b) => b.occupancy_rate - a.occupancy_rate)[0];
      return [
        { value: `${roundPct(summary.occupancy_rate)}%`, label: t.overallOccupancy },
        top ? { value: `${roundPct(top.occupancy_rate)}%`, label: t.highest, sub: top.label } : null,
      ].filter(Boolean);
    }
    if (analysis === 'available') {
      const top = [...rows].sort((a, b) => b.available_beds - a.available_beds)[0];
      return [
        { value: formatNumber(summary.available_beds, language), label: t.totalAvailable },
        top ? { value: formatNumber(top.available_beds, language), label: t.mostAvailable, sub: top.label } : null,
      ].filter(Boolean);
    }
    if (analysis === 'demand') {
      const top = [...rows].sort((a, b) => b.unassigned_students - a.unassigned_students)[0];
      return [
        { value: formatNumber(summary.unassigned_students, language), label: t.totalWaiting },
        top && top.unassigned_students > 0 ? { value: formatNumber(top.unassigned_students, language), label: t.highestDemand, sub: top.label } : null,
      ].filter(Boolean);
    }
    const top = [...rows].sort((a, b) => b.count - a.count)[0];
    return [
      { value: formatNumber(summary.pending_requests, language), label: t.totalPending },
      top && top.count > 0 ? { value: formatNumber(top.count, language), label: t.mostCommon, sub: top.label } : null,
    ].filter(Boolean);
  }, [analysis, rows, summary, language, t]);

  const hasSecondary = analysis !== 'requests' && rows.length > 0;

  return (
    <div className="analysis-page" dir={isHebrew ? 'rtl' : 'ltr'}>
      <section className="an-intro">
        <div className="an-intro-dark">
          <div className="an-intro-row1">
            <div className="an-intro-titles">
              <span className="an-intro-eyebrow">{t.eyebrow}</span>
              <h1>{t.title}</h1>
              <p className="an-intro-subtitle">{t.subtitle}</p>
            </div>
            <div className="an-intro-meta">
              {lastFetchedAt && (
                <span className="an-intro-updated">{t.lastUpdated} <bdi>{formatTimestamp(lastFetchedAt.toISOString(), language)}</bdi></span>
              )}
              <button
                type="button"
                className="an-intro-refresh"
                onClick={() => fetchAnalysis(filterRegion, true)}
                disabled={refreshing || loading}
              >
                <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
                {refreshing ? t.refreshing : t.refresh}
              </button>
            </div>
          </div>

          <div className="an-intro-analyze-row">
            <span className="an-intro-analyze-label">{t.analyzeLabel}</span>
            <div className="an-seg an-seg-dark" role="tablist" aria-label={t.analyzeLabel}>
              {analyzeOptions.map((o) => {
                const optMeta = ANALYSIS_META[o.value];
                const active = analysis === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`an-seg-btn ${active ? 'is-active' : ''}`}
                    style={active ? { '--seg-accent': optMeta.accent } : undefined}
                    onClick={() => handleAnalysisChange(o.value)}
                  >
                    <o.Icon size={15} />
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="an-intro-controls">
          {canPickRegion && (
            <label className="an-field">
              <span className="an-field-label">{t.regionLabel}</span>
              <select className="an-field-select" value={filterRegion} onChange={(e) => handleRegionChange(e.target.value)}>
                <option value="all">{t.allRegions}</option>
                {regions.map((r) => <option key={r.id} value={String(r.id)}>{localizeRegionName(r, language)}</option>)}
              </select>
            </label>
          )}
          {groupByChoicesAvailable && (
            <div className="an-field">
              <span className="an-field-label">{t.groupByLabel}</span>
              <div className="an-seg" role="tablist" aria-label={t.groupByLabel}>
                {groupByOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={groupBy === o.value}
                    className={`an-seg-btn ${groupBy === o.value ? 'is-active' : ''}`}
                    onClick={() => handleGroupByChange(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="an-field">
            <span className="an-field-label">{t.sortLabel}</span>
            <div className="an-seg" role="tablist" aria-label={t.sortLabel}>
              {sortOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="tab"
                  aria-selected={sort === o.value}
                  className={`an-seg-btn ${sort === o.value ? 'is-active' : ''}`}
                  onClick={() => handleSortChange(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {!isDefaultView && (
            <button type="button" className="an-reset-btn" onClick={handleReset}>{t.resetFilters}</button>
          )}
        </div>
      </section>

      {loading && (
        <div className="an-state-panel">
          <RefreshCw size={22} className="spin" />
          <p>{t.loading}</p>
        </div>
      )}

      {!loading && error && (
        <div className="an-state-panel an-error-panel">
          <AlertTriangle size={22} />
          <p>{error}</p>
          <button type="button" className="an-retry-btn" onClick={() => fetchAnalysis(filterRegion)}>
            <RefreshCw size={16} />
            {t.retry}
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <section className="an-hero" style={{ '--accent': meta.accent, '--accent-tint': meta.tint, '--accent-bg': meta.iconBg }}>
            <div className="an-hero-head">
              <div className="an-hero-title-group">
                <span className="an-hero-icon"><meta.Icon size={18} /></span>
                <div className="an-hero-title-text">
                  <h2>{chartTitle}</h2>
                  <p>{chartSubtitle}</p>
                </div>
              </div>
              {contextStats.length > 0 && (
                <div className="an-hero-stats">
                  {contextStats.map((s) => (
                    <div className="an-stat-pill" key={s.label}>
                      <span className="an-stat-pill-value">{s.value}</span>
                      <span className="an-stat-pill-label">{s.label}</span>
                      {s.sub && <span className="an-stat-pill-sub" title={s.sub}>{s.sub}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="an-hero-chart">
              {analysis === 'occupancy' && (
                <OccupancyColumnChart rows={displayRows} selectedKey={selectedKey} onSelect={handleSelectRow} language={language} t={t} scrollable={scrollableChart} noData={t.noData} />
              )}
              {analysis === 'available' && (
                <AvailableStackedChart rows={displayRows} selectedKey={selectedKey} onSelect={handleSelectRow} language={language} t={t} scrollable={scrollableChart} noData={t.noData} />
              )}
              {analysis === 'demand' && (
                <DemandGroupedChart rows={displayRows} selectedKey={selectedKey} onSelect={handleSelectRow} language={language} t={t} scrollable={scrollableChart} noData={t.noData} />
              )}
              {analysis === 'requests' && (
                <RequestsDonut rows={requestRingRows} listRows={sortedRows} total={num(summary.pending_requests)} selectedKey={selectedKey} onSelect={handleSelectRow} language={language} t={t} />
              )}
            </div>

            {sortedRows.length > TOP_N && analysis !== 'requests' && (
              <div className="an-hero-viewall">
                <button type="button" className="an-viewall-btn" onClick={() => setViewAll((v) => !v)}>
                  {viewAll ? t.showTop(TOP_N) : t.viewAll(sortedRows.length)}
                  {viewAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            )}

            {analysis !== 'requests' && (
              <div className="an-hero-foot">
                <ChartLegend analysis={analysis} t={t} />
                {statusSummary.length > 0 && (
                  <div className="an-status-chips">
                    {statusSummary.map((s) => (
                      <span className={`an-status-chip an-status-chip-${s.tone}`} key={s.label}>
                        <strong>{formatNumber(s.count, language)}</strong>
                        {s.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className={`an-secondary-grid ${hasSecondary ? '' : 'is-single'}`}>
            <DetailPanel
              analysis={analysis}
              groupBy={groupBy}
              row={selectedRow}
              buildingRows={buildingRows}
              summary={summary}
              t={t}
              language={language}
              isHebrew={isHebrew}
              navigate={navigate}
              accent={meta.accent}
            />

            {hasSecondary && analysis === 'occupancy' && (
              <CapacityBreakdownPanel rows={rows} t={t} language={language} accent={meta.accent} />
            )}
            {hasSecondary && analysis === 'available' && (
              <TopAvailablePanel rows={rows} t={t} language={language} accent={meta.accent} />
            )}
            {hasSecondary && analysis === 'demand' && (
              <DemandSharePanel rows={demandRows} colorMap={regionColorMap} t={t} language={language} />
            )}
          </div>

          <section className="an-findings" style={{ '--accent': meta.accent }}>
            <h2><Lightbulb size={15} className="an-findings-icon" />{t.findingsTitle}</h2>
            {insights.length === 0 ? (
              <p className="an-insights-empty">{t.noInsights}</p>
            ) : (
              <div className="an-findings-grid">
                {insights.map((text, i) => (
                  <div className="an-finding-card" key={i}>{text}</div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <style>{`
        .analysis-page { padding: 22px 24px 32px; display: flex; flex-direction: column; gap: 16px; max-width: 100%; }

        .spin { animation: an-spin 1s linear infinite; }
        @keyframes an-spin { to { transform: rotate(360deg); } }

        /* ---------- Analytical workspace intro (header + primary toolbar, one composed panel) ---------- */
        .an-intro {
          border-radius: 18px; overflow: hidden; box-shadow: 0 10px 28px rgba(15,23,42,0.14);
          border: 1px solid rgba(15,23,42,0.06);
        }
        .an-intro-dark {
          background: linear-gradient(135deg, #0c1424 0%, #16213b 55%, #1c2c4c 100%);
          padding: 26px 28px 20px;
        }
        .an-intro-row1 { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
        .an-intro-titles { min-width: 0; }
        .an-intro-eyebrow {
          display: inline-flex; font-size: 11px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
          color: #7dd3fc; margin-bottom: 8px;
        }
        .an-intro-titles h1 { color: white; font-size: 26px; font-weight: 800; margin: 0 0 7px; letter-spacing: -0.015em; line-height: 1.2; }
        .an-intro-subtitle { color: #a9bad6; font-size: 13.5px; margin: 0; max-width: 580px; line-height: 1.6; }
        .an-intro-meta { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .an-intro-updated { font-size: 11.5px; color: #93c5fd; white-space: nowrap; }
        .an-intro-refresh {
          display: flex; align-items: center; gap: 7px; padding: 9px 16px; background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.16); color: white; border-radius: 9px; font-size: 12.5px;
          font-weight: 700; cursor: pointer; font-family: inherit; white-space: nowrap; transition: background 0.15s;
        }
        .an-intro-refresh:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
        .an-intro-refresh:disabled { opacity: 0.55; cursor: default; }

        .an-intro-analyze-row {
          display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
          padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.09);
        }
        .an-intro-analyze-label {
          font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #8ba3c7; flex-shrink: 0;
        }

        .an-intro-controls {
          background: #f8fafc; padding: 14px 28px; display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap;
          border-top: 1px solid #eef2f7;
        }

        .an-field { display: flex; flex-direction: column; gap: 5px; }
        .an-field-label { font-size: 10.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; }
        .an-field-select {
          padding: 7px 28px 7px 11px; border-radius: 8px; border: 1px solid #dbe4ef; font-size: 13px;
          color: #0f172a; background: white; cursor: pointer; min-width: 148px; font-family: inherit; height: 34px;
        }
        [dir="rtl"] .an-field-select { padding: 7px 11px 7px 28px; }

        .an-seg {
          display: inline-flex; background: #eef2f7; border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap;
        }
        .an-seg-btn {
          display: flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 8px;
          font-size: 12.5px; font-weight: 700; color: #64748b; background: transparent; border: none;
          cursor: pointer; font-family: inherit; white-space: nowrap; transition: background 0.12s, color 0.12s;
        }
        .an-seg-btn:hover { color: #334155; }
        .an-seg-btn.is-active { background: white; color: #0f172a; box-shadow: 0 1px 3px rgba(15,23,42,0.1); }

        .an-seg-dark { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.13); padding: 4px; border-radius: 12px; }
        .an-seg-dark .an-seg-btn { padding: 9px 16px; font-size: 13.5px; color: #c3d1e6; }
        .an-seg-dark .an-seg-btn svg { color: #7d93b8; }
        .an-seg-dark .an-seg-btn:hover { color: white; }
        .an-seg-dark .an-seg-btn:hover svg { color: #cbd8ec; }
        .an-seg-dark .an-seg-btn.is-active {
          background: white; color: var(--seg-accent, #2563eb); box-shadow: 0 4px 12px rgba(0,0,0,0.28);
        }
        .an-seg-dark .an-seg-btn.is-active svg { color: var(--seg-accent, #2563eb); }

        .an-reset-btn {
          padding: 8px 14px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;
          font-size: 12.5px; font-weight: 700; color: #475569; cursor: pointer; font-family: inherit; height: 34px;
        }
        .an-reset-btn:hover { background: #f1f5f9; }

        .an-state-panel {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; padding: 56px 24px; background: white; border-radius: 14px;
          color: #64748b; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #eef2f7;
        }
        .an-error-panel { color: #b91c1c; }
        .an-retry-btn {
          display: flex; align-items: center; gap: 6px; padding: 8px 18px;
          background: #2563eb; color: white; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
        }

        /* ---------- Hero analysis card ---------- */
        .an-hero {
          background: white; border: 1px solid #eef2f7; border-radius: 16px;
          box-shadow: 0 2px 10px rgba(15,23,42,0.06); overflow: hidden;
          border-top: 4px solid var(--accent, #2563eb);
        }
        .an-hero-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;
          padding: 20px 22px 16px; background: var(--accent-tint, #f8fafc);
        }
        .an-hero-title-group { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
        .an-hero-icon {
          width: 38px; height: 38px; border-radius: 11px; background: var(--accent-bg, #dbeafe); color: var(--accent, #2563eb);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .an-hero-title-text h2 { font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 3px; letter-spacing: -0.01em; line-height: 1.3; }
        .an-hero-title-text p { font-size: 12.5px; color: #64748b; margin: 0; line-height: 1.5; }
        .an-hero-stats { display: flex; gap: 22px; flex-shrink: 0; }
        .an-stat-pill { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .an-stat-pill-value { font-size: 21px; font-weight: 800; color: #0f172a; line-height: 1.2; letter-spacing: -0.01em; }
        .an-stat-pill-label { font-size: 10.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; }
        .an-stat-pill-sub { font-size: 11.5px; color: var(--accent, #2563eb); font-weight: 700; max-width: 180px; line-height: 1.35; word-break: break-word; overflow-wrap: break-word; }

        .an-hero-chart { padding: 22px 22px 6px; }

        .an-hero-viewall { display: flex; justify-content: center; padding: 2px 0 14px; }
        .an-viewall-btn {
          display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 999px;
          border: 1px solid #dbe4ef; background: white; color: #2563eb; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit; white-space: nowrap;
        }
        .an-viewall-btn:hover { background: #eff6ff; }

        .an-hero-foot {
          display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
          padding: 12px 22px 18px; border-top: 1px solid #f1f5f9;
        }

        /* ---------- Chart legend ---------- */
        .an-chart-legend { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .an-legend-item { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: #64748b; }
        .an-legend-swatch { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
        .an-legend-swatch.is-round { border-radius: 50%; }

        .an-status-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .an-status-chip {
          display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border-radius: 999px;
          font-size: 11px; font-weight: 600; color: #64748b; background: #f8fafc; border: 1px solid #eef2f7;
        }
        [dir="rtl"] .an-status-chip { padding: 4px 8px 4px 10px; }
        .an-status-chip strong { font-size: 12.5px; font-weight: 800; color: #0f172a; }
        .an-status-chip-critical { background: #fef2f2; border-color: #fecaca; }
        .an-status-chip-critical strong { color: #b91c1c; }
        .an-status-chip-caution { background: #fffbeb; border-color: #fde68a; }
        .an-status-chip-caution strong { color: #92400e; }
        .an-status-chip-healthy strong { color: #15803d; }

        /* ---------- Column / stacked / grouped chart shell (shared) ---------- */
        .an-cchart-empty {
          display: flex; align-items: center; justify-content: center; padding: 60px 12px;
          color: #94a3b8; font-size: 13.5px; text-align: center;
        }
        .an-cchart-frame { display: flex; gap: 10px; }
        .an-cchart-axis {
          flex-shrink: 0; width: 32px; height: 200px; margin-top: 28px;
          display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end;
        }
        [dir="rtl"] .an-cchart-axis { align-items: flex-start; }
        .an-cchart-axis span { font-size: 10.5px; color: #94a3b8; font-weight: 600; transform: translateY(50%); }
        .an-cchart-axis span:first-child { transform: translateY(-2px); }
        .an-cchart-axis span:last-child { transform: translateY(2px); }
        .an-cchart-plotwrap { position: relative; flex: 1; min-width: 0; padding-top: 28px; }
        .an-cchart-plotwrap.is-scrollable { overflow-x: auto; padding-bottom: 4px; }
        .an-cchart-hlines { position: absolute; inset-inline: 0; top: 28px; height: 200px; pointer-events: none; }
        .an-cchart-hline { position: absolute; inset-inline: 0; height: 1px; background: #eef2f7; }
        .an-cchart-bars {
          position: relative; height: 200px; display: flex; align-items: flex-end; gap: 12px; min-width: min-content;
        }
        .an-cchart-bars.is-centered { justify-content: center; width: 100%; }
        .an-cchart-bars.is-start { justify-content: flex-start; }

        .an-col-item { position: relative; display: flex; flex-direction: column; align-items: center; flex: 0 0 88px; height: 100%; }
        .an-col-scale { width: 100%; height: 200px; display: flex; align-items: flex-end; justify-content: center; }
        .an-col-bar {
          width: 38px; border-radius: 7px 7px 2px 2px; position: relative; min-height: 3px;
          transition: filter 0.12s, opacity 0.12s; cursor: pointer; border: none; padding: 0; font-family: inherit;
        }
        .an-col-item:hover .an-col-bar, .an-col-bar:focus-visible { filter: brightness(0.92); }
        .an-col-item.is-selected .an-col-bar { box-shadow: 0 0 0 2px white, 0 0 0 4px var(--accent, #2563eb); }
        .an-col-bar.is-zero { border: 1.5px dashed #cbd5e1; border-radius: 5px; }
        .an-col-item.is-selected .an-col-bar.is-zero { box-shadow: 0 0 0 2px white, 0 0 0 4px var(--accent, #2563eb); border-style: solid; border-color: var(--accent, #2563eb); }
        .an-col-value {
          position: absolute; bottom: 100%; inset-inline: 0; margin-bottom: 5px; text-align: center;
          font-size: 12px; font-weight: 800; color: #0f172a; white-space: nowrap;
        }
        .an-col-name {
          margin-top: 9px; font-size: 11px; color: #64748b; font-weight: 600; text-align: center;
          width: 100%; line-height: 1.3; word-break: break-word; overflow-wrap: break-word;
        }
        .an-col-item.is-selected .an-col-name { color: #0f172a; font-weight: 800; }

        /* stacked (available beds) */
        .an-col-stack { width: 38px; position: relative; }
        .an-col-seg { position: absolute; inset-inline: 0; }
        .an-col-seg-occupied { background: #cbd5e1; border-radius: 2px 2px 2px 2px; }
        .an-col-seg-available { background: #0d9488; border-radius: 7px 7px 2px 2px; }
        .an-col-seg-label {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800; color: white;
        }

        /* grouped (demand) */
        .an-group-item { position: relative; display: flex; flex-direction: column; align-items: center; flex: 0 0 92px; height: 100%; }
        .an-group-bars { display: flex; align-items: flex-end; gap: 5px; height: 200px; }
        .an-group-bar-wrap { display: flex; flex-direction: column; align-items: center; width: 30px; height: 100%; justify-content: flex-end; }
        .an-group-bar {
          width: 26px; border-radius: 6px 6px 2px 2px; position: relative; min-height: 3px; cursor: pointer;
          border: none; padding: 0; font-family: inherit; transition: filter 0.12s;
        }
        .an-group-item:hover .an-group-bar { filter: brightness(0.94); }
        .an-group-item.is-selected .an-group-bar-waiting { box-shadow: 0 0 0 2px white, 0 0 0 4px var(--accent, #d97706); }
        .an-group-bar.is-zero { border: 1.5px dashed #cbd5e1; border-radius: 4px; }
        .an-group-unknown {
          width: 26px; height: 3px; border-radius: 2px; border-top: 2px dashed #cbd5e1; margin-bottom: 0;
        }

        /* ---------- Hover tooltip (shared by column/stacked/grouped charts) ----------
           Rendered through a React portal straight into <body> and positioned with
           position:fixed + viewport-measured coordinates, so it can never be clipped
           by an ancestor's overflow (.an-hero uses overflow:hidden for its rounded
           corners/tinted header; .an-cchart-plotwrap.is-scrollable uses overflow-x:auto,
           which per spec also computes overflow-y to auto). Left as-is on purpose -
           moving the tooltip out of that subtree fixes the clipping without touching
           either rule, so the rounded-corner/layered-header layout is untouched. */
        .an-tooltip {
          position: fixed; left: 0; top: 0; transform: translate(-50%, calc(-100% - 10px));
          background: #0f172a; color: white; padding: 8px 12px; border-radius: 9px; font-size: 11.5px;
          font-weight: 600; line-height: 1.45; white-space: normal; max-width: 208px; text-align: center;
          box-shadow: 0 10px 24px rgba(15,23,42,0.3); opacity: 0; pointer-events: none; z-index: 9999;
          animation: an-tooltip-fade 0.12s ease forwards;
        }
        .an-tooltip[data-placement="below"] { transform: translate(-50%, 10px); }
        @keyframes an-tooltip-fade { to { opacity: 1; } }
        .an-tooltip strong { display: block; font-size: 12px; font-weight: 800; margin-bottom: 3px; }
        .an-tooltip::after {
          content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
          border: 5px solid transparent; border-top-color: #0f172a;
        }
        .an-tooltip[data-placement="below"]::after {
          top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #0f172a;
        }
        .an-group-name {
          margin-top: 9px; font-size: 11px; color: #64748b; font-weight: 600; text-align: center;
          width: 100%; line-height: 1.3; word-break: break-word; overflow-wrap: break-word;
        }
        .an-group-item.is-selected .an-group-name { color: #0f172a; font-weight: 800; }

        /* ---------- Donut (requests) ---------- */
        .an-donut-layout { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; justify-content: center; }
        .an-donut-wrap { position: relative; width: 176px; height: 176px; flex-shrink: 0; border-radius: 50%; }
        .an-donut-hole {
          position: absolute; inset: 30px; border-radius: 50%; background: white;
          display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 2px;
        }
        .an-donut-hole-value { font-size: 26px; font-weight: 800; color: #0f172a; line-height: 1; }
        .an-donut-hole-label { font-size: 10.5px; color: #94a3b8; font-weight: 700; max-width: 92px; line-height: 1.3; }
        .an-donut-legend { display: flex; flex-direction: column; gap: 4px; min-width: 220px; flex: 1; max-width: 360px; }
        .an-donut-row {
          display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 9px; border: none;
          background: transparent; cursor: pointer; font-family: inherit; text-align: inherit; width: 100%;
        }
        .an-donut-row:hover { background: #f8fafc; }
        .an-donut-row.is-selected { background: #f8fafc; box-shadow: inset 0 0 0 1px #e2e8f0; }
        .an-donut-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .an-donut-row-label { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: #334155; line-height: 1.3; word-break: break-word; overflow-wrap: break-word; }
        .an-donut-row-count { font-size: 13px; font-weight: 800; color: #0f172a; }
        .an-donut-row-pct { font-size: 11px; font-weight: 600; color: #94a3b8; min-width: 34px; text-align: end; }

        /* ---------- Secondary row ---------- */
        .an-secondary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 0.72fr); gap: 14px; align-items: stretch; }
        .an-secondary-grid.is-single { grid-template-columns: 1fr; }

        .an-panel { background: white; border: 1px solid #eef2f7; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; }

        /* ---------- Detail panel ---------- */
        .an-detail-card { padding: 18px 20px 18px; border-top: 3px solid var(--accent, #2563eb); border-radius: 14px 14px 0 0; }
        .an-detail-empty { display: flex; align-items: center; justify-content: center; padding: 40px 16px; color: #94a3b8; font-size: 13px; text-align: center; }
        .an-detail-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
        .an-detail-eyebrow { font-size: 10.5px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 4px; }
        .an-detail-top h3 { font-size: 17px; font-weight: 800; color: #0f172a; margin: 0; line-height: 1.35; overflow-wrap: break-word; }
        .an-detail-titlecol { min-width: 0; }

        .an-detail-big { display: flex; align-items: baseline; gap: 9px; padding: 10px 0 16px; border-bottom: 1px solid #f1f5f9; margin-bottom: 16px; }
        .an-detail-big-value { font-size: 36px; font-weight: 800; color: #0f172a; line-height: 1; letter-spacing: -0.02em; }
        .an-detail-big-label { font-size: 13px; color: #64748b; font-weight: 600; }

        .an-detail-facts { display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 16px; }
        .an-detail-fact { display: flex; flex-direction: column; gap: 3px; }
        .an-detail-fact-value { font-size: 17px; font-weight: 800; color: #0f172a; }
        .an-detail-fact-label { font-size: 11.5px; color: #94a3b8; font-weight: 600; }

        .an-mini-breakdown { margin-bottom: 18px; }
        .an-mini-track { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: #eef2f7; margin-bottom: 9px; gap: 2px; }
        .an-mini-track span { display: block; height: 100%; }
        .an-mini-legend { display: flex; flex-wrap: wrap; gap: 14px; }
        .an-mini-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; font-weight: 600; }
        .an-mini-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        .an-share-bar { margin-bottom: 18px; }
        .an-share-bar-label { font-size: 12px; color: #64748b; font-weight: 600; margin-bottom: 7px; }
        .an-share-bar-track { height: 10px; border-radius: 999px; background: #eef2f7; overflow: hidden; }
        .an-share-bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--accent, #2563eb); }

        .an-detail-action {
          display: inline-flex; align-items: center; gap: 7px; padding: 10px 16px; background: var(--accent, #2563eb); color: white;
          border: none; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
          width: 100%; justify-content: center; margin-top: auto;
        }
        .an-detail-action:hover { filter: brightness(0.92); }
        [dir="rtl"] .an-detail-action svg { transform: scaleX(-1); }

        /* ---------- Secondary panels ---------- */
        .an-panel-body { padding: 18px 20px; display: flex; flex-direction: column; flex: 1; }
        .an-panel-title { font-size: 14px; font-weight: 800; color: #1e293b; margin: 0 0 2px; }
        .an-panel-sub { font-size: 11.5px; color: #94a3b8; margin: 0 0 16px; }

        .an-capacity-total { display: flex; align-items: baseline; gap: 8px; margin-bottom: 14px; }
        .an-capacity-total-value { font-size: 26px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em; }
        .an-capacity-total-label { font-size: 12px; color: #64748b; font-weight: 600; }

        .an-top-list { display: flex; flex-direction: column; gap: 10px; }
        .an-top-row { display: flex; align-items: center; gap: 10px; }
        .an-top-rank {
          width: 22px; height: 22px; border-radius: 50%; background: #f1f5f9; color: #64748b;
          font-size: 10.5px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .an-top-rank.is-first { background: var(--accent, #0d9488); color: white; }
        .an-top-main { flex: 1; min-width: 0; }
        .an-top-name { font-size: 12.5px; font-weight: 700; color: #0f172a; line-height: 1.3; word-break: break-word; overflow-wrap: break-word; margin-bottom: 4px; }
        .an-top-track { height: 6px; border-radius: 999px; background: #eef2f7; overflow: hidden; }
        .an-top-fill { display: block; height: 100%; border-radius: 999px; background: var(--accent, #0d9488); }
        .an-top-value { font-size: 13px; font-weight: 800; color: #0f172a; flex-shrink: 0; }

        /* ---------- Findings ---------- */
        .an-findings { background: white; border: 1px solid #eef2f7; border-radius: 14px; padding: 16px 18px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .an-findings h2 { display: flex; align-items: center; gap: 7px; font-size: 14.5px; font-weight: 800; color: #1e293b; margin: 0 0 12px; }
        .an-findings-icon { color: var(--accent, #2563eb); flex-shrink: 0; }
        .an-findings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
        .an-finding-card {
          font-size: 13.5px; color: #334155; line-height: 1.55; padding: 12px 14px;
          background: #f8fafc; border: 1px solid #eef2f7; border-inline-start: 3px solid var(--accent, #2563eb); border-radius: 10px;
        }
        .an-insights-empty { font-size: 13px; color: #94a3b8; margin: 0; }

        @media (max-width: 980px) {
          .an-secondary-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 900px) {
          .an-intro-row1 { flex-direction: column; align-items: stretch; }
          .an-intro-meta { justify-content: space-between; }
          .an-hero-stats { gap: 16px; }
        }
        @media (max-width: 640px) {
          .an-intro-dark { padding: 22px 18px 18px; }
          .an-intro-controls { padding: 14px 18px; flex-direction: column; align-items: stretch; }
          .an-field-select { min-width: 0; width: 100%; }
          .an-hero-head { flex-direction: column; }
          .an-hero-stats { width: 100%; justify-content: space-between; }
          .an-donut-layout { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}

// =========================
// Segmented / chart-legend helpers
// =========================
function ChartLegend({ analysis, t }) {
  if (analysis === 'occupancy') {
    return (
      <div className="an-chart-legend">
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: COLOR.healthy }} />{t.statusHealthy}</span>
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: COLOR.caution }} />{t.statusCaution}</span>
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: COLOR.critical }} />{t.statusCritical}</span>
      </div>
    );
  }
  if (analysis === 'available') {
    return (
      <div className="an-chart-legend">
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: '#cbd5e1' }} />{t.legendOccupied}</span>
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: '#0d9488' }} />{t.legendAvailable}</span>
      </div>
    );
  }
  if (analysis === 'demand') {
    return (
      <div className="an-chart-legend">
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: COLOR.caution }} />{t.legendWaiting}</span>
        <span className="an-legend-item"><span className="an-legend-swatch" style={{ background: '#94a3b8' }} />{t.legendCapacity}</span>
      </div>
    );
  }
  return null;
}

function EmptyChart({ text }) {
  return <div className="an-cchart-empty">{text}</div>;
}

// Polished hover/focus tooltip shared by every column-based chart - a
// real floating panel (not the native browser title attribute), built
// from the same rowContext() text every analysis already uses in its
// ranked context lines, so the tooltip never says anything different
// from the rest of the page.
//
// Rendered through a portal straight into <body> and positioned with
// position:fixed from a real getBoundingClientRect() measurement, so it
// can never be clipped by an ancestor's overflow (.an-hero's rounded-
// corner overflow:hidden, or the horizontal-scroll chart's overflow-x)
// or by the viewport edge - and it flips to below the bar, and clamps
// horizontally, whenever there isn't room. Direction-agnostic: it reads
// the trigger's real screen position, so it's correct in RTL and LTR
// without any dir-specific code.
const TOOLTIP_HALF_WIDTH = 108; // half of .an-tooltip's max-width + a small margin
const TOOLTIP_MIN_SPACE_ABOVE = 100; // conservative estimate of the tooltip's own height + gap

function useBarTooltip() {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edgeMargin = 10;
    const placement = rect.top >= TOOLTIP_MIN_SPACE_ABOVE ? 'above' : 'below';
    const rawLeft = rect.left + rect.width / 2;
    const minLeft = TOOLTIP_HALF_WIDTH + edgeMargin;
    const maxLeft = window.innerWidth - TOOLTIP_HALF_WIDTH - edgeMargin;
    const left = Math.min(Math.max(rawLeft, minLeft), Math.max(maxLeft, minLeft));
    const top = placement === 'above' ? rect.top : rect.bottom;
    setPos({ left, top, placement });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  // A fixed-position tooltip is anchored to the viewport, not to the bar -
  // if the page (or the chart's own horizontal scroller in "view all"
  // mode) scrolls or the window resizes while it's open, close it rather
  // than let it drift away from the bar it's describing.
  useEffect(() => {
    if (!pos) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [pos, hide]);

  return { ref, pos, show, hide };
}

function PortalTooltip({ pos, label, children }) {
  if (!pos) return null;
  return createPortal(
    <div className="an-tooltip" data-placement={pos.placement} style={{ left: pos.left, top: pos.top }} role="tooltip">
      <strong>{label}</strong>
      <span>{children}</span>
    </div>,
    document.body
  );
}

// =========================
// Occupancy - vertical column chart, colour = status tone.
// =========================
function OccupancyColumnChart({ rows, selectedKey, onSelect, language, t, scrollable }) {
  if (rows.length === 0) return <EmptyChart text={t.noData} />;
  const gridSteps = [100, 75, 50, 25, 0];

  return (
    <div className="an-cchart-frame">
      <div className="an-cchart-axis">
        {gridSteps.map((g) => <span key={g}>{g}%</span>)}
      </div>
      <div className={`an-cchart-plotwrap ${scrollable ? 'is-scrollable' : ''}`}>
        <div className="an-cchart-hlines">
          {gridSteps.map((g) => <div key={g} className="an-cchart-hline" style={{ bottom: `${g}%` }} />)}
        </div>
        <div className={`an-cchart-bars ${scrollable ? 'is-start' : 'is-centered'}`}>
          {rows.map((row) => (
            <OccupancyBarItem key={row.key} row={row} selected={selectedKey === row.key} onSelect={onSelect} language={language} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OccupancyBarItem({ row, selected, onSelect, language, t }) {
  const tip = useBarTooltip();
  const tone = getRowTone('occupancy', row);
  const pct = clamp(row.occupancy_rate, 0, 100);
  const isZero = pct <= 0;
  return (
    <div className={`an-col-item ${selected ? 'is-selected' : ''}`}>
      <div className="an-col-scale">
        <button
          ref={tip.ref}
          type="button"
          className={`an-col-bar ${isZero ? 'is-zero' : ''}`}
          style={{ height: isZero ? '7px' : `${pct}%`, background: isZero ? 'transparent' : COLOR[tone] }}
          onClick={() => onSelect(row.key)}
          onMouseEnter={tip.show}
          onMouseLeave={tip.hide}
          onFocus={tip.show}
          onBlur={tip.hide}
          aria-pressed={selected}
          title={`${row.label} · ${roundPct(pct)}%`}
        >
          <span className="an-col-value">{roundPct(pct)}%</span>
        </button>
      </div>
      <span className="an-col-name" title={row.label}>{row.label}</span>
      <PortalTooltip pos={tip.pos} label={row.label}>{rowContext('occupancy', row, t, language)}</PortalTooltip>
    </div>
  );
}

// =========================
// Available beds - stacked column chart (occupied + available),
// column height scaled to each row's total capacity.
// =========================
function AvailableStackedChart({ rows, selectedKey, onSelect, language, t, scrollable }) {
  if (rows.length === 0) return <EmptyChart text={t.noData} />;
  const maxTotal = Math.max(...rows.map((r) => r.total_beds), 1);
  const gridSteps = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div className="an-cchart-frame">
      <div className="an-cchart-axis">
        {gridSteps.map((g) => <span key={g}>{formatNumber(Math.round(maxTotal * g), language)}</span>)}
      </div>
      <div className={`an-cchart-plotwrap ${scrollable ? 'is-scrollable' : ''}`}>
        <div className="an-cchart-hlines">
          {gridSteps.map((g) => <div key={g} className="an-cchart-hline" style={{ bottom: `${g * 100}%` }} />)}
        </div>
        <div className={`an-cchart-bars ${scrollable ? 'is-start' : 'is-centered'}`}>
          {rows.map((row) => (
            <AvailableBarItem key={row.key} row={row} selected={selectedKey === row.key} onSelect={onSelect} maxTotal={maxTotal} language={language} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AvailableBarItem({ row, selected, onSelect, maxTotal, language, t }) {
  const tip = useBarTooltip();
  const totalPct = maxTotal > 0 ? (row.total_beds / maxTotal) * 100 : 0;
  const isZero = totalPct <= 0;
  const occPctOfBar = row.total_beds > 0 ? (row.assigned / row.total_beds) * 100 : 0;
  const availPctOfBar = 100 - occPctOfBar;
  const occHeightPx = (totalPct / 100) * 200 * (occPctOfBar / 100);
  return (
    <div className={`an-col-item ${selected ? 'is-selected' : ''}`}>
      <div className="an-col-scale">
        <button
          ref={tip.ref}
          type="button"
          className={`an-col-bar an-col-stack ${isZero ? 'is-zero' : ''}`}
          style={{ height: isZero ? '7px' : `${totalPct}%`, background: 'transparent' }}
          onClick={() => onSelect(row.key)}
          onMouseEnter={tip.show}
          onMouseLeave={tip.hide}
          onFocus={tip.show}
          onBlur={tip.hide}
          aria-pressed={selected}
          title={`${row.label} · ${formatNumber(row.available_beds, language)} ${t.availableBedsWord}`}
        >
          <span className="an-col-value">{formatNumber(row.available_beds, language)}</span>
          {!isZero && (
            <>
              <span className="an-col-seg an-col-seg-available" style={{ top: 0, height: `${availPctOfBar}%` }} />
              <span className="an-col-seg an-col-seg-occupied" style={{ bottom: 0, height: `${occPctOfBar}%` }}>
                {occHeightPx >= 22 && <span className="an-col-seg-label" style={{ color: '#475569' }}>{formatNumber(row.assigned, language)}</span>}
              </span>
            </>
          )}
        </button>
      </div>
      <span className="an-col-name" title={row.label}>{row.label}</span>
      <PortalTooltip pos={tip.pos} label={row.label}>{rowContext('available', row, t, language)}</PortalTooltip>
    </div>
  );
}

// =========================
// Demand - grouped columns per region: waiting vs. available capacity,
// on one shared count axis (never two scales).
// =========================
function DemandGroupedChart({ rows, selectedKey, onSelect, language, t, scrollable }) {
  if (rows.length === 0) return <EmptyChart text={t.noData} />;
  const maxVal = Math.max(...rows.map((r) => Math.max(r.unassigned_students, r.available_in_region || 0)), 1);
  const gridSteps = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div className="an-cchart-frame">
      <div className="an-cchart-axis">
        {gridSteps.map((g) => <span key={g}>{formatNumber(Math.round(maxVal * g), language)}</span>)}
      </div>
      <div className={`an-cchart-plotwrap ${scrollable ? 'is-scrollable' : ''}`}>
        <div className="an-cchart-hlines">
          {gridSteps.map((g) => <div key={g} className="an-cchart-hline" style={{ bottom: `${g * 100}%` }} />)}
        </div>
        <div className={`an-cchart-bars ${scrollable ? 'is-start' : 'is-centered'}`}>
          {rows.map((row) => (
            <DemandGroupItem key={row.key} row={row} selected={selectedKey === row.key} onSelect={onSelect} maxVal={maxVal} language={language} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DemandGroupItem({ row, selected, onSelect, maxVal, language, t }) {
  const waitTip = useBarTooltip();
  const availTip = useBarTooltip();
  const tone = getRowTone('demand', row);
  const waitPct = maxVal > 0 ? (row.unassigned_students / maxVal) * 100 : 0;
  const waitIsZero = waitPct <= 0;
  const availKnown = row.available_in_region != null;
  const availPct = availKnown ? (row.available_in_region / maxVal) * 100 : 0;
  const availIsZero = availKnown && availPct <= 0;
  const tooltipContent = rowContext('demand', row, t, language);
  return (
    <div className={`an-group-item ${selected ? 'is-selected' : ''}`}>
      <div className="an-group-bars">
        <div className="an-group-bar-wrap">
          <button
            ref={waitTip.ref}
            type="button"
            className={`an-group-bar an-group-bar-waiting ${waitIsZero ? 'is-zero' : ''}`}
            style={{ height: waitIsZero ? '6px' : `${waitPct}%`, background: waitIsZero ? 'transparent' : (tone === 'critical' ? COLOR.critical : COLOR.caution) }}
            onClick={() => onSelect(row.key)}
            onMouseEnter={waitTip.show}
            onMouseLeave={waitTip.hide}
            onFocus={waitTip.show}
            onBlur={waitTip.hide}
            aria-pressed={selected}
            title={`${row.label} · ${formatNumber(row.unassigned_students, language)} ${t.waitingWord}`}
          >
            <span className="an-col-value">{formatNumber(row.unassigned_students, language)}</span>
          </button>
        </div>
        <div className="an-group-bar-wrap">
          {availKnown ? (
            <button
              ref={availTip.ref}
              type="button"
              className={`an-group-bar an-group-bar-avail ${availIsZero ? 'is-zero' : ''}`}
              style={{ height: availIsZero ? '6px' : `${availPct}%`, background: availIsZero ? 'transparent' : '#94a3b8' }}
              onClick={() => onSelect(row.key)}
              onMouseEnter={availTip.show}
              onMouseLeave={availTip.hide}
              onFocus={availTip.show}
              onBlur={availTip.hide}
              aria-pressed={selected}
              title={`${row.label} · ${formatNumber(row.available_in_region, language)} ${t.legendCapacity}`}
            >
              <span className="an-col-value">{formatNumber(row.available_in_region, language)}</span>
            </button>
          ) : (
            <span className="an-group-unknown" title={t.unknown} />
          )}
        </div>
      </div>
      <span className="an-group-name" title={row.label}>{row.label}</span>
      <PortalTooltip pos={waitTip.pos} label={row.label}>{tooltipContent}</PortalTooltip>
      <PortalTooltip pos={availTip.pos} label={row.label}>{tooltipContent}</PortalTooltip>
    </div>
  );
}

// =========================
// Requests - donut (categorical, <=7 slices, fixed ring order) with an
// always-visible legend/table twin so nothing is tooltip-only.
// =========================
function RequestsDonut({ rows, listRows, total, selectedKey, onSelect, language, t }) {
  if (!rows.length || total <= 0) return <EmptyChart text={t.noData} />;

  let acc = 0;
  const stops = rows.map((row) => {
    const startDeg = (acc / total) * 360;
    acc += Math.max(row.count, 0);
    const endDeg = (acc / total) * 360;
    const baseColor = REQUEST_TYPE_COLORS[row.request_type] || COLOR.neutral;
    const active = !selectedKey || selectedKey === row.key;
    const color = active ? baseColor : mixWithWhite(baseColor, 0.72);
    return `${color} ${startDeg}deg ${endDeg}deg`;
  });
  const gradient = `conic-gradient(${stops.join(', ')})`;

  const centerRow = selectedKey ? rows.find((r) => r.key === selectedKey) : null;
  const centerValue = centerRow ? formatNumber(centerRow.count, language) : formatNumber(total, language);
  const centerLabel = centerRow ? centerRow.label : t.totalPending;

  return (
    <div className="an-donut-layout">
      <div className="an-donut-wrap" style={{ background: gradient }}>
        <div className="an-donut-hole">
          <span className="an-donut-hole-value">{centerValue}</span>
          <span className="an-donut-hole-label" title={centerLabel}>{centerLabel}</span>
        </div>
      </div>
      <div className="an-donut-legend">
        {listRows.map((row) => {
          const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
          const color = REQUEST_TYPE_COLORS[row.request_type] || COLOR.neutral;
          const selected = selectedKey === row.key;
          return (
            <button
              key={row.key}
              type="button"
              className={`an-donut-row ${selected ? 'is-selected' : ''}`}
              onClick={() => onSelect(row.key)}
              aria-pressed={selected}
            >
              <span className="an-donut-dot" style={{ background: color }} />
              <span className="an-donut-row-label">{row.label}</span>
              <span className="an-donut-row-count">{formatNumber(row.count, language)}</span>
              <span className="an-donut-row-pct">{pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =========================
// Secondary panels
// =========================
function CapacityBreakdownPanel({ rows, t, language, accent }) {
  const totals = rows.reduce((acc, r) => {
    acc.assigned += r.assigned || 0;
    acc.available += r.available_beds || 0;
    return acc;
  }, { assigned: 0, available: 0 });
  const total = totals.assigned + totals.available;
  const occPct = total > 0 ? (totals.assigned / total) * 100 : 0;
  const availPct = 100 - occPct;

  return (
    <div className="an-panel" style={{ '--accent': accent }}>
      <div className="an-panel-body">
        <h3 className="an-panel-title">{t.capacityBreakdownTitle}</h3>
        <p className="an-panel-sub">{t.capacityBreakdownSub}</p>
        <div className="an-capacity-total">
          <span className="an-capacity-total-value">{formatNumber(total, language)}</span>
          <span className="an-capacity-total-label">{t.totalBedsWord}</span>
        </div>
        <div className="an-mini-track">
          <span style={{ width: `${occPct}%`, background: '#cbd5e1' }} />
          <span style={{ width: `${availPct}%`, background: '#0d9488' }} />
        </div>
        <div className="an-mini-legend">
          <span className="an-mini-legend-item"><span className="an-mini-dot" style={{ background: '#cbd5e1' }} />{t.legendOccupied}: {formatNumber(totals.assigned, language)}</span>
          <span className="an-mini-legend-item"><span className="an-mini-dot" style={{ background: '#0d9488' }} />{t.legendAvailable}: {formatNumber(totals.available, language)}</span>
        </div>
      </div>
    </div>
  );
}

function TopAvailablePanel({ rows, t, language, accent }) {
  const top = [...rows].sort((a, b) => b.available_beds - a.available_beds).slice(0, 4);
  const maxVal = Math.max(...top.map((r) => r.available_beds), 1);

  return (
    <div className="an-panel" style={{ '--accent': accent }}>
      <div className="an-panel-body">
        <h3 className="an-panel-title">{t.topAvailableTitle}</h3>
        <p className="an-panel-sub">{t.topAvailableSub}</p>
        <div className="an-top-list">
          {top.map((row, i) => (
            <div className="an-top-row" key={row.key}>
              <span className={`an-top-rank ${i === 0 ? 'is-first' : ''}`}>{i + 1}</span>
              <div className="an-top-main">
                <div className="an-top-name" title={row.label}>{row.label}</div>
                <div className="an-top-track">
                  <span className="an-top-fill" style={{ width: `${(row.available_beds / maxVal) * 100}%` }} />
                </div>
              </div>
              <span className="an-top-value">{formatNumber(row.available_beds, language)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemandSharePanel({ rows, colorMap, t, language }) {
  const withDemand = rows.filter((r) => r.unassigned_students > 0);
  const total = withDemand.reduce((s, r) => s + r.unassigned_students, 0);

  if (total <= 0) {
    return (
      <div className="an-panel">
        <div className="an-panel-body">
          <h3 className="an-panel-title">{t.demandShareTitle}</h3>
          <p className="an-panel-sub">{t.demandShareSub}</p>
          <div className="an-detail-empty" style={{ padding: '20px 0 0' }}>{t.noData}</div>
        </div>
      </div>
    );
  }

  const sorted = [...withDemand].sort((a, b) => b.unassigned_students - a.unassigned_students);
  let acc = 0;
  const stops = sorted.map((row) => {
    const startDeg = (acc / total) * 360;
    acc += row.unassigned_students;
    const endDeg = (acc / total) * 360;
    return `${colorMap.get(row.region_id || row.region) || COLOR.neutral} ${startDeg}deg ${endDeg}deg`;
  });
  const gradient = `conic-gradient(${stops.join(', ')})`;

  return (
    <div className="an-panel">
      <div className="an-panel-body">
        <h3 className="an-panel-title">{t.demandShareTitle}</h3>
        <p className="an-panel-sub">{t.demandShareSub}</p>
        <div className="an-donut-layout" style={{ justifyContent: 'flex-start', gap: 18 }}>
          <div className="an-donut-wrap" style={{ width: 108, height: 108, background: gradient }}>
            <div className="an-donut-hole" style={{ inset: 18 }}>
              <span className="an-donut-hole-value" style={{ fontSize: 17 }}>{formatNumber(total, language)}</span>
            </div>
          </div>
          <div className="an-donut-legend" style={{ minWidth: 0 }}>
            {sorted.slice(0, 5).map((row) => {
              const pct = Math.round((row.unassigned_students / total) * 100);
              return (
                <div className="an-donut-row" key={row.key} style={{ cursor: 'default', padding: '5px 4px' }}>
                  <span className="an-donut-dot" style={{ background: colorMap.get(row.region_id || row.region) || COLOR.neutral }} />
                  <span className="an-donut-row-label">{row.label}</span>
                  <span className="an-donut-row-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ analysis, groupBy, row, buildingRows, summary, t, language, isHebrew, navigate, accent }) {
  if (!row) {
    return (
      <div className="an-panel">
        <div className="an-detail-empty">{t.noData}</div>
      </div>
    );
  }

  const tone = getRowTone(analysis, row);
  let bigValue;
  let bigLabel;
  let facts = [];
  let breakdown = null;
  let action = null;
  let badge = null;

  if (analysis === 'occupancy' || analysis === 'available') {
    bigValue = `${roundPct(row.occupancy_rate)}%`;
    bigLabel = t.occupancyRate;
    facts = [
      { label: t.bedsOccupied, value: <NumRatio a={row.assigned} b={row.total_beds} language={language} /> },
      { label: t.availableBedsWord, value: formatNumber(row.available_beds, language) },
    ];
    if (groupBy === 'region') {
      const buildingCount = buildingRows.filter((b) => (b.region_id || b.region) === (row.region_id || row.region)).length;
      facts.push({ label: t.buildingsWord, value: formatNumber(buildingCount, language) });
    }
    breakdown = {
      kind: 'segments',
      segments: [
        { label: t.assignedWord, value: row.assigned, color: '#cbd5e1' },
        { label: t.availableBedsWord, value: row.available_beds, color: '#0d9488' },
      ],
    };
    badge = { tone, label: tone === 'critical' ? t.statusCritical : tone === 'caution' ? t.statusCaution : t.statusHealthy };
    action = groupBy === 'building'
      ? { label: t.viewBuildingDetails, onClick: () => navigate(`/buildings?region=${encodeURIComponent(row.region_id || '')}&building=${encodeURIComponent(row.building_id)}`) }
      : { label: t.viewBuildingsInRegion, onClick: () => navigate(`/buildings?region=${encodeURIComponent(row.region_id || '')}`) };
  } else if (analysis === 'demand') {
    bigValue = formatNumber(row.unassigned_students, language);
    bigLabel = t.waitingWord;
    facts = [
      { label: t.assignedWord, value: <NumRatio a={row.assigned_students} b={row.total_students} language={language} /> },
    ];
    if (row.available_in_region != null) {
      facts.push({ label: t.availableBedsWord, value: formatNumber(row.available_in_region, language) });
    }
    breakdown = {
      kind: 'segments',
      segments: [
        { label: t.waitingWord, value: row.unassigned_students, color: tone === 'critical' ? COLOR.critical : COLOR.caution },
        { label: t.assignedWord, value: row.assigned_students, color: '#94a3b8' },
      ],
    };
    if (tone === 'critical') badge = { tone, label: t.statusOverCapacity };
    if (row.region_id) {
      action = { label: t.viewBuildingsInRegion, onClick: () => navigate(`/buildings?region=${encodeURIComponent(row.region_id)}`) };
    }
  } else {
    const totalPending = num(summary.pending_requests);
    const share = totalPending > 0 ? (row.count / totalPending) * 100 : 0;
    bigValue = formatNumber(row.count, language);
    bigLabel = t.pendingWord;
    breakdown = { kind: 'share', pct: share, label: t.shareOfPending };
    action = { label: t.reviewRequests, onClick: () => navigate('/transfers') };
  }

  return (
    <div className="an-panel an-detail-card" style={{ '--accent': accent }}>
      <div className="an-detail-top">
        <div className="an-detail-titlecol">
          <p className="an-detail-eyebrow">{t.selectedLabel}</p>
          <h3>{row.label}</h3>
        </div>
        {badge && <span className={`an-status-chip an-status-chip-${badge.tone}`}>{badge.label}</span>}
      </div>

      <div className="an-detail-big">
        <span className="an-detail-big-value">{bigValue}</span>
        <span className="an-detail-big-label">{bigLabel}</span>
      </div>

      {facts.length > 0 && (
        <div className="an-detail-facts">
          {facts.map((f) => (
            <div className="an-detail-fact" key={f.label}>
              <span className="an-detail-fact-value">{f.value}</span>
              <span className="an-detail-fact-label">{f.label}</span>
            </div>
          ))}
        </div>
      )}

      {breakdown?.kind === 'segments' && <MiniBreakdown segments={breakdown.segments} language={language} />}
      {breakdown?.kind === 'share' && <ShareBar pct={breakdown.pct} label={breakdown.label} />}

      {action && (
        <button type="button" className="an-detail-action" onClick={action.onClick}>
          {action.label}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function MiniBreakdown({ segments, language }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0) || 1;
  return (
    <div className="an-mini-breakdown">
      <div className="an-mini-track">
        {segments.map((seg) => (
          <span key={seg.label} style={{ width: `${(Math.max(seg.value, 0) / total) * 100}%`, background: seg.color }} />
        ))}
      </div>
      <div className="an-mini-legend">
        {segments.map((seg) => (
          <span className="an-mini-legend-item" key={seg.label}>
            <span className="an-mini-dot" style={{ background: seg.color }} />
            {seg.label}: {formatNumber(seg.value, language)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ShareBar({ pct, label }) {
  return (
    <div className="an-share-bar">
      <div className="an-share-bar-label">{label}: {clamp(Math.round(pct), 0, 100)}%</div>
      <div className="an-share-bar-track">
        <span className="an-share-bar-fill" style={{ width: `${clamp(pct, 0, 100)}%` }} />
      </div>
    </div>
  );
}

// Compact supporting summary shown inline in the hero card's footer -
// grouped counters over the full current row set (not just the visible
// top N), never a second big chart.
function buildStatusSummary(analysis, rows, t) {
  if (!rows.length) return [];

  if (analysis === 'occupancy' || analysis === 'available') {
    const critical = rows.filter((r) => getRowTone(analysis, r) === 'critical').length;
    const caution = rows.filter((r) => getRowTone(analysis, r) === 'caution').length;
    const healthy = rows.length - critical - caution;
    return [
      { label: t.statusCritical, count: critical, tone: 'critical' },
      { label: t.statusCaution, count: caution, tone: 'caution' },
      { label: t.statusHealthy, count: healthy, tone: 'healthy' },
    ];
  }

  if (analysis === 'demand') {
    const over = rows.filter((r) => getRowTone('demand', r) === 'critical').length;
    const within = rows.length - over;
    return [
      { label: t.statusOverCapacity, count: over, tone: 'critical' },
      { label: t.statusWithinCapacity, count: within, tone: 'healthy' },
    ];
  }

  return [];
}

function buildInsights(analysis, { rows, data, groupBy, isHebrew }) {
  const list = [];
  const lang = isHebrew ? 'he' : 'en';

  if (analysis === 'occupancy') {
    if (rows.length === 0) return list;
    const sorted = [...rows].sort((a, b) => b.occupancy_rate - a.occupancy_rate);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    if (highest) {
      const rate = roundPct(highest.occupancy_rate);
      list.push(rate >= 90
        ? (isHebrew ? `"${highest.label}" כמעט מלא, בתפוסה של ${rate}%.` : `"${highest.label}" is almost full at ${rate}%.`)
        : (isHebrew ? `ל"${highest.label}" התפוסה הגבוהה ביותר - ${rate}%.` : `"${highest.label}" has the highest occupancy at ${rate}%.`));
    }
    if (lowest && lowest.key !== highest?.key) {
      const rate = roundPct(lowest.occupancy_rate);
      list.push(isHebrew
        ? `ל"${lowest.label}" התפוסה הנמוכה ביותר - ${rate}%.`
        : `"${lowest.label}" has the lowest occupancy at ${rate}%.`);
    }
    const nearFull = rows.filter((r) => r.occupancy_rate >= 90);
    if (nearFull.length > 1) {
      const noun = nounSingularPlural(nearFull.length, groupBy, isHebrew);
      list.push(isHebrew
        ? `${formatNumber(nearFull.length, lang)} ${noun} בתפוסה של 90% ומעלה.`
        : `${formatNumber(nearFull.length, lang)} ${noun} are at 90% occupancy or higher.`);
    }
    return list.slice(0, 4);
  }

  if (analysis === 'available') {
    if (rows.length === 0) return list;
    const sorted = [...rows].sort((a, b) => b.available_beds - a.available_beds);
    const most = sorted[0];
    const least = sorted[sorted.length - 1];

    if (most) {
      list.push(isHebrew
        ? `ל"${most.label}" הזמינות הגבוהה ביותר - ${formatNumber(most.available_beds, lang)} מיטות פנויות.`
        : `"${most.label}" has the most available capacity, with ${formatNumber(most.available_beds, lang)} beds.`);
    }
    const zero = rows.filter((r) => r.available_beds === 0);
    if (zero.length > 0) {
      const noun = nounSingularPlural(zero.length, groupBy, isHebrew);
      list.push(isHebrew
        ? `ל-${formatNumber(zero.length, lang)} ${noun} אין כרגע מיטות פנויות.`
        : `${formatNumber(zero.length, lang)} ${noun} currently ${zero.length === 1 ? 'has' : 'have'} no available beds.`);
    } else {
      list.push(isHebrew ? `לכל ה${nounPlural(groupBy, true)} יש כרגע קיבולת פנויה.` : `All ${nounPlural(groupBy, false).toLowerCase()} currently have available capacity.`);
    }
    if (least && least.key !== most?.key && least.available_beds > 0) {
      list.push(isHebrew
        ? `ל"${least.label}" הזמינות הנמוכה ביותר - ${formatNumber(least.available_beds, lang)} מיטות פנויות.`
        : `"${least.label}" has the least available capacity, with ${formatNumber(least.available_beds, lang)} beds.`);
    }
    return list.slice(0, 4);
  }

  if (analysis === 'demand') {
    const totalWaiting = num(data?.summary?.unassigned_students);
    if (totalWaiting === 0) {
      list.push(isHebrew ? 'אין כרגע סטודנטים הממתינים לשיבוץ.' : 'No students are currently waiting for assignment.');
      return list;
    }
    if (rows.length === 0) return list;
    const sorted = [...rows].sort((a, b) => b.unassigned_students - a.unassigned_students);
    const top = sorted[0];
    if (top && top.unassigned_students > 0) {
      list.push(isHebrew
        ? `ל"${top.label}" הביקוש הגבוה ביותר - ${formatNumber(top.unassigned_students, lang)} סטודנטים ממתינים.`
        : `"${top.label}" has the highest demand, with ${formatNumber(top.unassigned_students, lang)} students waiting.`);
    }
    const overCapacity = rows.filter((r) => r.available_in_region != null && r.unassigned_students > r.available_in_region);
    if (overCapacity.length === 1) {
      list.push(isHebrew
        ? `הביקוש ב"${overCapacity[0].label}" עולה על הקיבולת הפנויה הנוכחית.`
        : `Demand in "${overCapacity[0].label}" exceeds the currently available capacity.`);
    } else if (overCapacity.length > 1) {
      list.push(isHebrew
        ? `ב-${formatNumber(overCapacity.length, lang)} אזורים הביקוש עולה על הקיבולת הפנויה.`
        : `${formatNumber(overCapacity.length, lang)} regions have demand exceeding available capacity.`);
    } else {
      list.push(isHebrew ? 'בכל האזורים יש כיום קיבולת פנויה מספקת לביקוש.' : 'Available capacity currently covers demand in every region.');
    }
    return list.slice(0, 4);
  }

  // requests
  const totalPending = num(data?.summary?.pending_requests);
  if (totalPending === 0) {
    list.push(isHebrew ? 'אין בקשות ממתינות כרגע.' : 'No pending requests right now.');
    return list;
  }
  if (rows.length > 0) {
    const sorted = [...rows].sort((a, b) => b.count - a.count);
    const top = sorted[0];
    if (top) {
      list.push(isHebrew
        ? `"${top.label}" הסוג הנפוץ ביותר בבקשות הממתינות - ${formatNumber(top.count, lang)}.`
        : `"${top.label}" is the most common pending request, with ${formatNumber(top.count, lang)}.`);
    }
  }
  const priorityWaiting = num(data?.summary?.priority_unassigned_students);
  if (priorityWaiting > 0) {
    list.push(isHebrew
      ? `${formatNumber(priorityWaiting, lang)} סטודנטים עם בקשה מיוחדת עדיין ללא שיבוץ.`
      : `${formatNumber(priorityWaiting, lang)} students with a special request are still unassigned.`);
  }
  return list.slice(0, 4);
}

export default AnalysisPage;
