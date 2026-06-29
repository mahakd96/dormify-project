import React, { useState, useEffect } from 'react';
import {
  Download, Loader, Building2, ShieldAlert, Info, Globe,
  FileSpreadsheet, RefreshCw, Users,
} from 'lucide-react';
import { reportsAPI, regionsAPI } from '../services/api';

// Hidden from the Reports region filter — not a real dorm report region.
const _isExcludedRegion = r =>
  /^technion$/i.test((r.id   || '').trim()) ||
  /^(הטכניון|technion)$/i.test((r.name || '').trim());

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const texts = {
  he: {
    title:          'דוחות',
    subtitle:       'הפק דוחות Excel מהנתונים הנוכחיים במערכת',
    hint:           'בחר אזור ולאחר מכן הורד את הדוח הרצוי.',
    download:       'הורד דוח',
    downloading:    'מוריד...',
    downloadError:  'שגיאה בהורדת הדוח',
    note:           'הדוחות מופקים לפי המצב הנוכחי. לתוצאות עדכניות, העלה נתונים חדשים והרץ שיבוץ לפני ההורדה.',
    sectionReports: 'דוחות להורדה',
    filterLabel:    'אזור',
    allRegions:     'כל האזורים',
    loadingRegions: 'טוען...',
    sectionHow:     'איך משתמשים בדוחות',
    steps: [
      {
        titleHe: 'בחר אזור',
        descHe:  'בחר "כל האזורים" לדוח כולל, או אזור מעון ספציפי.',
        titleEn: 'Choose a region',
        descEn:  'Select all regions or a specific dormitory region.',
      },
      {
        titleHe: 'הורד את הדוח הנכון',
        descHe:  '"פעולות סטודנטים" לעבודת משרד, "תפוסה" למיטות, "בדיקה ידנית" לרשומות בעייתיות.',
        titleEn: 'Download the right report',
        descEn:  'Student Actions for office work, Capacity for beds, Manual Review for problem records.',
      },
      {
        titleHe: 'עיין בגיליונות',
        descHe:  'כל קובץ מכיל גיליונות מאורגנים עם פילטרים, צבעים וסיכומים בעברית.',
        titleEn: 'Review the sheets',
        descEn:  'Each file has organised sheets with filters, colours, and Hebrew summaries.',
      },
      {
        titleHe: 'עדכן לפני הורדה',
        descHe:  'לתוצאות עדכניות – העלה נתונים חדשים והרץ שיבוץ לפני הפקת הדוח.',
        titleEn: 'Update before downloading',
        descEn:  'For fresh results, upload the latest data and run allocation first.',
      },
    ],
  },
  en: {
    title:          'Reports',
    subtitle:       'Generate Excel reports from current system data',
    hint:           'Select a region, then download the report you need.',
    download:       'Download Report',
    downloading:    'Downloading…',
    downloadError:  'Failed to download report',
    note:           'Reports reflect the current database state. For updated results, upload the latest data and run allocation before downloading.',
    sectionReports: 'Available Reports',
    filterLabel:    'Region',
    allRegions:     'All Regions',
    loadingRegions: 'Loading…',
    sectionHow:     'How to use these reports',
    steps: [
      {
        titleEn: 'Choose a region',
        descEn:  'Select all regions or a specific dormitory region.',
      },
      {
        titleEn: 'Download the right report',
        descEn:  'Student Actions for office work, Capacity for beds, Manual Review for problem records.',
      },
      {
        titleEn: 'Review the sheets',
        descEn:  'Each file has organised sheets with filters, colours, and Hebrew summaries.',
      },
      {
        titleEn: 'Update before downloading',
        descEn:  'For fresh results, upload the latest data and run allocation first.',
      },
    ],
  },
};

const STEP_ICONS = [Globe, Download, FileSpreadsheet, RefreshCw];

// ---------------------------------------------------------------------------
// Report card definitions
// ---------------------------------------------------------------------------

