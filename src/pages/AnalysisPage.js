import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell,
} from 'recharts';
import {
  Users, Home, Bed, AlertTriangle, CheckCircle2, Search, RefreshCw,
  TrendingUp, TrendingDown, Upload, Shuffle, ArrowLeftRight, Star, Clock,
  ChevronUp, ChevronDown, MapPin,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { analysisAPI, regionsAPI } from '../services/api';

// ---------------------------------------------------------------------
// Controlled Dormify palette - navy / blue / green / orange / gray.
// Red is reserved for warning/error states only, never for plain categories.
// ---------------------------------------------------------------------
const PALETTE = ['#2563eb', '#059669', '#f59e0b', '#0f172a', '#0d9488', '#94a3b8', '#3d9fe0', '#65a30d'];
const COLOR_WARN = '#dc2626';

const GENDER_LABELS = {
  he: { male: 'זכר', female: 'נקבה' },
  en: { male: 'Male', female: 'Female' },
};
const RELIGION_LABELS = {
  he: { Jewish: 'יהודי', Muslims: 'מוסלמי', Christian: 'נוצרי', Druze: 'דרוזי', not_specified: 'לא צוין' },
  en: { Jewish: 'Jewish', Muslims: 'Muslim', Christian: 'Christian', Druze: 'Druze', not_specified: 'Not specified' },
};
const RELIGIOUS_LABELS = {
  he: { religious: 'דתי', no_preference: 'לא משנה', not_specified: 'לא צוין' },
  en: { religious: 'Religious', no_preference: 'No preference', not_specified: 'Not specified' },
};
const CATEGORY_LABELS = {
  he: { new: 'חדשים', continuing: 'ממשיכים', transfer: 'מעברים', leaving: 'עוזבים' },
  en: { new: 'New', continuing: 'Continuing', transfer: 'Transfer', leaving: 'Leaving' },
};
const HOUSING_LABELS = {
  he: {
    'רווקים': 'רווקים', 'רווקות': 'רווקות', 'זוגות': 'זוגות',
    'משפחות עד 2 ילדים (כולל)': 'משפחות', 'רווקים/ות בדירה': 'רווקים/ות בדירה',
  },
  en: {
    'רווקים': 'Single (men)', 'רווקות': 'Single (women)', 'זוגות': 'Couples',
    'משפחות עד 2 ילדים (כולל)': 'Families', 'רווקים/ות בדירה': 'Single in apartment',
  },
};

function getRoleLabel(role, language) {
  const map = {
    central_admin: { he: 'מנהל מרכזי', en: 'Central Admin' },
    region_boss: { he: 'מנהל אזור', en: 'Region Admin' },
    employee: { he: 'עובד', en: 'Employee' },
  };
  return map[role]?.[language] || '';
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value, language) {
  return num(value).toLocaleString(language === 'he' ? 'he-IL' : 'en-US');
}

function pct(part, whole) {
  const p = num(part);
  const w = num(whole);
  if (w <= 0) return 0;
  return Math.round((p / w) * 100);
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

function AnalysisPage({ language = 'he' }) {
  const isHebrew = language === 'he';
  const auth = useAuth();
  const { user, isCentralAdmin, canRunAllocation, canAssignPriority } = auth;
  const navigate = useNavigate();

  const [regions, setRegions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const [filterRegion, setFilterRegion] = useState('all');
  const [dimension, setDimension] = useState('gender');
  const [buildingSearch, setBuildingSearch] = useState('');
  const [sort, setSort] = useState({ key: 'occupancy_rate', dir: 'desc' });

  const t = {
    he: {
      title: 'ניתוח נתונים',
      subtitle: 'תמונת מצב ניהולית: תפוסה, שיבוצים והתפלגות סטודנטים בזמן אמת',
      lastUpdated: 'עודכן לאחרונה',
      dataSource: 'מקור נתונים',
      noBatch: 'טרם הועלה קובץ',
      refresh: 'רענון',
      refreshing: 'מרענן...',
      systemWide: 'תצוגה מערכתית - כלל האזורים',
      allRegions: 'כל האזורים',
      regionFilter: 'אזור',
      buildingSearch: 'חיפוש בניין או אזור',
      resetFilters: 'איפוס סינון',
      loading: 'טוען נתוני ניתוח...',
      loadError: 'אירעה שגיאה בטעינת נתוני הניתוח',
      retry: 'נסו שוב',
      noData: 'אין נתונים להצגה',
      noMatch: 'אין תוצאות התואמות את הסינון הנוכחי',

      totalStudents: 'סה"כ סטודנטים',
      assignedStudents: 'סטודנטים משובצים',
      unassignedStudents: 'ממתינים לשיבוץ',
      occupancyRate: 'אחוז תפוסה',
      availableBeds: 'מיטות פנויות',
      ofTotal: 'מכלל הסטודנטים',
      stillWaiting: 'עדיין ממתינים',
      bedsOccupied: 'מיטות תפוסות',
      readyForMore: 'זמינות לשיבוץ נוסף',

      insightsTitle: 'תובנות ונושאים לטיפול',
      noInsights: 'אין נושאים דחופים כרגע',
      noInsightsSub: 'כל המדדים המרכזיים בטווח תקין ואין חריגות משמעותיות בנתונים.',

      allocationPerformance: 'ביצועי שיבוץ',
      allocationPerformanceSub: 'התקדמות שיבוץ הסטודנטים מול היעד הכולל',
      allStudents: 'כלל הסטודנטים',
      priorityStudents: 'סטודנטים עם בקשות מיוחדות',
      assigned: 'משובצים',
      unassigned: 'ממתינים',
      waiting: 'ממתינים',

      occupancyTitle: 'השוואת תפוסה',
      occupancyByRegion: 'תפוסה לפי אזור',
      occupancyByBuilding: 'תפוסה לפי בניין (12 המובילים)',
      occupancySub: 'מיון לפי אחוז תפוסה, מהגבוה לנמוך',

      distributionTitle: 'התפלגות סטודנטים',
      distributionSub: 'בחרו מאפיין להצגת ההתפלגות בפועל',
      dimGender: 'מגדר', dimReligion: 'דת', dimReligious: 'דתי/חילוני',
      dimCategory: 'קטגוריה', dimHousing: 'סוג מגורים', dimRegion: 'אזור',
      dimAllocation: 'סטטוס שיבוץ', dimPriority: 'בקשות מיוחדות',
      unknown: 'לא ידוע',

      tableTitle: 'פירוט לפי בניין',
      tableSub: 'נתוני תפוסה מלאים, ניתנים למיון ולחיפוש',
      colBuilding: 'בניין', colRegion: 'אזור', colTotal: 'סה"כ מיטות',
      colAssigned: 'משובץ', colAvailable: 'פנוי', colRate: 'אחוז תפוסה',
      showing: 'מוצגים',
      of: 'מתוך',

      recentActivity: 'מקורות נתונים אחרונים',
      latestUpload: 'העלאה אחרונה',
      latestRun: 'הרצת שיבוץ אחרונה',
      students: 'סטודנטים',
    },
    en: {
      title: 'Analytics & Insights',
      subtitle: 'A management view of occupancy, assignments, and student distribution in real time',
      lastUpdated: 'Last updated',
      dataSource: 'Data source',
      noBatch: 'No file uploaded yet',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      systemWide: 'System-wide — all regions',
      allRegions: 'All Regions',
      regionFilter: 'Region',
      buildingSearch: 'Search building or region',
      resetFilters: 'Reset filters',
      loading: 'Loading analytics…',
      loadError: 'Something went wrong while loading analytics data',
      retry: 'Retry',
      noData: 'No data to display',
      noMatch: 'No results match the current filters',

      totalStudents: 'Total Students',
      assignedStudents: 'Assigned Students',
      unassignedStudents: 'Pending Assignment',
      occupancyRate: 'Occupancy Rate',
      availableBeds: 'Available Beds',
      ofTotal: 'of all students',
      stillWaiting: 'still waiting',
      bedsOccupied: 'beds occupied',
      readyForMore: 'ready for assignment',

      insightsTitle: 'Insights & Attention',
      noInsights: 'No urgent issues right now',
      noInsightsSub: 'All key metrics are within a healthy range — no meaningful anomalies in the data.',

      allocationPerformance: 'Allocation Performance',
      allocationPerformanceSub: 'Student assignment progress against the overall total',
      allStudents: 'All Students',
      priorityStudents: 'Students with Special Requests',
      assigned: 'Assigned',
      unassigned: 'Waiting',
      waiting: 'Waiting',

      occupancyTitle: 'Occupancy Comparison',
      occupancyByRegion: 'Occupancy by Region',
      occupancyByBuilding: 'Occupancy by Building (top 12)',
      occupancySub: 'Sorted by occupancy rate, highest to lowest',

      distributionTitle: 'Student Distribution',
      distributionSub: 'Choose an attribute to see its real distribution',
      dimGender: 'Gender', dimReligion: 'Religion', dimReligious: 'Religious Preference',
      dimCategory: 'Category', dimHousing: 'Housing Type', dimRegion: 'Region',
      dimAllocation: 'Allocation Status', dimPriority: 'Special Requests',
      unknown: 'Unknown',

      tableTitle: 'Building Breakdown',
      tableSub: 'Full occupancy detail, sortable and searchable',
      colBuilding: 'Building', colRegion: 'Region', colTotal: 'Total Beds',
      colAssigned: 'Assigned', colAvailable: 'Available', colRate: 'Occupancy',
      showing: 'Showing',
      of: 'of',

      recentActivity: 'Recent Data Sources',
      latestUpload: 'Latest upload',
      latestRun: 'Latest allocation run',
      students: 'students',
    },
  }[language] || {};

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

  const resetFilters = () => {
    setFilterRegion('all');
    setBuildingSearch('');
    setDimension('gender');
  };

  const summary = data?.summary || {};
  const roleLabel = getRoleLabel(user?.role, language);
  const regionContext = data?.region?.name || (isCentralAdmin?.() ? t.systemWide : '');
  const canPickRegion = isCentralAdmin?.() && regions.length > 1;

  const totalStudents = num(summary.total_students);
  const assignedStudents = num(summary.assigned_students);
  const unassignedStudents = num(summary.unassigned_students);
  const occupancyRate = num(summary.occupancy_rate);
  const availableBeds = num(summary.available_beds);
  const totalCapacity = num(summary.total_capacity);
  const occupiedBeds = num(summary.occupied_beds);
  const priorityStudents = num(summary.priority_students);
  const priorityUnassigned = num(summary.priority_unassigned_students);
  const priorityAssigned = Math.max(priorityStudents - priorityUnassigned, 0);
  const pendingRequests = num(summary.pending_requests);

  const kpis = [
    {
      key: 'total', Icon: Users, accent: '#2563eb', bg: '#dbeafe',
      value: totalStudents, label: t.totalStudents,
      sub: regionContext ? regionContext : null,
      route: '/students',
    },
    {
      key: 'assigned', Icon: CheckCircle2, accent: '#059669', bg: '#d1fae5',
      value: assignedStudents, label: t.assignedStudents,
      sub: `${pct(assignedStudents, totalStudents)}% ${t.ofTotal}`,
      route: '/students',
    },
    {
      key: 'unassigned', Icon: Clock, accent: '#d97706', bg: '#fef3c7',
      value: unassignedStudents, label: t.unassignedStudents,
      sub: `${pct(unassignedStudents, totalStudents)}% ${t.stillWaiting}`,
      route: '/students',
    },
    {
      key: 'occupancy', Icon: Home, accent: '#0f172a', bg: '#e2e8f0',
      value: `${occupancyRate}%`, label: t.occupancyRate,
      sub: `${formatNumber(occupiedBeds, language)}/${formatNumber(totalCapacity, language)} ${t.bedsOccupied}`,
      route: '/buildings',
    },
    {
      key: 'available', Icon: Bed, accent: '#0d9488', bg: '#ccfbf1',
      value: availableBeds, label: t.availableBeds,
      sub: t.readyForMore,
      route: '/buildings',
    },
  ];

  const occupancyRows = useMemo(() => (data?.occupancy_data || []).map((r) => ({
    building: r.building || t.unknown,
    region: r.region || t.unknown,
    total_beds: num(r.total_beds),
    assigned: num(r.assigned),
    available_beds: num(r.available_beds),
    occupancy_rate: num(r.occupancy_rate),
  })), [data, t.unknown]);

  const distinctRegionsInData = useMemo(
    () => [...new Set(occupancyRows.map((r) => r.region).filter(Boolean))],
    [occupancyRows]
  );
  const groupByRegion = distinctRegionsInData.length > 1;

  const occupancyChartData = useMemo(() => {
    if (occupancyRows.length === 0) return [];
    if (groupByRegion) {
      const map = {};
      occupancyRows.forEach((r) => {
        if (!map[r.region]) map[r.region] = { name: r.region, total: 0, assigned: 0 };
        map[r.region].total += r.total_beds;
        map[r.region].assigned += r.assigned;
      });
      return Object.values(map).map((x) => ({
        name: x.name, total: x.total, assigned: x.assigned,
        available: Math.max(x.total - x.assigned, 0),
        rate: x.total > 0 ? Math.round((x.assigned / x.total) * 100) : 0,
      })).sort((a, b) => b.rate - a.rate);
    }
    return [...occupancyRows]
      .map((r) => ({ name: r.building, total: r.total_beds, assigned: r.assigned, available: r.available_beds, rate: r.occupancy_rate }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 12);
  }, [occupancyRows, groupByRegion]);

  const tableRows = useMemo(() => {
    const search = buildingSearch.trim().toLowerCase();
    let rows = occupancyRows;
    if (search) {
      rows = rows.filter((r) =>
        r.building.toLowerCase().includes(search) || r.region.toLowerCase().includes(search)
      );
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return rows;
  }, [occupancyRows, buildingSearch, sort]);

  const distributionOptions = [
    { key: 'gender', label: t.dimGender },
    { key: 'religion', label: t.dimReligion },
    { key: 'religious', label: t.dimReligious },
    { key: 'category', label: t.dimCategory },
    { key: 'housing', label: t.dimHousing },
    { key: 'allocation', label: t.dimAllocation },
    { key: 'priority', label: t.dimPriority },
    ...(distinctRegionsInData.length > 1 ? [{ key: 'region', label: t.dimRegion }] : []),
  ];

  const distributionData = useMemo(() => {
    const mapWithLabels = (rows, key, labels) => (rows || [])
      .map((row) => {
        const raw = row[key];
        const name = raw ? (labels?.[language]?.[raw] || raw) : t.unknown;
        return { name, value: num(row.count) };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

    switch (dimension) {
      case 'gender': return mapWithLabels(data?.students_by_gender, 'gender', GENDER_LABELS);
      case 'religion': return mapWithLabels(data?.students_by_religion, 'requested_religion', RELIGION_LABELS);
      case 'religious': return mapWithLabels(data?.students_by_religious, 'religious', RELIGIOUS_LABELS);
      case 'category': return mapWithLabels(data?.students_by_category, 'category', CATEGORY_LABELS);
      case 'housing': return mapWithLabels(data?.students_by_housing, 'housing_type', HOUSING_LABELS);
      case 'region': return (data?.students_by_region || [])
        .map((r) => ({ name: r.region || t.unknown, value: num(r.count) }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value);
      case 'allocation': return [
        { name: t.assigned, value: assignedStudents },
        { name: t.unassigned, value: unassignedStudents },
      ].filter((d) => d.value > 0);
      case 'priority': return [
        { name: t.priorityStudents, value: priorityStudents },
        { name: isHebrew ? 'ללא בקשה מיוחדת' : 'No special request', value: Math.max(totalStudents - priorityStudents, 0) },
      ].filter((d) => d.value > 0);
      default: return [];
    }
    // eslint-disable-next-line
  }, [dimension, data, language, assignedStudents, unassignedStudents, priorityStudents, totalStudents]);

  const insights = useMemo(
    () => buildInsights({
      summary, occupancyChartData, groupByRegion, latestRun: data?.latest_run,
      pendingRequests, unassignedStudents, priorityUnassigned, availableBeds, totalStudents,
      canRunAllocation: typeof canRunAllocation === 'function' && canRunAllocation(),
      canAssignPriority: typeof canAssignPriority === 'function' && canAssignPriority(),
      t, isHebrew,
    }),
    // eslint-disable-next-line
    [summary, occupancyChartData, groupByRegion, data, pendingRequests, unassignedStudents, priorityUnassigned, availableBeds, totalStudents]
  );

  const toggleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div className="analysis-page" dir={isHebrew ? 'rtl' : 'ltr'}>
      <header className="an-header">
        <div className="an-header-main">
          <h1>{t.title}</h1>
          <p className="an-subtitle">{t.subtitle}</p>
          <div className="an-context-row">
            {roleLabel && <span className="an-chip">{roleLabel}</span>}
            {regionContext && <span className="an-chip an-chip-outline"><MapPin size={12} />{regionContext}</span>}
            <span className="an-chip an-chip-outline">
              {t.dataSource}: {data?.latest_batch?.filename ? <bdi>{data.latest_batch.filename}</bdi> : t.noBatch}
            </span>
          </div>
        </div>
        <div className="an-header-actions">
          {lastFetchedAt && (
            <span className="an-updated">{t.lastUpdated}: <bdi>{formatTimestamp(lastFetchedAt.toISOString(), language)}</bdi></span>
          )}
          <button
            type="button"
            className="an-refresh-btn"
            onClick={() => fetchAnalysis(filterRegion, true)}
            disabled={refreshing || loading}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            {refreshing ? t.refreshing : t.refresh}
          </button>
        </div>
      </header>

      <div className="an-filter-bar">
        {canPickRegion && (
          <div className="an-filter-field">
            <label>{t.regionFilter}</label>
            <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
              <option value="all">{t.allRegions}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="an-filter-field an-filter-search">
          <Search size={15} />
          <input
            value={buildingSearch}
            onChange={(e) => setBuildingSearch(e.target.value)}
            placeholder={t.buildingSearch}
          />
        </div>
        {(filterRegion !== 'all' || buildingSearch) && (
          <button type="button" className="an-reset-btn" onClick={resetFilters}>{t.resetFilters}</button>
        )}
      </div>

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
          <div className="an-kpi-row">
            {kpis.map((k) => (
              <button key={k.key} type="button" className="an-kpi-card" style={{ '--accent': k.accent, '--bg': k.bg }} onClick={() => navigate(k.route)}>
                <span className="an-kpi-icon"><k.Icon size={17} /></span>
                <span className="an-kpi-value">{typeof k.value === 'number' ? formatNumber(k.value, language) : k.value}</span>
                <span className="an-kpi-label">{k.label}</span>
                {k.sub && <span className="an-kpi-sub">{k.sub}</span>}
              </button>
            ))}
          </div>

          <InsightsPanel insights={insights} language={language} navigate={navigate} t={t} />

          <div className="an-section-card">
            <h2>{t.allocationPerformance}</h2>
            <p className="an-section-sub">{t.allocationPerformanceSub}</p>
            <PerformanceBar
              label={t.allStudents}
              total={totalStudents}
              segments={[
                { key: 'assigned', label: t.assigned, value: assignedStudents, color: PALETTE[1] },
                { key: 'unassigned', label: t.waiting, value: unassignedStudents, color: '#e2e8f0', textColor: '#475569' },
              ]}
              language={language}
            />
            {priorityStudents > 0 && (
              <PerformanceBar
                label={t.priorityStudents}
                total={priorityStudents}
                segments={[
                  { key: 'p-assigned', label: t.assigned, value: priorityAssigned, color: PALETTE[0] },
                  { key: 'p-waiting', label: t.waiting, value: priorityUnassigned, color: '#fde68a', textColor: '#92400e' },
                ]}
                language={language}
              />
            )}
          </div>

          <div className="an-section-card">
            <h2>{t.occupancyTitle}</h2>
            <p className="an-section-sub">{groupByRegion ? t.occupancyByRegion : t.occupancyByBuilding} · {t.occupancySub}</p>
            {occupancyChartData.length === 0 ? (
              <NoDataState text={t.noData} />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(occupancyChartData.length * 34, 140)}>
                <BarChart data={occupancyChartData} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value, n, entry) => [`${entry.payload.assigned}/${entry.payload.total} (${value}%)`, t.occupancyRate]}
                  />
                  <Bar dataKey="rate" radius={[0, 8, 8, 0]} maxBarSize={22}>
                    {occupancyChartData.map((row, i) => (
                      <Cell key={i} fill={row.rate >= 80 ? PALETTE[1] : row.rate >= 40 ? PALETTE[0] : PALETTE[2]} />
                    ))}
                    <LabelList dataKey="rate" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: '#334155', fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="an-section-card">
            <h2>{t.distributionTitle}</h2>
            <p className="an-section-sub">{t.distributionSub}</p>
            <div className="an-dim-buttons">
              {distributionOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`an-dim-btn ${dimension === opt.key ? 'active' : ''}`}
                  onClick={() => setDimension(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {distributionData.length === 0 ? (
              <NoDataState text={t.noData} />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(distributionData.length * 38, 140)}>
                <BarChart data={distributionData} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => [formatNumber(value, language), t.students]} />
                  <Bar dataKey="value" fill={PALETTE[0]} radius={[0, 8, 8, 0]} maxBarSize={22}>
                    <LabelList dataKey="value" position="right" formatter={(v) => formatNumber(v, language)} style={{ fontSize: 11, fill: '#334155', fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="an-section-card">
            <div className="an-table-header">
              <div>
                <h2>{t.tableTitle}</h2>
                <p className="an-section-sub">{t.tableSub}</p>
              </div>
              <span className="an-table-count">{t.showing} {tableRows.length} {t.of} {occupancyRows.length}</span>
            </div>
            {occupancyRows.length === 0 ? (
              <NoDataState text={t.noData} />
            ) : tableRows.length === 0 ? (
              <NoDataState text={t.noMatch} />
            ) : (
              <DetailTable rows={tableRows} sort={sort} onSort={toggleSort} language={language} t={t} />
            )}
          </div>

          <RecentDataActivity data={data} language={language} t={t} isHebrew={isHebrew} />
        </>
      )}

      <style>{`
        .analysis-page { padding: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 100%; }

        .an-header {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap;
          background: linear-gradient(120deg, #0f172a 0%, #1e293b 60%, #1e3a8a 140%);
          border-radius: 16px; padding: 22px 26px; box-shadow: 0 8px 24px rgba(15,23,42,0.2);
        }
        .an-header-main { min-width: 0; flex: 1; }
        .an-header h1 { font-size: 24px; font-weight: 800; color: white; margin: 0 0 6px; }
        .an-subtitle { color: #cbd5e1; font-size: 13.5px; margin: 0 0 12px; max-width: 640px; }
        .an-context-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .an-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px;
          font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.14); color: white;
        }
        .an-chip-outline { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #cbd5e1; }
        .an-header-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
        [dir="rtl"] .an-header-actions { align-items: flex-start; }
        .an-updated { font-size: 11px; color: #93c5fd; white-space: nowrap; }
        .an-refresh-btn {
          display: flex; align-items: center; gap: 7px; padding: 9px 16px; background: white; color: #1d4ed8;
          border: none; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
          white-space: nowrap;
        }
        .an-refresh-btn:hover:not(:disabled) { background: #eff6ff; }
        .an-refresh-btn:disabled { opacity: 0.7; cursor: default; }
        .spin { animation: an-spin 1s linear infinite; }
        @keyframes an-spin { to { transform: rotate(360deg); } }

        .an-filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .an-filter-field { display: flex; align-items: center; gap: 8px; }
        .an-filter-field label { font-size: 12.5px; font-weight: 700; color: #475569; }
        .an-filter-field select {
          padding: 9px 12px; border-radius: 9px; border: 1px solid #dbe4ef; font-size: 13.5px;
          color: #0f172a; background: white; cursor: pointer; min-width: 170px; font-family: inherit;
        }
        .an-filter-search {
          background: white; border: 1px solid #dbe4ef; border-radius: 9px; padding: 0 12px; min-width: 240px; color: #94a3b8;
        }
        .an-filter-search input {
          border: none; outline: none; padding: 10px 8px; font-size: 13.5px; width: 100%; color: #0f172a; font-family: inherit;
        }
        .an-reset-btn {
          padding: 9px 14px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 9px;
          font-size: 13px; font-weight: 700; color: #475569; cursor: pointer; font-family: inherit;
        }
        .an-reset-btn:hover { background: #e2e8f0; }

        .an-state-panel {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; padding: 60px 24px; background: white; border-radius: 16px;
          color: #64748b; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .an-error-panel { color: #b91c1c; }
        .an-retry-btn {
          display: flex; align-items: center; gap: 6px; padding: 8px 18px;
          background: #2563eb; color: white; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
        }

        .an-kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
        .an-kpi-card {
          display: flex; flex-direction: column; gap: 9px; padding: 16px 18px; text-align: start;
          background: white; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-top: 3px solid var(--accent, #94a3b8); cursor: pointer; font-family: inherit;
          transition: transform 0.15s, box-shadow 0.15s; min-width: 0;
        }
        .an-kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
        .an-kpi-icon {
          width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center;
          background: var(--bg, #f1f5f9); color: var(--accent, #64748b);
        }
        .an-kpi-value { font-size: 23px; font-weight: 800; color: #1e293b; line-height: 1; }
        .an-kpi-label { font-size: 12.5px; color: #64748b; font-weight: 600; }
        .an-kpi-sub { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .an-insights-section {
          background: white; border-radius: 16px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-inline-start: 4px solid #cbd5e1;
        }
        .an-insights-section.has-items { border-inline-start-color: #f59e0b; }
        .an-insights-section.all-clear { border-inline-start-color: #10b981; }
        .an-insights-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .an-insights-header h2 { font-size: 16px; font-weight: 800; color: #1e293b; margin: 0; }
        .an-insights-count { font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 20px; background: #fef3c7; color: #92400e; }
        .an-insights-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
        .an-insight-item {
          display: flex; align-items: flex-start; gap: 12px; padding: 13px 14px;
          background: #f8fafc; border-radius: 12px; text-align: start;
          border: 1px solid #eef2f7; border-inline-start: 3px solid transparent;
          width: 100%; cursor: default; font-family: inherit; transition: all 0.15s;
        }
        .an-insight-item.clickable { cursor: pointer; }
        .an-insight-item.clickable:hover { background: white; box-shadow: 0 4px 14px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .an-sev-error { border-inline-start-color: #ef4444; }
        .an-sev-warning { border-inline-start-color: #f59e0b; }
        .an-sev-info { border-inline-start-color: #3b82f6; }
        .an-insight-icon { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .an-sev-error .an-insight-icon { background: #fee2e2; color: #dc2626; }
        .an-sev-warning .an-insight-icon { background: #fef3c7; color: #d97706; }
        .an-sev-info .an-insight-icon { background: #dbeafe; color: #2563eb; }
        .an-insight-body { flex: 1; min-width: 0; }
        .an-insight-title { font-weight: 700; font-size: 13.5px; color: #1e293b; }
        .an-insight-desc { font-size: 12px; color: #64748b; margin-top: 3px; line-height: 1.4; }
        .an-empty-state {
          display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 22px 12px; color: #64748b;
        }
        .an-empty-state strong { color: #166534; font-size: 14.5px; }
        .an-empty-state span { font-size: 12.5px; max-width: 420px; }

        .an-section-card { background: white; border-radius: 16px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .an-section-card h2 { font-size: 16px; font-weight: 800; color: #1e293b; margin: 0 0 4px; }
        .an-section-sub { font-size: 12.5px; color: #94a3b8; margin: 0 0 16px; }

        .an-perf-block { margin-bottom: 16px; }
        .an-perf-block:last-child { margin-bottom: 0; }
        .an-perf-label-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
        .an-perf-label { font-size: 13.5px; font-weight: 700; color: #334155; }
        .an-perf-total { font-size: 12px; color: #94a3b8; }
        .an-progress-track { display: flex; width: 100%; height: 30px; border-radius: 8px; overflow: hidden; background: #f1f5f9; }
        .an-progress-segment { display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 700; white-space: nowrap; overflow: hidden; transition: width 0.3s; }
        .an-perf-legend { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
        .an-perf-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; }
        .an-perf-swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }

        .an-dim-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .an-dim-btn {
          padding: 8px 16px; border-radius: 999px; border: 1px solid #dbe4ef; background: white;
          color: #334155; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .an-dim-btn:hover { border-color: #93c5fd; }
        .an-dim-btn.active { background: #2563eb; border-color: #2563eb; color: white; box-shadow: 0 4px 12px rgba(37,99,235,0.25); }

        .an-no-data { display: flex; align-items: center; justify-content: center; padding: 40px 12px; color: #94a3b8; font-size: 13.5px; }

        .an-table-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        .an-table-count { font-size: 12.5px; color: #94a3b8; white-space: nowrap; }
        .an-table-wrap { overflow-x: auto; }
        .an-table { width: 100%; border-collapse: collapse; min-width: 640px; }
        .an-table th {
          padding: 11px 14px; text-align: start; color: #475569; font-size: 12.5px; font-weight: 800;
          white-space: nowrap; background: #f8fafc; cursor: pointer; user-select: none;
        }
        .an-table th .th-inner { display: inline-flex; align-items: center; gap: 4px; }
        .an-table td { padding: 11px 14px; text-align: start; color: #1e293b; font-size: 13px; white-space: nowrap; border-top: 1px solid #eef2f7; }
        .an-rate-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }

        .an-recent { background: #f8fafc; border: 1px solid #eef2f7; border-radius: 16px; padding: 16px 20px; }
        .an-recent h2 { font-size: 14px; font-weight: 800; color: #1e293b; margin: 0 0 12px; }
        .an-recent-list { display: flex; flex-wrap: wrap; gap: 10px; }
        .an-recent-item {
          display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: white;
          border-radius: 10px; border: 1px solid #eef2f7; flex: 1; min-width: 240px;
        }
        .an-recent-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: #dbeafe; color: #2563eb; }
        .an-recent-body { min-width: 0; }
        .an-recent-title { font-size: 12.5px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .an-recent-sub { font-size: 11.5px; color: #94a3b8; }

        @media (max-width: 1200px) {
          .an-kpi-row { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 900px) {
          .an-header { flex-direction: column; }
          .an-header-actions { align-items: stretch; width: 100%; }
          [dir="rtl"] .an-header-actions { align-items: stretch; }
        }
        @media (max-width: 640px) {
          .an-kpi-row { grid-template-columns: repeat(2, 1fr); }
          .an-insights-list { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function NoDataState({ text }) {
  return <div className="an-no-data">{text}</div>;
}

function PerformanceBar({ label, total, segments, language }) {
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

function InsightsPanel({ insights, language, navigate, t }) {
  return (
    <div className={`an-insights-section ${insights.length > 0 ? 'has-items' : 'all-clear'}`}>
      <div className="an-insights-header">
        <h2>{t.insightsTitle}</h2>
        {insights.length > 0 && <span className="an-insights-count">{insights.length}</span>}
      </div>
      {insights.length === 0 ? (
        <div className="an-empty-state">
          <CheckCircle2 size={30} color="#10b981" />
          <strong>{t.noInsights}</strong>
          <span>{t.noInsightsSub}</span>
        </div>
      ) : (
        <div className="an-insights-list">
          {insights.map((item) => {
            const clickable = Boolean(item.route);
            return (
              <button
                key={item.id}
                type="button"
                className={`an-insight-item an-sev-${item.severity} ${clickable ? 'clickable' : ''}`}
                onClick={clickable ? () => navigate(item.route) : undefined}
                disabled={!clickable}
              >
                <span className="an-insight-icon"><item.Icon size={17} /></span>
                <span className="an-insight-body">
                  <span className="an-insight-title">{language === 'he' ? item.titleHe : item.titleEn}</span>
                  <span className="an-insight-desc">{language === 'he' ? item.descHe : item.descEn}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailTable({ rows, sort, onSort, language, t }) {
  const columns = [
    { key: 'building', label: t.colBuilding },
    { key: 'region', label: t.colRegion },
    { key: 'total_beds', label: t.colTotal },
    { key: 'assigned', label: t.colAssigned },
    { key: 'available_beds', label: t.colAvailable },
    { key: 'occupancy_rate', label: t.colRate },
  ];

  const rateColor = (rate) => (rate >= 80 ? { bg: '#d1fae5', color: '#065f46' } : rate >= 40 ? { bg: '#dbeafe', color: '#1e40af' } : { bg: '#fef3c7', color: '#92400e' });

  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} onClick={() => onSort(col.key)}>
                <span className="th-inner">
                  {col.label}
                  {sort.key === col.key && (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((row, idx) => {
            const colors = rateColor(row.occupancy_rate);
            return (
              <tr key={`${row.building}-${idx}`}>
                <td>{row.building}</td>
                <td>{row.region}</td>
                <td>{formatNumber(row.total_beds, language)}</td>
                <td>{formatNumber(row.assigned, language)}</td>
                <td>{formatNumber(row.available_beds, language)}</td>
                <td><span className="an-rate-badge" style={{ background: colors.bg, color: colors.color }}>{row.occupancy_rate}%</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentDataActivity({ data, language, t, isHebrew }) {
  const batch = data?.latest_batch;
  const run = data?.latest_run;
  if (!batch && !run) return null;

  return (
    <div className="an-recent">
      <h2>{t.recentActivity}</h2>
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
              <span className="an-recent-title">{run.region_name || ''} — {run.status_display || run.status}</span>
              <span className="an-recent-sub">
                {t.latestRun} · {formatNumber(run.successful_assignments, language)} {isHebrew ? 'שיבוצים' : 'assignments'} · {formatTimestamp(run.completed_at || run.started_at, language)}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function buildInsights({
  summary, occupancyChartData, groupByRegion, latestRun,
  pendingRequests, unassignedStudents, priorityUnassigned, availableBeds, totalStudents,
  canRunAllocation, canAssignPriority, t, isHebrew,
}) {
  const insights = [];

  if (unassignedStudents > 0) {
    insights.push({
      id: 'unassigned', severity: 'warning', Icon: Users, route: '/students',
      titleHe: 'סטודנטים ללא שיבוץ', titleEn: 'Unassigned students',
      descHe: `${unassignedStudents} סטודנטים ממתינים כרגע לשיבוץ לחדר`,
      descEn: `${unassignedStudents} students are currently waiting for a room assignment`,
    });
  }

  if (priorityUnassigned > 0) {
    insights.push({
      id: 'priority-waiting', severity: 'warning', Icon: Star, route: canAssignPriority ? '/priority' : null,
      titleHe: 'סטודנטים עם בקשות מיוחדות ממתינים', titleEn: 'Special-request students waiting',
      descHe: `${priorityUnassigned} סטודנטים עם בקשה מיוחדת עדיין ללא שיבוץ`,
      descEn: `${priorityUnassigned} students with a special request are still unassigned`,
    });
  }

  if (pendingRequests > 0) {
    insights.push({
      id: 'pending-requests', severity: 'warning', Icon: ArrowLeftRight, route: '/transfers',
      titleHe: 'בקשות ממתינות לטיפול', titleEn: 'Pending requests',
      descHe: `${pendingRequests} בקשות סטודנטים ממתינות לסקירה`,
      descEn: `${pendingRequests} student requests are awaiting review`,
    });
  }

  if (latestRun && latestRun.status === 'failed') {
    insights.push({
      id: 'run-failed', severity: 'error', Icon: AlertTriangle, route: canRunAllocation ? '/allocation' : null,
      titleHe: 'הרצת שיבוץ אחרונה נכשלה', titleEn: 'Latest allocation run failed',
      descHe: latestRun.error_message || 'בדקו את פרטי ההרצה ונסו שוב',
      descEn: latestRun.error_message || 'Review the run details and try again',
    });
  }

  if (availableBeds > 0 && unassignedStudents > 0) {
    insights.push({
      id: 'capacity-vs-unassigned', severity: 'info', Icon: TrendingUp, route: canRunAllocation ? '/allocation' : null,
      titleHe: 'קיבולת פנויה זמינה', titleEn: 'Spare capacity available',
      descHe: `${availableBeds} מיטות פנויות בזמן ש-${unassignedStudents} סטודנטים ממתינים לשיבוץ`,
      descEn: `${availableBeds} beds are available while ${unassignedStudents} students remain unassigned`,
    });
  }

  if (occupancyChartData.length > 1) {
    const lowest = [...occupancyChartData].sort((a, b) => a.rate - b.rate)[0];
    const highest = [...occupancyChartData].sort((a, b) => b.rate - a.rate)[0];

    if (lowest && lowest.total > 0 && lowest.rate <= 25) {
      insights.push({
        id: 'lowest-occupancy', severity: 'info', Icon: TrendingDown, route: null,
        titleHe: groupByRegion ? 'אזור עם תפוסה נמוכה' : 'בניין עם תפוסה נמוכה',
        titleEn: groupByRegion ? 'Region with low occupancy' : 'Building with low occupancy',
        descHe: `"${lowest.name}" בתפוסה של ${lowest.rate}% בלבד (${lowest.assigned}/${lowest.total})`,
        descEn: `"${lowest.name}" is at only ${lowest.rate}% occupancy (${lowest.assigned}/${lowest.total})`,
      });
    }

    if (highest && highest.rate >= 95) {
      insights.push({
        id: 'highest-occupancy', severity: 'info', Icon: TrendingUp, route: null,
        titleHe: groupByRegion ? 'אזור בתפוסה כמעט מלאה' : 'בניין בתפוסה כמעט מלאה',
        titleEn: groupByRegion ? 'Region near full occupancy' : 'Building near full occupancy',
        descHe: `"${highest.name}" בתפוסה של ${highest.rate}% (${highest.assigned}/${highest.total})`,
        descEn: `"${highest.name}" is at ${highest.rate}% occupancy (${highest.assigned}/${highest.total})`,
      });
    }
  }

  const severityOrder = { error: 0, warning: 1, info: 2 };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return insights.slice(0, 6);
}

export default AnalysisPage;