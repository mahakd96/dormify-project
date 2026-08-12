import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeAPI } from '../services/api';
import {
  Users, Upload, AlertTriangle, Clock, Shuffle, Inbox, Star,
  ArrowLeftRight, FileText, CheckCircle, Circle, RefreshCw,
  Building2, BarChart3, BedDouble, Percent, MapPin, ChevronRight, ChevronLeft,
  Sunrise, Sun, Sunset, Moon, ArrowRight, ArrowLeft,
} from 'lucide-react';

const ICONS = {
  users: Users,
  upload: Upload,
  'alert-triangle': AlertTriangle,
  clock: Clock,
  shuffle: Shuffle,
  inbox: Inbox,
  star: Star,
  'arrow-left-right': ArrowLeftRight,
  'file-text': FileText,
  'check-circle': CheckCircle,
  percent: Percent,
};

// The API still returns 'regions-pending-review' (kept server-side for
// backend regression coverage - see views.py's home_dashboard), but it isn't
// clickable and isn't useful enough for Central Admin, so it's replaced here
// by the 'regions-high-occupancy' card instead of being rendered.
const ATTENTION_IDS_HIDDEN_FROM_UI = new Set(['regions-pending-review']);

const WORKFLOW_LABELS = {
  upload: { he: 'העלאת קובץ', en: 'File upload' },
  data_review: { he: 'סקירת נתונים', en: 'Data review' },
  regional_processing: { he: 'עיבוד אזורי', en: 'Regional processing' },
  allocation: { he: 'שיבוץ', en: 'Allocation' },
  results_review: { he: 'סקירת תוצאות', en: 'Results review' },
};

const STAGE_META = {
  completed: { colorClass: 'stage-completed', Icon: CheckCircle },
  active: { colorClass: 'stage-active', Icon: Circle },
  attention: { colorClass: 'stage-attention', Icon: AlertTriangle },
  waiting: { colorClass: 'stage-waiting', Icon: Clock },
};

const SEVERITY_META = {
  error: { colorClass: 'severity-error' },
  warning: { colorClass: 'severity-warning' },
  info: { colorClass: 'severity-info' },
};

function getGreeting(language) {
  const hour = new Date().getHours();
  if (language === 'he') {
    if (hour < 5) return { text: 'לילה טוב', Icon: Moon };
    if (hour < 12) return { text: 'בוקר טוב', Icon: Sunrise };
    if (hour < 17) return { text: 'צהריים טובים', Icon: Sun };
    if (hour < 21) return { text: 'ערב טוב', Icon: Sunset };
    return { text: 'לילה טוב', Icon: Moon };
  }
  if (hour < 5) return { text: 'Good night', Icon: Moon };
  if (hour < 12) return { text: 'Good morning', Icon: Sunrise };
  if (hour < 17) return { text: 'Good afternoon', Icon: Sun };
  if (hour < 21) return { text: 'Good evening', Icon: Sunset };
  return { text: 'Good night', Icon: Moon };
}