const REPORT_CARDS = [
  {
    id:             'student-actions',
    Icon:           Users,
    color:          '#1565C0',
    accentLight:    '#dbeafe',
    iconBg:         '#eff6ff',
    titleHe:        'דוח פעולות סטודנטים',
    titleEn:        'Student Actions Report',
    descHe:         'כל סטודנט מופיע בגיליון אחד בלבד לפי הפעולה הנדרשת: נכנסים חדשים, ממשיכים, מעברים, עוזבים ולא משובצים.',
    descEn:         'Each student in exactly one sheet by required action: new, continuing, transfer, leaving, or unassigned.',
    filenamePrefix: 'Dormify_Student_Actions_Report',
    apiFn:          (api, regionId) => () => api.downloadStudentActionsReport(regionId),
    sheets:         ['הסבר', 'תמצית סטודנטים', 'נכנסים חדשים', 'ממשיכים', 'מעברים', 'עוזבים', 'לא שובצו'],
  },
  {
    id:             'capacity',
    Icon:           Building2,
    color:          '#6A1B9A',
    accentLight:    '#ede9fe',
    iconBg:         '#faf5ff',
    titleHe:        'דוח תפוסה ומיטות',
    titleEn:        'Capacity Report',
    descHe:         'תמצית תפוסה לפי אזור, בניין, דירה וחדר – עם צביעת שורות לפי אחוז תפוסה.',
    descEn:         'Occupancy by region, building, apartment, and room – with colour-coded occupancy rates.',
    filenamePrefix: 'Dormify_Capacity_Report',
    apiFn:          (api, regionId) => () => api.downloadCapacityReport(regionId),
    sheets:         ['הסבר', 'תמצית תפוסה', 'תפוסה לפי אזור', 'תפוסה לפי בניין', 'תפוסה לפי דירה', 'תפוסה לפי חדרים'],
  },
  {
    id:             'review',
    Icon:           ShieldAlert,
    color:          '#B71C1C',
    accentLight:    '#fee2e2',
    iconBg:         '#fff5f5',
    titleHe:        'דוח בדיקה ידנית',
    titleEn:        'Manual Review Report',
    descHe:         'נתונים חסרים, תעודות זהות כפולות, ולא משובצים עם בעיית נתונים – רשומות הדורשות בדיקת צוות.',
    descEn:         'Missing data, duplicate IDs, unassigned with data issues — records requiring office review.',
    filenamePrefix: 'Dormify_Manual_Review_Report',
    apiFn:          (api, regionId) => () => api.downloadManualReviewReport(regionId),
    sheets:         ['הסבר', 'תמצית חריגים', 'חריגים לבדיקה', 'תעודות זהות כפולות', 'נתונים חסרים', 'לא שובצו עם בעיה'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerDownload(blob, filename) {
  const url  = window.URL.createObjectURL(new Blob([blob]));
  const link = document.createElement('a');
  link.href  = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
  window.URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// ReportCard
// ---------------------------------------------------------------------------

function ReportCard({ card, language, t, regionId, regionFileSlug }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const fn       = card.apiFn(reportsAPI, regionId);
      const response = await fn();
      const slug     = regionFileSlug || 'All_Regions';
      triggerDownload(response.data, `${card.filenamePrefix}_${slug}_${today()}.xlsx`);
    } catch (err) {
      setError(t.downloadError + (err?.message ? `: ${err.message}` : ''));
    } finally {
      setLoading(false);
    }
  };

  const { Icon, color, accentLight, iconBg } = card;
  const title = language === 'he' ? card.titleHe : card.titleEn;
  const desc  = language === 'he' ? card.descHe  : card.descEn;

  return (
    <div className="rpc-card" style={{ borderTopColor: color }}>
      {/* Growing body — pushes footer to bottom */}
      <div className="rpc-body">
        <div className="rpc-header">
          <div className="rpc-icon-badge" style={{ background: iconBg, color }}>
            <Icon size={22} strokeWidth={1.8} />
          </div>
          <div className="rpc-titles">
            <h3 className="rpc-title" style={{ color }}>{title}</h3>
            {language === 'he' && (
              <span className="rpc-title-en">{card.titleEn}</span>
            )}
          </div>
        </div>

        <p className="rpc-desc">{desc}</p>

        <div className="rpc-tags">
          {card.sheets.map(s => (
            <span
              key={s}
              className="rpc-tag"
              style={{ background: accentLight + 'cc', color, borderColor: accentLight }}
            >
              {s}
            </span>
          ))}
        </div>

        {error && <p className="rpc-error">{error}</p>}
      </div>

      {/* Footer — always at bottom */}
      <div className="rpc-footer">
        <button
          className="rpc-btn"
          style={{ background: color }}
          onClick={handleDownload}
          disabled={loading}
        >
          {loading
            ? <><Loader size={14} className="rp-spin" />{t.downloading}</>
            : <><Download size={14} />{t.download}</>}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UsageGuide
// ---------------------------------------------------------------------------

function UsageGuide({ t, language }) {
  const steps = t.steps || [];

  return (
    <div className="rp-guide">
      <p className="rp-guide-label">{t.sectionHow}</p>
      <div className="rp-guide-steps">
        {steps.map((step, i) => {
          const Icon  = STEP_ICONS[i];
          const title = language === 'he' ? (step.titleHe || step.titleEn) : step.titleEn;
          const desc  = language === 'he' ? (step.descHe  || step.descEn)  : step.descEn;
          return (
            <div key={i} className="rp-guide-step">
              <div className="rp-guide-step-top">
                <span className="rp-guide-num">{String(i + 1).padStart(2, '0')}</span>
                {Icon && <span className="rp-guide-step-icon"><Icon size={15} /></span>}
              </div>
              <h4 className="rp-guide-step-title">{title}</h4>
              <p className="rp-guide-step-desc">{desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportsPage
// ---------------------------------------------------------------------------

function ReportsPage({ language }) {
  const t = texts[language] || texts.en;

  const [regions,        setRegions]        = useState([]);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [regionsLoading, setRegionsLoading] = useState(true);

  useEffect(() => {
    setRegionsLoading(true);
    regionsAPI.getAll()
      .then(list => setRegions(list.filter(r => !_isExcludedRegion(r))))
      .catch(() => {})
      .finally(() => setRegionsLoading(false));
  }, []);

  const regionFileSlug = selectedRegion || null;

  return (
    <div className="rp-page">

      {/* ── Top bar: title + region selector ── */}
      <div className="rp-topbar">
        <div className="rp-topbar-text">
          <h1 className="rp-title">{t.title}</h1>
          <p className="rp-subtitle">{t.subtitle}</p>
          <p className="rp-hint">
            <Globe size={12} className="rp-hint-icon" />
            {t.hint}
          </p>
        </div>

        <div className="rp-filter-box">
          <label className="rp-filter-label" htmlFor="rp-region-sel">
            {t.filterLabel}
          </label>
          <select
            id="rp-region-sel"
            className="rp-filter-select"
            value={selectedRegion}
            onChange={e => setSelectedRegion(e.target.value)}
            disabled={regionsLoading}
          >
            <option value="">{regionsLoading ? t.loadingRegions : t.allRegions}</option>
            {regions.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Section label ── */}
      <p className="rp-section-label">{t.sectionReports}</p>

      {/* ── Report cards ── */}
      <div className="rp-cards-grid">
        {REPORT_CARDS.map(card => (
          <ReportCard
            key={card.id}
            card={card}
            language={language}
            t={t}
            regionId={selectedRegion || null}
            regionFileSlug={regionFileSlug}
          />
        ))}
      </div>

      {/* ── How to use ── */}
      <UsageGuide t={t} language={language} />

      {/* ── Bottom note ── */}
      <div className="rp-note">
        <Info size={14} className="rp-note-icon" />
        <p>{t.note}</p>
      </div>

      {/* ── Styles ── */}
      <style>{`
        /* ── Page shell ── */
        .rp-page {
          padding: 28px 28px 40px;
          max-width: 1140px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* ── Top bar ── */
        .rp-topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 28px;
          flex-wrap: wrap;
        }
        .rp-topbar-text { flex: 1; min-width: 200px; }
        .rp-title   { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 4px; letter-spacing: -0.4px; }
        .rp-subtitle { font-size: 14px; color: #64748b; margin: 0 0 8px; }
        .rp-hint {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; color: #94a3b8; margin: 0;
        }
        .rp-hint-icon { flex-shrink: 0; }

        /* Region filter */
        .rp-filter-box {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 180px;
        }
        .rp-filter-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #94a3b8;
        }
        .rp-filter-select {
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          padding: 9px 12px;
          background: white;
          color: #1e293b;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .rp-filter-select:disabled { opacity: 0.55; cursor: not-allowed; }
        .rp-filter-select:focus {
          outline: none;
          border-color: #818cf8;
          box-shadow: 0 0 0 3px rgba(129,140,248,0.18);
        }

        /* ── Section label ── */
        .rp-section-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #94a3b8;
          margin: 0 0 12px;
        }

        /* ── Cards grid ── */
        .rp-cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          align-items: stretch;
          margin-bottom: 28px;
        }
        @media (max-width: 900px) {
          .rp-cards-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 580px) {
          .rp-cards-grid { grid-template-columns: 1fr; }
        }

        /* ── Individual card ── */
        .rpc-card {
          background: #ffffff;
          border: 1px solid #e8ecf0;
          border-top: 3.5px solid;
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 1px 6px rgba(0,0,0,0.05);
          transition: box-shadow 0.18s, transform 0.18s;
          overflow: hidden;
        }
        .rpc-card:hover {
          box-shadow: 0 6px 22px rgba(0,0,0,0.1);
          transform: translateY(-2px);
        }

        /* Card body — grows so footer stays at bottom */
        .rpc-body {
          flex: 1;
          padding: 20px 20px 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* Card header */
        .rpc-header { display: flex; align-items: center; gap: 13px; }
        .rpc-icon-badge {
          width: 46px; height: 46px;
          border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .rpc-titles { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
        .rpc-title  { font-size: 14px; font-weight: 700; margin: 0; line-height: 1.3; }
        .rpc-title-en { font-size: 10.5px; color: #94a3b8; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .rpc-desc {
          font-size: 12.5px; color: #475569; margin: 0; line-height: 1.55;
        }

        /* Sheet tags */
        .rpc-tags { display: flex; flex-wrap: wrap; gap: 5px; }
        .rpc-tag {
          font-size: 10.5px; font-weight: 600;
          padding: 2px 7px; border-radius: 20px;
          border: 1px solid; white-space: nowrap;
        }

        .rpc-error {
          font-size: 11.5px; color: #dc2626; margin: 0;
          background: #fef2f2; border: 1px solid #fecaca;
          border-radius: 6px; padding: 6px 10px;
        }

        /* Card footer — always at bottom */
        .rpc-footer {
          padding: 12px 20px 18px;
          border-top: 1px solid #f1f5f9;
        }
        .rpc-btn {
          display: flex; align-items: center; justify-content: center;
          gap: 7px; width: 100%; padding: 9px 16px;
          color: white; border: none; border-radius: 8px;
          font-family: inherit; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: opacity 0.15s, transform 0.1s;
          letter-spacing: 0.01em;
        }
        .rpc-btn:hover:not(:disabled) { opacity: 0.87; }
        .rpc-btn:active:not(:disabled) { transform: scale(0.98); }
        .rpc-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Usage guide ── */
        .rp-guide {
          background: #f8fafc;
          border: 1px solid #e8ecf0;
          border-radius: 14px;
          padding: 22px 24px;
          margin-bottom: 20px;
        }
        .rp-guide-label {
          font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.08em;
          color: #94a3b8; margin: 0 0 18px;
        }
        .rp-guide-steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
        }
        @media (max-width: 700px) {
          .rp-guide-steps { grid-template-columns: repeat(2, 1fr); gap: 16px 24px; }
        }
        @media (max-width: 420px) {
          .rp-guide-steps { grid-template-columns: 1fr; gap: 16px; }
        }

        .rp-guide-step {
          padding-inline-end: 20px;
          border-inline-end: 1px solid #e2e8f0;
        }
        .rp-guide-step:last-child {
          border-inline-end: none;
          padding-inline-end: 0;
        }
        .rp-guide-step-top {
          display: flex; align-items: center; gap: 7px; margin-bottom: 9px;
        }
        .rp-guide-num {
          font-size: 20px; font-weight: 900;
          color: #1e40af; line-height: 1;
          font-variant-numeric: tabular-nums;
        }
        .rp-guide-step-icon { color: #94a3b8; display: flex; align-items: center; }
        .rp-guide-step-title {
          font-size: 12.5px; font-weight: 700; color: #1e293b; margin: 0 0 4px;
        }
        .rp-guide-step-desc {
          font-size: 11.5px; color: #64748b; margin: 0; line-height: 1.5;
        }

        /* ── Bottom note ── */
        .rp-note {
          display: flex; align-items: flex-start; gap: 9px;
          background: #f8fafc; border: 1px solid #e8ecf0;
          border-radius: 10px; padding: 13px 16px;
        }
        .rp-note-icon { flex-shrink: 0; color: #94a3b8; margin-top: 1px; }
        .rp-note p { margin: 0; font-size: 12.5px; color: #64748b; line-height: 1.6; }

        /* ── Spinner ── */
        @keyframes rp-spin { to { transform: rotate(360deg); } }
        .rp-spin { animation: rp-spin 0.9s linear infinite; display: block; }
      `}</style>
    </div>
  );
}

export default ReportsPage;