// ---------------------------------------------------------------------------
// Pure helpers and deterministic business rules for the Analysis dashboard.
// No JSX here on purpose - keeps every threshold and calculation in one
// place that is easy to audit, instead of scattered magic numbers inside
// components. Every formula documented here must match what the backend
// actually computes (see backend/api/views.py::analysis_data).
// ---------------------------------------------------------------------------

// Named thresholds used by building/region status classification and by
// the Needs-Attention issue rules below. Centralised here instead of
// inlined so every "why is this flagged?" question has one place to look.
export const THRESHOLDS = Object.freeze({
  OCCUPANCY_FULL: 100,          // assigned >= capacity
  OCCUPANCY_NEARLY_FULL: 90,    // >= 90% is "about to run out of beds"
  OCCUPANCY_HEALTHY_MIN: 40,    // 40-89% with some assigned = healthy
  OCCUPANCY_UNDERUTILIZED_MAX: 30, // <= 30% (with some occupants) = underutilized
  REGION_HIGH_WAITING_RATE: 0.30,  // 30%+ of a region's students still waiting
  PENDING_REQUEST_STALE_DAYS: 3,   // a pending request open > 3 days is flagged
  RANKING_DEFAULT_SIZE: 12,        // buildings shown per ranking view
});

export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function locale(language) {
  return language === 'he' ? 'he-IL' : 'en-US';
}

export function formatNumber(value, language) {
  return num(value).toLocaleString(locale(language));
}

export function formatDecimal(value, language, maximumFractionDigits = 1) {
  return num(value).toLocaleString(locale(language), { maximumFractionDigits });
}

// `value` is already a 0-100 percentage (matches occupancy_rate as returned
// by the backend), not a 0-1 fraction.
export function formatPercent(value, language, maximumFractionDigits = 0) {
  const fraction = num(value) / 100;
  try {
    return fraction.toLocaleString(locale(language), {
      style: 'percent',
      maximumFractionDigits,
    });
  } catch {
    return `${Math.round(num(value))}%`;
  }
}

export function pct(part, whole) {
  const p = num(part);
  const w = num(whole);
  if (w <= 0) return 0;
  return Math.round((p / w) * 100);
}

