import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { allocationAPI, inboxAPI } from '../services/api';
import {
  Play,
  Square,
  Trash2,
  RefreshCw,
  Loader,
  Check,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Users,
  Home,
  Lock,
  Bell,
  Calendar,
  BarChart3,
  ShieldCheck,
  SlidersHorizontal,
  Clock,
  Mail,
  Building2,
  Activity,
  ExternalLink,
  Info,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StatusBadge({ statusKey, t }) {
  const config = {
    not_started: { label: t.statusNotStarted, cls: 'badge-gray', dot: false },
    queued:      { label: t.statusQueued,      cls: 'badge-blue', dot: true },
    running:     { label: t.statusRunning,     cls: 'badge-blue', dot: true, pulse: true },
    cancellation_requested: { label: t.statusStopping, cls: 'badge-amber', dot: true, pulse: true },
    stopped:     { label: t.statusStopped,    cls: 'badge-gray', dot: false },
    completed:   { label: t.statusCompleted,  cls: 'badge-green', dot: false },
    failed:      { label: t.statusFailed,     cls: 'badge-red', dot: false },
    deleted:     { label: t.statusDeleted,    cls: 'badge-gray', dot: false },
  };
  const c = config[statusKey] || config.not_started;
  return (
    <span className={`ap-status-badge ${c.cls}`}>
      {c.dot && <span className={`ap-badge-dot${c.pulse ? ' ap-badge-dot-pulse' : ''}`} />}
      {c.label}
    </span>
  );
}

function ToastNotification({ toast }) {
  if (!toast) return null;
  const icons = {
    success: <Check size={15} />,
    error:   <XCircle size={15} />,
    info:    <Info size={15} />,
    warning: <AlertTriangle size={15} />,
  };
  return (
    <div className={`ap-toast ap-toast-${toast.type}`} role="alert" aria-live="polite">
      <span className="ap-toast-icon">{icons[toast.type] || icons.info}</span>
      <span className="ap-toast-msg">{toast.message}</span>
    </div>
  );
}

function ConfirmDialog({ modal, t, onClose }) {
  if (!modal) return null;
  return (
    <div className="ap-modal-overlay" role="dialog" aria-modal="true">
      <div className="ap-modal-box">
        <h3 className="ap-modal-title">{modal.title}</h3>
        <p className="ap-modal-body">{modal.message}</p>
        <div className="ap-modal-actions">
          <button className="ap-modal-cancel" onClick={onClose}>{t.cancel}</button>
          <button className="ap-modal-confirm" onClick={modal.onConfirm}>{t.confirm}</button>
        </div>
      </div>
    </div>
  );
}

function InventoryTypeRow({ typeKey, label, item, expandedType, onToggle, t }) {
  const total = item.total_beds || 0;
  const available = item.available_beds || 0;
  const occupied = item.occupied_beds || 0;
  const occupancyPct = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
  const isExpanded = expandedType === typeKey;

  return (
    <div className="ap-inv-row">
      <button
        className="ap-inv-row-header"
        onClick={() => onToggle(typeKey)}
        aria-expanded={isExpanded}
      >
        <div className="ap-inv-row-left">
          <span className="ap-inv-type-icon">
            <Home size={15} />
          </span>
          <span className="ap-inv-type-name">{label}</span>
        </div>
        <div className="ap-inv-row-right">
          <div className="ap-inv-quick-stats">
            <span className="ap-inv-quick-stat available">
              <strong>{available}</strong> {t.freeBedsLabel}
            </span>
            <span className="ap-inv-sep">·</span>
            <span className="ap-inv-quick-stat">{occupancyPct}% {t.occupied}</span>
          </div>
          <div className="ap-inv-progress-mini">
            <div
              className="ap-inv-progress-fill"
              style={{ width: `${occupancyPct}%` }}
            />
          </div>
          <span className="ap-inv-chevron">
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="ap-inv-expanded">
          <div className="ap-inv-metrics-grid">
            <div className="ap-inv-metric">
              <div className="ap-inv-metric-val">{item.apartments || 0}</div>
              <div className="ap-inv-metric-lbl">{t.apartmentsLabel}</div>
            </div>
            <div className="ap-inv-metric">
              <div className="ap-inv-metric-val">{item.rooms || 0}</div>
              <div className="ap-inv-metric-lbl">{t.roomsLabel}</div>
            </div>
            <div className="ap-inv-metric">
              <div className="ap-inv-metric-val">{total}</div>
              <div className="ap-inv-metric-lbl">{t.totalBedsLabel}</div>
            </div>
            <div className="ap-inv-metric ap-inv-metric-highlight">
              <div className="ap-inv-metric-val">{available}</div>
              <div className="ap-inv-metric-lbl">{t.freeBedsLabel}</div>
            </div>
            <div className="ap-inv-metric">
              <div className="ap-inv-metric-val">{occupied}</div>
              <div className="ap-inv-metric-lbl">{t.occupiedBeds}</div>
            </div>
            <div className="ap-inv-metric">
              <div className="ap-inv-metric-val ap-inv-metric-pct">{occupancyPct}%</div>
              <div className="ap-inv-metric-lbl">{t.occupancyPct}</div>
            </div>
          </div>
          <div className="ap-inv-occ-bar-wrap">
            <div className="ap-inv-occ-bar">
              <div
                className="ap-inv-occ-fill"
                style={{ width: `${occupancyPct}%` }}
                title={`${occupancyPct}% occupied`}
              />
            </div>
            <span className="ap-inv-occ-label">{occupancyPct}% {t.occupied}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CriticalConditionCard({ condKey, t }) {
  return (
    <div className="ap-cond-card ap-cond-critical">
      <div className="ap-cond-icon-wrap ap-cond-icon-critical">
        <Lock size={13} />
      </div>
      <div className="ap-cond-body">
        <div className="ap-cond-name">{t[condKey] || condKey}</div>
        {t[`${condKey}Desc`] && (
          <div className="ap-cond-desc">{t[`${condKey}Desc`]}</div>
        )}
        <div className="ap-cond-meta">
          <span className="ap-cond-badge ap-cond-badge-critical">
            <ShieldCheck size={11} /> {t.hardConstraint}
          </span>
          <span className="ap-cond-always">{t.alwaysApplied}</span>
        </div>
      </div>
    </div>
  );
}

function FlexibleConditionCard({ condKey, value, t, onToggle, onWeightChange }) {
  return (
    <div className={`ap-cond-card ap-cond-flexible${!value.enabled ? ' ap-cond-off' : ''}`}>
      <div className="ap-cond-flex-top">
        <div className="ap-cond-icon-wrap ap-cond-icon-flex">
          <SlidersHorizontal size={13} />
        </div>
        <div className="ap-cond-body">
          <div className="ap-cond-name">{t[condKey] || condKey}</div>
          {t[`${condKey}Desc`] && (
            <div className="ap-cond-desc">{t[`${condKey}Desc`]}</div>
          )}
          <span className={`ap-cond-status-chip${value.enabled ? ' ap-cond-status-on' : ''}`}>
            {value.enabled ? t.included : t.excluded}
          </span>
        </div>
        <button
          type="button"
          className={`ap-switch${value.enabled ? ' ap-switch-on' : ''}`}
          role="switch"
          aria-checked={value.enabled}
          aria-label={`${t[condKey] || condKey}: ${value.enabled ? t.included : t.excluded}`}
          onClick={() => onToggle(condKey)}
        >
          <span className="ap-switch-thumb" />
        </button>
      </div>

      {value.enabled && (
        <div className="ap-cond-weight">
          <div className="ap-cond-weight-header">
            <span className="ap-cond-weight-lbl">{t.importance}</span>
            <span className="ap-cond-weight-val">{value.weight}/10</span>
          </div>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={value.weight}
            className="ap-range"
            aria-label={`${t.importance}: ${t[condKey] || condKey}`}
            onChange={(e) => onWeightChange(condKey, e.target.value)}
          />
          <div className="ap-range-scale">
            <span>0</span>
            <span>10</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

function AllocationPage({ language = 'he' }) {
  const navigate = useNavigate();
  const { isCentralAdmin, getUserRegion, canRunAllocation } = useAuth();

  const central = typeof isCentralAdmin === 'function' ? isCentralAdmin() === true : false;

  // ── Core State ──────────────────────────────
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [summary, setSummary]     = useState(null);
  const [inboxItem, setInboxItem] = useState(null);

  // ── Run State ───────────────────────────────
  const [isRunning, setIsRunning]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [result, setResult]         = useState(null);
  const [runId, setRunId]           = useState(null);
  const [runStatus, setRunStatus]   = useState(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── UI State ────────────────────────────────
  const [confirmModal, setConfirmModal] = useState(null);
  const [toast, setToast]               = useState(null);
  const [expandedType, setExpandedType] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Constraints State ────────────────────────
  const [constraints, setConstraints] = useState({
    sameGender:             { enabled: true, strict: true,  critical: true,  weight: 0 },
    priorityFirst:          { enabled: true, strict: true,  critical: true,  weight: 0 },
    roommatePositiveOnly:   { enabled: true, strict: true,  critical: true,  weight: 0 },
    ReligiousTogether:      { enabled: true, strict: true,  critical: true,  weight: 0 },
    sameReligion:           { enabled: true, strict: false, critical: false, weight: 6 },
    roommateMatch:          { enabled: true, strict: false, critical: false, weight: 8 },
    sectorMatching:         { enabled: true, strict: false, critical: false, weight: 7 },
    avoidYearMix_1_with_3_4:{ enabled: true, strict: false, critical: false, weight: 4 },
    avoidAtudaimWithHasmaha:{ enabled: true, strict: false, critical: false, weight: 4 },
  }

  );

  // ── Refs ────────────────────────────────────
  const pollRef = useRef(null);
  const mountedRef = useRef(true);
  const runStartRef = useRef(null);
  const timerRef = useRef(null);

  // ── Translations ────────────────────────────
  const t = useMemo(() => {
    const strings = {
      he: {
        title: 'שיבוץ סטודנטים',
        subtitle: '',
        runAllocation: 'הפעל שיבוץ',
        running: 'מריץ שיבוץ...',
        stopAllocation: 'עצור שיבוץ',
        stoppingStopping: 'עוצר...',
        deleteResults: 'מחק תוצאות',
        deletingResults: 'מוחק...',
        viewResults: 'צפה בתוצאות',
        // Status labels
        statusNotStarted: 'לא הופעל',
        statusQueued:     'בתור',
        statusRunning:    'רץ',
        statusStopping:   'עוצר',
        statusStopped:    'עצר',
        statusCompleted:  'הושלם',
        statusFailed:     'נכשל',
        statusDeleted:    'נמחק',
        // Stats
        totalStudents:     'סה״כ סטודנטים',
        allocatedStudents: 'שובצו',
        unallocatedStudents: 'לא שובצו',
        lastRun:           'הרצה אחרונה',
        neverRun:          'לא הורץ',
        students:          'סטודנטים',
        // Progress
        progressTitle:     'הרצת שיבוץ בתהליך',
        processed:         'עובדו',
        allocated:         'שובצו',
        remaining:         'נותרו',
        elapsed:           'זמן חלף',
        // Inventory
        inventoryTitle:    'מלאי דיור לפי סוג',
        singleHousing:     'דיור רווקים/ות',
        coupleHousing:     'דיור זוגות',
        familyHousing:     'דיור משפחה',
        apartmentsLabel:   'דירות',
        roomsLabel:        'חדרים',
        freeBedsLabel:     'מיטות פנויות',
        totalBedsLabel:    'סה״כ מיטות',
        occupiedBeds:      'מיטות תפוסות',
        occupancyPct:      'תפוסה',
        occupied:          'תפוסה',
        // Conditions
        conditionsTitle:   'תנאי ואילוצי שיבוץ',
        criticalTitle:     'אילוצים קריטיים',
        criticalHint:      'חוקים קבועים המופעלים תמיד. לא ניתן לשנות אותם.',
        flexibleTitle:     'העדפות לאופטימיזציה',
        flexibleHint:      'העדפות שניתן להפעיל, לכבות ולכוונן את רמת חשיבותן.',
        hardConstraint:    'אילוץ קשיח',
        alwaysApplied:     'מופעל תמיד',
        importance:        'רמת חשיבות',
        included:          'פעיל',
        excluded:          'כבוי',
        noWeight:          'ללא משקל',
        // Constraint names
        sameGender:        'אותו מגדר בדירה',
        sameGenderDesc:    'סטודנטים מוקצים לדירות מגדריות מתאימות',
        priorityFirst:     'סטודנטים בעדיפות קודמים',
        priorityFirstDesc: 'קבוצת העדיפות הייעודית של הלשכה העליונה משובצת אך ורק לבניין 179; שאר סטודנטי העדיפות יכולים להישבץ בכל סוג מעונות ומקובצים יחד ככל האפשר',
        roommatePositiveOnly: '100% תשובות חיוביות לשותפים',
        roommatePositiveOnlyDesc: 'רק בקשות שותפים הדדיות מאושרות מלאות',
        ReligiousTogether: '100% התאמות דתיות',
        ReligiousTogetherDesc: 'סטודנטים דתיים מוקצים עם שותפים תואמים',
        sameReligion:      'אותה דת בדירה',
        sameReligionDesc:  'מקבץ סטודנטים עם אותה שייכות דתית',
        roommateMatch:     'התאמת שותפים מבוקשים',
        roommateMatchDesc: 'מנסה למלא בקשות שותפים כאשר אפשרי',
        sectorMatching:    'התאמה לפי שייכות',
        sectorMatchingDesc: 'מקבץ סטודנטים לפי שייכות קבוצתית',
        avoidYearMix_1_with_3_4: 'לא לשבץ שנה א׳ עם שנה ג׳/ד׳',
        avoidYearMix_1_with_3_4Desc: 'מונע שיבוץ של סטודנטי שנה ראשונה עם שנה שלישית/רביעית',
        avoidAtudaimWithHasmaha: 'לא לשבץ הסמכה עם עתודאים',
        avoidAtudaimWithHashmahaDesc: 'מונע שיבוץ משותף של סטודנטי הסמכה ועתודאים',
        // Results
        resultsTitle:      'תוצאות השיבוץ',
        successfulAssign:  'שובצו בהצלחה',
        roommateMatches:   'התאמות שותפים',
        conflicts:         'התנגשויות',
        viewFullResults:   'צפה בתוצאות המלאות',
        noResultsTitle:    'אין תוצאות זמינות',
        noResultsHint:     'הרץ שיבוץ כדי לראות תוצאות כאן.',
        resultsReady:      'השיבוץ הושלם',
        // Notifications
        notification:    'הודעה ממשרד המעונות המרכזי',
        receivedStudents: 'סטודנטים התקבלו לשיבוץ',
        batchId:         'מספר קובץ',
        receivedAt:      'התקבל בתאריך',
        pending:         'ממתין',
        viewed:          'נצפה',
        // Error / misc
        loading:         'טוען נתונים...',
        error:           'שגיאה בטעינת הנתונים',
        retry:           'נסה שוב',
        noStudents:      'אין סטודנטים לשיבוץ',
        noPermission:    'אין הרשאה להריץ שיבוץ',
        noRegion:        'לא נמצא אזור למשתמש',
        missingRunId:    'לא נמצא מזהה הרצה',
        cancel:          'ביטול',
        confirm:         'אישור',
        stopConfirmTitle:'עצור שיבוץ',
        stopConfirmMsg:  'האם לעצור את השיבוץ הפעיל? כל ההקצאות החלקיות יימחקו.',
        deleteConfirmTitle: 'מחיקת תוצאות שיבוץ',
        deleteConfirmMsg: 'האם למחוק את תוצאות השיבוץ? פעולה זו תבטל את כל ההקצאות שנוצרו.',
        stopSuccess:     'השיבוץ עוצר. ניקוי נתונים בתהליך...',
        stopError:       'שגיאה בעצירת השיבוץ',
        deleteSuccess:   'תוצאות השיבוץ נמחקו בהצלחה',
        deleteError:     'שגיאה במחיקת תוצאות השיבוץ',
        approvedCannotDelete: 'לא ניתן למחוק הקצאה שאושרה סופית',
        stoppedStatus:   'השיבוץ עצר',
        unknownError:    'שגיאה לא ידועה',
        malformedSummary: 'נתוני שיבוץ לא תקינים',
        currentStatus:   'סטטוס נוכחי',
        region:          'אזור',
        studentBreakdownTitle: 'פילוח סטודנטים',
        newStudents:     'חדשים',
        continuing:      'ממשיכים',
        transfers:       'העברות',
        leaving:         'עוזבים',
        priorityStudents:'עדיפות',
      },
      en: {
        title: 'Allocation ',
        subtitle: '',
        runAllocation: 'Run Allocation',
        running: 'Running...',
        stopAllocation: 'Stop Run',
        stoppingStopping: 'Stopping...',
        deleteResults: 'Delete Results',
        deletingResults: 'Deleting...',
        viewResults: 'View Results',
        // Status labels
        statusNotStarted: 'Not Started',
        statusQueued:     'Queued',
        statusRunning:    'Running',
        statusStopping:   'Stopping',
        statusStopped:    'Stopped',
        statusCompleted:  'Completed',
        statusFailed:     'Failed',
        statusDeleted:    'Deleted',
        // Stats
        totalStudents:     'Total Students',
        allocatedStudents: 'Allocated',
        unallocatedStudents: 'Unallocated',
        lastRun:           'Last Run',
        neverRun:          'Never run',
        students:          'Students',
        // Progress
        progressTitle:     'Allocation in Progress',
        processed:         'Processed',
        allocated:         'Allocated',
        remaining:         'Remaining',
        elapsed:           'Elapsed',
        // Inventory
        inventoryTitle:    'Inventory by Housing Type',
        singleHousing:     'Single Housing',
        coupleHousing:     'Couple Housing',
        familyHousing:     'Family Housing',
        apartmentsLabel:   'Apartments',
        roomsLabel:        'Rooms',
        freeBedsLabel:     'Available Beds',
        totalBedsLabel:    'Total Beds',
        occupiedBeds:      'Occupied Beds',
        occupancyPct:      'Occupancy',
        occupied:          'occupied',
        // Conditions
        conditionsTitle:   'Allocation Conditions',
        criticalTitle:     'Critical Conditions',
        criticalHint:      'Fixed rules always applied by the algorithm. Cannot be changed.',
        flexibleTitle:     'Flexible Preferences',
        flexibleHint:      'Optional preferences that can be toggled and weighted.',
        hardConstraint:    'Hard Constraint',
        alwaysApplied:     'Always active',
        importance:        'Importance',
        included:          'Active',
        excluded:          'Inactive',
        noWeight:          'No weight',
        // Constraint names + descriptions
        sameGender:        'Same gender in apartment',
        sameGenderDesc:    'Students are assigned to gender-appropriate apartments',
        priorityFirst:     'Priority students first',
        priorityFirstDesc: 'The designated Upper Office priority group is assigned exclusively to building 179; other priority students may be placed across any dorm type and are grouped together where possible',
        roommatePositiveOnly: '100% positive roommate matches',
        roommatePositiveOnlyDesc: 'Only confirmed mutual roommate requests are fulfilled',
        ReligiousTogether: '100% religious apartment matches',
        ReligiousTogetherDesc: 'Religious students are placed with compatible peers',
        sameReligion:      'Same religion in apartment',
        sameReligionDesc:  'Groups students with the same religious background',
        roommateMatch:     'Match roommate requests',
        roommateMatchDesc: 'Attempts to fulfill roommate preferences when possible',
        sectorMatching:    'Sector matching',
        sectorMatchingDesc: 'Groups students by sector affiliation',
        avoidYearMix_1_with_3_4: 'Avoid mixing 1st year with 3rd/4th',
        avoidYearMix_1_with_3_4Desc: 'Prevents placing first-year with third/fourth-year students',
        avoidAtudaimWithHasmaha: 'Avoid mixing graduate with atudaim',
        avoidAtudaimWithHashmahaDesc: 'Prevents co-locating graduate and atudaim students',
        // Results
        resultsTitle:      'Allocation Results',
        successfulAssign:  'Successfully Assigned',
        roommateMatches:   'Roommate Matches',
        conflicts:         'Conflicts',
        viewFullResults:   'View Full Results',
        noResultsTitle:    'No Results Yet',
        noResultsHint:     'Run an allocation to see results here.',
        resultsReady:      'Allocation Completed',
        // Notifications
        notification:    'Notification from Housing Office',
        receivedStudents: 'students received for allocation',
        batchId:         'Batch ID',
        receivedAt:      'Received on',
        pending:         'Pending',
        viewed:          'Viewed',
        // Error / misc
        loading:         'Loading...',
        error:           'Error loading data',
        retry:           'Try again',
        noStudents:      'No students to assign',
        noPermission:    'No permission to run allocation',
        noRegion:        'User region not found',
        missingRunId:    'No active run identifier found',
        cancel:          'Cancel',
        confirm:         'Confirm',
        stopConfirmTitle:'Stop Allocation',
        stopConfirmMsg:  'Stop the active allocation? All partial assignments will be deleted.',
        deleteConfirmTitle: 'Delete Allocation Results',
        deleteConfirmMsg: 'Delete the current allocation results? All assignments from this run will be cancelled.',
        stopSuccess:     'Allocation stopping. Cleanup in progress...',
        stopError:       'Failed to stop allocation',
        deleteSuccess:   'Allocation results deleted successfully',
        deleteError:     'Failed to delete allocation results',
        approvedCannotDelete: 'Approved allocations cannot be deleted',
        stoppedStatus:   'Allocation stopped',
        unknownError:    'Unknown error',
        malformedSummary: 'Malformed allocation summary response',
        currentStatus:   'Current status',
        region:          'Region',
        studentBreakdownTitle: 'Student Breakdown',
        newStudents:     'New',
        continuing:      'Continuing',
        transfers:       'Transfers',
        leaving:         'Leaving',
        priorityStudents:'Priority',
      },
    };
    return strings[language] || strings.en;
  }, [language]);

  // ── Helpers ─────────────────────────────────
  const unwrapResponse = useCallback((res) => {
    if (res && typeof res === 'object' && 'data' in res) return res.data;
    return res;
  }, []);

  const getErrorMessage = useCallback((err) => {
    if (!err) return t.unknownError;
    if (typeof err === 'string') return err;
    const data = err?.response?.data;
    if (typeof data === 'string') return data;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (err?.message) return err.message;
    return t.unknownError;
  }, [t.unknownError]);

  const normalizeInboxStatus = useCallback((statusValue) => {
    const s = String(statusValue || '').trim().toLowerCase();
    if (s === 'pending') return 'pending';
    if (s === 'viewed') return 'viewed';
    if (s === 'processed') return 'processed';
    return s;
  }, []);

  const safeSummary = useCallback((raw) => {
    const data = unwrapResponse(raw);
    if (!data || typeof data !== 'object') throw new Error(t.malformedSummary);

    return {
      total_students:      Number(data.total_students) || 0,
      unassigned_students: Number(data.unassigned_students) || 0,
      assigned_students:   Number(data.assigned_students) || 0,
      available_beds:      Number(data.available_beds) || 0,
      priority_students:   Number(data.priority_students) || 0,
      total_capacity:      Number(data.total_capacity) || 0,
      occupancy_rate:      Number(data.occupancy_rate) || 0,
      latest_inbox:        data.latest_inbox && typeof data.latest_inbox === 'object' ? data.latest_inbox : null,
      students_by_category: data.students_by_category && typeof data.students_by_category === 'object'
        ? {
            new:        Number(data.students_by_category.new) || 0,
            continuing: Number(data.students_by_category.continuing) || 0,
            transfer:   Number(data.students_by_category.transfer) || 0,
            leaving:    Number(data.students_by_category.leaving) || 0,
          }
        : null,
      students_by_housing_type: data.students_by_housing_type || null,
      inventory_by_type: data.inventory_by_type && typeof data.inventory_by_type === 'object'
        ? Object.fromEntries(
            ['single', 'couple', 'family'].map((key) => {
              const item = data.inventory_by_type[key] || {};
              return [key, {
                apartments:    Number(item.apartments) || 0,
                rooms:         Number(item.rooms) || 0,
                total_beds:    Number(item.total_beds) || 0,
                occupied_beds: Number(item.occupied_beds) || 0,
                available_beds:Number(item.available_beds) || 0,
              }];
            })
          )
        : null,
      region: data.region && typeof data.region === 'object' ? data.region : null,
      ...data,
    };
  }, [t.malformedSummary, unwrapResponse]);

  const safeInbox = useCallback((raw) => {
    const data = unwrapResponse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!data.inbox || typeof data.inbox !== 'object') return null;
    return {
      ...data.inbox,
      status: normalizeInboxStatus(data.inbox.status),
    };
  }, [normalizeInboxStatus, unwrapResponse]);

  const resolveRegionId = useCallback(() => {
    const regionValue = typeof getUserRegion === 'function' ? getUserRegion() : null;
    if (!regionValue) return summary?.region?.id || summary?.region?.name || null;
    if (typeof regionValue === 'string' || typeof regionValue === 'number') return regionValue;
    if (typeof regionValue === 'object') return regionValue.id || regionValue.name || regionValue.region || null;
    return summary?.region?.id || summary?.region?.name || null;
  }, [getUserRegion, summary]);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => { if (mountedRef.current) setToast(null); }, 4500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const formatElapsed = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ── Constraint Handlers ──────────────────────
  const toggleConstraintEnabled = (key) => {
    setConstraints((prev) => {
      const current = prev[key];
      if (!current || current.critical) return prev;
      return { ...prev, [key]: { ...current, enabled: !current.enabled } };
    });
  };

  const setConstraintWeight = (key, nextWeight) => {
    const parsed = Number(nextWeight);
    const w = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;
    setConstraints((prev) => {
      const current = prev[key];
      if (!current || current.critical) return prev;
      return { ...prev, [key]: { ...current, weight: w } };
    });
  };

  // ── Derived State ────────────────────────────
  const hardConstraints = useMemo(
    () => Object.entries(constraints).filter(([, v]) => v.critical),
    [constraints]
  );
  const optimizationPreferences = useMemo(
    () => Object.entries(constraints).filter(([, v]) => !v.critical),
    [constraints]
  );
  const effectiveConfig = useMemo(() => {
    const out = {};
    Object.entries(constraints).forEach(([k, v]) => {
      out[k] = {
        enabled: v.critical ? true : !!v.enabled,
        strict:  !!v.strict,
        critical: !!v.critical,
        weight:  v.critical ? 0 : Number(v.weight) || 0,
      };
    });
    return out;
  }, [constraints]);

    const canRun =
    typeof canRunAllocation === 'function'
      ? canRunAllocation()
      : false;

  const currentAssignedStudents =
    Number(summary?.assigned_students) || 0;

  const currentUnassignedStudents =
    Number(summary?.unassigned_students) || 0;

  const hasCurrentAllocation =
    currentAssignedStudents > 0;

  const hasStudents =
    currentUnassignedStudents > 0;

  const currentStatusKey = useMemo(() => {
    if (isRunning && isStopping) {
      return 'cancellation_requested';
    }

    if (isRunning) {
      return runStatus || 'running';
    }

    if (!hasCurrentAllocation) {
      return 'not_started';
    }

    if (runStatus === 'completed') {
      return 'completed';
    }

    return 'not_started';
  }, [
    runStatus,
    isRunning,
    isStopping,
    hasCurrentAllocation,
  ]);

  const showStopBtn =
    isRunning &&
    !isStopping &&
    Boolean(runId) &&
    canRun;

  const showDelBtn =
    hasCurrentAllocation &&
    runStatus === 'completed' &&
    !isRunning &&
    Boolean(result) &&
    Boolean(runId) &&
    canRun;

  // ── Elapsed Timer ────────────────────────────
  useEffect(() => {
    if (isRunning) {
      runStartRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (mountedRef.current) {
          setElapsedSeconds(Math.floor((Date.now() - runStartRef.current) / 1000));
        }
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      if (!isRunning) setElapsedSeconds(0);
      runStartRef.current = null;
    }
    return () => clearInterval(timerRef.current);
  }, [isRunning]);

  // ── Data Fetching ────────────────────────────
  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    let normalizedSummary = null;

    try {
      const summaryRaw = await allocationAPI.getSummary();
      normalizedSummary = safeSummary(summaryRaw);
      setSummary(normalizedSummary);

      if (!central) {
        try {
          const inboxRaw = await inboxAPI.getLatest();
          const inbox = safeInbox(inboxRaw);
          if (inbox) {
            setInboxItem(inbox);
            if (inbox.status === 'pending' && inbox.id) {
              Promise.resolve(inboxAPI.markViewed(inbox.id)).catch(() => {});
            }
          } else {
            setInboxItem(null);
          }
        } catch {
          setInboxItem(null);
        }
      } else {
        setInboxItem(null);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }

    return normalizedSummary;
  }, [central, getErrorMessage, safeInbox, safeSummary]);

  const startPolling = useCallback((id) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) { stopPolling(); return; }

      try {
        const data = await allocationAPI.getRunStatus(id);
        const runData = data?.run;
        const st = runData?.status;

        if (!mountedRef.current) return;
        setRunStatus(st);

        if (st === 'completed') {
          stopPolling();
          setIsRunning(false);
          setIsStopping(false);
          setProgress(100);
          setResult({
            successful_assignments: data.successful_assignments ?? runData?.successful_assignments ?? 0,
            roommate_matches:       data.roommate_matches ?? runData?.roommate_matches ?? 0,
            conflicts:              data.conflicts ?? runData?.conflicts ?? 0,
            assignments:            data.assignments ?? [],
            run:                    runData,
          });
          loadPage().catch(() => {});
        } else if (st === 'stopped' || st === 'failed' || st === 'deleted') {
          stopPolling();
          setIsRunning(false);
          setIsStopping(false);
          setProgress(0);
          setResult(null);
          setRunId(null);
          setRunStatus(null);
          loadPage().catch(() => {});
          if (st === 'stopped')      showToast(t.stoppedStatus, 'info');
          else if (st === 'failed')  showToast(runData?.error_message || t.unknownError, 'error');
        } else if (st === 'cancellation_requested') {
          setIsStopping(true);
          setProgress((prev) => Math.min(prev + 2, 95));
        } else if (st === 'running' || st === 'queued') {
          setProgress((prev) => Math.min(prev + 3, 92));
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, 3000);
  }, [stopPolling, loadPage, showToast, t.stoppedStatus, t.unknownError]);

  const recoverActiveRun = useCallback(
  async (regionId, currentSummary = null) => {
    try {
      const data =
        await allocationAPI.getActiveRun(
          regionId || undefined
        );

      const run = data?.run;

      if (!run || !mountedRef.current) {
        return;
      }

      const assignedNow =
        Number(
          currentSummary?.assigned_students
        ) || 0;

      const hasAssignmentsNow =
        assignedNow > 0;

      const activeStatuses = [
        'queued',
        'running',
        'cancellation_requested',
      ];

      /*
       * הרצה שרצה כרגע נשחזר תמיד,
       * גם אם עדיין לא נוצרו שיבוצים.
       */
      if (activeStatuses.includes(run.status)) {
        setRunId(run.id);
        setRunStatus(run.status);
        setIsRunning(true);

        if (
          run.status ===
          'cancellation_requested'
        ) {
          setIsStopping(true);
        }

        startPolling(run.id);
        return;
      }

      /*
       * אם ההרצה האחרונה הסתיימה,
       * אבל אין כרגע שיבוצים במסד הנתונים,
       * מדובר בהרצה היסטורית שנמחקה.
       */
      if (
        run.status === 'completed' &&
        !hasAssignmentsNow
      ) {
        setResult(null);
        setRunId(null);
        setRunStatus(null);
        setIsRunning(false);
        setIsStopping(false);
        return;
      }

      /*
       * משחזרים תוצאה שהושלמה רק כאשר
       * עדיין קיימים שיבוצים בפועל.
       */
      if (
        run.status === 'completed' &&
        hasAssignmentsNow
      ) {
        try {
          const detail =
            await allocationAPI.getRunStatus(
              run.id
            );

          if (
            mountedRef.current &&
            detail?.run?.status === 'completed'
          ) {
            setRunId(run.id);
            setRunStatus('completed');

            setResult({
              successful_assignments:
                assignedNow,

              roommate_matches:
                detail.roommate_matches ??
                detail.run
                  ?.roommate_matches ??
                0,

              conflicts:
                Number(
                  currentSummary
                    ?.unassigned_students
                ) || 0,

              assignments:
                detail.assignments ?? [],

              run: detail.run,
            });
          }
        } catch (error) {
          console.warn(
            'Failed to load completed run detail:',
            error
          );

          setResult(null);
          setRunId(null);
          setRunStatus(null);
        }

        return;
      }

      setResult(null);
      setRunId(null);
      setRunStatus(null);
    } catch (error) {
      console.warn(
        'Failed to recover active run:',
        error
      );
    }
  },
  [startPolling]
);

  const loadPageRef = useRef(loadPage);
  const recoverRef  = useRef(recoverActiveRun);
  useEffect(() => { loadPageRef.current = loadPage; }, [loadPage]);
  useEffect(() => { recoverRef.current = recoverActiveRun; }, [recoverActiveRun]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

    useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const loadedSummary =
        await loadPageRef.current();

      if (
        cancelled ||
        !mountedRef.current
      ) {
        return;
      }

      const regionId =
        loadedSummary?.region?.id || null;

      await recoverRef.current(
        regionId,
        loadedSummary
      );
    };

    init().catch(console.warn);

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Action Handlers ──────────────────────────
  const handleViewResults = useCallback(() => {
    navigate('/allocation/results', {
      state: {
        result: result || null,
        summary,
        constraints: effectiveConfig,
        region: summary?.region || null,
        generatedAt: result ? new Date().toISOString() : null,
      },
    });
  }, [navigate, result, summary, effectiveConfig]);


  const runAllocation = async () => {
    if (isRunning || isStopping || isDeleting) return;
    setIsRunning(true);
    setProgress(0);
    setResult(null);
    setError(null);
    setRunId(null);
    setRunStatus(null);

    const regionId = resolveRegionId();
    if (!regionId) {
      setIsRunning(false);
      setError(t.noRegion);
      return;
    }

    try {
      const responseRaw = await allocationAPI.startRun(regionId, { constraints: effectiveConfig });
      const response = unwrapResponse(responseRaw);
      const id = response?.run_id || response?.run?.id;
      if (!id) throw new Error(t.missingRunId);

      setRunId(id);
      setRunStatus('queued');
      startPolling(id);

      if (inboxItem?.id) {
        inboxAPI.markProcessed(inboxItem.id).catch(() => {});
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setIsRunning(false);
      setRunId(null);
      setRunStatus(null);
    }
  };

  const requestStopAllocation = () => {
    if (!runId) { showToast(t.missingRunId, 'error'); return; }
    setConfirmModal({
      title: t.stopConfirmTitle,
      message: t.stopConfirmMsg,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsStopping(true);
        try {
          await allocationAPI.stopRun(runId);
          showToast(t.stopSuccess, 'info');
          setRunStatus('cancellation_requested');
        } catch (err) {
          showToast(getErrorMessage(err) || t.stopError, 'error');
          setIsStopping(false);
        }
      },
    });
  };

  const requestDeleteResults = () => {
    if (!runId) { showToast(t.missingRunId, 'error'); return; }
    setConfirmModal({
      title: t.deleteConfirmTitle,
      message: t.deleteConfirmMsg,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsDeleting(true);
        try {
          await allocationAPI.deleteResults(runId);

stopPolling();

setResult(null);
setRunId(null);
setRunStatus(null);
setIsRunning(false);
setIsStopping(false);
setProgress(0);

await loadPage();

showToast(
  t.deleteSuccess,
  'success'
);
        } catch (err) {
          const msg = getErrorMessage(err);
          const isApproved = err?.response?.status === 409
            || (typeof msg === 'string' && msg.toLowerCase().includes('approved'));
          showToast(isApproved ? t.approvedCannotDelete : (msg || t.deleteError), 'error');
        } finally {
          if (mountedRef.current) setIsDeleting(false);
        }
      },
    });
  };

  // ── Loading / Error States ───────────────────
  if (loading) {
    return (
      <div className="ap-page">
        <div className="ap-loading-state">
          <Loader size={36} className="ap-spin" />
          <span>{t.loading}</span>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="ap-page">
        <div className="ap-error-state">
          <XCircle size={36} />
          <p className="ap-error-title">{t.error}</p>
          <p className="ap-error-msg">{error}</p>
          <button className="ap-retry-btn" onClick={loadPage}>{t.retry}</button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // ── Last run date ────────────────────────────
    const lastRunTimestamp =
    hasCurrentAllocation
      ? (
          result?.run?.completed_at ||
          result?.run?.started_at ||
          null
        )
      : null;

  const lastRunDate =
    lastRunTimestamp
      ? new Date(
          lastRunTimestamp
        ).toLocaleString(
          language === 'he'
            ? 'he-IL'
            : 'en-US',
          {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }
        )
      : null;

  // ── Inventory types ──────────────────────────
  const inventoryTypes = [
    ['single', t.singleHousing],
    ['couple', t.coupleHousing],
    ['family', t.familyHousing],
  ];

  // ── Region label ─────────────────────────────
  const regionLabel = summary?.region
    ? (language === 'he'
        ? summary.region.name || summary.region.name_en || ''
        : summary.region.name_en || summary.region.name || '')
    : null;

  // ── Render ───────────────────────────────────
  return (
    <div className="ap-page">
      <ToastNotification toast={toast} />
      <ConfirmDialog modal={confirmModal} t={t} onClose={() => setConfirmModal(null)} />

      <div className="ap-shell">

        {/* ── 1. Page Header ─────────────────── */}
        <div className="ap-header-card">
          <div className="ap-header-top">
            <div className="ap-header-title-block">
              <h1 className="ap-page-title">{t.title}</h1>
              <p className="ap-page-subtitle">{t.subtitle}</p>
            </div>
            <div className="ap-header-meta">
              <StatusBadge statusKey={currentStatusKey} t={t} />
              {regionLabel && (
                <span className="ap-region-chip">{regionLabel}</span>
              )}
              {lastRunDate && (
                <div className="ap-last-run">
                  <Clock size={13} />
                  <span>{lastRunDate}</span>
                </div>
              )}
            </div>
          </div>

          <div className="ap-header-stats">
            {result && hasCurrentAllocation ? (
              <>
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-green"><Check size={16} /></div>
                  <div>
                    <div className="ap-stat-val ap-stat-green-text">{currentAssignedStudents}</div>
                    <div className="ap-stat-lbl">{t.successfulAssign}</div>
                  </div>
                </div>
                <div className="ap-stat-divider" />
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-blue"><Users size={16} /></div>
                  <div>
                    <div className="ap-stat-val">{result.roommate_matches || 0}</div>
                    <div className="ap-stat-lbl">{t.roommateMatches}</div>
                  </div>
                </div>
                <div className="ap-stat-divider" />
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-amber"><AlertTriangle size={16} /></div>
                  <div>
                    <div className="ap-stat-val ap-stat-amber-text">{result.conflicts || 0}</div>
                    <div className="ap-stat-lbl">{t.conflicts}</div>
                  </div>
                </div>
                <div className="ap-stat-divider" />
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-slate"><Home size={16} /></div>
                  <div>
                    <div className="ap-stat-val">{summary?.available_beds || 0}</div>
                    <div className="ap-stat-lbl">{t.freeBedsLabel}</div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-blue"><Users size={16} /></div>
                  <div>
                    <div className="ap-stat-val">{summary?.total_students || 0}</div>
                    <div className="ap-stat-lbl">{t.totalStudents}</div>
                  </div>
                </div>
                <div className="ap-stat-divider" />
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-green"><Check size={16} /></div>
                  <div>
                    <div className="ap-stat-val ap-stat-green-text">{summary?.assigned_students || 0}</div>
                    <div className="ap-stat-lbl">{t.allocatedStudents}</div>
                  </div>
                </div>
                <div className="ap-stat-divider" />
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-amber"><AlertTriangle size={16} /></div>
                  <div>
                    <div className="ap-stat-val ap-stat-amber-text">{summary?.unassigned_students || 0}</div>
                    <div className="ap-stat-lbl">{t.unallocatedStudents}</div>
                  </div>
                </div>
                <div className="ap-stat-divider" />
                <div className="ap-stat-item">
                  <div className="ap-stat-icon ap-stat-slate"><Home size={16} /></div>
                  <div>
                    <div className="ap-stat-val">{summary?.available_beds || 0}</div>
                    <div className="ap-stat-lbl">{t.freeBedsLabel}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── 2. Controls Bar ────────────────── */}
        <div className="ap-controls-bar">
          <div className="ap-controls-left">
            {/* Run */}
            <button
              className="ap-btn ap-btn-primary"
              onClick={runAllocation}
              disabled={isRunning || !canRun || !hasStudents || isDeleting}
              title={!hasStudents ? t.noStudents : !canRun ? t.noPermission : ''}
            >
              {isRunning ? (
                <><RefreshCw size={15} className="ap-spin" /> {isStopping ? t.stoppingStopping : t.running}</>
              ) : (
                <><Play size={15} /> {t.runAllocation}</>
              )}
            </button>

            {/* Stop */}
            {showStopBtn && (
              <button className="ap-btn ap-btn-danger" onClick={requestStopAllocation} disabled={isStopping}>
                <Square size={15} />
                {t.stopAllocation}
              </button>
            )}

            {/* Stopping indicator */}
            {isStopping && !showStopBtn && (
              <div className="ap-inline-chip ap-chip-amber">
                <Loader size={13} className="ap-spin" />
                {t.stoppingStopping}
              </div>
            )}
          </div>

          <div className="ap-controls-right">
            {/* View Results */}
            <button
              className="ap-btn ap-btn-ghost"
              onClick={handleViewResults}
              disabled={
  !hasCurrentAllocation ||
  !result ||
  runStatus !== 'completed'
}
            >
              <ExternalLink size={15} />
              {t.viewResults}
            </button>

            {/* Delete */}
            {showDelBtn && (
              <button
                className="ap-btn ap-btn-ghost-danger"
                onClick={requestDeleteResults}
                disabled={isDeleting}
              >
                {isDeleting ? <><Loader size={13} className="ap-spin" /> {t.deletingResults}</> : <><Trash2 size={15} /> {t.deleteResults}</>}
              </button>
            )}
          </div>
        </div>

        {/* ── 3. Progress Card (when running) ── */}
        {isRunning && (
          <div className="ap-progress-card">
            <div className="ap-progress-header">
              <div className="ap-progress-status">
                <Activity size={15} />
                <span>{isStopping ? t.stoppingStopping : t.progressTitle}</span>
              </div>
              <div className="ap-progress-timer">
                <Clock size={13} />
                <span>{formatElapsed(elapsedSeconds)}</span>
              </div>
            </div>

            <div className="ap-progress-bar-wrap">
              <div className="ap-progress-bar">
                <div className="ap-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="ap-progress-pct">{progress}%</span>
            </div>

            <div className="ap-progress-detail">
              <span className="ap-progress-chip">
                <Users size={12} />
                {summary?.unassigned_students || 0} {t.students}
              </span>
              <span className="ap-progress-chip ap-chip-blue">
                <BarChart3 size={12} />
                {t.progressTitle}
              </span>
            </div>
          </div>
        )}

        {/* ── 4. Inline error (non-fatal) ─────── */}
        {error && summary && (
          <div className="ap-inline-alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* ── 5. Inbox Notice (compact) ────────── */}
        {inboxItem && (
          <div className="ap-inbox-notice">
            <div className="ap-inbox-icon-wrap">
              <Bell size={15} />
            </div>
            <div className="ap-inbox-body">
              <span className="ap-inbox-title">{t.notification}</span>
              <div className="ap-inbox-detail">
                <Mail size={12} />
                <strong>{Number(inboxItem.students_count) || 0}</strong>
                <span>{t.receivedStudents}</span>
                <span className="ap-inbox-meta-sep">·</span>
                <Calendar size={12} />
                <span>
                  {inboxItem.created_at
                    ? new Date(inboxItem.created_at).toLocaleDateString(
                        language === 'he' ? 'he-IL' : 'en-US'
                      )
                    : '-'}
                </span>
              </div>
            </div>
            <span className={`ap-inbox-status${inboxItem.status === 'pending' ? ' ap-inbox-pending' : ''}`}>
              {inboxItem.status === 'pending'
                ? <><AlertTriangle size={12} /> {t.pending}</>
                : <><Check size={12} /> {t.viewed}</>
              }
            </span>
          </div>
        )}

        {/* ── 6. Main Content ──────────────── */}
        <div className="ap-main-col">

          {/* Inventory by Housing Type */}
          <div className="ap-card">
            <div className="ap-card-header">
              <div className="ap-card-title-row">
                <Building2 size={16} />
                <h2 className="ap-card-title">{t.inventoryTitle}</h2>
              </div>
            </div>

            {summary?.inventory_by_type ? (
              <div className="ap-inv-list">
                {inventoryTypes.map(([typeKey, label]) => (
                  <InventoryTypeRow
                    key={typeKey}
                    typeKey={typeKey}
                    label={label}
                    item={summary.inventory_by_type[typeKey] || {}}
                    expandedType={expandedType}
                    onToggle={(k) => setExpandedType(prev => prev === k ? null : k)}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <div className="ap-empty-hint">
                <Info size={14} />
                <span>{t.noResultsHint}</span>
              </div>
            )}
          </div>

          {/* Allocation Conditions */}
          <div className="ap-card">
            <div className="ap-card-header">
              <div className="ap-card-title-row">
                <SlidersHorizontal size={16} />
                <h2 className="ap-card-title">{t.conditionsTitle}</h2>
              </div>
            </div>

            {/* Critical Conditions */}
            <div className="ap-cond-section">
              <div className="ap-cond-section-header ap-cond-col-critical">
                <ShieldCheck size={14} />
                <div>
                  <div className="ap-cond-col-title">{t.criticalTitle}</div>
                  <div className="ap-cond-col-hint">{t.criticalHint}</div>
                </div>
                <span className="ap-count-badge">{hardConstraints.length}</span>
              </div>
              <div className="ap-cond-grid-2">
                {hardConstraints.map(([key]) => (
                  <CriticalConditionCard key={key} condKey={key} t={t} />
                ))}
              </div>
            </div>

            {/* Flexible Preferences */}
            <div className="ap-cond-section ap-cond-section-divider">
              <div className="ap-cond-section-header ap-cond-col-flexible">
                <SlidersHorizontal size={14} />
                <div>
                  <div className="ap-cond-col-title">{t.flexibleTitle}</div>
                  <div className="ap-cond-col-hint">{t.flexibleHint}</div>
                </div>
                <span className="ap-count-badge">{optimizationPreferences.length}</span>
              </div>
              <div className="ap-cond-grid-2">
                {optimizationPreferences.map(([key, value]) => (
                  <FlexibleConditionCard
                    key={key}
                    condKey={key}
                    value={value}
                    t={t}
                    onToggle={toggleConstraintEnabled}
                    onWeightChange={setConstraintWeight}
                  />
                ))}
              </div>
            </div>

            {!canRun && (
              <div className="ap-lock-notice">
                <Lock size={14} />
                <span>{t.noPermission}</span>
              </div>
            )}
          </div>
        </div>
      </div>

            <style>{styles}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const styles = `  /* ── Variables ────────────────────────────── */
  .ap-page {
    --ap-bg: #f0f4f8;
    --ap-surface: #ffffff;
    --ap-surface-2: #f8fafc;
    --ap-border: rgba(15, 23, 42, 0.08);
    --ap-border-m: rgba(15, 23, 42, 0.13);
    --ap-text: #0f172a;
    --ap-text-2: #475569;
    --ap-muted: #94a3b8;
    --ap-blue: #2563eb;
    --ap-blue-soft: rgba(37, 99, 235, 0.08);
    --ap-blue-border: rgba(37, 99, 235, 0.18);
    --ap-green: #059669;
    --ap-green-soft: rgba(5, 150, 105, 0.09);
    --ap-green-border: rgba(5, 150, 105, 0.18);
    --ap-amber: #d97706;
    --ap-amber-soft: rgba(217, 119, 6, 0.09);
    --ap-amber-border: rgba(217, 119, 6, 0.18);
    --ap-red: #dc2626;
    --ap-red-soft: rgba(220, 38, 38, 0.09);
    --ap-red-border: rgba(220, 38, 38, 0.18);
    --ap-shadow: 0 1px 3px rgba(15,23,42,0.06), 0 4px 14px rgba(15,23,42,0.05);
    --ap-shadow-md: 0 4px 20px rgba(15,23,42,0.09);
    --ap-radius: 14px;
    --ap-radius-sm: 10px;
    --ap-radius-xs: 7px;
    min-height: calc(100vh - 64px);
    padding: 20px;
    background: linear-gradient(145deg, #eef2f7 0%, #e8f0fe 55%, #edfaf4 100%);
    font-family: inherit;
  }

  /* ── Shell ───────────────────────────────── */
  .ap-shell {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* ── Card base ──────────────────────────── */
  .ap-card {
    background: var(--ap-surface);
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius);
    box-shadow: var(--ap-shadow);
    overflow: hidden;
    transition: box-shadow 0.18s;
  }
  .ap-card:hover {
    box-shadow: var(--ap-shadow-md);
  }

  .ap-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--ap-border);
  }

  .ap-card-title-row {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--ap-text);
  }

  .ap-card-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--ap-text);
  }

  /* ── Loading / Error ─────────────────────── */
  .ap-loading-state,
  .ap-error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    min-height: 360px;
    background: var(--ap-surface);
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius);
    box-shadow: var(--ap-shadow);
    max-width: 520px;
    margin: 40px auto;
    color: var(--ap-muted);
    font-size: 14px;
    font-weight: 600;
  }

  .ap-error-state { color: var(--ap-red); }
  .ap-error-title { margin: 0; font-size: 16px; font-weight: 700; }
  .ap-error-msg   { margin: 0; font-size: 13px; color: var(--ap-muted); text-align: center; max-width: 360px; }

  .ap-retry-btn {
    padding: 9px 18px;
    border-radius: var(--ap-radius-sm);
    border: 1px solid var(--ap-blue-border);
    background: var(--ap-blue-soft);
    color: var(--ap-blue);
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s;
  }
  .ap-retry-btn:hover { background: rgba(37,99,235,0.14); }

  /* ── Header Card ─────────────────────────── */
  .ap-header-card {
    background: linear-gradient(135deg, #ffffff 60%, rgba(37,99,235,0.03) 100%);
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius);
    box-shadow: var(--ap-shadow-md);
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .ap-header-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .ap-page-title {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    color: var(--ap-text);
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .ap-page-subtitle {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--ap-text-2);
    font-weight: 500;
  }

  .ap-header-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .ap-last-run {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--ap-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .ap-region-chip {
    display: inline-flex;
    align-items: center;
    padding: 5px 11px;
    border-radius: 999px;
    background: var(--ap-blue-soft);
    border: 1px solid var(--ap-blue-border);
    color: var(--ap-blue);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .ap-header-stats {
    display: flex;
    align-items: center;
    gap: 0;
    background: linear-gradient(135deg, var(--ap-surface-2) 0%, rgba(37,99,235,0.03) 100%);
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-sm);
    padding: 0;
    overflow: hidden;
  }

  .ap-stat-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    flex: 1;
  }

  .ap-stat-divider {
    width: 1px;
    height: 36px;
    background: var(--ap-border);
    flex-shrink: 0;
  }

  .ap-stat-icon {
    width: 34px;
    height: 34px;
    border-radius: var(--ap-radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .ap-stat-blue  { background: var(--ap-blue-soft);  border: 1px solid var(--ap-blue-border);  color: var(--ap-blue); }
  .ap-stat-green { background: var(--ap-green-soft); border: 1px solid var(--ap-green-border); color: var(--ap-green); }
  .ap-stat-amber { background: var(--ap-amber-soft); border: 1px solid var(--ap-amber-border); color: var(--ap-amber); }
  .ap-stat-slate { background: rgba(100,116,139,0.09); border: 1px solid rgba(100,116,139,0.18); color: #475569; }

  .ap-stat-val  { font-size: 20px; font-weight: 800; color: var(--ap-text); letter-spacing: -0.02em; }
  .ap-stat-lbl  { font-size: 11.5px; font-weight: 600; color: var(--ap-muted); margin-top: 1px; }
  .ap-stat-green-text { color: var(--ap-green); }
  .ap-stat-amber-text { color: var(--ap-amber); }

  /* ── Status Badge ─────────────────────────── */
  .ap-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .badge-gray  { background: rgba(100,116,139,0.09); border-color: rgba(100,116,139,0.18); color: #475569; }
  .badge-blue  { background: var(--ap-blue-soft);  border-color: var(--ap-blue-border);  color: var(--ap-blue); }
  .badge-green { background: var(--ap-green-soft); border-color: var(--ap-green-border); color: var(--ap-green); }
  .badge-amber { background: var(--ap-amber-soft); border-color: var(--ap-amber-border); color: var(--ap-amber); }
  .badge-red   { background: var(--ap-red-soft);   border-color: var(--ap-red-border);   color: var(--ap-red); }

  .ap-badge-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }
  .ap-badge-dot-pulse {
    animation: ap-dot-pulse 1.6s ease-in-out infinite;
  }
  @keyframes ap-dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  /* ── Controls Bar ────────────────────────── */
  .ap-controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--ap-surface);
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius);
    box-shadow: var(--ap-shadow);
    padding: 12px 16px;
    flex-wrap: wrap;
  }

  .ap-controls-left,
  .ap-controls-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ── Buttons ─────────────────────────────── */
  .ap-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 16px;
    border-radius: var(--ap-radius-sm);
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    border: 1px solid transparent;
    transition: transform 0.14s, filter 0.14s, background 0.14s, border-color 0.14s;
    white-space: nowrap;
    line-height: 1;
  }
  .ap-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none !important;
    filter: none !important;
  }

  .ap-btn-primary {
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    border-color: rgba(5,150,105,0.25);
    box-shadow: 0 4px 12px rgba(5,150,105,0.25);
  }
  .ap-btn-primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.04); }

  .ap-btn-danger {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: #fff;
    border-color: rgba(220,38,38,0.25);
    box-shadow: 0 4px 12px rgba(220,38,38,0.22);
  }
  .ap-btn-danger:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.04); }

  .ap-btn-ghost {
    background: rgba(15,23,42,0.03);
    color: var(--ap-text);
    border-color: var(--ap-border);
  }
  .ap-btn-ghost:hover:not(:disabled) {
    background: var(--ap-blue-soft);
    border-color: var(--ap-blue-border);
    color: var(--ap-blue);
  }

  .ap-btn-ghost-danger {
    background: var(--ap-red-soft);
    color: var(--ap-red);
    border-color: var(--ap-red-border);
  }
  .ap-btn-ghost-danger:hover:not(:disabled) { background: rgba(220,38,38,0.13); }

  /* ── Inline Chip ─────────────────────────── */
  .ap-inline-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 700;
    border: 1px solid transparent;
  }
  .ap-chip-amber {
    background: var(--ap-amber-soft);
    border-color: var(--ap-amber-border);
    color: var(--ap-amber);
  }
  .ap-chip-blue {
    background: var(--ap-blue-soft);
    border-color: var(--ap-blue-border);
    color: var(--ap-blue);
  }

  /* ── Progress Card ───────────────────────── */
  .ap-progress-card {
    background: linear-gradient(135deg, rgba(37,99,235,0.06), rgba(16,185,129,0.04));
    border: 1px solid var(--ap-blue-border);
    border-radius: var(--ap-radius);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ap-progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .ap-progress-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 700;
    color: var(--ap-blue);
  }

  .ap-progress-timer {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ap-text-2);
    font-variant-numeric: tabular-nums;
  }

  .ap-progress-bar-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ap-progress-bar {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: rgba(15,23,42,0.08);
    overflow: hidden;
  }

  .ap-progress-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--ap-blue), var(--ap-green));
    transition: width 0.4s ease;
  }

  .ap-progress-pct {
    font-size: 12.5px;
    font-weight: 800;
    color: var(--ap-text-2);
    min-width: 38px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ap-progress-detail {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ── Inline Alert ────────────────────────── */
  .ap-inline-alert {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 11px 14px;
    border-radius: var(--ap-radius-sm);
    background: var(--ap-amber-soft);
    border: 1px solid var(--ap-amber-border);
    color: var(--ap-amber);
    font-size: 13px;
    font-weight: 600;
  }
  .ap-inline-alert button {
    margin-left: auto;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--ap-amber);
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
    font-weight: 700;
  }

  /* ── Inbox Notice ────────────────────────── */
  .ap-inbox-notice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: linear-gradient(135deg, var(--ap-blue-soft), rgba(99,102,241,0.06));
    border: 1px solid var(--ap-blue-border);
    border-radius: var(--ap-radius-sm);
    flex-wrap: wrap;
  }

  .ap-inbox-icon-wrap {
    width: 34px;
    height: 34px;
    border-radius: var(--ap-radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.8);
    border: 1px solid rgba(255,255,255,0.6);
    color: var(--ap-blue);
    flex-shrink: 0;
  }

  .ap-inbox-body {
    flex: 1;
    min-width: 0;
  }

  .ap-inbox-title {
    font-size: 12px;
    font-weight: 700;
    color: #1e3a8a;
    display: block;
    margin-bottom: 4px;
  }

  .ap-inbox-detail {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--ap-text-2);
    font-weight: 500;
    flex-wrap: wrap;
  }
  .ap-inbox-detail strong { color: var(--ap-text); font-weight: 800; }

  .ap-inbox-meta-sep { color: var(--ap-muted); }

  .ap-inbox-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 700;
    background: rgba(15,23,42,0.04);
    border: 1px solid var(--ap-border);
    color: var(--ap-text-2);
    white-space: nowrap;
  }
  .ap-inbox-pending {
    background: var(--ap-amber-soft);
    border-color: var(--ap-amber-border);
    color: var(--ap-amber);
  }

  /* ── Main Content ────────────────────────── */
  .ap-main-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* ── Inventory ────────────────────────────── */
  .ap-inv-list {
    display: flex;
    flex-direction: column;
  }

  .ap-inv-row {
    border-bottom: 1px solid var(--ap-border);
  }
  .ap-inv-row:last-child { border-bottom: none; }

  .ap-inv-row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 16px;
    background: none;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: start;
    transition: background 0.14s;
  }
  .ap-inv-row-header:hover { background: var(--ap-surface-2); }

  .ap-inv-row-left {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .ap-inv-type-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--ap-radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ap-blue-soft);
    border: 1px solid var(--ap-blue-border);
    color: var(--ap-blue);
    flex-shrink: 0;
  }

  .ap-inv-type-name {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--ap-text);
  }

  .ap-inv-row-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .ap-inv-quick-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ap-muted);
    font-weight: 600;
  }

  .ap-inv-quick-stat.available { color: var(--ap-green); }
  .ap-inv-quick-stat strong { font-weight: 800; }
  .ap-inv-sep { color: var(--ap-muted); opacity: 0.6; }

  .ap-inv-progress-mini {
    width: 70px;
    height: 5px;
    border-radius: 999px;
    background: rgba(15,23,42,0.08);
    overflow: hidden;
  }

  .ap-inv-progress-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--ap-blue);
  }

  .ap-inv-chevron {
    color: var(--ap-muted);
    display: flex;
    align-items: center;
  }

  .ap-inv-expanded {
    padding: 0 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--ap-surface-2);
    border-top: 1px solid var(--ap-border);
  }

  .ap-inv-metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding-top: 14px;
  }

  .ap-inv-metric {
    border-radius: var(--ap-radius-xs);
    border: 1px solid var(--ap-border);
    background: var(--ap-surface);
    padding: 10px;
    text-align: center;
  }

  .ap-inv-metric-highlight {
    background: var(--ap-green-soft);
    border-color: var(--ap-green-border);
  }

  .ap-inv-metric-val {
    font-size: 18px;
    font-weight: 800;
    color: var(--ap-text);
    letter-spacing: -0.02em;
  }

  .ap-inv-metric-highlight .ap-inv-metric-val { color: var(--ap-green); }

  .ap-inv-metric-pct { font-size: 16px; }

  .ap-inv-metric-lbl {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--ap-muted);
    margin-top: 2px;
  }

  .ap-inv-occ-bar-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ap-inv-occ-bar {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: rgba(15,23,42,0.08);
    overflow: hidden;
  }

  .ap-inv-occ-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--ap-blue), var(--ap-green));
  }

  .ap-inv-occ-label {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--ap-text-2);
    white-space: nowrap;
  }

  /* ── Conditions ──────────────────────────── */
  .ap-cond-section {
    padding: 16px;
    border-top: 1px solid var(--ap-border);
  }

  .ap-cond-section-divider {
    border-top: 2px solid var(--ap-border);
  }

  .ap-cond-section-header {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--ap-border);
  }

  .ap-cond-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .ap-cond-col-critical { color: #0f766e; }
  .ap-cond-col-flexible  { color: var(--ap-blue); }

  .ap-cond-col-title {
    font-size: 13px;
    font-weight: 800;
    color: var(--ap-text);
    line-height: 1.2;
    margin-bottom: 3px;
  }

  .ap-cond-col-hint {
    font-size: 11px;
    font-weight: 500;
    color: var(--ap-muted);
    line-height: 1.45;
  }

  .ap-count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(15,23,42,0.06);
    border: 1px solid var(--ap-border);
    color: var(--ap-muted);
    font-size: 11px;
    font-weight: 800;
    margin-left: auto;
    flex-shrink: 0;
  }

  /* Condition Cards */
  .ap-cond-card {
    border-radius: var(--ap-radius-xs);
    border: 1px solid var(--ap-border);
    background: var(--ap-surface-2);
    padding: 11px 12px;
    transition: border-color 0.15s;
  }

  .ap-cond-critical {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    background: linear-gradient(135deg, rgba(15,118,110,0.04), rgba(16,185,129,0.02));
    border-color: rgba(15,118,110,0.14);
  }

  .ap-cond-flexible {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .ap-cond-flexible.ap-cond-off { opacity: 0.6; background: rgba(15,23,42,0.018); }

  .ap-cond-flex-top {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .ap-cond-icon-wrap {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .ap-cond-icon-critical {
    background: rgba(15,118,110,0.09);
    border: 1px solid rgba(15,118,110,0.16);
    color: #0f766e;
  }

  .ap-cond-icon-flex {
    background: var(--ap-blue-soft);
    border: 1px solid var(--ap-blue-border);
    color: var(--ap-blue);
  }

  .ap-cond-body { flex: 1; min-width: 0; }

  .ap-cond-name {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ap-text);
    line-height: 1.35;
  }

  .ap-cond-desc {
    font-size: 11px;
    color: var(--ap-muted);
    margin-top: 2px;
    line-height: 1.4;
    font-weight: 500;
  }

  .ap-cond-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 7px;
  }

  .ap-cond-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 800;
    border: 1px solid transparent;
  }

  .ap-cond-badge-critical {
    background: rgba(15,118,110,0.09);
    border-color: rgba(15,118,110,0.16);
    color: #0f766e;
  }

  .ap-cond-always {
    font-size: 10.5px;
    color: var(--ap-muted);
    font-weight: 600;
  }

  .ap-cond-status-chip {
    display: inline-flex;
    align-items: center;
    margin-top: 5px;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--ap-muted);
  }
  .ap-cond-status-chip.ap-cond-status-on { color: var(--ap-green); }

  /* ── Switch ──────────────────────────────── */
  .ap-switch {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 999px;
    background: rgba(100,116,139,0.25);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.18s;
    margin-top: 1px;
  }
  .ap-switch-on { background: var(--ap-blue); }
  .ap-switch:focus-visible { outline: 3px solid rgba(37,99,235,0.22); outline-offset: 2px; }

  .ap-switch-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(15,23,42,0.2);
    transition: transform 0.18s;
  }
  .ap-switch-on .ap-switch-thumb { transform: translateX(18px); }

  /* ── Slider ──────────────────────────────── */
  .ap-cond-weight {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--ap-border);
  }

  .ap-cond-weight-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
  }

  .ap-cond-weight-lbl {
    font-size: 11px;
    font-weight: 700;
    color: var(--ap-muted);
  }

  .ap-cond-weight-val {
    font-size: 11px;
    font-weight: 800;
    color: var(--ap-text);
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--ap-blue-soft);
    border: 1px solid var(--ap-blue-border);
  }

  .ap-range {
    width: 100%;
    accent-color: var(--ap-blue);
    cursor: pointer;
    height: 4px;
  }
  .ap-range:disabled { cursor: not-allowed; opacity: 0.4; }

  .ap-range-scale {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-size: 9.5px;
    color: var(--ap-muted);
    font-weight: 700;
  }

  /* ── Lock Notice ─────────────────────────── */
  .ap-lock-notice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 16px;
    border-top: 1px solid var(--ap-border);
    color: var(--ap-muted);
    font-size: 12.5px;
    font-weight: 600;
  }

  /* ── Empty hint ──────────────────────────── */
  .ap-empty-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    color: var(--ap-muted);
    font-size: 13px;
    font-weight: 500;
  }

  /* ── Toast ───────────────────────────────── */
  .ap-toast {
    position: fixed;
    top: 16px;
    inset-inline-end: 16px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 16px;
    border-radius: var(--ap-radius-sm);
    font-size: 13.5px;
    font-weight: 700;
    box-shadow: 0 8px 24px rgba(15,23,42,0.18);
    z-index: 300;
    max-width: 380px;
    animation: ap-toast-in 0.22s ease;
  }

  @keyframes ap-toast-in {
    from { transform: translateY(-10px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  .ap-toast-success { background: linear-gradient(135deg, #10b981, #059669); color: #fff; }
  .ap-toast-error   { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
  .ap-toast-info    { background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; }
  .ap-toast-warning { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; }

  .ap-toast-icon { flex-shrink: 0; }
  .ap-toast-msg  { line-height: 1.4; }

  /* ── Confirm Modal ───────────────────────── */
  .ap-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15,23,42,0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 16px;
  }

  .ap-modal-box {
    background: var(--ap-surface);
    border-radius: 18px;
    box-shadow: 0 20px 60px rgba(15,23,42,0.22);
    padding: 28px;
    max-width: 420px;
    width: 100%;
    animation: ap-modal-in 0.2s ease;
  }

  @keyframes ap-modal-in {
    from { transform: scale(0.96) translateY(8px); opacity: 0; }
    to   { transform: scale(1)    translateY(0);   opacity: 1; }
  }

  .ap-modal-title {
    margin: 0 0 10px;
    font-size: 17px;
    font-weight: 800;
    color: var(--ap-text);
  }

  .ap-modal-body {
    margin: 0 0 22px;
    font-size: 13.5px;
    color: var(--ap-text-2);
    line-height: 1.55;
    font-weight: 500;
  }

  .ap-modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .ap-modal-cancel {
    padding: 9px 18px;
    border-radius: 10px;
    border: 1px solid var(--ap-border);
    background: rgba(15,23,42,0.04);
    color: var(--ap-text);
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.14s;
  }
  .ap-modal-cancel:hover { background: rgba(15,23,42,0.08); }

  .ap-modal-confirm {
    padding: 9px 18px;
    border-radius: 10px;
    border: 1px solid rgba(220,38,38,0.28);
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: #fff;
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    box-shadow: 0 4px 12px rgba(220,38,38,0.25);
    transition: filter 0.14s;
  }
  .ap-modal-confirm:hover { filter: brightness(1.06); }

  /* ── Spin ────────────────────────────────── */
  .ap-spin {
    animation: ap-spin 0.9s linear infinite;
  }
  @keyframes ap-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* ── Responsive ──────────────────────────── */
  @media (max-width: 768px) {
    .ap-page { padding: 12px; }
    .ap-header-stats { flex-wrap: wrap; }
    .ap-stat-item { flex: 0 1 calc(50% - 1px); }
    .ap-cond-grid-2 { grid-template-columns: 1fr; }
    .ap-controls-bar { flex-direction: column; align-items: stretch; }
    .ap-controls-left, .ap-controls-right { justify-content: stretch; }
    .ap-controls-left .ap-btn, .ap-controls-right .ap-btn { flex: 1; justify-content: center; }
    .ap-inv-metrics-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 480px) {
    .ap-header-top { flex-direction: column; }
    .ap-header-meta { justify-content: flex-start; }
    .ap-stat-item { flex: 1 1 100%; }
    .ap-stat-divider { display: none; }
    .ap-inv-quick-stats { display: none; }
  }
`;

export default AllocationPage;