function formatTimestamp(iso, language, opts) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(language === 'he' ? 'he-IL' : 'en-US', opts || {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Purely a display-layer computation over already-returned real timestamps -
// no new business logic, just "which of these known dates is newest".
function getLastUpdateIso(process) {
  const candidates = [
    process?.latest_batch?.created_at,
    process?.active_run?.started_at,
    process?.active_run?.completed_at,
    process?.latest_run?.started_at,
    process?.latest_run?.completed_at,
    process?.latest_inbox?.processed_at,
    process?.latest_inbox?.viewed_at,
    process?.latest_inbox?.created_at,
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, iso) => (new Date(iso) > new Date(latest) ? iso : latest));
}

// Which workflow stage the hero should highlight: the most urgent one first,
// then whatever is actively moving, otherwise the furthest completed stage.
function getHeroStage(workflow) {
  if (!Array.isArray(workflow) || workflow.length === 0) return null;
  return (
    workflow.find((s) => s.status === 'attention') ||
    workflow.find((s) => s.status === 'active') ||
    [...workflow].reverse().find((s) => s.status === 'completed') ||
    workflow[0]
  );
}

function HomePage({ language }) {
  const auth = useAuth();
  const { user, isCentralAdmin, isRegionBoss, isEmployee } = auth;
  const navigate = useNavigate();
  const isRTL = language === 'he';
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;
  const ChevronIcon = isRTL ? ChevronLeft : ChevronRight;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const t = {
    he: {
      // The large hero heading reads as a role-oriented welcome for every
      // role, instead of the stored account/user name - the smaller
      // hero-pill badge below it still shows the actual role_display
      // untouched (e.g. "מנהל מרכזי").
      userName: isCentralAdmin() ? 'מרכז הניהול שלך'
        : isRegionBoss() ? 'מרכז האזור שלך'
        : isEmployee() ? 'סביבת העבודה שלך'
        : (user?.name || user?.first_name || 'משתמש'),
      requiresAttention: 'דורש טיפול',
      noAttention: 'אין נושאים דחופים כרגע',
      noAttentionSub: 'כל תהליכי השיבוץ מתנהלים כרגיל ואין פעולות ממתינות.',
      workflowTitle: 'שלבי התהליך',
      quickActions: 'פעולות מהירות',
      metricsTitle: 'מדדים עיקריים',
      recentActivity: 'פעילות אחרונה',
      noActivity: 'אין פעילות להצגה כרגע',
      noAction: 'הכל מטופל - אין פעולה נדרשת כרגע',
      retry: 'נסו שוב',
      loadError: 'אירעה שגיאה בטעינת הנתונים',
      loading: 'טוען נתונים...',
      assignedStudents: 'סטודנטים משובצים',
      unassignedStudents: 'ממתינים לשיבוץ',
      occupancyRate: 'אחוז תפוסה',
      availableBeds: 'מיטות פנויות',
      pendingRequests: 'בקשות ממתינות',
      systemWide: 'תצוגה מערכתית',
      lastUpdated: 'עדכון אחרון',
      currentStage: 'שלב נוכחי',
      ofTotal: 'מתוך הכל',
      needsReview: 'דורש סקירה',
      allClear: 'הכל תקין',
      occupied: 'פנויות כעת',
    },
    en: {
      userName: isCentralAdmin() ? 'Your Management Center'
        : isRegionBoss() ? 'Your Regional Center'
        : isEmployee() ? 'Your Workspace'
        : (user?.name || user?.first_name || 'User'),
      requiresAttention: 'Requires Attention',
      noAttention: 'No urgent issues right now',
      noAttentionSub: 'All allocation processes are on track — nothing is waiting on you.',
      workflowTitle: 'Process Stages',
      quickActions: 'Quick Actions',
      metricsTitle: 'Key Metrics',
      recentActivity: 'Recent Activity',
      noActivity: 'No recent activity to show',
      noAction: 'All caught up — nothing needs your action right now',
      retry: 'Retry',
      loadError: 'Something went wrong while loading this page',
      loading: 'Loading…',
      assignedStudents: 'Assigned Students',
      unassignedStudents: 'Pending Assignment',
      occupancyRate: 'Occupancy Rate',
      availableBeds: 'Available Beds',
      pendingRequests: 'Pending Requests',
      systemWide: 'System-wide',
      lastUpdated: 'Last updated',
      currentStage: 'Current stage',
      ofTotal: 'of total',
      needsReview: 'Needs review',
      allClear: 'All clear',
      occupied: 'available now',
    },
  }[language] || {};

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await homeAPI.get();
      setData(result);
    } catch (err) {
      setError(err?.message || t.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.loadError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const greeting = getGreeting(language);
  const roleLabel = data?.user?.role_display || user?.role || '';
  const regionLabel = data?.user?.region_name;
  const heroStage = data ? getHeroStage(data.workflow) : null;
  const lastUpdateIso = data ? getLastUpdateIso(data.process) : null;
  const quickActions = buildQuickActions({ auth, language, isCentralAdmin, isRegionBoss, isEmployee });

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-main">
          <span className="hero-eyebrow">
            <greeting.Icon size={15} />
            {greeting.text}
          </span>
          <h1 className="hero-name">{t.userName}</h1>
          <div className="hero-pills">
            {roleLabel && <span className="hero-pill">{roleLabel}</span>}
            {regionLabel ? (
              <span className="hero-pill hero-pill-outline"><MapPin size={12} />{regionLabel}</span>
            ) : data?.scope === 'system' ? (
              <span className="hero-pill hero-pill-outline"><MapPin size={12} />{t.systemWide}</span>
            ) : null}
            {heroStage && (
              <span className={`hero-pill hero-pill-stage stage-pill-${heroStage.status}`}>
                {t.currentStage}: {language === 'he' ? heroStage.label_he : heroStage.label_en}
              </span>
            )}
          </div>
          {data && <p className="hero-situation">{language === 'he' ? data.situation_he : data.situation_en}</p>}
        </div>

        {!loading && !error && data && (
          <div className="hero-action-panel">
            {lastUpdateIso && (
              <span className="hero-updated">
                {t.lastUpdated}: <bdi>{formatTimestamp(lastUpdateIso, language)}</bdi>
              </span>
            )}
            {data.primary_action ? (
              <button
                type="button"
                className="hero-primary-btn"
                onClick={() => navigate(data.primary_action.route)}
              >
                {language === 'he' ? data.primary_action.label_he : data.primary_action.label_en}
                <ArrowIcon size={16} />
              </button>
            ) : (
              <div className="hero-all-good">
                <CheckCircle size={16} />
                {t.noAction}
              </div>
            )}
          </div>
        )}
      </section>

      {!loading && !error && quickActions.length > 0 && (
        <div className="quick-actions-strip">
          <span className="quick-actions-label">{t.quickActions}</span>
          <div className="quick-actions-scroller">
            {quickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className="quick-action-chip"
                onClick={() => navigate(action.route)}
              >
                <action.Icon size={15} />
                {language === 'he' ? action.labelHe : action.labelEn}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="state-panel">
          <RefreshCw size={22} className="spin" />
          <p>{t.loading}</p>
        </div>
      )}

      {!loading && error && (
        <div className="state-panel error-panel">
          <AlertTriangle size={22} />
          <p>{error}</p>
          <button type="button" className="retry-btn" onClick={fetchData}>
            <RefreshCw size={16} />
            {t.retry}
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <AttentionSection
            items={data.attention_items}
            language={language}
            navigate={navigate}
            t={t}
            ChevronIcon={ChevronIcon}
          />

          <KpiRow data={data} language={language} navigate={navigate} t={t} />

          <div className="lower-grid">
            <WorkflowStrip workflow={data.workflow} language={language} />
            <RecentActivitySection
              items={data.recent_activity}
              language={language}
              navigate={navigate}
              t={t}
            />
          </div>
        </>
      )}

      <style>{`
        .home-page { padding: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 100%; }

        /* ---------- Hero ---------- */
        .hero {
          position: relative; overflow: hidden;
          display: flex; align-items: center; justify-content: space-between; gap: 24px;
          background: linear-gradient(120deg, #0f172a 0%, #1e293b 48%, #1e3a8a 130%);
          border-radius: 18px; padding: 26px 30px;
          box-shadow: 0 10px 30px rgba(15,23,42,0.25);
        }
        .hero-glow {
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(480px 220px at 85% 0%, rgba(61,159,224,0.35), transparent 70%);
        }
        [dir="rtl"] .hero-glow { background: radial-gradient(480px 220px at 15% 0%, rgba(61,159,224,0.35), transparent 70%); }
        .hero-main { position: relative; min-width: 0; flex: 1; }
        .hero-eyebrow {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
          color: #93c5fd; text-transform: uppercase;
        }
        .hero-name { font-size: 28px; font-weight: 800; color: white; margin: 6px 0 12px; line-height: 1.2; }
        .hero-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .hero-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
          background: rgba(255,255,255,0.14); color: white;
        }
        .hero-pill-outline { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #cbd5e1; }
        .hero-pill-stage { background: rgba(255,255,255,0.1); }
        .stage-pill-attention { background: rgba(239,68,68,0.25); color: #fecaca; }
        .stage-pill-active { background: rgba(61,159,224,0.3); color: #bfdbfe; }
        .stage-pill-completed { background: rgba(16,185,129,0.22); color: #a7f3d0; }
        .stage-pill-waiting { background: rgba(255,255,255,0.1); color: #cbd5e1; }
        .hero-situation { color: #cbd5e1; font-size: 14px; margin: 0; max-width: 620px; }

        .hero-action-panel {
          position: relative; flex-shrink: 0; display: flex; flex-direction: column;
          align-items: flex-end; gap: 10px; text-align: end;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
          border-radius: 14px; padding: 16px 18px; min-width: 240px;
        }
        [dir="rtl"] .hero-action-panel { align-items: flex-start; text-align: start; }
        .hero-updated { font-size: 11px; color: #93c5fd; white-space: nowrap; }
        .hero-primary-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 20px; background: white; color: #1d4ed8;
          border: none; border-radius: 10px; font-size: 14px; font-weight: 700;
          cursor: pointer; font-family: inherit; white-space: nowrap;
          box-shadow: 0 6px 16px rgba(0,0,0,0.2);
        }
        .hero-primary-btn:hover { background: #eff6ff; }
        .hero-all-good {
          display: flex; align-items: center; gap: 8px; padding: 10px 16px;
          background: rgba(16,185,129,0.18); color: #a7f3d0; border-radius: 10px;
          font-size: 13px; font-weight: 600; white-space: nowrap;
        }

        /* ---------- Quick actions ---------- */
        .quick-actions-strip {
          display: flex; align-items: center; gap: 14px; padding: 4px 2px;
        }
        .quick-actions-label { font-size: 12px; font-weight: 700; color: #64748b; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.03em; }
        .quick-actions-scroller { display: flex; gap: 8px; overflow-x: auto; flex: 1; padding-bottom: 2px; }
        .quick-action-chip {
          display: flex; align-items: center; gap: 7px; padding: 9px 14px; white-space: nowrap;
          background: white; border: 1px solid #e2e8f0; border-radius: 999px;
          font-size: 13px; font-weight: 600; color: #334155; cursor: pointer;
          font-family: inherit; transition: all 0.15s; flex-shrink: 0;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .quick-action-chip:hover { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; transform: translateY(-1px); }
        .quick-action-chip svg { color: #2563eb; }

        /* ---------- Loading / error ---------- */
        .state-panel {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; padding: 60px 24px; background: white; border-radius: 16px;
          color: #64748b; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .error-panel { color: #b91c1c; }
        .spin { animation: home-spin 1s linear infinite; }
        @keyframes home-spin { to { transform: rotate(360deg); } }
        .retry-btn {
          display: flex; align-items: center; gap: 6px; padding: 8px 18px;
          background: #2563eb; color: white; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .retry-btn:hover { background: #1d4ed8; }

        /* ---------- Attention (highest-priority section) ---------- */
        .attention-section {
          background: white; border-radius: 16px; padding: 20px 22px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-inline-start: 4px solid #cbd5e1;
        }
        .attention-section.has-items { border-inline-start-color: #f59e0b; }
        .attention-section.all-clear { border-inline-start-color: #10b981; }
        .attention-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .attention-header h2 { font-size: 16px; font-weight: 800; color: #1e293b; margin: 0; }
        .attention-badge-count {
          font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 20px;
          background: #fef3c7; color: #92400e;
        }
        .attention-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
        .attention-item {
          display: flex; align-items: flex-start; gap: 12px; padding: 13px 14px;
          background: #f8fafc; border-radius: 12px; text-align: start;
          border: 1px solid #eef2f7; border-inline-start: 3px solid transparent;
          width: 100%; cursor: default; font-family: inherit; transition: all 0.15s;
        }
        .attention-item.clickable { cursor: pointer; }
        .attention-item.clickable:hover { background: white; box-shadow: 0 4px 14px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .attention-item:disabled { color: inherit; opacity: 1; }
        .severity-error { border-inline-start-color: #ef4444; }
        .severity-warning { border-inline-start-color: #f59e0b; }
        .severity-info { border-inline-start-color: #3b82f6; }
        .attention-icon {
          width: 36px; height: 36px; border-radius: 9px; display: flex;
          align-items: center; justify-content: center; flex-shrink: 0;
        }
        .severity-error .attention-icon { background: #fee2e2; color: #dc2626; }
        .severity-warning .attention-icon { background: #fef3c7; color: #d97706; }
        .severity-info .attention-icon { background: #dbeafe; color: #2563eb; }
        .attention-body { flex: 1; min-width: 0; }
        .attention-title-row { display: flex; align-items: center; gap: 8px; }
        .attention-title { font-weight: 700; font-size: 13.5px; color: #1e293b; }
        .attention-count {
          font-size: 11px; font-weight: 800; padding: 1px 9px; border-radius: 10px;
          background: #1e293b; color: white; flex-shrink: 0;
        }
        .attention-desc { font-size: 12px; color: #64748b; margin-top: 3px; line-height: 1.4; }
        .attention-chevron { color: #cbd5e1; flex-shrink: 0; align-self: center; }
        .attention-item.clickable:hover .attention-chevron { color: #2563eb; }

        .empty-state {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          gap: 8px; padding: 22px 12px; color: #64748b;
        }
        .empty-state .empty-icon { color: #10b981; }
        .empty-state strong { color: #166534; font-size: 14.5px; }
        .empty-state span { font-size: 12.5px; max-width: 380px; }

        /* ---------- KPI cards ---------- */
        .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
        .kpi-card {
          display: flex; flex-direction: column; gap: 10px; padding: 16px 18px;
          background: white; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-top: 3px solid var(--kpi-accent, #94a3b8); min-width: 0;
          text-align: start; font-family: inherit; border-inline: none; border-bottom: none;
          cursor: default;
        }
        button.kpi-card { cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
        button.kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
        .kpi-icon {
          width: 34px; height: 34px; border-radius: 9px; display: flex;
          align-items: center; justify-content: center; background: var(--kpi-bg, #f1f5f9); color: var(--kpi-accent, #64748b);
        }
        .kpi-value { font-size: 24px; font-weight: 800; color: #1e293b; line-height: 1; }
        .kpi-label { font-size: 12.5px; color: #64748b; font-weight: 600; }
        .kpi-sub { font-size: 11px; color: #94a3b8; }

        /* ---------- Lower grid: workflow + activity ---------- */
        .lower-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }

        .workflow-strip {
          background: #f8fafc; border-radius: 16px; padding: 18px 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #eef2f7;
        }
        .workflow-strip h2 { font-size: 14.5px; font-weight: 800; color: #1e293b; margin: 0 0 14px; }
        .workflow-steps { display: flex; align-items: center; }
        .workflow-step {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          text-align: center; position: relative; width: 84px; flex-shrink: 0;
        }
        .workflow-connector { flex: 1; height: 3px; background: #e2e8f0; margin: 0 2px; margin-top: -20px; border-radius: 2px; }
        .workflow-connector.connector-filled { background: linear-gradient(90deg, #2563eb, #3d9fe0); }
        .workflow-connector.connector-attention { background: #f87171; }
        .step-dot {
          width: 32px; height: 32px; border-radius: 50%; display: flex;
          align-items: center; justify-content: center; flex-shrink: 0; border: 2px solid transparent;
        }
        .stage-completed .step-dot { background: #d1fae5; color: #059669; border-color: #a7f3d0; }
        .stage-active .step-dot { background: #dbeafe; color: #2563eb; border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
        .stage-attention .step-dot { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
        .stage-waiting .step-dot { background: white; color: #94a3b8; border-color: #e2e8f0; }
        .step-label { font-size: 10.5px; font-weight: 700; color: #334155; line-height: 1.2; }
        .step-status { font-size: 9.5px; color: #94a3b8; }
        .stage-attention .step-status { color: #dc2626; }
        .stage-active .step-status { color: #2563eb; }

        .section-card {
          background: white; border-radius: 16px; padding: 18px 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08); min-width: 0;
        }
        .section-card h2 { font-size: 14.5px; font-weight: 800; color: #1e293b; margin: 0 0 12px; }

        .activity-list { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto; }
        .activity-item {
          display: flex; align-items: center; gap: 12px; padding: 10px 12px;
          background: #f8fafc; border-radius: 10px; border: none; width: 100%;
          text-align: start; font-family: inherit; cursor: pointer; transition: all 0.15s;
        }
        .activity-item:hover { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
        .activity-icon {
          width: 32px; height: 32px; border-radius: 8px; background: #e2e8f0; color: #475569;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .activity-type-upload .activity-icon { background: #dbeafe; color: #2563eb; }
        .activity-type-allocation .activity-icon { background: #ede9fe; color: #7c3aed; }
        .activity-type-request .activity-icon { background: #fef3c7; color: #b45309; }
        .activity-body { flex: 1; min-width: 0; }
        .activity-title-row { display: flex; align-items: center; gap: 8px; }
        .activity-title { font-size: 13px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .activity-status-chip {
          font-size: 10px; font-weight: 700; padding: 1px 8px; border-radius: 10px; flex-shrink: 0;
        }
        .status-pending, .status-processing, .status-queued, .status-running, .status-viewed, .status-cancellation_requested {
          background: #fef3c7; color: #92400e;
        }
        .status-approved, .status-completed { background: #d1fae5; color: #065f46; }
        .status-rejected, .status-failed { background: #fee2e2; color: #991b1b; }
        .activity-sub { font-size: 11.5px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .activity-time { font-size: 11px; color: #94a3b8; flex-shrink: 0; }

        @media (max-width: 1200px) {
          .kpi-row { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 1100px) {
          .lower-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 900px) {
          .hero { flex-direction: column; align-items: stretch; }
          .hero-action-panel { align-items: stretch; text-align: center; }
          [dir="rtl"] .hero-action-panel { align-items: stretch; text-align: center; }
        }
        @media (max-width: 640px) {
          .kpi-row { grid-template-columns: repeat(2, 1fr); }
          .hero-name { font-size: 22px; }
          .attention-list { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function KpiRow({ data, language, navigate, t }) {
  const m = data.metrics || {};
  const totalKnown = (m.assigned_students || 0) + (m.unassigned_students || 0);
  const assignedPct = totalKnown ? Math.round((m.assigned_students / totalKnown) * 100) : null;
  const unassignedPct = totalKnown ? Math.round((m.unassigned_students / totalKnown) * 100) : null;

  const tiles = [
    {
      key: 'assigned', Icon: CheckCircle, accent: '#059669', bg: '#d1fae5',
      value: m.assigned_students ?? 0, label: t.assignedStudents,
      sub: assignedPct != null ? `${assignedPct}% ${t.ofTotal}` : null,
      route: '/students',
    },
    {
      key: 'unassigned', Icon: Users, accent: '#d97706', bg: '#fef3c7',
      value: m.unassigned_students ?? 0, label: t.unassignedStudents,
      sub: unassignedPct != null ? `${unassignedPct}% ${t.ofTotal}` : null,
      route: '/students',
    },
    {
      key: 'occupancy', Icon: Percent, accent: '#2563eb', bg: '#dbeafe',
      value: `${m.occupancy_rate ?? 0}%`, label: t.occupancyRate,
      sub: `${m.available_beds ?? 0} ${t.occupied}`,
      route: '/analysis',
    },
    {
      key: 'beds', Icon: BedDouble, accent: '#0d9488', bg: '#ccfbf1',
      value: m.available_beds ?? 0, label: t.availableBeds,
      sub: null,
      route: '/buildings',
    },
    {
      key: 'requests', Icon: ArrowLeftRight, accent: '#7c3aed', bg: '#ede9fe',
      value: m.pending_requests ?? 0, label: t.pendingRequests,
      sub: (m.pending_requests ?? 0) > 0 ? t.needsReview : t.allClear,
      route: '/transfers',
    },
  ];

  return (
    <div className="kpi-row">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          className="kpi-card"
          style={{ '--kpi-accent': tile.accent, '--kpi-bg': tile.bg }}
          onClick={() => navigate(tile.route)}
        >
          <span className="kpi-icon"><tile.Icon size={17} /></span>
          <span className="kpi-value">{tile.value}</span>
          <span className="kpi-label">{tile.label}</span>
          {tile.sub && <span className="kpi-sub">{tile.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function WorkflowStrip({ workflow, language }) {
  if (!Array.isArray(workflow) || workflow.length === 0) return null;

  const connectorClass = (prevStatus) => {
    if (prevStatus === 'attention') return 'connector-attention';
    if (prevStatus === 'completed') return 'connector-filled';
    return '';
  };

  return (
    <div className="workflow-strip">
      <h2>{language === 'he' ? 'שלבי התהליך' : 'Process Stages'}</h2>
      <div className="workflow-steps">
        {workflow.map((step, idx) => {
          const meta = STAGE_META[step.status] || STAGE_META.waiting;
          const label = WORKFLOW_LABELS[step.key] || { he: step.label_he, en: step.label_en };
          const statusLabel = {
            completed: language === 'he' ? 'הושלם' : 'Done',
            active: language === 'he' ? 'בתהליך' : 'In progress',
            attention: language === 'he' ? 'לטיפול' : 'Attention',
            waiting: language === 'he' ? 'ממתין' : 'Waiting',
          }[step.status] || step.status;

          return (
            <React.Fragment key={step.key || idx}>
              {idx > 0 && (
                <div className={`workflow-connector ${connectorClass(workflow[idx - 1].status)}`} />
              )}
              <div className={`workflow-step ${meta.colorClass}`}>
                <div className="step-dot"><meta.Icon size={15} /></div>
                <span className="step-label">{language === 'he' ? (step.label_he || label.he) : (step.label_en || label.en)}</span>
                <span className="step-status">{statusLabel}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function AttentionSection({ items, language, navigate, t, ChevronIcon }) {
  const list = (Array.isArray(items) ? items : []).filter(
    (item) => !ATTENTION_IDS_HIDDEN_FROM_UI.has(item.id)
  );
  return (
    <div className={`attention-section ${list.length > 0 ? 'has-items' : 'all-clear'}`}>
      <div className="attention-header">
        <h2>{t.requiresAttention}</h2>
        {list.length > 0 && <span className="attention-badge-count">{list.length}</span>}
      </div>
      {list.length === 0 ? (
        <div className="empty-state">
          <CheckCircle size={30} className="empty-icon" />
          <strong>{t.noAttention}</strong>
          <span>{t.noAttentionSub}</span>
        </div>
      ) : (
        <div className="attention-list">
          {list.map((item) => {
            const Icon = ICONS[item.icon] || AlertTriangle;
            const severity = SEVERITY_META[item.severity] || SEVERITY_META.info;
            const clickable = Boolean(item.route);
            const title = language === 'he' ? item.title_he : item.title_en;
            const desc = language === 'he' ? item.description_he : item.description_en;
            return (
              <button
                key={item.id}
                type="button"
                className={`attention-item ${severity.colorClass} ${clickable ? 'clickable' : ''}`}
                onClick={clickable ? () => navigate(item.route) : undefined}
                disabled={!clickable}
              >
                <span className="attention-icon"><Icon size={17} /></span>
                <span className="attention-body">
                  <span className="attention-title-row">
                    <span className="attention-title">{title}</span>
                    {item.count != null && <span className="attention-count">{item.count}</span>}
                  </span>
                  <span className="attention-desc">{desc}</span>
                </span>
                {clickable && <ChevronIcon size={16} className="attention-chevron" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentActivitySection({ items, language, navigate, t }) {
  const list = Array.isArray(items) ? items : [];
  const ACTIVITY_ICONS = { upload: Upload, allocation: Shuffle, request: FileText };
  return (
    <div className="section-card">
      <h2>{t.recentActivity}</h2>
      {list.length === 0 ? (
        <div className="empty-state">
          <span>{t.noActivity}</span>
        </div>
      ) : (
        <div className="activity-list">
          {list.map((item) => {
            const Icon = ACTIVITY_ICONS[item.type] || FileText;
            const title = language === 'he' ? item.title_he : item.title_en;
            const sub = language === 'he' ? item.subtitle_he : item.subtitle_en;
            return (
              <button
                key={item.id}
                type="button"
                className={`activity-item activity-type-${item.type}`}
                onClick={item.route ? () => navigate(item.route) : undefined}
              >
                <span className="activity-icon"><Icon size={15} /></span>
                <span className="activity-body">
                  <span className="activity-title-row">
                    <span className="activity-title">{title}</span>
                    {item.status && (
                      <span className={`activity-status-chip status-${item.status}`}>{item.status}</span>
                    )}
                  </span>
                  {sub && <span className="activity-sub"><bdi>{sub}</bdi></span>}
                </span>
                <span className="activity-time"><bdi>{formatTimestamp(item.timestamp, language)}</bdi></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildQuickActions({ auth, language, isCentralAdmin, isRegionBoss, isEmployee }) {
  const actions = [];
  const central = typeof isCentralAdmin === 'function' && isCentralAdmin();
  const boss = typeof isRegionBoss === 'function' && isRegionBoss();
  const employee = typeof isEmployee === 'function' && isEmployee();
  const canUpload = typeof auth?.canUploadExcel === 'function' && auth.canUploadExcel();
  const canRunAllocation = typeof auth?.canRunAllocation === 'function' && auth.canRunAllocation();
  const canAssignPriority = typeof auth?.canAssignPriority === 'function' && auth.canAssignPriority();

  if (canUpload) {
    actions.push({ key: 'upload', labelHe: 'העלאת קובץ', labelEn: 'Upload file', route: '/upload', Icon: Upload });
  }
  if (canRunAllocation) {
    actions.push({
      key: 'allocation',
      labelHe: central ? 'הרצת שיבוץ' : 'הרצת שיבוץ לאזור שלי',
      labelEn: central ? 'Run allocation' : 'Run allocation for my region',
      route: '/allocation', Icon: Shuffle,
    });
  }
  actions.push({
    key: 'results',
    labelHe: central ? 'סקירת תוצאות שיבוץ' : 'סקירת תוצאות אזוריות',
    labelEn: central ? 'Review results' : 'Review regional results',
    route: '/allocation/results', Icon: BarChart3,
  });
  actions.push({
    key: 'requests',
    labelHe: boss || central ? 'בקשות ממתינות' : 'צפייה בבקשות',
    labelEn: boss || central ? 'Pending requests' : 'View requests',
    route: '/transfers', Icon: ArrowLeftRight,
  });
  if (central) {
    actions.push({ key: 'reports', labelHe: 'צפייה בדוחות', labelEn: 'View reports', route: '/reports', Icon: FileText });
  }
  if (canAssignPriority) {
    actions.push({ key: 'priority', labelHe: 'ניהול סטודנטים בעדיפות', labelEn: 'Manage priority students', route: '/priority', Icon: Star });
  }
  if (boss || employee) {
    actions.push({ key: 'students', labelHe: 'סטודנטים באזור שלי', labelEn: 'Students in my region', route: '/students', Icon: Users });
    actions.push({ key: 'buildings', labelHe: 'בניינים וחדרים', labelEn: 'Buildings & Rooms', route: '/buildings', Icon: Building2 });
  }

  return actions;
}

export default HomePage;
