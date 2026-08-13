import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { allocationAPI, inboxAPI } from '../services/api';
import { localizeRegionName } from '../utils/locationNames';
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

// Mirrors the backend's MIN_USER_SOLVER_TIME_SECONDS / MAX_USER_SOLVER_TIME_SECONDS
// (allocation/solver.py) so the frontend can validate before ever sending a
// request - the backend re-validates independently regardless, so a
// malformed/bypassed request can never hand CP-SAT an unreasonable duration.
const MIN_SOLVER_SECONDS = 1;
const MAX_SOLVER_SECONDS = 36000; // 10 hours
const DEFAULT_SOLVER_SECONDS = 500;
const SOLVER_UNIT_TO_SECONDS = { seconds: 1, minutes: 60, hours: 3600 };

// Statuses for which a run is still "live" (search timing should keep
// ticking / backend polling should continue). Matches the backend's own
// notion of an in-progress AllocationRun (see get_active_allocation_run).
const LIVE_RUN_STATUSES = ['queued', 'running', 'cancellation_requested', 'stop_and_save_requested'];
const PREVIEW_POLL_INTERVAL_MS = 5000;

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StatusBadge({ statusKey, t }) {
  const config = {
    not_started: { label: t.statusNotStarted, cls: 'badge-gray', dot: false },
    queued:      { label: t.statusQueued,      cls: 'badge-blue', dot: true },
    running:     { label: t.statusRunning,     cls: 'badge-blue', dot: true, pulse: true },
    cancellation_requested: { label: t.statusStopping, cls: 'badge-amber', dot: true, pulse: true },
    stop_and_save_requested: { label: t.statusStopSaveRequested, cls: 'badge-amber', dot: true, pulse: true },
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

function PreviewPanel({ open, loading, errorMsg, snapshot, hasNewer, t, onClose, onRefresh, formatElapsed }) {
  if (!open) return null;

  const assignments = Array.isArray(snapshot?.assignments) ? snapshot.assignments : [];
  const assignedCount = snapshot?.assigned_count ?? assignments.length;
  const unassignedCount = snapshot?.unassigned_count ?? 0;
  const solverStatus = snapshot?.solver_status;
  const wallTime = Number(snapshot?.wall_time_seconds) || 0;

  return (
    <div className="ap-modal-overlay" role="dialog" aria-modal="true">
      <div className="ap-preview-box">
        <div className="ap-preview-header">
          <div>
            <h3 className="ap-preview-title">{t.previewTitle}</h3>
            <p className="ap-preview-subtitle">{t.previewSubtitle}</p>
          </div>
          <button className="ap-preview-close" onClick={onClose} aria-label={t.previewClose}>×</button>
        </div>

        {hasNewer && (
          <div className="ap-preview-newer-banner">
            <span>{t.previewNewerAvailable}</span>
            <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={onRefresh}>
              <RefreshCw size={13} />
              {t.previewRefresh}
            </button>
          </div>
        )}

        {loading && !snapshot ? (
          <div className="ap-preview-empty">
            <Loader size={20} className="ap-spin" />
            <span>{t.previewLoadingMsg}</span>
          </div>
        ) : errorMsg && !snapshot ? (
          <div className="ap-preview-empty">
            <XCircle size={20} />
            <span>{errorMsg}</span>
          </div>
        ) : !snapshot ? (
          <div className="ap-preview-empty">
            <Info size={20} />
            <span>{t.previewUnavailable}</span>
          </div>
        ) : (
          <>
            <div className="ap-preview-stats">
              <div className="ap-preview-stat">
                <div className="ap-preview-stat-val ap-stat-green-text">{assignedCount}</div>
                <div className="ap-preview-stat-lbl">{t.previewAssignedLabel}</div>
              </div>
              <div className="ap-preview-stat">
                <div className="ap-preview-stat-val ap-stat-amber-text">{unassignedCount}</div>
                <div className="ap-preview-stat-lbl">{t.previewUnassignedLabel}</div>
              </div>
              <div className="ap-preview-stat">
                <div className="ap-preview-stat-val">
                  {solverStatus === 'OPTIMAL' ? t.previewOptimalState : t.previewFeasibleState}
                </div>
                <div className="ap-preview-stat-lbl">{t.previewSolverStateLabel}</div>
              </div>
              <div className="ap-preview-stat">
                <div className="ap-preview-stat-val">{formatElapsed(Math.round(wallTime))}</div>
                <div className="ap-preview-stat-lbl">{t.previewElapsedLabel}</div>
              </div>
            </div>

            <div className="ap-preview-table-wrap">
              {assignments.length === 0 ? (
                <div className="ap-empty-hint">
                  <Info size={14} />
                  <span>{t.previewTableEmpty}</span>
                </div>
              ) : (
                <table className="ap-preview-table">
                  <thead>
                    <tr>
                      <th>{t.previewStudentCol}</th>
                      <th>{t.previewApartmentCol}</th>
                      <th>{t.previewRoomCol}</th>
                      <th>{t.previewBedCol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((row) => (
                      <tr key={row.student_db_id ?? `${row.bed_id}-${row.student_id}`}>
                        <td>{row.student_name}</td>
                        <td>{row.apartment_code}</td>
                        <td>{row.room_code}</td>
                        <td>{row.bed_label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
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

function CriticalConditionCard({ condKey, t, titleKey, highlight }) {
  const resolvedTitleKey = titleKey || condKey;
  const title = t[resolvedTitleKey] || resolvedTitleKey;
  const desc = t[`${resolvedTitleKey}Desc`];
  const desc2 = t[`${resolvedTitleKey}Desc2`];

  return (
    <div className={`ap-cond-card ap-cond-critical${highlight ? ' ap-cond-highlight' : ''}`}>
      <div className="ap-cond-icon-wrap ap-cond-icon-critical">
        <Lock size={13} />
      </div>
      <div className="ap-cond-body">
        <div className="ap-cond-name">{title}</div>
        {desc && <div className="ap-cond-desc">{desc}</div>}
        {desc2 && <div className="ap-cond-desc ap-cond-desc-2">{desc2}</div>}
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
  const [showPopulationDetails, setShowPopulationDetails] = useState(false);

  // ── Run State ───────────────────────────────
  const [isRunning, setIsRunning]   = useState(false);
  const [result, setResult]         = useState(null);
  const [runId, setRunId]           = useState(null);
  const [runStatus, setRunStatus]   = useState(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isStoppingSave, setIsStoppingSave] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Max Solver Time State ("זמן חיפוש מרבי") ──
  const [maxSolverValue, setMaxSolverValue] = useState(String(DEFAULT_SOLVER_SECONDS));
  const [maxSolverUnit, setMaxSolverUnit]   = useState('seconds');
  const [maxSolverError, setMaxSolverError] = useState('');

  // ── Current-Result Preview State ("צפה בתוצאה הנוכחית") ──
  const [isPreviewOpen, setIsPreviewOpen]     = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [previewLoading, setPreviewLoading]   = useState(false);
  const [previewErrorMsg, setPreviewErrorMsg] = useState('');
  const [previewHasNewer, setPreviewHasNewer] = useState(false);

  // ── UI State ────────────────────────────────
  const [confirmModal, setConfirmModal] = useState(null);
  const [toast, setToast]               = useState(null);
  const [expandedType, setExpandedType] = useState(null);

  // ── Search Timing State ──────────────────────
  // Anchored to the backend's AllocationRun.search_started_at (via
  // AllocationRunSerializer.elapsed_search_seconds/remaining_search_seconds
  // — see get_active_allocation_run / get_allocation_run_detail), never to
  // local React lifetime. `searchTiming` holds the last server-confirmed
  // snapshot plus the client clock at the moment it was received; the
  // ticking effect below only ever extrapolates FROM that anchor, so a
  // page navigation, refresh, or a second tab opened on /allocation all
  // recompute the same correct elapsed/remaining from persisted backend
  // state instead of restarting from zero.
  const [searchTiming, setSearchTiming] = useState(null);
  const [displayElapsed, setDisplayElapsed] = useState(0);

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
  const previewPollRef = useRef(null);
  const previewSequenceRef = useRef(0);
  const previewHasContentRef = useRef(false);

  // ── Translations ────────────────────────────
  const t = useMemo(() => {
    const strings = {
      he: {
        title: 'שיבוץ סטודנטים',
        subtitle: '',
        runAllocation: 'הפעל שיבוץ',
        running: 'מריץ שיבוץ...',
        stopAllocation: 'בטל הרצה',
        stoppingStopping: 'מבטל...',
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
        priorityFirst:     'סטודנטים בעדיפות',
        priorityFirstDesc: 'סטודנטים בעדיפות יקבלו קדימות בשיבוץ.',
        priorityFirstDesc2: 'כאשר ניתן, המערכת תעדיף ריכוז באותו בניין.',
        priorityFirstAnier:     'עדיפות אניר',
        priorityFirstAnierDesc: 'סטודנטים באניר יקבלו עדיפות לבניין 179 כאשר יש זמינות.',
        priorityFirstAnierDesc2: 'אם אין זמינות, יישקלו פתרונות מתאימים נוספים.',
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
        // Max search time (before run)
        maxSearchTimeLabel: 'זמן חיפוש מרבי',
        maxSearchTimeHint: 'השיבוץ עשוי להסתיים מוקדם יותר אם יימצא פתרון מיטבי',
        maxSearchTimeUnitSeconds: 'שניות',
        maxSearchTimeUnitMinutes: 'דקות',
        maxSearchTimeUnitHours: 'שעות',
        maxSearchTimeInvalid: 'יש להזין זמן חיפוש תקין',
        maxSearchTimeTooLow: 'זמן החיפוש המינימלי הוא שנייה אחת',
        maxSearchTimeTooHigh: 'זמן החיפוש המרבי הוא 10 שעות',
        elapsedLabel: 'זמן שעבר',
        finalSearchDurationLabel: 'זמן ריצה',
        // Current-result preview ("צפה בתוצאה הנוכחית")
        viewCurrentResult: 'צפה בתוצאה הנוכחית',
        previewTitle: 'תוצאה זמנית',
        previewSubtitle: 'האלגוריתם עדיין ממשיך לחפש פתרון טוב יותר',
        previewLoadingMsg: 'טוען תוצאה נוכחית...',
        previewUnavailable: 'טרם נמצא פתרון ראשוני. נסו שוב בעוד רגע.',
        previewAssignedLabel: 'שובצו',
        previewUnassignedLabel: 'לא שובצו',
        previewSolverStateLabel: 'מצב הפתרון',
        previewElapsedLabel: 'זמן חלף',
        previewNewerAvailable: 'נמצאה תוצאה חדשה יותר',
        previewRefresh: 'רענן תוצאה',
        previewClose: 'סגור',
        previewErrorMsg: 'שגיאה בטעינת התוצאה הנוכחית',
        previewFeasibleState: 'פתרון תקין (טרם הוכח כאופטימלי)',
        previewOptimalState: 'פתרון אופטימלי',
        previewStudentCol: 'סטודנט',
        previewApartmentCol: 'דירה',
        previewRoomCol: 'חדר',
        previewBedCol: 'מיטה',
        previewTableEmpty: 'אין עדיין שיבוצים בפתרון הזמני',
        // Stop & Save ("עצור ושמור תוצאה") - distinct from Cancel
        stopAndSave: 'עצור ושמור תוצאה',
        stoppingSave: 'עוצר ושומר...',
        stopAndSaveConfirmTitle: 'עצירה ושמירת תוצאה',
        stopAndSaveConfirmMsg: 'האם לעצור את חיפוש הפתרון ולשמור את הפתרון הטוב ביותר שנמצא עד כה? ייתכן שהפתרון לא יהיה האופטימלי ביותר האפשרי.',
        stopAndSaveSuccess: 'בקשת עצירה עם שמירה נשלחה. הפתרון הטוב ביותר שנמצא יישמר.',
        stopAndSaveError: 'שגיאה בעצירה ושמירת התוצאה',
        stoppedEarlyBadge: 'נעצר ידנית — לא הוכח כאופטימלי',
        statusStopSaveRequested: 'עוצר ושומר',
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
        stopConfirmTitle:'ביטול הרצת שיבוץ',
        stopConfirmMsg:  'האם לבטל את השיבוץ הפעיל? השיבוץ ייעצר וכל ההקצאות החלקיות יימחקו — פעולה זו אינה שומרת תוצאה. אם ברצונך לשמור את הפתרון הטוב ביותר שנמצא עד כה, השתמש/י ב"עצור ושמור תוצאה" במקום.',
        deleteConfirmTitle: 'מחיקת תוצאות שיבוץ',
        deleteConfirmMsg: 'האם למחוק את תוצאות השיבוץ? פעולה זו תבטל את כל ההקצאות שנוצרו.',
        stopSuccess:     'בקשת הביטול נשלחה. השיבוץ ייעצר בהקדם והנתונים החלקיים יימחקו.',
        stopError:       'שגיאה בביטול השיבוץ',
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
        // Population summary (imported → excluded → sent to solver)
        populationSummaryTitle: 'אוכלוסיית שיבוץ',
        populationImported:  'נקלטו',
        populationExcluded:  'הוחרגו',
        populationSentToSolver: 'נשלחו לשיבוץ',
        populationShowDetails: 'הצג פירוט',
        populationHideDetails: 'הסתר פירוט',
        populationExcludedAccessibility: 'נגישות — מיועדים לשיבוץ ידני',
        populationExcludedLeaving: 'עוזבים — אינם משתתפים בשיבוץ',
        populationExcludedOverlap: 'נמצאו בשתי הקבוצות',
        populationExcludedTotalUnique: 'סה״כ ייחודי שהוחרג',
        populationProcessed: 'עובדו',
        populationAssignedWord: 'שובצו',
        populationUnassignedWord: 'לא שובצו',
      },
      en: {
        title: 'Allocation ',
        subtitle: '',
        runAllocation: 'Run Allocation',
        running: 'Running...',
        stopAllocation: 'Cancel Run',
        stoppingStopping: 'Cancelling...',
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
        priorityFirst:     'Priority students',
        priorityFirstDesc: 'Priority students receive placement precedence.',
        priorityFirstDesc2: 'When possible, the system favors grouping them in one building.',
        priorityFirstAnier:     'ANIR priority',
        priorityFirstAnierDesc: 'ANIR students get priority for Building 179 when available.',
        priorityFirstAnierDesc2: 'If unavailable, suitable alternatives are considered.',
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
        // Max search time (before run)
        maxSearchTimeLabel: 'Maximum search time',
        maxSearchTimeHint: 'The allocation may finish earlier if an optimal solution is found',
        maxSearchTimeUnitSeconds: 'seconds',
        maxSearchTimeUnitMinutes: 'minutes',
        maxSearchTimeUnitHours: 'hours',
        maxSearchTimeInvalid: 'Enter a valid search time',
        maxSearchTimeTooLow: 'Minimum search time is 1 second',
        maxSearchTimeTooHigh: 'Maximum search time is 10 hours',
        elapsedLabel: 'Elapsed',
        finalSearchDurationLabel: 'Run time',
        // Current-result preview
        viewCurrentResult: 'View Current Result',
        previewTitle: 'Temporary Result',
        previewSubtitle: 'The algorithm is still searching for a better solution',
        previewLoadingMsg: 'Loading current result...',
        previewUnavailable: 'No feasible solution found yet. Try again shortly.',
        previewAssignedLabel: 'Assigned',
        previewUnassignedLabel: 'Unassigned',
        previewSolverStateLabel: 'Solution state',
        previewElapsedLabel: 'Elapsed',
        previewNewerAvailable: 'A newer result is available',
        previewRefresh: 'Refresh Result',
        previewClose: 'Close',
        previewErrorMsg: 'Failed to load the current result',
        previewFeasibleState: 'Feasible (not yet proven optimal)',
        previewOptimalState: 'Optimal',
        previewStudentCol: 'Student',
        previewApartmentCol: 'Apartment',
        previewRoomCol: 'Room',
        previewBedCol: 'Bed',
        previewTableEmpty: 'No assignments in the temporary result yet',
        // Stop & Save - distinct from Cancel
        stopAndSave: 'Stop & Save Result',
        stoppingSave: 'Stopping & saving...',
        stopAndSaveConfirmTitle: 'Stop & Save Result',
        stopAndSaveConfirmMsg: 'Stop searching and keep the best result found so far? It may not be the most optimal possible solution.',
        stopAndSaveSuccess: 'Stop & Save requested. The best result found will be kept.',
        stopAndSaveError: 'Failed to stop and save the result',
        stoppedEarlyBadge: 'Stopped manually — not proven optimal',
        statusStopSaveRequested: 'Stopping & saving',
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
        stopConfirmTitle:'Cancel Allocation Run',
        stopConfirmMsg:  'Cancel the active allocation run? It will stop and all partial assignments will be deleted — this does not save a result. To keep the best result found so far, use "Stop & Save Result" instead.',
        deleteConfirmTitle: 'Delete Allocation Results',
        deleteConfirmMsg: 'Delete the current allocation results? All assignments from this run will be cancelled.',
        stopSuccess:     'Cancellation requested. The run will stop shortly and partial data will be deleted.',
        stopError:       'Failed to cancel the allocation run',
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
        // Population summary (imported → excluded → sent to solver)
        populationSummaryTitle: 'Allocation Population',
        populationImported:  'imported',
        populationExcluded:  'excluded',
        populationSentToSolver: 'sent to allocation',
        populationShowDetails: 'Show details',
        populationHideDetails: 'Hide details',
        populationExcludedAccessibility: 'accessibility — handled manually',
        populationExcludedLeaving: 'leaving — do not take part in allocation',
        populationExcludedOverlap: 'in both groups',
        populationExcludedTotalUnique: 'total unique excluded',
        populationProcessed: 'processed',
        populationAssignedWord: 'assigned',
        populationUnassignedWord: 'unassigned',
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

  const safePopulationSummary = useCallback((raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const hasAnyField = [
      'imported_students', 'excluded_accessibility', 'excluded_leaving',
      'excluded_overlap', 'excluded_total', 'sent_to_solver',
    ].some((key) => raw[key] !== undefined);
    if (!hasAnyField) return null;

    return {
      imported_students:      Number(raw.imported_students) || 0,
      excluded_accessibility: Number(raw.excluded_accessibility) || 0,
      excluded_leaving:       Number(raw.excluded_leaving) || 0,
      excluded_overlap:       Number(raw.excluded_overlap) || 0,
      excluded_total:         Number(raw.excluded_total) || 0,
      sent_to_solver:         Number(raw.sent_to_solver) || 0,
      assigned:   raw.assigned !== undefined ? Number(raw.assigned) || 0 : null,
      unassigned: raw.unassigned !== undefined ? Number(raw.unassigned) || 0 : null,
    };
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
      population_summary:  safePopulationSummary(data.population_summary),
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
  }, [t.malformedSummary, unwrapResponse, safePopulationSummary]);

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

  const stopPreviewPolling = useCallback(() => {
    if (previewPollRef.current) {
      clearInterval(previewPollRef.current);
      previewPollRef.current = null;
    }
  }, []);

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false);
    stopPreviewPolling();
  }, [stopPreviewPolling]);

  // Fetches the current-best-solution snapshot without ever stopping the
  // solver or touching BedAssignment/Student - a pure read (see backend
  // get_allocation_run_preview). `force` accepts whatever the server has
  // right now even if it's newer than what's displayed (used by the
  // "רענן תוצאה" button); otherwise a newer snapshot than what's already
  // shown just flips previewHasNewer instead of silently swapping the
  // table out from under the user.
  const fetchPreview = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!runId) return;
    if (!silent) setPreviewLoading(true);
    if (!silent) setPreviewErrorMsg('');

    try {
      const data = await allocationAPI.getPreview(runId);
      if (!mountedRef.current) return;

      if (!data?.available || !data.snapshot) {
        return;
      }

      const incomingSeq = Number(data.snapshot.sequence) || 0;
      const shouldReplace =
        force || !previewHasContentRef.current || incomingSeq === previewSequenceRef.current;

      if (shouldReplace) {
        previewSequenceRef.current = incomingSeq;
        previewHasContentRef.current = true;
        setPreviewSnapshot(data.snapshot);
        setPreviewHasNewer(false);
      } else if (incomingSeq > previewSequenceRef.current) {
        setPreviewHasNewer(true);
      }
    } catch (err) {
      if (!silent) setPreviewErrorMsg(getErrorMessage(err) || t.previewErrorMsg);
    } finally {
      if (!silent) setPreviewLoading(false);
    }
  }, [runId, t.previewErrorMsg]);

  const openPreview = useCallback(() => {
    if (!runId) return;
    setIsPreviewOpen(true);
    fetchPreview();
    stopPreviewPolling();
    previewPollRef.current = setInterval(() => {
      fetchPreview({ silent: true }).catch(() => {});
    }, PREVIEW_POLL_INTERVAL_MS);
  }, [runId, fetchPreview, stopPreviewPolling]);

  const refreshPreviewToLatest = useCallback(() => {
    fetchPreview({ force: true }).catch(() => {});
  }, [fetchPreview]);

  // Validates the "זמן חיפוש מרבי" input against the same bounds the
  // backend enforces (MIN_USER_SOLVER_TIME_SECONDS/MAX_USER_SOLVER_TIME_SECONDS
  // in allocation/solver.py) so an invalid value is caught before ever
  // reaching the server.
  const validateMaxSolverTime = useCallback(() => {
    const numeric = Number(maxSolverValue);
    if (!maxSolverValue || !Number.isFinite(numeric) || numeric <= 0) {
      return t.maxSearchTimeInvalid;
    }
    const seconds = numeric * (SOLVER_UNIT_TO_SECONDS[maxSolverUnit] || 1);
    if (seconds < MIN_SOLVER_SECONDS) return t.maxSearchTimeTooLow;
    if (seconds > MAX_SOLVER_SECONDS) return t.maxSearchTimeTooHigh;
    return '';
  }, [maxSolverValue, maxSolverUnit, t]);

  const maxSolverSecondsValue = useMemo(() => {
    const numeric = Number(maxSolverValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric * (SOLVER_UNIT_TO_SECONDS[maxSolverUnit] || 1);
  }, [maxSolverValue, maxSolverUnit]);

  const formatElapsed = (secs) => {
    const total = Math.max(0, Math.round(Number(secs) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
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

  // Building 179 / ANIR preferential placement only applies within the
  // Upper dorm region (גוש עליון, region id "gush-elyon" — the region that
  // owns DormType code=15 / כפר הסמכה, see allocation.solver
  // _may_use_building_179_automatically). Every other region shows the
  // generic priority-placement message instead.
  const isUpperDorm = summary?.region?.id === 'gush-elyon';

  // The progress bar represents ONLY elapsed-vs-configured-max search
  // time — never algorithm/optimality completion. CP-SAT gives no live
  // signal for "how close to done" beyond elapsed time itself (see the
  // optimality-proof investigation), so this bar must not be read as
  // "X% solved."
  const progressPct = searchTiming?.maxSearchSeconds
    ? Math.min(100, Math.round((displayElapsed / searchTiming.maxSearchSeconds) * 100))
    : 0;
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

    if (isRunning && isStoppingSave) {
      return 'stop_and_save_requested';
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
    isStoppingSave,
    hasCurrentAllocation,
  ]);

  // Cancel ("בטל הרצה") and Stop & Save ("עצור ושמור תוצאה") are mutually
  // exclusive requests once one is in flight - both hide as soon as
  // either isStopping or isStoppingSave becomes true, matching the
  // backend's own race guard (whichever request wins the row lock first
  // "claims" the stop; the other gets 409).
  const isStopRequested = isStopping || isStoppingSave;

  const showCancelBtn =
    isRunning &&
    !isStopRequested &&
    Boolean(runId) &&
    canRun;

  const showStopSaveBtn =
    isRunning &&
    !isStopRequested &&
    Boolean(runId) &&
    canRun;

  // Viewing the current result stays available even while a stop is in
  // flight (it's a harmless read of the last known snapshot).
  const showPreviewBtn =
    isRunning &&
    Boolean(runId);

  const showDelBtn =
    hasCurrentAllocation &&
    runStatus === 'completed' &&
    !isRunning &&
    Boolean(result) &&
    Boolean(runId) &&
    canRun;

  // ── Search Timing Display (ticks locally, anchored to the backend) ──
  // Extrapolates from `searchTiming` (last server-confirmed snapshot) using
  // the client clock only for smooth per-second display between the 3s
  // polling ticks — never as the source of truth. Every poll response
  // re-anchors `searchTiming` (see applySearchTiming), so this self-heals
  // after navigating away/back, a refresh, tab throttling, etc. instead of
  // drifting or restarting from zero.
  useEffect(() => {
    if (!searchTiming) {
      setDisplayElapsed(0);
      return;
    }

    const tick = () => {
      if (!mountedRef.current) return;
      if (searchTiming.live) {
        const nextElapsed = searchTiming.elapsedAtSync + (Date.now() - searchTiming.syncedAtClientMs) / 1000;
        setDisplayElapsed(nextElapsed);
      } else {
        // Terminal / not-yet-searching snapshot: frozen, no ticking.
        setDisplayElapsed(searchTiming.elapsedAtSync);
      }
    };

    tick();
    if (!searchTiming.live) return undefined;

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [searchTiming]);

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

  // Seeds/refreshes the backend-anchored search-timing snapshot from a
  // serialized AllocationRun (see AllocationRunSerializer.elapsed_search_seconds
  // / remaining_search_seconds). Called on every poll tick and whenever a
  // run is (re)discovered, so the anchor self-corrects continuously
  // instead of ever depending on when this component happened to mount.
  const applySearchTiming = useCallback((runData) => {
    if (!runData) {
      setSearchTiming(null);
      return;
    }
    const max = runData.max_search_seconds != null ? Number(runData.max_search_seconds) : null;
    const elapsed = Number(runData.elapsed_search_seconds) || 0;
    const remaining = runData.remaining_search_seconds != null ? Number(runData.remaining_search_seconds) : null;
    setSearchTiming({
      maxSearchSeconds: max,
      elapsedAtSync: elapsed,
      remainingAtSync: remaining,
      syncedAtClientMs: Date.now(),
      live: LIVE_RUN_STATUSES.includes(runData.status),
    });
  }, []);

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
        applySearchTiming(runData);

        if (st === 'completed') {
          stopPolling();
          closePreview();
          setIsRunning(false);
          setIsStopping(false);
          setIsStoppingSave(false);
          setResult({
            successful_assignments: data.successful_assignments ?? runData?.successful_assignments ?? 0,
            roommate_matches:       data.roommate_matches ?? runData?.roommate_matches ?? 0,
            conflicts:              data.conflicts ?? runData?.conflicts ?? 0,
            assignments:            data.assignments ?? [],
            population_summary:     safePopulationSummary(data.population_summary),
            solver_status:          data.solver_status ?? null,
            optimality_proven:      Boolean(data.optimality_proven),
            stopped_early_by_user:  Boolean(data.stopped_early_by_user),
            // Frozen final search duration (backend-computed, see
            // AllocationRunSerializer.elapsed_search_seconds) — shown as
            // "זמן ריצה" after completion, distinct from the live-preview's
            // own wall_time (PreviewPanel keeps its own separate label).
            final_search_seconds:   runData?.elapsed_search_seconds ?? null,
            run:                    runData,
          });
          loadPage().catch(() => {});
          if (data.stopped_early_by_user) showToast(t.stopAndSaveSuccess, 'success');
        } else if (st === 'stopped' || st === 'failed' || st === 'deleted') {
          stopPolling();
          closePreview();
          setIsRunning(false);
          setIsStopping(false);
          setIsStoppingSave(false);
          setResult(null);
          setRunId(null);
          setRunStatus(null);
          loadPage().catch(() => {});
          if (st === 'stopped')      showToast(t.stoppedStatus, 'info');
          else if (st === 'failed')  showToast(runData?.error_message || t.unknownError, 'error');
        } else if (st === 'cancellation_requested') {
          setIsStopping(true);
        } else if (st === 'stop_and_save_requested') {
          setIsStoppingSave(true);
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, 3000);
  }, [stopPolling, closePreview, loadPage, showToast, t.stoppedStatus, t.unknownError, t.stopAndSaveSuccess, safePopulationSummary, applySearchTiming]);

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

      const activeStatuses = LIVE_RUN_STATUSES;

      /*
       * הרצה שרצה כרגע נשחזר תמיד,
       * גם אם עדיין לא נוצרו שיבוצים.
       */
      if (activeStatuses.includes(run.status)) {
        setRunId(run.id);
        setRunStatus(run.status);
        setIsRunning(true);
        applySearchTiming(run);

        if (
          run.status ===
          'cancellation_requested'
        ) {
          setIsStopping(true);
        }

        if (
          run.status ===
          'stop_and_save_requested'
        ) {
          setIsStoppingSave(true);
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

              population_summary:
                safePopulationSummary(detail.population_summary),

              final_search_seconds:
                detail.run?.elapsed_search_seconds ?? null,

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
  [startPolling, safePopulationSummary, applySearchTiming]
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
      stopPreviewPolling();
    };
  }, [stopPolling, stopPreviewPolling]);

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
    if (isRunning || isStopping || isStoppingSave || isDeleting) return;

    const maxTimeError = validateMaxSolverTime();
    if (maxTimeError) {
      setMaxSolverError(maxTimeError);
      return;
    }
    setMaxSolverError('');

    setIsRunning(true);
    setResult(null);
    setError(null);
    setRunId(null);
    setRunStatus(null);
    setSearchTiming(null);
    setPreviewSnapshot(null);
    setPreviewHasNewer(false);
    previewSequenceRef.current = 0;
    previewHasContentRef.current = false;

    const regionId = resolveRegionId();
    if (!regionId) {
      setIsRunning(false);
      setError(t.noRegion);
      return;
    }

    try {
      const responseRaw = await allocationAPI.startRun(regionId, {
        constraints: effectiveConfig,
        max_solver_seconds: maxSolverSecondsValue,
      });
      const response = unwrapResponse(responseRaw);
      const id = response?.run_id || response?.run?.id;
      if (!id) throw new Error(t.missingRunId);

      setRunId(id);
      setRunStatus('queued');
      applySearchTiming(response?.run);
      startPolling(id);

      if (inboxItem?.id) {
        inboxAPI.markProcessed(inboxItem.id).catch(() => {});
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setIsRunning(false);
      setRunId(null);
      setRunStatus(null);
      setSearchTiming(null);
    }
  };

  const requestStopAllocation = () => {
    if (!runId) { showToast(t.missingRunId, 'error'); return; }
    if (isStopping || isStoppingSave) return;
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

  const requestStopAndSave = () => {
    if (!runId) { showToast(t.missingRunId, 'error'); return; }
    if (isStopping || isStoppingSave) return;
    setConfirmModal({
      title: t.stopAndSaveConfirmTitle,
      message: t.stopAndSaveConfirmMsg,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsStoppingSave(true);
        try {
          await allocationAPI.stopAndSave(runId);
          showToast(t.stopAndSaveSuccess, 'info');
          setRunStatus('stop_and_save_requested');
        } catch (err) {
          showToast(getErrorMessage(err) || t.stopAndSaveError, 'error');
          setIsStoppingSave(false);
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
setSearchTiming(null);
setIsRunning(false);
setIsStopping(false);

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
  const regionLabel = summary?.region ? localizeRegionName(summary.region, language) : null;

  // ── Render ───────────────────────────────────
  return (
    <div className="ap-page">
      <ToastNotification toast={toast} />
      <ConfirmDialog modal={confirmModal} t={t} onClose={() => setConfirmModal(null)} />
      <PreviewPanel
        open={isPreviewOpen}
        loading={previewLoading}
        errorMsg={previewErrorMsg}
        snapshot={previewSnapshot}
        hasNewer={previewHasNewer}
        t={t}
        onClose={closePreview}
        onRefresh={refreshPreviewToLatest}
        formatElapsed={formatElapsed}
      />

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
              {/* Frozen final search duration, only after completion — no
                  max/remaining shown here, matching the live card. The
                  live-preview's own elapsed label (PreviewPanel) stays
                  entirely separate and is never conflated with this. */}
              {!isRunning && result?.final_search_seconds != null && (
                <div className="ap-last-run">
                  <Clock size={13} />
                  <span>{t.finalSearchDurationLabel}: {formatElapsed(result.final_search_seconds)}</span>
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

        {/* ── 1b. Population Summary (compact) ── */}
        {(() => {
          const activePopulation =
            (hasCurrentAllocation && result?.population_summary)
              ? result.population_summary
              : summary?.population_summary;
          if (!activePopulation) return null;

          const {
            imported_students, excluded_accessibility, excluded_leaving,
            excluded_overlap, excluded_total, sent_to_solver, assigned, unassigned,
          } = activePopulation;

          return (
            <div className="ap-population-card">
              <div className="ap-population-row">
                <span className="ap-population-chip ap-population-chip-blue">
                  {imported_students} {t.populationImported}
                </span>
                <span className="ap-population-arrow">→</span>
                <span className="ap-population-chip ap-population-chip-amber">
                  {excluded_total} {t.populationExcluded}
                </span>
                <span className="ap-population-arrow">→</span>
                <span className="ap-population-chip ap-population-chip-green">
                  {sent_to_solver} {t.populationSentToSolver}
                </span>

                {excluded_total > 0 && (
                  <button
                    type="button"
                    className="ap-population-toggle"
                    onClick={() => setShowPopulationDetails((prev) => !prev)}
                    aria-expanded={showPopulationDetails}
                  >
                    {showPopulationDetails ? t.populationHideDetails : t.populationShowDetails}
                  </button>
                )}
              </div>

              {showPopulationDetails && excluded_total > 0 && (
                <ul className="ap-population-details">
                  <li>{excluded_accessibility} {t.populationExcludedAccessibility}</li>
                  <li>{excluded_leaving} {t.populationExcludedLeaving}</li>
                  {excluded_overlap > 0 && (
                    <li>{excluded_overlap} {t.populationExcludedOverlap}</li>
                  )}
                  <li className="ap-population-details-total">
                    {t.populationExcludedTotalUnique}: {excluded_total}
                  </li>
                </ul>
              )}

              {typeof assigned === 'number' && typeof unassigned === 'number' && (
                <div className="ap-population-processed">
                  {sent_to_solver} {t.populationProcessed} = {assigned} {t.populationAssignedWord} + {unassigned} {t.populationUnassignedWord}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── 1c. Max Search Time (before run) ── */}
        {!isRunning && (
          <div className="ap-card ap-maxtime-card">
            <div className="ap-maxtime-row">
              <label className="ap-maxtime-label" htmlFor="ap-maxtime-value">
                {t.maxSearchTimeLabel}
              </label>
              <div className="ap-maxtime-inputs">
                <input
                  id="ap-maxtime-value"
                  type="number"
                  min="1"
                  step="1"
                  className="ap-number-input"
                  value={maxSolverValue}
                  onChange={(e) => {
                    setMaxSolverValue(e.target.value);
                    if (maxSolverError) setMaxSolverError('');
                  }}
                  disabled={isRunning}
                  aria-label={t.maxSearchTimeLabel}
                />
                <select
                  className="ap-unit-select"
                  value={maxSolverUnit}
                  onChange={(e) => {
                    setMaxSolverUnit(e.target.value);
                    if (maxSolverError) setMaxSolverError('');
                  }}
                  disabled={isRunning}
                  aria-label={t.maxSearchTimeLabel}
                >
                  <option value="seconds">{t.maxSearchTimeUnitSeconds}</option>
                  <option value="minutes">{t.maxSearchTimeUnitMinutes}</option>
                  <option value="hours">{t.maxSearchTimeUnitHours}</option>
                </select>
              </div>
            </div>
            {maxSolverError ? (
              <div className="ap-maxtime-error">
                <AlertTriangle size={13} />
                <span>{maxSolverError}</span>
              </div>
            ) : (
              <p className="ap-maxtime-hint">{t.maxSearchTimeHint}</p>
            )}
          </div>
        )}

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
                <>
                  <RefreshCw size={15} className="ap-spin" />
                  {isStopping ? t.stoppingStopping : isStoppingSave ? t.stoppingSave : t.running}
                </>
              ) : (
                <><Play size={15} /> {t.runAllocation}</>
              )}
            </button>

            {/* View Current Result ("צפה בתוצאה הנוכחית") - never stops the solver */}
            {showPreviewBtn && (
              <button className="ap-btn ap-btn-ghost" onClick={openPreview}>
                <Info size={15} />
                {t.viewCurrentResult}
              </button>
            )}

            {/* Stop & Save ("עצור ושמור תוצאה") - keeps the best feasible result */}
            {showStopSaveBtn && (
              <button className="ap-btn ap-btn-warning" onClick={requestStopAndSave} disabled={isStopRequested}>
                <Square size={15} />
                {t.stopAndSave}
              </button>
            )}

            {/* Cancel ("בטל הרצה") - discards any partial work, smaller/secondary */}
            {showCancelBtn && (
              <button className="ap-btn ap-btn-ghost-danger ap-btn-sm" onClick={requestStopAllocation} disabled={isStopRequested}>
                <Square size={13} />
                {t.stopAllocation}
              </button>
            )}

            {/* Stopping indicator */}
            {isStopRequested && !showStopSaveBtn && (
              <div className="ap-inline-chip ap-chip-amber">
                <Loader size={13} className="ap-spin" />
                {isStoppingSave ? t.stoppingSave : t.stoppingStopping}
              </div>
            )}
          </div>

          <div className="ap-controls-right">
            {/* View Results - always available: it shows the current
                effective allocation stored in the DB, not just the result
                of a run just executed in this browser session. */}
            <button
              className="ap-btn ap-btn-ghost"
              onClick={handleViewResults}
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
                <span>
                  {isStopping ? t.stoppingStopping : isStoppingSave ? t.stoppingSave : t.progressTitle}
                </span>
              </div>
              <div className="ap-progress-timer">
                <Clock size={13} />
                <span>{t.elapsedLabel}</span>
                <span>{formatElapsed(displayElapsed)}</span>
              </div>
            </div>

            {/* Bar = elapsed / configured max search time ONLY — never an
                algorithm/optimality-completion estimate. CP-SAT gives no
                live "how close to done" signal beyond elapsed time; do not
                relabel this as "% completed". Anchored to the backend
                (AllocationRun.search_started_at via elapsed_search_seconds),
                never to how long this page happened to be open — survives
                navigation, refresh, and a second tab. This is a MAXIMUM,
                not a promise: an earlier OPTIMAL proof stops the solver
                (and this bar) sooner. */}
            <div className="ap-progress-bar-wrap">
              <div className="ap-progress-bar">
                <div className="ap-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="ap-progress-pct">{progressPct}%</span>
            </div>

            <div className="ap-progress-detail">
              <span className="ap-progress-chip">
                <Users size={12} />
                {summary?.unassigned_students || 0} {t.students}
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
                  <CriticalConditionCard
                    key={key}
                    condKey={key}
                    t={t}
                    titleKey={key === 'priorityFirst' && isUpperDorm ? 'priorityFirstAnier' : undefined}
                    highlight={key === 'priorityFirst'}
                  />
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

  /* ── Population Summary (compact) ─────────── */
  .ap-population-card {
    background: #fff;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ap-population-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ap-population-chip {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 700;
    white-space: nowrap;
  }
  .ap-population-chip-blue  { background: var(--ap-blue-soft);  border: 1px solid var(--ap-blue-border);  color: var(--ap-blue); }
  .ap-population-chip-amber { background: var(--ap-amber-soft); border: 1px solid var(--ap-amber-border); color: var(--ap-amber); }
  .ap-population-chip-green { background: var(--ap-green-soft); border: 1px solid var(--ap-green-border); color: var(--ap-green); }
  .ap-population-arrow {
    color: var(--ap-text-2);
    font-size: 13px;
  }
  .ap-population-toggle {
    margin-inline-start: auto;
    background: none;
    border: none;
    color: var(--ap-blue);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 4px;
  }
  .ap-population-toggle:hover { text-decoration: underline; }
  .ap-population-details {
    margin: 0;
    padding-inline-start: 18px;
    font-size: 12.5px;
    color: var(--ap-text-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ap-population-details-total {
    font-weight: 700;
    color: var(--ap-text);
    list-style: none;
    margin-inline-start: -18px;
    margin-top: 2px;
  }
  .ap-population-processed {
    font-size: 12.5px;
    color: var(--ap-text-2);
    font-weight: 600;
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

  .ap-btn-warning {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #fff;
    border-color: rgba(217,119,6,0.25);
    box-shadow: 0 4px 12px rgba(217,119,6,0.22);
  }
  .ap-btn-warning:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.04); }

  .ap-btn-sm {
    padding: 7px 12px;
    font-size: 12.5px;
  }

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

  .ap-cond-desc-2 {
    margin-top: 1px;
  }

  .ap-cond-highlight {
    background: linear-gradient(135deg, rgba(217,119,6,0.05), rgba(217,119,6,0.015));
    border-color: rgba(217,119,6,0.16);
  }

  .ap-cond-highlight .ap-cond-icon-critical {
    background: rgba(217,119,6,0.10);
    border-color: rgba(217,119,6,0.20);
    color: var(--ap-amber);
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

  /* ── Max Search Time ("זמן חיפוש מרבי") ──── */
  .ap-maxtime-card {
    padding: 16px 20px;
  }
  .ap-maxtime-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .ap-maxtime-label {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--ap-text);
  }
  .ap-maxtime-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ap-number-input {
    width: 96px;
    padding: 8px 12px;
    border-radius: var(--ap-radius-xs);
    border: 1px solid var(--ap-border-m);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ap-text);
    font-family: inherit;
    background: var(--ap-surface);
    text-align: center;
  }
  .ap-number-input:focus, .ap-unit-select:focus {
    outline: none;
    border-color: var(--ap-blue-border);
    box-shadow: 0 0 0 3px var(--ap-blue-soft);
  }
  .ap-unit-select {
    padding: 8px 12px;
    border-radius: var(--ap-radius-xs);
    border: 1px solid var(--ap-border-m);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ap-text);
    font-family: inherit;
    background: var(--ap-surface);
    cursor: pointer;
  }
  .ap-maxtime-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--ap-muted);
    font-weight: 500;
  }
  .ap-maxtime-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 12px;
    font-weight: 700;
    color: var(--ap-red);
  }

  /* ── Preview Panel ("תוצאה זמנית") ────────── */
  .ap-preview-box {
    background: var(--ap-surface);
    border-radius: 18px;
    box-shadow: 0 20px 60px rgba(15,23,42,0.22);
    padding: 24px;
    max-width: 720px;
    width: 100%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    animation: ap-modal-in 0.2s ease;
  }
  .ap-preview-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
  }
  .ap-preview-title {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 800;
    color: var(--ap-text);
  }
  .ap-preview-subtitle {
    margin: 0;
    font-size: 13px;
    color: var(--ap-amber);
    font-weight: 600;
  }
  .ap-preview-close {
    background: rgba(15,23,42,0.05);
    border: none;
    border-radius: 8px;
    width: 30px;
    height: 30px;
    font-size: 18px;
    line-height: 1;
    color: var(--ap-text-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .ap-preview-close:hover { background: rgba(15,23,42,0.1); }

  .ap-preview-newer-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    margin: 10px 0;
    border-radius: var(--ap-radius-sm);
    background: var(--ap-amber-soft);
    border: 1px solid var(--ap-amber-border);
    color: var(--ap-amber);
    font-size: 13px;
    font-weight: 700;
  }

  .ap-preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 48px 16px;
    color: var(--ap-muted);
    font-size: 13.5px;
    font-weight: 600;
  }

  .ap-preview-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin: 14px 0;
  }
  .ap-preview-stat {
    text-align: center;
    padding: 10px 8px;
    border-radius: var(--ap-radius-sm);
    background: var(--ap-surface-2);
    border: 1px solid var(--ap-border);
  }
  .ap-preview-stat-val {
    font-size: 16px;
    font-weight: 800;
    color: var(--ap-text);
  }
  .ap-preview-stat-lbl {
    font-size: 11px;
    color: var(--ap-muted);
    font-weight: 600;
    margin-top: 2px;
  }

  .ap-preview-table-wrap {
    overflow-y: auto;
    border-radius: var(--ap-radius-sm);
    border: 1px solid var(--ap-border);
  }
  .ap-preview-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .ap-preview-table thead th {
    position: sticky;
    top: 0;
    background: var(--ap-surface-2);
    text-align: right;
    padding: 9px 12px;
    font-weight: 700;
    color: var(--ap-text-2);
    border-bottom: 1px solid var(--ap-border);
  }
  .ap-preview-table tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--ap-border);
    color: var(--ap-text);
  }
  .ap-preview-table tbody tr:last-child td { border-bottom: none; }
  .ap-preview-table tbody tr:hover { background: var(--ap-surface-2); }

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