export function formatTimestamp(iso, language, opts) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(locale(language), opts || {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function daysBetween(fromIso, toDate = new Date()) {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  const ms = toDate.getTime() - from.getTime();
  return Math.max(Math.floor(ms / 86400000), 0);
}

// Real pluralization, not string concatenation - avoids "1 ימים" / "1 days".
export function formatDaysPending(days, language) {
  const isHebrew = language === 'he';
  if (days === null || days === undefined) return '';
  if (days <= 0) return isHebrew ? 'פחות מיום' : 'less than a day';
  if (days === 1) return isHebrew ? 'יום אחד' : '1 day';
  if (isHebrew && days === 2) return 'יומיים';
  return isHebrew ? `${formatNumber(days, language)} ימים` : `${formatNumber(days, language)} days`;
}

// ---------------------------------------------------------------------------
// Building status classification - one rule set, reused by the ranking
// chart, the detail table, and any status badge, so a building can never
// show a different status in two places.
// ---------------------------------------------------------------------------
export const BUILDING_STATUS = Object.freeze({
  REVIEW: 'review',
  FULL: 'full',
  NEARLY_FULL: 'nearly_full',
  HEALTHY: 'healthy',
  UNDERUTILIZED: 'underutilized',
  // Reflects only that the building currently has zero active bed
  // assignments. The data model has no per-building waiting-demand field
  // (a Student only has a *region* before assignment, never a specific
  // building - see buildRegionRows below), so this status must never be
  // read or labeled as "no demand": there may well be waiting students who
  // simply haven't been assigned here yet.
  NO_ASSIGNMENTS: 'no_assignments',
});

export function classifyBuildingStatus(row) {
  const total = num(row.total_beds);
  const assigned = num(row.assigned);
  const rate = num(row.occupancy_rate);

  // Data-integrity anomalies (no active beds at all, or more students
  // assigned than physical capacity) always need a human look first.
  if (total === 0 || assigned > total) return BUILDING_STATUS.REVIEW;
  if (rate >= THRESHOLDS.OCCUPANCY_FULL) return BUILDING_STATUS.FULL;
  if (rate >= THRESHOLDS.OCCUPANCY_NEARLY_FULL) return BUILDING_STATUS.NEARLY_FULL;
  if (assigned === 0) return BUILDING_STATUS.NO_ASSIGNMENTS;
  if (rate <= THRESHOLDS.OCCUPANCY_UNDERUTILIZED_MAX) return BUILDING_STATUS.UNDERUTILIZED;
  return BUILDING_STATUS.HEALTHY;
}

export const BUILDING_STATUS_LABELS = {
  he: {
    [BUILDING_STATUS.REVIEW]: 'דורש בדיקה',
    [BUILDING_STATUS.FULL]: 'מלא',
    [BUILDING_STATUS.NEARLY_FULL]: 'כמעט מלא',
    [BUILDING_STATUS.HEALTHY]: 'תפוסה תקינה',
    [BUILDING_STATUS.UNDERUTILIZED]: 'תת-ניצול',
    [BUILDING_STATUS.NO_ASSIGNMENTS]: 'ללא שיבוצים נוכחיים',
  },
  en: {
    [BUILDING_STATUS.REVIEW]: 'Requires review',
    [BUILDING_STATUS.FULL]: 'Full',
    [BUILDING_STATUS.NEARLY_FULL]: 'Nearly full',
    [BUILDING_STATUS.HEALTHY]: 'Healthy occupancy',
    [BUILDING_STATUS.UNDERUTILIZED]: 'Underutilized',
    [BUILDING_STATUS.NO_ASSIGNMENTS]: 'No current assignments',
  },
};

export const BUILDING_STATUS_COLORS = {
  [BUILDING_STATUS.REVIEW]: { bg: '#f1f5f9', color: '#475569', dot: '#94a3b8' },
  [BUILDING_STATUS.FULL]: { bg: '#fee2e2', color: '#b91c1c', dot: '#dc2626' },
  [BUILDING_STATUS.NEARLY_FULL]: { bg: '#fef3c7', color: '#92400e', dot: '#d97706' },
  [BUILDING_STATUS.HEALTHY]: { bg: '#d1fae5', color: '#065f46', dot: '#059669' },
  [BUILDING_STATUS.UNDERUTILIZED]: { bg: '#dbeafe', color: '#1e40af', dot: '#2563eb' },
  [BUILDING_STATUS.NO_ASSIGNMENTS]: { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
};

// ---------------------------------------------------------------------------
// Region-level aggregation - joins occupancy_data (building/capacity side,
// keyed by the building's region) with students_by_region (demand side,
// keyed by the student's resolved region). Both ultimately key off the same
// Region.name field on the backend, so a plain name join is correct.
// ---------------------------------------------------------------------------
export function buildRegionRows(occupancyRows, studentsByRegion) {
  const capacityByRegion = {};
  occupancyRows.forEach((row) => {
    if (!row.region) return;
    if (!capacityByRegion[row.region]) {
      capacityByRegion[row.region] = { capacity: 0, assignedBeds: 0, buildings: 0 };
    }
    capacityByRegion[row.region].capacity += num(row.total_beds);
    capacityByRegion[row.region].assignedBeds += num(row.assigned);
    capacityByRegion[row.region].buildings += 1;
  });

  const regionNames = new Set([
    ...Object.keys(capacityByRegion),
    ...studentsByRegion.map((r) => r.region).filter(Boolean),
  ]);

  return [...regionNames].map((name) => {
    const cap = capacityByRegion[name] || { capacity: 0, assignedBeds: 0, buildings: 0 };
    const demand = studentsByRegion.find((r) => r.region === name) || { count: 0, assigned: 0, waiting: 0 };
    const available = Math.max(cap.capacity - cap.assignedBeds, 0);
    return {
      region: name,
      capacity: cap.capacity,
      assignedBeds: cap.assignedBeds,
      availableBeds: available,
      buildings: cap.buildings,
      students: num(demand.count),
      assignedStudents: num(demand.assigned),
      waiting: num(demand.waiting),
      occupancyRate: cap.capacity > 0 ? Math.round((cap.assignedBeds / cap.capacity) * 100) : 0,
      waitingRate: num(demand.count) > 0 ? demand.waiting / demand.count : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Needs-Attention issue detection - every entry here is a deterministic
// rule over real backend data. No fabricated numbers, no invented targets.
// `ctx` fields:
//   summary, occupancyRows, regionRows, latestRun, oldestPendingCreatedAt,
//   canRunAllocation, canAssignPriority, language
// ---------------------------------------------------------------------------
export function buildAttentionIssues(ctx) {
  const {
    summary, occupancyRows, regionRows, latestRun, oldestPendingCreatedAt,
    canRunAllocation, canAssignPriority, language,
  } = ctx;
  const isHebrew = language === 'he';
  const issues = [];

  const unassigned = num(summary.unassigned_students);
  const priorityUnassigned = num(summary.priority_unassigned_students);
  const pendingRequests = num(summary.pending_requests);
  const availableBeds = num(summary.available_beds);

  if (latestRun && latestRun.status === 'failed') {
    issues.push({
      id: 'run-failed',
      severity: 'critical',
      titleHe: 'הרצת שיבוץ אחרונה נכשלה',
      titleEn: 'Latest allocation run failed',
      descHe: latestRun.error_message || 'בדקו את פרטי ההרצה ונסו שוב.',
      descEn: latestRun.error_message || 'Review the run details and try again.',
      action: canRunAllocation ? { type: 'route', payload: '/allocation' } : null,
    });
  }

  // Region-level capacity shortage: a TRUE unmet-demand deficit, not merely
  // "the region happens to be busy". shortage = how many waiting students
  // exceed the beds still free in that region right now. Occupancy alone
  // (however high) never implies a shortage on its own - a region can be at
  // 95% occupancy with zero students waiting, which is not a shortage.
  regionRows
    .map((r) => ({ ...r, shortage: Math.max(r.waiting - r.availableBeds, 0) }))
    .filter((r) => r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage)
    .slice(0, 3)
    .forEach((r) => {
      issues.push({
        id: `region-shortage-${r.region}`,
        severity: 'critical',
        titleHe: 'מחסור בקיבולת באזור',
        titleEn: 'Capacity shortage in region',
        descHe: `באזור "${r.region}" חסרות ${formatNumber(r.shortage, language)} מיטות: ${formatNumber(r.waiting, language)} סטודנטים ממתינים מול ${formatNumber(r.availableBeds, language)} מיטות פנויות בלבד.`,
        descEn: `"${r.region}" is short ${formatNumber(r.shortage, language)} beds: ${formatNumber(r.waiting, language)} students waiting against only ${formatNumber(r.availableBeds, language)} beds available.`,
        action: { type: 'filter-region', payload: r.region, tab: 'occupancy' },
      });
    });

  // Region-level high-occupancy pressure: a SEPARATE, independent warning
  // from capacity shortage above - flags regions with little remaining
  // flexibility even when current demand happens to be fully met (no
  // waiting students yet). Deliberately does not require r.waiting > 0.
  regionRows
    .filter((r) => r.capacity > 0 && r.occupancyRate >= THRESHOLDS.OCCUPANCY_NEARLY_FULL)
    .sort((a, b) => b.occupancyRate - a.occupancyRate)
    .slice(0, 3)
    .forEach((r) => {
      issues.push({
        id: `region-high-occupancy-${r.region}`,
        severity: 'high',
        titleHe: 'תפוסה גבוהה באזור',
        titleEn: 'High occupancy pressure in region',
        descHe: `אזור "${r.region}" בתפוסה של ${r.occupancyRate}% - נותרו ${formatNumber(r.availableBeds, language)} מיטות פנויות בלבד.`,
        descEn: `"${r.region}" is at ${r.occupancyRate}% occupancy - only ${formatNumber(r.availableBeds, language)} beds remain available.`,
        action: { type: 'filter-region', payload: r.region, tab: 'occupancy' },
      });
    });

  if (priorityUnassigned > 0) {
    issues.push({
      id: 'priority-waiting',
      severity: 'high',
      titleHe: 'סטודנטים עם בקשות מיוחדות ממתינים',
      titleEn: 'Special-request students waiting',
      descHe: `${formatNumber(priorityUnassigned, language)} סטודנטים עם בקשה מיוחדת עדיין ללא שיבוץ.`,
      descEn: `${formatNumber(priorityUnassigned, language)} students with a special request are still unassigned.`,
      action: canAssignPriority ? { type: 'route', payload: '/priority' } : null,
    });
  }

  if (oldestPendingCreatedAt) {
    const days = daysBetween(oldestPendingCreatedAt);
    if (days !== null && days >= THRESHOLDS.PENDING_REQUEST_STALE_DAYS) {
      issues.push({
        id: 'stale-requests',
        severity: 'high',
        titleHe: 'בקשות ממתינות זמן רב',
        titleEn: 'Requests pending for a long time',
        descHe: `${formatNumber(pendingRequests, language)} בקשות ממתינות לטיפול; הוותיקה שבהן ממתינה כבר ${formatDaysPending(days, language)}.`,
        descEn: `${formatNumber(pendingRequests, language)} requests are awaiting review; the oldest has been waiting ${formatDaysPending(days, language)}.`,
        action: { type: 'route', payload: '/transfers' },
      });
    }
  }

  // Regions with an unusually high share of their own students still
  // waiting - a third, independent pressure signal (deliberately not gated
  // on occupancy) alongside capacity shortage and high occupancy above:
  // a region can have a high waiting *rate* even while overall occupancy
  // looks moderate, e.g. because a lot of its capacity sits in a different
  // housing-type mix than what the waiting students need.
  regionRows
    .filter((r) => r.students > 0 && r.waitingRate >= THRESHOLDS.REGION_HIGH_WAITING_RATE)
    .sort((a, b) => b.waitingRate - a.waitingRate)
    .slice(0, 3)
    .forEach((r) => {
      const ratePct = Math.round(r.waitingRate * 100);
      issues.push({
        id: `region-high-waiting-${r.region}`,
        severity: 'medium',
        titleHe: 'שיעור המתנה גבוה באזור',
        titleEn: 'High waiting rate in region',
        descHe: `${ratePct}% מהסטודנטים באזור "${r.region}" (${formatNumber(r.waiting, language)} מתוך ${formatNumber(r.students, language)}) עדיין ממתינים לשיבוץ.`,
        descEn: `${ratePct}% of students in "${r.region}" (${formatNumber(r.waiting, language)} of ${formatNumber(r.students, language)}) are still waiting for assignment.`,
        action: { type: 'filter-region', payload: r.region, tab: 'occupancy' },
      });
    });

  if (unassigned > 0) {
    issues.push({
      id: 'unassigned',
      severity: 'medium',
      titleHe: 'סטודנטים ללא שיבוץ',
      titleEn: 'Unassigned students',
      descHe: `${formatNumber(unassigned, language)} סטודנטים ממתינים כרגע לשיבוץ לחדר.`,
      descEn: `${formatNumber(unassigned, language)} students are currently waiting for a room assignment.`,
      action: { type: 'route', payload: '/students' },
    });
  }

  if (pendingRequests > 0) {
    issues.push({
      id: 'pending-requests',
      severity: 'medium',
      titleHe: 'בקשות ממתינות לטיפול',
      titleEn: 'Pending requests',
      descHe: `${formatNumber(pendingRequests, language)} בקשות סטודנטים ממתינות לסקירה.`,
      descEn: `${formatNumber(pendingRequests, language)} student requests are awaiting review.`,
      action: { type: 'route', payload: '/transfers' },
    });
  }

  // Buildings with real free capacity but zero current bed assignments - a
  // concrete, actionable gap (not just "low occupancy"). Phrased as "no
  // allocations", never "no demand": whether anyone actually wants to live
  // there is not something this data model can tell us per building.
  const emptyWithCapacity = occupancyRows.filter((r) => num(r.total_beds) > 0 && num(r.assigned) === 0);
  if (emptyWithCapacity.length > 0) {
    const totalFreeBeds = emptyWithCapacity.reduce((sum, r) => sum + num(r.total_beds), 0);
    issues.push({
      id: 'empty-buildings',
      severity: 'medium',
      titleHe: 'בניינים עם קיבולת פנויה ללא שיבוצים',
      titleEn: 'Buildings with free capacity and no allocations',
      descHe: `${formatNumber(emptyWithCapacity.length, language)} בניינים (סה"כ ${formatNumber(totalFreeBeds, language)} מיטות) ללא סטודנט משובץ אחד.`,
      descEn: `${formatNumber(emptyWithCapacity.length, language)} buildings (${formatNumber(totalFreeBeds, language)} beds total) have not a single student assigned.`,
      action: { type: 'table-filter', payload: { status: BUILDING_STATUS.NO_ASSIGNMENTS } },
    });
  }

  if (availableBeds > 0 && unassigned > 0) {
    issues.push({
      id: 'capacity-vs-unassigned',
      severity: 'info',
      titleHe: 'קיבולת פנויה זמינה',
      titleEn: 'Spare capacity available',
      descHe: `${formatNumber(availableBeds, language)} מיטות פנויות בזמן ש-${formatNumber(unassigned, language)} סטודנטים ממתינים לשיבוץ.`,
      descEn: `${formatNumber(availableBeds, language)} beds are available while ${formatNumber(unassigned, language)} students remain unassigned.`,
      action: canRunAllocation ? { type: 'route', payload: '/allocation' } : null,
    });
  }

  const severityOrder = { critical: 0, high: 1, medium: 2, info: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Occupancy ranking view modes - only options backed by real per-building
// data (no fabricated "largest shortage" at building granularity, since
// waiting demand is not known per-building - only per-region).
// ---------------------------------------------------------------------------
export const RANKING_VIEWS = Object.freeze({
  HIGHEST: 'highest',
  LOWEST: 'lowest',
  MOST_AVAILABLE: 'most_available',
});

export function sortForRankingView(rows, view) {
  const sorted = [...rows];
  switch (view) {
    case RANKING_VIEWS.LOWEST:
      return sorted.sort((a, b) => num(a.occupancy_rate) - num(b.occupancy_rate));
    case RANKING_VIEWS.MOST_AVAILABLE:
      return sorted.sort((a, b) => num(b.available_beds) - num(a.available_beds));
    case RANKING_VIEWS.HIGHEST:
    default:
      return sorted.sort((a, b) => num(b.occupancy_rate) - num(a.occupancy_rate));
  }
}
