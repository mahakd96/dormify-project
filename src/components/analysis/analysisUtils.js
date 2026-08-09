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
  TOP_URGENT_BUILDINGS: 10,        // buildings shown in the collapsed "requires attention" table
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

// A building counts as "critical" for the KPI/urgency-ranking purposes when
// it needs a human decision soon: a genuine data anomaly, full, or about to
// run out of beds. "No current assignments" / "underutilized" are not
// critical on their own - they're worth reviewing but are not urgent in the
// same sense (see the KPI card's definition tooltip).
const CRITICAL_BUILDING_STATUSES = new Set([
  BUILDING_STATUS.REVIEW, BUILDING_STATUS.FULL, BUILDING_STATUS.NEARLY_FULL,
]);

export function isCriticalBuildingStatus(statusKey) {
  return CRITICAL_BUILDING_STATUSES.has(statusKey);
}

export function countCriticalBuildings(occupancyRows) {
  return occupancyRows.filter((row) => isCriticalBuildingStatus(classifyBuildingStatus(row))).length;
}

// Urgency ranking for the "Buildings Requiring Attention" table - a data
// anomaly outranks a full building, which outranks a nearly-full one, and so
// on; occupancy rate breaks ties within the same status. Deliberately does
// NOT try to rank by waiting demand at building granularity - the data model
// only knows waiting demand per region (see buildRegionRows below), so
// inventing a per-building waiting number here would violate the "never
// fake a metric the data can't support" rule.
const BUILDING_URGENCY_WEIGHT = {
  [BUILDING_STATUS.REVIEW]: 5,
  [BUILDING_STATUS.FULL]: 4,
  [BUILDING_STATUS.NEARLY_FULL]: 3,
  [BUILDING_STATUS.NO_ASSIGNMENTS]: 1,
  [BUILDING_STATUS.UNDERUTILIZED]: 0,
  [BUILDING_STATUS.HEALTHY]: 0,
};

export function computeBuildingUrgency(row) {
  const statusKey = classifyBuildingStatus(row);
  return (BUILDING_URGENCY_WEIGHT[statusKey] || 0) * 1000 + num(row.occupancy_rate);
}

// ---------------------------------------------------------------------------
// Region ("district") health status - considers more than occupancy alone,
// per the dashboard's design brief: a real unmet-demand deficit outranks
// "merely busy", which outranks "no beds free relative to waiting share",
// which outranks a case with no signal to be worried about.
// ---------------------------------------------------------------------------
export const REGION_STATUS = Object.freeze({
  SHORTAGE: 'shortage',           // real deficit: waiting > available beds right now
  HIGH_PRESSURE: 'high_pressure', // occupancy >= 90%, little slack even if demand is met today
  ELEVATED_WAITING: 'elevated_waiting', // 30%+ of the region's own students still waiting
  HEALTHY: 'healthy',
  UNDERUTILIZED: 'underutilized',
  NO_DATA: 'no_data',
});

export function classifyRegionStatus(row) {
  if (row.capacity <= 0 && row.students <= 0) return REGION_STATUS.NO_DATA;
  const shortage = Math.max(num(row.waiting) - num(row.availableBeds), 0);
  if (shortage > 0) return REGION_STATUS.SHORTAGE;
  if (row.capacity > 0 && row.occupancyRate >= THRESHOLDS.OCCUPANCY_NEARLY_FULL) return REGION_STATUS.HIGH_PRESSURE;
  if (row.students > 0 && row.waitingRate >= THRESHOLDS.REGION_HIGH_WAITING_RATE) return REGION_STATUS.ELEVATED_WAITING;
  if (row.capacity > 0 && row.occupancyRate <= THRESHOLDS.OCCUPANCY_UNDERUTILIZED_MAX) return REGION_STATUS.UNDERUTILIZED;
  return REGION_STATUS.HEALTHY;
}

export const REGION_STATUS_LABELS = {
  he: {
    [REGION_STATUS.SHORTAGE]: 'מחסור בקיבולת',
    [REGION_STATUS.HIGH_PRESSURE]: 'לחץ תפוסה גבוה',
    [REGION_STATUS.ELEVATED_WAITING]: 'שיעור המתנה גבוה',
    [REGION_STATUS.HEALTHY]: 'תקין',
    [REGION_STATUS.UNDERUTILIZED]: 'תת-ניצול',
    [REGION_STATUS.NO_DATA]: 'אין נתונים',
  },
  en: {
    [REGION_STATUS.SHORTAGE]: 'Capacity shortage',
    [REGION_STATUS.HIGH_PRESSURE]: 'High occupancy pressure',
    [REGION_STATUS.ELEVATED_WAITING]: 'Elevated waiting rate',
    [REGION_STATUS.HEALTHY]: 'Healthy',
    [REGION_STATUS.UNDERUTILIZED]: 'Underutilized',
    [REGION_STATUS.NO_DATA]: 'No data',
  },
};

export const REGION_STATUS_COLORS = {
  [REGION_STATUS.SHORTAGE]: { bg: '#fee2e2', color: '#b91c1c', dot: '#dc2626' },
  [REGION_STATUS.HIGH_PRESSURE]: { bg: '#ffedd5', color: '#c2410c', dot: '#f97316' },
  [REGION_STATUS.ELEVATED_WAITING]: { bg: '#fef3c7', color: '#92400e', dot: '#d97706' },
  [REGION_STATUS.HEALTHY]: { bg: '#d1fae5', color: '#065f46', dot: '#059669' },
  [REGION_STATUS.UNDERUTILIZED]: { bg: '#dbeafe', color: '#1e40af', dot: '#2563eb' },
  [REGION_STATUS.NO_DATA]: { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
};

// ---------------------------------------------------------------------------
// Region-level aggregation - joins occupancy_data (building/capacity side,
// keyed by the building's region) with students_by_region (demand side,
// keyed by the student's resolved region) and requests_by_region (pending
// special requests, attributed - see backend comments). All three key off
// the same Region.name field on the backend, so a plain name join is
// correct. Also derives, per region, how many of its buildings are
// currently Full - a concrete operational signal District Health uses
// alongside occupancy/waiting to decide status (see classifyRegionStatus).
// ---------------------------------------------------------------------------
export function buildRegionRows(occupancyRows, studentsByRegion, requestsByRegion = []) {
  const capacityByRegion = {};
  occupancyRows.forEach((row) => {
    if (!row.region) return;
    if (!capacityByRegion[row.region]) {
      capacityByRegion[row.region] = {
        capacity: 0, assignedBeds: 0, buildings: 0, fullBuildings: 0,
      };
    }
    const bucket = capacityByRegion[row.region];
    bucket.capacity += num(row.total_beds);
    bucket.assignedBeds += num(row.assigned);
    bucket.buildings += 1;
    if (classifyBuildingStatus(row) === BUILDING_STATUS.FULL) bucket.fullBuildings += 1;
  });

  const requestsByRegionMap = {};
  requestsByRegion.forEach((r) => {
    if (r.region) requestsByRegionMap[r.region] = num(r.count);
  });

  const regionNames = new Set([
    ...Object.keys(capacityByRegion),
    ...studentsByRegion.map((r) => r.region).filter(Boolean),
  ]);

  return [...regionNames].map((name) => {
    const cap = capacityByRegion[name] || {
      capacity: 0, assignedBeds: 0, buildings: 0, fullBuildings: 0,
    };
    const demand = studentsByRegion.find((r) => r.region === name) || { count: 0, assigned: 0, waiting: 0 };
    const available = Math.max(cap.capacity - cap.assignedBeds, 0);
    const row = {
      region: name,
      capacity: cap.capacity,
      assignedBeds: cap.assignedBeds,
      availableBeds: available,
      buildings: cap.buildings,
      fullBuildings: cap.fullBuildings,
      students: num(demand.count),
      assignedStudents: num(demand.assigned),
      waiting: num(demand.waiting),
      pendingRequests: requestsByRegionMap[name] || 0,
      occupancyRate: cap.capacity > 0 ? Math.round((cap.assignedBeds / cap.capacity) * 100) : 0,
      waitingRate: num(demand.count) > 0 ? demand.waiting / demand.count : 0,
    };
    row.statusKey = classifyRegionStatus(row);
    return row;
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
        action: { type: 'filter-region', payload: r.region, target: 'district' },
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
        action: { type: 'filter-region', payload: r.region, target: 'district' },
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
        action: { type: 'filter-region', payload: r.region, target: 'district' },
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
// Recommended Actions - converts the same real signals used by the
// Attention Queue into forward-looking, imperative next steps rather than
// problem statements. Deliberately phrased differently from the matching
// issue ("what's wrong" vs. "what to do about it") and deliberately never
// claims two regions/students are "compatible" - only that reviewing them
// together may be worthwhile, since compatibility is a business-logic
// decision this dashboard does not make. Every action links to an existing
// page/workflow; nothing here performs an allocation automatically.
// ---------------------------------------------------------------------------
export function buildRecommendedActions(ctx) {
  const {
    summary, regionRows, occupancyRows, latestBatch,
    canRunAllocation, canAssignPriority, language,
  } = ctx;
  const actions = [];

  const unassigned = num(summary.unassigned_students);
  const priorityUnassigned = num(summary.priority_unassigned_students);
  const pendingRequests = num(summary.pending_requests);
  const availableBeds = num(summary.available_beds);

  // 1. Cross-region comparison: a region genuinely short on beds while a
  // different region has real spare capacity and no shortage of its own -
  // both numbers come straight from regionRows, no invented "compatible"
  // claim, just a suggestion to review.
  const shortageRegions = regionRows
    .map((r) => ({ ...r, shortage: Math.max(r.waiting - r.availableBeds, 0) }))
    .filter((r) => r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage);
  const spareRegion = [...regionRows]
    .filter((r) => r.availableBeds > 0 && Math.max(r.waiting - r.availableBeds, 0) === 0)
    .sort((a, b) => b.availableBeds - a.availableBeds)[0];
  if (shortageRegions.length > 0 && spareRegion && spareRegion.region !== shortageRegions[0].region) {
    const short = shortageRegions[0];
    actions.push({
      id: 'compare-regions',
      titleHe: 'בדקו הפניית קיבולת בין אזורים',
      titleEn: 'Review spare capacity across regions',
      descHe: `באזור "${short.region}" חסרות ${formatNumber(short.shortage, language)} מיטות, בעוד באזור "${spareRegion.region}" יש ${formatNumber(spareRegion.availableBeds, language)} מיטות פנויות. שווה לבדוק אם ניתן להפנות חלק מהביקוש - בכפוף לכללי ההתאמה הקיימים.`,
      descEn: `"${short.region}" is short ${formatNumber(short.shortage, language)} beds, while "${spareRegion.region}" has ${formatNumber(spareRegion.availableBeds, language)} beds available. Worth reviewing whether some demand can be redirected there, subject to the existing matching rules.`,
      ctaHe: 'לצפייה בבניינים', ctaEn: 'View buildings',
      action: { type: 'filter-region', payload: short.region, target: 'district' },
    });
  }

  // 2. Special-request backlog.
  if (priorityUnassigned > 0) {
    actions.push({
      id: 'review-priority',
      titleHe: 'סקרו סטודנטים עם בקשות מיוחדות שממתינים',
      titleEn: 'Review waiting special-request students',
      descHe: `${formatNumber(priorityUnassigned, language)} סטודנטים עם בקשה מיוחדת עדיין ללא שיבוץ - מומלץ לתעדף את הטיפול בהם.`,
      descEn: `${formatNumber(priorityUnassigned, language)} special-request students remain unassigned - prioritizing them is recommended.`,
      ctaHe: 'לפתיחת מסך העדיפויות', ctaEn: 'Open priority workflow',
      action: canAssignPriority ? { type: 'route', payload: '/priority' } : null,
    });
  }

  // 3. General pending-requests backlog (only if not already the dominant
  // signal above, to avoid two near-identical cards).
  if (pendingRequests > 0 && priorityUnassigned === 0) {
    actions.push({
      id: 'review-requests',
      titleHe: 'פתחו את הבקשות הממתינות לסקירה',
      titleEn: 'Open the pending requests for review',
      descHe: `${formatNumber(pendingRequests, language)} בקשות סטודנט ממתינות לאישור או דחייה.`,
      descEn: `${formatNumber(pendingRequests, language)} student requests are awaiting approval or rejection.`,
      ctaHe: 'לצפייה בבקשות', ctaEn: 'View requests',
      action: { type: 'route', payload: '/transfers' },
    });
  }

  // 4. Spare capacity sitting idle while students wait - the operational
  // fix is to run/continue the allocation workflow, not to allocate here.
  if (availableBeds > 0 && unassigned > 0) {
    actions.push({
      id: 'run-allocation',
      titleHe: 'הריצו שיבוץ עבור סטודנטים ממתינים',
      titleEn: 'Run allocation for waiting students',
      descHe: `יש ${formatNumber(availableBeds, language)} מיטות פנויות ו-${formatNumber(unassigned, language)} סטודנטים ממתינים - פתחו את מסך השיבוץ לבדיקת התאמות אפשריות.`,
      descEn: `${formatNumber(availableBeds, language)} beds are free while ${formatNumber(unassigned, language)} students wait - open the allocation workflow to check possible matches.`,
      ctaHe: 'לפתיחת מסך השיבוץ', ctaEn: 'Open allocation workflow',
      action: canRunAllocation ? { type: 'route', payload: '/allocation' } : null,
    });
  }

  // 5. Buildings with free capacity but zero current assignments - worth a
  // manual look (import/placement gap), not necessarily "no demand".
  const emptyWithCapacity = occupancyRows.filter((r) => num(r.total_beds) > 0 && num(r.assigned) === 0);
  if (emptyWithCapacity.length > 0 && actions.length < 4) {
    actions.push({
      id: 'review-empty-buildings',
      titleHe: 'בדקו בניינים עם קיבולת פנויה ללא שיבוצים',
      titleEn: 'Review buildings with capacity but no assignments',
      descHe: `${formatNumber(emptyWithCapacity.length, language)} בניינים עם מיטות פעילות אך ללא סטודנט משובץ אחד - כדאי לוודא שאין פער בייבוא הנתונים או בתהליך השיבוץ.`,
      descEn: `${formatNumber(emptyWithCapacity.length, language)} buildings have active beds but not a single assigned student - worth confirming there is no data-import or placement gap.`,
      ctaHe: 'לצפייה בבניינים', ctaEn: 'View buildings',
      action: { type: 'table-filter', payload: { status: BUILDING_STATUS.NO_ASSIGNMENTS } },
    });
  }

  // 6. Stale data source - a real, checkable freshness signal (batch age),
  // never a guess about data quality.
  if (latestBatch?.created_at) {
    const ageDays = daysBetween(latestBatch.created_at);
    if (ageDays !== null && ageDays >= 14 && actions.length < 4) {
      actions.push({
        id: 'stale-data',
        titleHe: 'בדקו את עדכניות הנתונים',
        titleEn: 'Check data freshness',
        descHe: `קובץ הנתונים האחרון הועלה לפני ${formatDaysPending(ageDays, language)}. אם קיים קובץ מעודכן יותר, מומלץ להעלות אותו.`,
        descEn: `The latest data file was uploaded ${formatDaysPending(ageDays, language)} ago. If a more recent file exists, uploading it is recommended.`,
        ctaHe: 'למידע על מקורות הנתונים', ctaEn: 'View data sources',
        action: { type: 'switch-tab', payload: 'quality' },
      });
    }
  }

  return actions.slice(0, 4);
}

// ---------------------------------------------------------------------------
// A single, fully data-derived sentence under the Capacity Pressure chart -
// never a prediction, always a plain description of what the current
// numbers show (per the brief: "any automatic written insight must be
// fully derived from actual data").
// ---------------------------------------------------------------------------
export function buildPressureInsight(regionRows, language) {
  const rows = regionRows.filter((r) => r.capacity > 0 || r.students > 0);
  if (rows.length < 2) return null;
  const isHebrew = language === 'he';

  const shortageCount = rows.filter((r) => r.waiting > Math.max(r.availableBeds, 0)).length;
  const mostPressured = [...rows].sort((a, b) => (b.waiting - b.availableBeds) - (a.waiting - a.availableBeds))[0];
  const mostSpare = [...rows].sort((a, b) => b.availableBeds - a.availableBeds)[0];

  if (shortageCount > 0) {
    return isHebrew
      ? `${formatNumber(shortageCount, language)} מתוך ${formatNumber(rows.length, language)} אזורים מציגים ביקוש ממתין גבוה מהקיבולת הפנויה שלהם - "${mostPressured.region}" הכי בולט מביניהם.`
      : `${formatNumber(shortageCount, language)} of ${formatNumber(rows.length, language)} districts show waiting demand higher than their available capacity - "${mostPressured.region}" stands out most.`;
  }
  if (mostSpare && mostSpare.availableBeds > 0) {
    return isHebrew
      ? `אין כרגע מחסור אמיתי באף אזור. "${mostSpare.region}" מחזיק את מירב הקיבולת הפנויה (${formatNumber(mostSpare.availableBeds, language)} מיטות).`
      : `No district currently shows a real shortage. "${mostSpare.region}" holds the most available capacity (${formatNumber(mostSpare.availableBeds, language)} beds).`;
  }
  return null;
}

