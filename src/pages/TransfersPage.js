import React, { useState, useEffect, useRef, useMemo } from 'react';
import { studentsAPI, requestsAPI, regionsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import BedMatchPicker, { assignActionLabel, mergeBuildings } from '../components/BedMatchPicker';
import StudentSearch from '../components/StudentSearch';
import { localizeGender } from '../utils/genderLabels';
import {
  Search, X, Plus, Loader2, Check, AlertTriangle,
  Home, DoorOpen, FileText, MapPin, Building2, BedDouble,
  Clock, CheckCircle, XCircle, ChevronDown, ChevronUp,
  User, Calendar, Activity, UserPlus, UserMinus,
  Hash, Star, RefreshCw, ArrowRight, ArrowLeft, ArrowRightLeft,
  Eye, Inbox, Circle, Trash2,
} from 'lucide-react';

// ── Utilities ────────────────────────────────────────────────
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('he-IL', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return iso; }
};
const fmtDateShort = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('he-IL', { month:'short', day:'2-digit' }); }
  catch { return iso; }
};
const fmtReqId = (r) => {
  if (r?.request_number) return r.request_number;
  const yr = r?.created_at ? new Date(r.created_at).getFullYear() : new Date().getFullYear();
  return `REQ-${yr}-${String(r?.id || 0).padStart(6,'0')}`;
};

const TYPE_CFG = {
  room:           { color:'violet', labelHe:'שינוי חדר',    labelEn:'Room Transfer',    Icon: Home      },
  apartment:      { color:'teal',   labelHe:'מעבר מדירה',   labelEn:'Apt Transfer',     Icon: DoorOpen  },
  other:          { color:'amber',  labelHe:'בקשה אחרת',    labelEn:'Other',            Icon: FileText  },
  add_student:    { color:'blue',   labelHe:'הוספת סטודנט', labelEn:'Add Student',      Icon: UserPlus  },
  remove_student: { color:'rose',   labelHe:'הסרה ממעונות', labelEn:'Remove Student',   Icon: UserMinus },
  swap:           { color:'indigo', labelHe:'חילוף בין סטודנטים', labelEn:'Student Swap', Icon: RefreshCw },
  region_transfer:{ color:'violet', labelHe:'העברה בין אזורים', labelEn:'Region Transfer', Icon: MapPin },
};
// Cross-region transfers are stored as room/apartment + transfer_scope -
// but must never be LABELED "מעבר מדירה"; the scope is the meaningful type.
const TYPE_CFG_CROSS = { color:'violet', labelHe:'מעבר לאזור אחר', labelEn:'Cross-region Transfer', Icon: MapPin };
const typeCfgFor = (request) =>
  (request?.transfer_scope === 'cross_region'
    && (request.request_type === 'room' || request.request_type === 'apartment'))
    ? TYPE_CFG_CROSS
    : (TYPE_CFG[request?.request_type] || TYPE_CFG.other);
const STATUS_CFG = {
  pending:  { color:'amber', labelHe:'ממתינה', labelEn:'Pending',  Icon: Clock       },
  approved: { color:'green', labelHe:'אושרה',  labelEn:'Approved', Icon: CheckCircle },
  rejected: { color:'rose',  labelHe:'נדחתה',  labelEn:'Rejected', Icon: XCircle     },
  cancelled: { color:'slate', labelHe:'בוטלה',  labelEn:'Cancelled', Icon: XCircle     },
};

// ── Localization ─────────────────────────────────────────────
// Single translation dictionary for the whole page and every wizard/panel
// it renders - follows the same per-page t={he:{...},en:{...}} pattern used
// elsewhere in Dormify (see HomePage.js / WhatIfPage.js). Built once from
// the current language and threaded down as a prop rather than re-derived
// per component, so every string on this page stays in one place.
function buildT(isHe) {
  const p = (he, en) => (isHe ? he : en);
  const loc3 = (b, a, r) => p(`בניין ${b} · דירה ${a} · חדר ${r}`, `Building ${b} · Apt ${a} · Room ${r}`);
  const loc3WithRegion = (region, b, a, r) => p(
    `${region ? `${region} · ` : ''}בניין ${b} · דירה ${a} · חדר ${r}`,
    `${region ? `${region} · ` : ''}Building ${b} · Apt ${a} · Room ${r}`
  );
  return {
    // ── Top bar ──
    pageTitle: p('בקשות מעבר', 'Transfer Requests'),
    pageSubtitle: p('ניהול ואישור בקשות שינוי מגורים של סטודנטים', 'Manage and approve student housing change requests'),
    refresh: p('רענון', 'Refresh'),
    newRequest: p('בקשה חדשה', 'New Request'),

    // ── Stat cards ──
    statTotal: p('סה"כ', 'Total'),
    statPending: p('ממתינות', 'Pending'),
    statApproved: p('אושרו', 'Approved'),
    statRejected: p('נדחו', 'Rejected'),

    // ── List toolbar ──
    searchPlaceholder: p('חיפוש...', 'Search...'),
    tabAll: p('הכל', 'All'),
    tabPending: p('ממתינות', 'Pending'),
    tabApproved: p('אושרו', 'Approved'),
    tabRejected: p('נדחו', 'Rejected'),
    requestTypeLabel: p('סוג בקשה', 'Request Type'),
    regionLabel: p('אזור', 'Region'),
    allRegions: p('כל האזורים', 'All Regions'),
    regionFilterTitle: p('סינון לפי אזור', 'Filter by region'),
    requestsCount: (n) => p(`${n} בקשות`, `${n} requests`),
    loadingRequests: p('טוען...', 'Loading...'),

    typeFilterAll: p('כל סוגי הבקשות', 'All request types'),
    typeFilterAddStudent: p('הוספת סטודנט', 'Add Student'),
    typeFilterRemoveStudent: p('הסרה ממעונות', 'Remove from Dorms'),
    typeFilterRoom: p('שינוי חדר', 'Room Transfer'),
    typeFilterApartment: p('מעבר דירה / אזור', 'Apartment / Region Transfer'),
    typeFilterSwap: p('חילוף סטודנטים', 'Student Swap'),
    typeFilterOther: p('בקשה אחרת', 'Other Request'),

    // ── Empty states ──
    emptyNoRequestsTitle: p('אין בקשות מעבר כרגע', 'No transfer requests yet'),
    emptyNoRequestsSub: p('בקשות חדשות שייווצרו יופיעו כאן', 'New requests will appear here'),
    emptyNoResultsTitle: p('לא נמצאו בקשות', 'No requests found'),
    emptyNoResultsSub: p('נסי לשנות את החיפוש או את הסינונים', 'Try changing the search or filters'),
    emptyDetailNoneTitle: p('אין בקשות להצגה', 'No requests to display'),
    emptyDetailNoneSub: p('כאשר תיווצר בקשת מעבר חדשה, פרטיה יוצגו כאן.', 'When a new transfer request is created, its details will appear here.'),
    emptyDetailPickTitle: p('בחרי בקשה מהרשימה', 'Select a request from the list'),
    emptyDetailPickSub: p('בחרי בקשה כדי לצפות בפרטים, בשיבוץ הנוכחי ובפעולות הזמינות.', 'Select a request to view its details, current placement and available actions.'),

    errLoad: p('שגיאה בטעינה', 'Failed to load'),
    errSubmit: p('שגיאה בשליחה', 'Failed to submit'),
    errGeneric: p('שגיאה', 'Error'),

    // ── Wizard shared chrome ──
    cancel: p('ביטול', 'Cancel'),
    back: p('חזרה', 'Back'),
    next: p('המשך', 'Next'),
    submit: p('שלח', 'Submit'),
    selectPlaceholder: p('בחר...', 'Select...'),
    studentSearchPlaceholder: p('חפש סטודנט משובץ...', 'Search assigned student...'),

    // ── New Request modal: type picker ──
    modalNewRequest: p('בקשה חדשה', 'New Request'),
    modalChooseType: p('בחר סוג בקשה', 'Choose Request Type'),
    modalBackToTypes: p('סוגי בקשות', 'Request Types'),
    typeAddStudentTitle: p('הוספת סטודנט', 'Add Student'),
    typeAddStudentSub: p('רישום סטודנט חדש למעונות', 'Register a new student to the dorms'),
    typeRemoveStudentTitle: p('הסרה ממעונות', 'Remove from Dorms'),
    typeRemoveStudentSub: p('הסרת סטודנט קיים', 'Remove an existing student'),
    typeTransferTitle: p('בקשת מעבר', 'Transfer Request'),
    typeTransferSub: p('חדר אחר, דירה אחרת או אזור אחר', 'Different room, apartment or region'),
    typeSwapTitle: p('חילוף בין סטודנטים', 'Student Swap'),
    typeSwapSub: p('שני סטודנטים מחליפים מקום', 'Two students swap places'),
    typeOtherTitle: p('בקשה אחרת', 'Other Request'),
    typeOtherSub: p('הארכת שהייה ועוד', 'Stay extension and more'),

    // ── AddStudentWizard ──
    addSteps: [p('פרטי סטודנט', 'Student Details'), p('העדפות דיור', 'Housing Preferences'), p('סיבה', 'Reason'), p('סיכום', 'Summary')],
    addStep0Title: p('פרטי הסטודנט החדש', 'New Student Details'),
    addStep1Title: p('העדפות דיור', 'Housing Preferences'),
    addStep2Title: p('סיבת הבקשה', 'Request Reason'),
    addStep3Title: p('סיכום לפני שליחה', 'Summary Before Submitting'),
    labelId: p('תעודת זהות', 'ID Number'),
    labelFirstName: p('שם פרטי', 'First Name'),
    labelLastName: p('שם משפחה', 'Last Name'),
    labelPhone: p('טלפון', 'Phone'),
    labelEmail: p('אימייל', 'Email'),
    labelCity: p('עיר', 'City'),
    labelGender: p('מגדר', 'Gender'),
    labelReligion: p('דת', 'Religion'),
    labelDormType: p('סוג מעון', 'Dorm Type'),
    labelReason: p('סיבה', 'Reason'),
    genderMale: p(localizeGender('male', 'he'), localizeGender('male', 'en')),
    genderFemale: p(localizeGender('female', 'he'), localizeGender('female', 'en')),
    religionJewish: p('יהודי', 'Jewish'),
    religionMuslim: p('מוסלמי', 'Muslim'),
    religionChristian: p('נוצרי', 'Christian'),
    religionDruze: p('דרוזי', 'Druze'),
    dormCouples: p('זוגות', 'Couples'),
    dormSingle: p('בודדים', 'Singles'),
    addReasonPlaceholder: p('הסבר מדוע הסטודנט זקוק למקום במעון...', 'Explain why the student needs a place in the dorms...'),
    summaryName: p('שם', 'Name'),
    summaryIdShort: p('ת.ז', 'ID'),
    summaryPhone: p('טלפון', 'Phone'),
    summaryEmail: p('אימייל', 'Email'),
    summaryCity: p('עיר', 'City'),
    summaryGender: p('מגדר', 'Gender'),
    summaryReligion: p('דת', 'Religion'),
    summaryDormType: p('סוג מעון', 'Dorm Type'),
    summaryReason: p('סיבה', 'Reason'),

    // ── RemoveWizard ──
    removeSteps: [p('בחר סטודנט', 'Select Student'), p('שיבוץ נוכחי', 'Current Placement'), p('סיבה', 'Reason'), p('אישור', 'Confirm')],
    removeStep0Title: p('בחר סטודנט להסרה', 'Select Student to Remove'),
    removeStep1Title: p('שיבוץ נוכחי', 'Current Placement'),
    removeStep2Title: p('סיבת ההסרה', 'Removal Reason'),
    removeStep3Title: p('אישור הסרה', 'Confirm Removal'),
    fieldBuilding: p('בניין', 'Building'),
    fieldApartment: p('דירה', 'Apartment'),
    fieldRoom: p('חדר', 'Room'),
    fieldBed: p('מיטה', 'Bed'),
    removeNote: p('לאחר האישור, המיטה תתפנה ופרטי הסטודנט יסומנו כלא פעיל.', 'Once confirmed, the bed will be freed and the student will be marked inactive.'),
    removeReasonPlaceholder: p('הסבר מדוע הסטודנט מוסר...', 'Explain why the student is being removed...'),
    summaryStudent: p('סטודנט', 'Student'),
    summaryPlacement: p('שיבוץ', 'Placement'),
    confirmRemoveBtn: p('אשר', 'Confirm'),
    loc3,

    // ── SwapWizard ──
    swapSteps: [p('סטודנט א׳', 'Student A'), p('סטודנט ב׳', 'Student B'), p('סיבה', 'Reason'), p('אישור', 'Confirm')],
    swapStep0Title: p('בחר סטודנט ראשון', 'Select First Student'),
    swapStep1Title: p('בחר סטודנט שני להחלפה', 'Select Second Student to Swap With'),
    swapStep2Title: p('סיבת החילוף', 'Swap Reason'),
    swapStep3Title: p('אישור חילוף', 'Confirm Swap'),
    swapDifferentStudents: p('יש לבחור שני סטודנטים שונים', 'Please select two different students'),
    swapReasonPlaceholder: p('הסבר מדוע מבוקש החילוף...', 'Explain why the swap is requested...'),
    summaryStudentA: p('סטודנט א׳', 'Student A'),
    summaryStudentB: p('סטודנט ב׳', 'Student B'),
    submitSwapBtn: p('שלח בקשת חילוף', 'Submit Swap Request'),

    // ── TransferWizard ──
    transferStepStudent: p('בחר סטודנט', 'Select Student'),
    transferStepScope: p('סוג מעבר', 'Transfer Type'),
    transferStepDetails: p('פרטים', 'Details'),
    transferStepOptions: p('אפשרויות', 'Options'),
    transferStepConfirm: p('אישור', 'Confirm'),
    transferStudentTitle: p('בחר סטודנט', 'Select Student'),
    transferScopeTitle: p('סוג המעבר', 'Transfer Type'),
    scopeSameApartment: p('בתוך אותה דירה', 'Within the same apartment'),
    scopeSameRegion: p('לדירה אחרת באותו אזור', 'Different apartment, same region'),
    scopeCrossRegion: p('לאזור אחר', 'To a different region'),
    scopeCentralOnlyTitle: p('רק מנהל מרכזי יכול ליצור מעבר לאזור אחר', 'Only a central admin can create a cross-region transfer'),
    targetRegionLabel: p('אזור יעד:', 'Target region:'),
    currentStudentRegionFallback: p('האזור הנוכחי של הסטודנט', "the student's current region"),
    hintSameApartment: p('מעבר לחדר/מיטה אחרת בתוך הדירה הנוכחית', 'Transfer to a different room/bed within the current apartment'),
    hintSameRegion: p('נבחר אוטומטית - האזור הנוכחי של הסטודנט', "Chosen automatically - the student's current region"),
    nonCentralNote: p(
      'משתמש אזורי רשאי לבצע מעברים בתוך האזור המורשה בלבד; מעבר לאזור אחר מוגש על ידי מנהל מרכזי',
      'A regional user may only make transfers within their authorized region; cross-region transfers are submitted by a central admin'
    ),
    destRegionLabel: p('אזור יעד', 'Target region'),
    searchRegionPlaceholder: p('חיפוש אזור...', 'Search region...'),
    noRegionsFound: p('לא נמצאו אזורים', 'No regions found'),
    currentRegionTag: p('(האזור הנוכחי)', '(current region)'),
    selectedLabel: p('נבחר:', 'Selected:'),
    detailsTitle: p('פרטי הבקשה', 'Request Details'),
    otherDescLabel: p('תיאור הבקשה', 'Request Description'),
    otherDescPlaceholder: p('תאר את הבקשה...', 'Describe the request...'),
    transferReasonPlaceholder: p('הסבר את סיבת הבקשה...', 'Explain the reason for the request...'),
    optionsTitle: p('אפשרויות שיבוץ', 'Assignment Options'),
    optionsSameApartmentHint: p('מוצגות מיטות פנויות בדירה הנוכחית בלבד', 'Only free beds in the current apartment are shown'),
    checkOptionsBtn: p('בדיקת אפשרויות שיבוץ', 'Check assignment options'),
    searchingEllipsis: p('מחפש...', 'Searching...'),
    confirmSummaryTitle: p('סיכום לפני שליחה', 'Summary Before Submitting'),
    summaryCurrentPlacement: p('שיבוץ נוכחי', 'Current Placement'),
    summaryTransferType: p('סוג מעבר', 'Transfer Type'),
    summaryTargetRegion: p('אזור יעד', 'Target Region'),
    summarySelectedTarget: p('יעד נבחר', 'Selected Target'),
    summaryDescription: p('תיאור', 'Description'),
    singlePlace: p('מקום יחיד', 'single place'),
    bedWord: p('מיטה', 'bed'),
    loc3WithRegion,

    // ── ActionPanel ──
actionsLabel: p('פעולות', 'Actions'),

deleteRequestBtn: p('מחק בקשה', 'Delete Request'),

deleteRequestConfirmText: (name) => p(
  `האם למחוק את הבקשה של ${name}? פעולה זו תמחק את הבקשה בלבד ולא את הסטודנט מהמערכת.`,
  `Delete the request for ${name}? This will delete only the request and not the student from the system.`
),

deleteRequestError: p(
  'שגיאה במחיקת הבקשה',
  'Failed to delete request'
),

pendingDestinationReviewNote: p(
  'בקשת ההעברה ממתינה לבדיקה ואישור על ידי אזור היעד',
  "The transfer request is awaiting review and approval by the destination region"
),

rejectPlaceholder: p(
  'סיבת הדחייה (אופציונלי)...',
  'Rejection reason (optional)...'
),

rejectBtn: p('דחה', 'Reject'),
approveRemoveBtn: p('אשר הסרה', 'Confirm Removal'),

    // ── DetailPane ──
    tlCreated: p('נוצרה', 'Created'),
    tlPendingApproval: p('ממתינה לאישור', 'Awaiting approval'),
    tlApprovalFallback: p('אישור', 'Approval'),
    sectionRequestRoute: p('מסלול הבקשה', 'Request Route'),
    sectionCurrentPlacement: p('שיבוץ נוכחי', 'Current Placement'),
    sectionRequestDetails: p('פרטי הבקשה', 'Request Details'),
    dpTypeLabel: p('סוג הבקשה:', 'Request type:'),
    kvTransferType: p('סוג מעבר', 'Transfer Type'),
    transferTypeCrossRegion: p('לאזור אחר', 'To a different region'),
    transferTypeSameApartment: p('בתוך אותה דירה', 'Within the same apartment'),
    transferTypeSameRegionDiffApt: p('לדירה אחרת באותו אזור', 'Different apartment, same region'),
    transferTypeFallback: p('מעבר בתוך האזור הנוכחי', 'Transfer within the current region'),
    kvSourceRegion: p('אזור מוצא', 'Source Region'),
    kvTargetRegion: p('אזור יעד', 'Target Region'),
    kvFinalPlacement: p('שיבוץ סופי', 'Final Placement'),
    kvSwapWith: p('מחליף/ה עם', 'Swapping with'),
    kvReason: p('סיבה', 'Reason'),
    kvDescription: p('תיאור', 'Description'),
    kvOpenedBy: p('נפתח ע"י', 'Opened by'),
    kvDate: p('תאריך', 'Date'),
    kvHandledBy: p('טופל ע"י', 'Handled by'),
    historyToggle: (n) => p(`היסטוריית שיבוצים (${n})`, `Placement history (${n})`),
    rejectionReasonLabel: p('סיבת הדחייה:', 'Rejection reason:'),
    dash: '—',

    // Directional "back"/"forward" arrows in wizard footers and the type
    // picker - Hebrew reads right-to-left so "forward" points left and
    // "back" points right; English mirrors this. Kept as icon refs on the
    // dictionary so every wizard picks the right glyph without re-deriving it.
    BackArrow: isHe ? ArrowRight : ArrowLeft,
    NextArrow: isHe ? ArrowLeft : ArrowRight,
  };
}

// ── Atoms ────────────────────────────────────────────────────
const Pill = ({ color, children, small }) => (
  <span className={`pill pill-${color}${small?' pill-sm':''}`}>{children}</span>
);
const Spinner = ({ size=16 }) => <Loader2 size={size} className="spin" />;

const EmptyPane = ({ icon: Icon, title, sub, action, onAction }) => (
  <div className="empty-pane">
    <div className="ep-ico"><Icon size={28} /></div>
    <h4>{title}</h4>
    {sub && <p>{sub}</p>}
    {action && <button className="ep-btn" onClick={onAction}>{action}</button>}
  </div>
);

const StatCard = ({ label, value, icon: Icon, color, active, onClick }) => (
  <button className={`stat-card stat-${color}${active?' stat-active':''}`} onClick={onClick}>
    <div className="sc-ico"><Icon size={14} /></div>
    <div className="sc-val">{value}</div>
    <div className="sc-lbl">{label}</div>
  </button>
);

// ── Timeline ─────────────────────────────────────────────────
const Timeline = ({ events }) => (
  <div className="tl-wrap">
    {events.map((ev, i) => (
      <div key={i} className={`tl-item ${ev.done?'tl-done':ev.active?'tl-active':'tl-idle'}`}>
        <div className="tl-dot">
          {ev.done ? <Check size={9}/> : ev.active ? <Circle size={8}/> : null}
        </div>
        {i < events.length-1 && <div className="tl-line"/>}
        <div className="tl-body">
          <span className="tl-lbl">{ev.label}</span>
          {ev.sub && <span className="tl-sub">{ev.sub}</span>}
        </div>
      </div>
    ))}
  </div>
);

// ── Wizard progress bar ───────────────────────────────────────
const WizardBar = ({ steps, current, colorKey }) => (
  <div className="wz-bar">
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        <div className={`wz-node ${i<current?'wz-done':i===current?`wz-cur wz-cur-${colorKey}`:'wz-idle'}`}>
          <div className="wz-circle">{i<current?<Check size={10}/>:<span>{i+1}</span>}</div>
          <span className="wz-lbl">{s}</span>
        </div>
        {i < steps.length-1 && <div className={`wz-conn${i<current?' wz-conn-done':''}`}/>}
      </React.Fragment>
    ))}
  </div>
);

// ── Student search ────────────────────────────────────────────
// StudentSearch itself now lives in src/components/StudentSearch.js
// (shared with the Assisted Allocation page) - imported above.

const PickedBar = ({ student, onClear }) => {
  const name = student?.full_name || `${student?.first_name||''} ${student?.last_name||''}`.trim();
  return (
    <div className="picked-bar">
      <div className="pb-ava">{(name[0]||'?').toUpperCase()}</div>
      <div className="pb-info">
        <span className="pb-name">{name}</span>
        <span className="pb-id mono">{student?.student_id}</span>
      </div>
      <button className="pb-clear" onClick={onClear}><X size={12}/></button>
    </div>
  );
};


// ── Add Student Wizard ────────────────────────────────────────
const AddStudentWizard = ({ onSubmit, onCancel, submitting, error, T }) => {
  const [step, setStep] = useState(0);
  const [d, setD] = useState({ student_id:'', first_name:'', last_name:'', phone:'', email:'', city:'', gender:'', religion:'', dorm_type:'', reason:'' });
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  const steps = T.addSteps;

  const canNext = () => {
    if (step===0) return d.student_id && d.first_name && d.last_name;
    if (step===1) return !!d.gender;
    if (step===2) return d.reason.trim().length>0;
    return true;
  };

  const fld = (k,lbl,type='text',req=false) => (
    <div className="wz-field">
      <label>{lbl}{req&&<span className="req">*</span>}</label>
      <input type={type} value={d[k]} onChange={e=>set(k,e.target.value)} placeholder={lbl}/>
    </div>
  );
  const sel = (k,lbl,opts,req=false) => (
    <div className="wz-field">
      <label>{lbl}{req&&<span className="req">*</span>}</label>
      <select value={d[k]} onChange={e=>set(k,e.target.value)}>
        <option value="">{T.selectPlaceholder}</option>
        {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );

  return (
    <div className="wz-root">
      <WizardBar steps={steps} current={step} colorKey="blue"/>
      <div className="wz-content">
        {step===0 && (<>
          <h3 className="wz-title">{T.addStep0Title}</h3>
          <div className="wz-g3">{fld('student_id',T.labelId,'text',true)}{fld('first_name',T.labelFirstName,'text',true)}{fld('last_name',T.labelLastName,'text',true)}</div>
          <div className="wz-g3">{fld('phone',T.labelPhone,'tel')}{fld('email',T.labelEmail,'email')}{fld('city',T.labelCity)}</div>
        </>)}
        {step===1 && (<>
          <h3 className="wz-title">{T.addStep1Title}</h3>
          <div className="wz-g2">
            {sel('gender',T.labelGender,[{v:'male',l:T.genderMale},{v:'female',l:T.genderFemale}],true)}
            {sel('religion',T.labelReligion,[{v:'Jewish',l:T.religionJewish},{v:'Muslims',l:T.religionMuslim},{v:'Christian',l:T.religionChristian},{v:'Druze',l:T.religionDruze}])}
            {sel('dorm_type',T.labelDormType,[{v:'couples',l:T.dormCouples},{v:'single',l:T.dormSingle}])}
          </div>
        </>)}
        {step===2 && (<>
          <h3 className="wz-title">{T.addStep2Title}</h3>
          <div className="wz-field">
            <label>{T.labelReason}<span className="req">*</span></label>
            <textarea rows={4} value={d.reason} onChange={e=>set('reason',e.target.value)} placeholder={T.addReasonPlaceholder}/>
          </div>
        </>)}
        {step===3 && (<>
          <h3 className="wz-title">{T.addStep3Title}</h3>
          <div className="wz-summary">
            {[[T.summaryName,`${d.first_name} ${d.last_name}`],[T.summaryIdShort,d.student_id],[T.summaryPhone,d.phone||T.dash],
              [T.summaryEmail,d.email||T.dash],[T.summaryCity,d.city||T.dash],
              [T.summaryGender,d.gender==='male'?T.genderMale:d.gender==='female'?T.genderFemale:T.dash],
              [T.summaryReligion,d.religion||T.dash],[T.summaryDormType,d.dorm_type||T.dash],[T.summaryReason,d.reason]
            ].map(([k,v])=>(
              <div key={k} className="sum-row">
                <span className="sum-k">{k}</span><span className="sum-v">{v}</span>
              </div>
            ))}
          </div>
          {error && <div className="wz-err">{error}</div>}
        </>)}
      </div>
      <div className="wz-footer">
        <button className="wz-back" onClick={step===0?onCancel:()=>setStep(s=>s-1)}>
          {step===0?T.cancel:<><T.BackArrow size={13}/> {T.back}</>}
        </button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<steps.length-1
          ? <button className="wz-next wz-blue" disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>{T.next} <T.NextArrow size={13}/></button>
          : <button className="wz-next wz-blue" disabled={submitting} onClick={()=>{
              const { reason, ...studentFields } = d;
              onSubmit({ request_type:'add_student', reason, student_data: studentFields });
            }}>
              {submitting?<Spinner size={13}/>:<Check size={13}/>} {T.submit}
            </button>}
      </div>
    </div>
  );
};

// ── Remove Student Wizard ─────────────────────────────────────
const RemoveWizard = ({ onSubmit, onCancel, submitting, error, T, language }) => {
  const [step, setStep] = useState(0);
  const [student, setStudent] = useState(null);
  const [reason, setReason] = useState('');
  const steps = T.removeSteps;

  const canNext = () => {
    if (step===0) return !!student;
    if (step===2) return reason.trim().length>0;
    return true;
  };

  return (
    <div className="wz-root">
      <WizardBar steps={steps} current={step} colorKey="rose"/>
      <div className="wz-content">
        {step===0 && (<>
          <h3 className="wz-title">{T.removeStep0Title}</h3>
          {student ? <PickedBar student={student} onClear={()=>setStudent(null)}/> : <StudentSearch onPick={setStudent} filter={s=>s.is_assigned} placeholder={T.studentSearchPlaceholder} language={language}/>}
        </>)}
        {step===1 && student && (<>
          <h3 className="wz-title">{T.removeStep1Title}</h3>
          <div className="assignment-panel rose-panel">
            <div className="ap-row"><Building2 size={13}/><span>{T.fieldBuilding}</span><strong>{student.current_building||T.dash}</strong></div>
            <div className="ap-row"><DoorOpen size={13}/><span>{T.fieldApartment}</span><strong>{student.current_apartment||T.dash}</strong></div>
            <div className="ap-row"><Home size={13}/><span>{T.fieldRoom}</span><strong>{student.current_room||T.dash}</strong></div>
            <div className="ap-row"><BedDouble size={13}/><span>{T.fieldBed}</span><strong>{student.current_bed||T.dash}</strong></div>
          </div>
          <div className="wz-note rose-note"><AlertTriangle size={13}/> {T.removeNote}</div>
        </>)}
        {step===2 && (<>
          <h3 className="wz-title">{T.removeStep2Title}</h3>
          <div className="wz-field">
            <label>{T.labelReason}<span className="req">*</span></label>
            <textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder={T.removeReasonPlaceholder}/>
          </div>
        </>)}
        {step===3 && (<>
          <h3 className="wz-title">{T.removeStep3Title}</h3>
          <div className="wz-summary">
            <div className="sum-row"><span className="sum-k">{T.summaryStudent}</span><span className="sum-v">{student?.full_name}</span></div>
            <div className="sum-row"><span className="sum-k">{T.summaryIdShort}</span><span className="sum-v mono">{student?.student_id}</span></div>
            <div className="sum-row"><span className="sum-k">{T.summaryPlacement}</span><span className="sum-v">{T.loc3(student?.current_building, student?.current_apartment, student?.current_room)}</span></div>
            <div className="sum-row"><span className="sum-k">{T.summaryReason}</span><span className="sum-v">{reason}</span></div>
          </div>
          {error && <div className="wz-err">{error}</div>}
        </>)}
      </div>
      <div className="wz-footer">
        <button className="wz-back" onClick={step===0?onCancel:()=>setStep(s=>s-1)}>{step===0?T.cancel:<><T.BackArrow size={13}/> {T.back}</>}</button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<steps.length-1
          ? <button className="wz-next wz-rose" disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>{T.next} <T.NextArrow size={13}/></button>
          : <button className="wz-next wz-rose" disabled={submitting} onClick={()=>onSubmit({student:student?.id,reason,request_type:'remove_student'})}>
              {submitting?<Spinner size={13}/>:<UserMinus size={13}/>} {T.confirmRemoveBtn}
            </button>}
      </div>
    </div>
  );
};

// ── Swap Wizard (two students swap current beds/rooms) ────────
const SwapWizard = ({ onSubmit, onCancel, submitting, error, T, language }) => {
  const [step, setStep] = useState(0);
  const [studentA, setStudentA] = useState(null);
  const [studentB, setStudentB] = useState(null);
  const [reason, setReason] = useState('');
  const steps = T.swapSteps;

  const canNext = () => {
    if (step===0) return !!studentA;
    if (step===1) return !!studentB && studentB.id !== studentA?.id;
    if (step===2) return reason.trim().length>0;
    return true;
  };

  const AssignmentBox = ({ student }) => (
    <div className="assignment-panel violet-panel">
      <div className="ap-row"><Building2 size={13}/><span>{T.fieldBuilding}</span><strong>{student.current_building||T.dash}</strong></div>
      <div className="ap-row"><DoorOpen size={13}/><span>{T.fieldApartment}</span><strong>{student.current_apartment||T.dash}</strong></div>
      <div className="ap-row"><Home size={13}/><span>{T.fieldRoom}</span><strong>{student.current_room||T.dash}</strong></div>
      <div className="ap-row"><BedDouble size={13}/><span>{T.fieldBed}</span><strong>{student.current_bed||T.dash}</strong></div>
    </div>
  );

  return (
    <div className="wz-root">
      <WizardBar steps={steps} current={step} colorKey="indigo"/>
      <div className="wz-content">
        {step===0 && (<>
          <h3 className="wz-title">{T.swapStep0Title}</h3>
          {studentA ? <PickedBar student={studentA} onClear={()=>setStudentA(null)}/> : <StudentSearch onPick={setStudentA} filter={s=>s.is_assigned} placeholder={T.studentSearchPlaceholder} language={language}/>}
          {studentA && <div style={{marginTop:12}}><AssignmentBox student={studentA}/></div>}
        </>)}
        {step===1 && (<>
          <h3 className="wz-title">{T.swapStep1Title}</h3>
          {studentB ? <PickedBar student={studentB} onClear={()=>setStudentB(null)}/> : <StudentSearch onPick={setStudentB} filter={s=>s.is_assigned && s.id!==studentA?.id} placeholder={T.studentSearchPlaceholder} language={language}/>}
          {studentB && <div style={{marginTop:12}}><AssignmentBox student={studentB}/></div>}
          {studentB && studentB.id===studentA?.id && (
            <div className="wz-note rose-note"><AlertTriangle size={13}/> {T.swapDifferentStudents}</div>
          )}
        </>)}
        {step===2 && (<>
          <h3 className="wz-title">{T.swapStep2Title}</h3>
          <div className="wz-field">
            <label>{T.labelReason}<span className="req">*</span></label>
            <textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder={T.swapReasonPlaceholder}/>
          </div>
        </>)}
        {step===3 && (<>
          <h3 className="wz-title">{T.swapStep3Title}</h3>
          <div className="wz-summary">
            <div className="sum-row"><span className="sum-k">{T.summaryStudentA}</span><span className="sum-v">{studentA?.full_name} · {T.loc3(studentA?.current_building, studentA?.current_apartment, studentA?.current_room)}</span></div>
            <div className="sum-row"><span className="sum-k">{T.summaryStudentB}</span><span className="sum-v">{studentB?.full_name} · {T.loc3(studentB?.current_building, studentB?.current_apartment, studentB?.current_room)}</span></div>
            <div className="sum-row"><span className="sum-k">{T.summaryReason}</span><span className="sum-v">{reason}</span></div>
          </div>
          {error && <div className="wz-err">{error}</div>}
        </>)}
      </div>
      <div className="wz-footer">
        <button className="wz-back" onClick={step===0?onCancel:()=>setStep(s=>s-1)}>{step===0?T.cancel:<><T.BackArrow size={13}/> {T.back}</>}</button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<steps.length-1
          ? <button className="wz-next wz-indigo" disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>{T.next} <T.NextArrow size={13}/></button>
          : <button className="wz-next wz-indigo" disabled={submitting} onClick={()=>onSubmit({student:studentA?.id,swap_with_student:studentB?.id,reason,request_type:'swap'})}>
              {submitting?<Spinner size={13}/>:<RefreshCw size={13}/>} {T.submitSwapBtn}
            </button>}
      </div>
    </div>
  );
};

// ── Transfer Wizard (room / apartment / other) ────────────────
const TransferWizard = ({ type, onSubmit, onCancel, submitting, error, regions = [],
  feasData, onCheckFeas, checkingFeas, onClearFeas, onLoadMoreFeas, loadingMoreFeas, loadMoreFeasError,
  T, language }) => {
  const { isCentralAdmin, user } = useAuth();
  const central = isCentralAdmin();
  const [step, setStep] = useState(0);
  const [student, setStudent] = useState(null);
  const [reason, setReason] = useState('');
  const [otherDesc, setOtherDesc] = useState('');
  const [selOpt, setSelOpt] = useState(null);
  // Unified transfer scope: same_apartment / same_region / cross_region.
  // Cross-region creation is central-admin only - the backend enforces
  // this independently of the UI (serializer PermissionDenied).
  const [scope, setScope] = useState(null);
  const [destRegions, setDestRegions] = useState([]);
  const [regionQuery, setRegionQuery] = useState('');

  const isTransfer = type==='transfer';
  const colorKey = isTransfer?'violet':'amber';

  // The three scopes map onto existing backend request fields only:
  //   same_apartment -> room      + same_apartment=true
  //   same_region    -> apartment + same_apartment=false + scope same_region
  //   cross_region   -> apartment + scope cross_region + destination_regions
  const effReqType  = scope==='same_apartment' ? 'room' : 'apartment';
  const effSameApt  = scope==='same_apartment' ? true : scope==='same_region' ? false : null;
  const effScope    = scope==='cross_region' ? 'cross_region' : 'same_region';

  const stepKeys = isTransfer
    ? ['student','scope','details','options','confirm']
    : ['student','details','confirm'];
  const stepLabels = {
    student:T.transferStepStudent, scope:T.transferStepScope, details:T.transferStepDetails,
    options:T.transferStepOptions, confirm:T.transferStepConfirm,
  };
  const steps = stepKeys.map(k=>stepLabels[k]);
  const stepKey = stepKeys[step];
  const lastStep = steps.length-1;

  // Any change to what defines the search invalidates previously fetched
  // options (and the previously selected bed) - never show stale results.
  useEffect(() => {
    if (!isTransfer) return;
    setSelOpt(null);
    if (onClearFeas) onClearFeas();
  }, [scope, destRegions, student]); // eslint-disable-line

  const canNext = () => {
    if (stepKey==='student') return !!student;
    if (stepKey==='scope') return !!scope && (scope!=='cross_region' || destRegions.length>0);
    if (stepKey==='details') return reason.trim().length>0;
    if (stepKey==='options') return !!selOpt;
    return true;
  };

  const visibleRegions = regions.filter(r =>
    !regionQuery.trim() || (r.name||'').toLowerCase().includes(regionQuery.trim().toLowerCase()));
  const destRegionNames = regions.filter(r=>destRegions.includes(r.id)).map(r=>r.name);
  const currentRegionLabel = student?.region_name || T.currentStudentRegionFallback;
  const searchedRegionNames = (feasData?.search_regions||[]).map(r=>r.name);
  const scopeLabel = {
    same_apartment:T.scopeSameApartment,
    same_region:T.scopeSameRegion,
    cross_region:T.scopeCrossRegion,
  }[scope] || '';

  return (
    <div className="wz-root">
      <WizardBar steps={steps} current={step} colorKey={colorKey}/>
      <div className="wz-content">
        {stepKey==='student' && (<>
          <h3 className="wz-title">{T.transferStudentTitle}</h3>
          {student ? <PickedBar student={student} onClear={()=>setStudent(null)}/> : (
            <StudentSearch
              onPick={(s)=>{
                setStudent(s);
                // The slim search payload has no region_name - fetch the full
                // record so the read-only target-region label can show the
                // real current region name on the scope step.
                if (!s.region_name && studentsAPI.getById) {
                  studentsAPI.getById(s.id)
                    .then(full => setStudent(prev => (prev && prev.id===s.id ? { ...prev, ...full } : prev)))
                    .catch(()=>{});
                }
              }}
              filter={s=>s.is_assigned} placeholder={T.studentSearchPlaceholder} language={language}/>
          )}
          {student && (
            <div className="assignment-panel violet-panel" style={{marginTop:12}}>
              {student.region_name && <div className="ap-row"><MapPin size={13}/><span>{T.fieldRegion}</span><strong>{student.region_name}</strong></div>}
              <div className="ap-row"><Building2 size={13}/><span>{T.fieldBuilding}</span><strong>{student.current_building||T.dash}</strong></div>
              <div className="ap-row"><DoorOpen size={13}/><span>{T.fieldApartment}</span><strong>{student.current_apartment||T.dash}</strong></div>
              <div className="ap-row"><Home size={13}/><span>{T.fieldRoom}</span><strong>{student.current_room||T.dash}</strong></div>
            </div>
          )}
        </>)}

        {stepKey==='scope' && (<>
          <h3 className="wz-title">{T.transferScopeTitle}</h3>
          <div className="pref-group">
            {[
              {v:'same_apartment', l:T.scopeSameApartment},
              {v:'same_region',    l:T.scopeSameRegion},
              {v:'cross_region',   l:T.scopeCrossRegion, centralOnly:true},
            ].map(o=>(
              <button key={o.v} type="button"
                className={`pref-btn${scope===o.v?' pref-active':''}`}
                disabled={o.centralOnly && !central}
                title={o.centralOnly && !central ? T.scopeCentralOnlyTitle : undefined}
                onClick={()=>setScope(o.v)}>{o.l}</button>
            ))}
          </div>
          {(scope==='same_apartment' || scope==='same_region') && (
            <div className="scope-region-note">
              <MapPin size={13}/> {T.targetRegionLabel} <strong>{central ? currentRegionLabel : (user?.region_name || user?.regionName || currentRegionLabel)}</strong>
              <span className="scope-region-hint">
                {scope==='same_apartment'
                  ? T.hintSameApartment
                  : T.hintSameRegion}
              </span>
            </div>
          )}
          {!central && (
            <div className="scope-region-note">
              <MapPin size={13}/>
              <span className="scope-region-hint">{T.nonCentralNote}</span>
            </div>
          )}
          {scope==='cross_region' && central && (
            <div className="region-ms">
              <label className="region-ms-label">{T.destRegionLabel}<span className="req">*</span></label>
              <div className="region-ms-search">
                <Search size={12}/>
                <input value={regionQuery} onChange={e=>setRegionQuery(e.target.value)} placeholder={T.searchRegionPlaceholder}/>
              </div>
              <div className="region-ms-list">
                {visibleRegions.map(r=>(
                  <label key={r.id} className={`region-ms-row${destRegions.includes(r.id)?' region-ms-on':''}`}>
                    <input type="radio" name="dest-region" checked={destRegions.includes(r.id)} onChange={()=>setDestRegions([r.id])}/>
                    <span>{r.name}</span>
                    {student?.region_name===r.name && <span className="region-ms-cur">{T.currentRegionTag}</span>}
                  </label>
                ))}
                {visibleRegions.length===0 && <div className="region-ms-empty">{T.noRegionsFound}</div>}
              </div>
              {destRegions.length>0 && (
                <div className="region-ms-picked">{T.selectedLabel} <strong>{destRegionNames.join(', ')}</strong></div>
              )}
            </div>
          )}
        </>)}

        {stepKey==='details' && (<>
          <h3 className="wz-title">{T.detailsTitle}</h3>
          {type==='other' && (
            <div className="wz-field">
              <label>{T.otherDescLabel}</label>
              <input value={otherDesc} onChange={e=>setOtherDesc(e.target.value)} placeholder={T.otherDescPlaceholder}/>
            </div>
          )}
          <div className="wz-field">
            <label>{T.labelReason}<span className="req">*</span></label>
            <textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder={T.transferReasonPlaceholder}/>
          </div>
        </>)}

        {stepKey==='options' && (<>
          <h3 className="wz-title">{T.optionsTitle}</h3>
          <div className="scope-region-note">
            <MapPin size={13}/>
            {scope==='cross_region'
              ? <>{T.targetRegionColon}<strong>{(searchedRegionNames.length?searchedRegionNames:destRegionNames).join(', ')}</strong></>
              : <>{T.targetRegionColon}<strong>{searchedRegionNames[0] || currentRegionLabel}</strong></>}
            {scope==='same_apartment' && <span className="scope-region-hint">{T.optionsSameApartmentHint}</span>}
          </div>
          {!feasData && !checkingFeas && (
            <button className="check-feas-btn"
              onClick={()=>onCheckFeas(null,student?.id,effReqType,effSameApt,effScope,scope==='cross_region'?destRegions:undefined)}>
              <Activity size={14}/> {T.checkOptionsBtn}
            </button>
          )}
          {checkingFeas && <div className="checking-state"><Spinner/> {T.searchingEllipsis}</div>}
          {feasData && (
            <BedMatchPicker
              buildings={feasData.buildings||[]}
              totalBuildings={feasData.total_buildings}
              totalApartments={feasData.total_apartments}
              totalRooms={feasData.total_rooms}
              totalValidBeds={feasData.total_valid_beds}
              counts={feasData.counts}
              dataIntegrity={feasData.data_integrity}
              conflictExamples={feasData.conflict_examples}
              loading={checkingFeas}
              loadingMore={loadingMoreFeas}
              hasMore={!!feasData.has_more}
              onLoadMore={onLoadMoreFeas}
              loadMoreError={loadMoreFeasError}
              selectedBedId={selOpt?.bed_id}
              onSelectBed={setSelOpt}
              language={language}
              scopeContext={scope}
            />
          )}
        </>)}

        {stepKey==='confirm' && (<>
          <h3 className="wz-title">{T.confirmSummaryTitle}</h3>
          <div className="wz-summary">
            <div className="sum-row"><span className="sum-k">{T.summaryStudent}</span><span className="sum-v">{student?.full_name}</span></div>
            <div className="sum-row"><span className="sum-k">{T.summaryCurrentPlacement}</span><span className="sum-v">{T.loc3WithRegion(student?.region_name, student?.current_building, student?.current_apartment, student?.current_room)}</span></div>
            {isTransfer && <div className="sum-row"><span className="sum-k">{T.summaryTransferType}</span><span className="sum-v">{scopeLabel}</span></div>}
            {isTransfer && scope==='cross_region' && <div className="sum-row"><span className="sum-k">{T.summaryTargetRegion}</span><span className="sum-v">{destRegionNames.join(', ')}</span></div>}
            {isTransfer&&selOpt && <div className="sum-row"><span className="sum-k">{T.summarySelectedTarget}</span><span className="sum-v">{T.loc3WithRegion(selOpt.region_name, selOpt.building, selOpt.apartment, selOpt.room)} · {selOpt.single_bed_room ? T.singlePlace : `${T.bedWord} ${selOpt.bed_display || selOpt.bed_label}`}</span></div>}
            {reason && <div className="sum-row"><span className="sum-k">{T.summaryReason}</span><span className="sum-v">{reason}</span></div>}
            {otherDesc && <div className="sum-row"><span className="sum-k">{T.summaryDescription}</span><span className="sum-v">{otherDesc}</span></div>}
          </div>
          {error && <div className="wz-err">{error}</div>}
        </>)}
      </div>
      <div className="wz-footer">
        <button className="wz-back" onClick={step===0?onCancel:()=>setStep(s=>s-1)}>{step===0?T.cancel:<><T.BackArrow size={13}/> {T.back}</>}</button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<lastStep
          ? <button className={`wz-next wz-${colorKey}`} disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>{T.next} <T.NextArrow size={13}/></button>
          : <button className={`wz-next wz-${colorKey}`} disabled={submitting}
              onClick={()=>{
                const payload = {
                  student:student?.id,
                  request_type: isTransfer ? effReqType : type,
                  reason, other_description:otherDesc,
                  same_apartment: isTransfer ? effSameApt : null,
                  target_room:selOpt?.room_id||selOpt?.roomId,
                  ...(isTransfer ? {
                    transfer_scope: central ? effScope : 'same_region',
                    // Region PKs are slug strings (e.g. "broshim") - pass
                    // them through untouched, only dropping null/empty.
                    destination_regions: (central && scope==='cross_region')
                      ? destRegions.filter((v)=>v!=null && String(v).trim()!=='')
                      : [],
                  } : {}),
                };
                onSubmit(payload);
              }}>
              {submitting?<Spinner size={13}/>:<Check size={13}/>} {T.submit}
            </button>}
      </div>
    </div>
  );
};

// ── New Request Modal ─────────────────────────────────────────
const NewRequestModal = ({ onClose, onSuccess, regions = [], T, language }) => {
  const [type, setType] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [feasData, setFeasData] = useState(null);
  const [checkingFeas, setCheckingFeas] = useState(false);
  const [loadingMoreFeas, setLoadingMoreFeas] = useState(false);
  const [loadMoreFeasError, setLoadMoreFeasError] = useState('');
  // Remembers the params of the last feasibility check so "load more" can
  // repeat the exact same filter (student/type/same-apartment) at the next
  // offset instead of guessing - never mixes results from a different query.
  const feasParamsRef = useRef(null);
  const feasAbortRef = useRef(null);

  const typeCards = [
    { v:'add_student',    Icon:UserPlus,  color:'blue',   title:T.typeAddStudentTitle, sub:T.typeAddStudentSub },
    { v:'remove_student', Icon:UserMinus, color:'rose',   title:T.typeRemoveStudentTitle, sub:T.typeRemoveStudentSub },
    { v:'transfer',       Icon:ArrowRightLeft, color:'violet', title:T.typeTransferTitle, sub:T.typeTransferSub },
    { v:'swap',           Icon:RefreshCw, color:'indigo', title:T.typeSwapTitle, sub:T.typeSwapSub },
    { v:'other',          Icon:FileText,  color:'amber',  title:T.typeOtherTitle,   sub:T.typeOtherSub },
  ];

  const handleSubmit = async (payload) => {
    setError(''); setSubmitting(true);
    try { await requestsAPI.create(payload); onSuccess(); onClose(); }
    catch (err) { setError(err.message||T.errSubmit); }
    finally { setSubmitting(false); }
  };

  const handleCheckFeas = async (_id, studentId, reqType, sameApt, transferScope, regionIds) => {
    if (feasAbortRef.current) feasAbortRef.current.abort();
    const controller = new AbortController();
    feasAbortRef.current = controller;
    // Remember the FULL search definition (incl. transfer scope and the
    // selected destination regions) so "load more" repeats it exactly.
    feasParamsRef.current = { studentId, reqType, sameApt, transferScope, regionIds };
    setCheckingFeas(true);
    setFeasData(null); // clear stale results from a previous filter immediately
    try {
      const d = await requestsAPI.checkFeasibilityForStudent(studentId, reqType, sameApt, {
        signal: controller.signal, transferScope, regionIds,
      });
      setFeasData(d);
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      setFeasData({ feasible:false, reason:err.message, buildings:[] });
    }
    finally { if (feasAbortRef.current === controller) setCheckingFeas(false); }
  };

  const handleLoadMoreFeas = async () => {
    const p = feasParamsRef.current;
    if (!p || !feasData || loadingMoreFeas) return;
    setLoadingMoreFeas(true);
    setLoadMoreFeasError('');
    try {
      // Building-paged: offset counts BUILDINGS already loaded; the next
      // page is appended, never replacing what is already on screen.
      const d = await requestsAPI.checkFeasibilityForStudent(p.studentId, p.reqType, p.sameApt, {
        offset: (feasData.buildings || []).length,
        transferScope: p.transferScope, regionIds: p.regionIds,
      });
      setFeasData((prev) => ({ ...d, buildings: mergeBuildings(prev?.buildings, d.buildings) }));
    } catch (err) {
      // keep existing results visible - a failed "load more" isn't fatal.
      setLoadMoreFeasError(err.message || T.errGeneric);
    } finally { setLoadingMoreFeas(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="mh-left">
            {type && <button className="back-type" onClick={()=>setType(null)}><T.BackArrow size={13}/> {T.modalBackToTypes}</button>}
            <h2>{type?T.modalNewRequest:T.modalChooseType}</h2>
          </div>
          <button className="modal-close" onClick={onClose}><X size={17}/></button>
        </div>

        {!type && (
          <div className="type-picker">
            {typeCards.map(tc=>{
              const Icon=tc.Icon;
              return (
                <button key={tc.v} className={`tp-card`} onClick={()=>setType(tc.v)}>
                  <div className={`tp-ico tp-ico-${tc.color}`}><Icon size={18}/></div>
                  <div className="tp-info">
                    <span className="tp-title">{tc.title}</span>
                    <span className="tp-sub">{tc.sub}</span>
                  </div>
                  <T.NextArrow size={13} className="tp-arrow"/>
                </button>
              );
            })}
          </div>
        )}
        {type==='add_student'    && <AddStudentWizard onSubmit={handleSubmit} onCancel={onClose} submitting={submitting} error={error} T={T}/>}
        {type==='remove_student' && <RemoveWizard     onSubmit={handleSubmit} onCancel={onClose} submitting={submitting} error={error} T={T} language={language}/>}
        {type==='swap'           && <SwapWizard       onSubmit={handleSubmit} onCancel={onClose} submitting={submitting} error={error} T={T} language={language}/>}
        {(type==='transfer'||type==='other') && (
          <TransferWizard type={type} onSubmit={handleSubmit} onCancel={onClose}
            submitting={submitting} error={error} regions={regions}
            feasData={feasData} onCheckFeas={handleCheckFeas} checkingFeas={checkingFeas}
            onClearFeas={()=>setFeasData(null)}
            onLoadMoreFeas={handleLoadMoreFeas} loadingMoreFeas={loadingMoreFeas}
            loadMoreFeasError={loadMoreFeasError} T={T} language={language}/>
        )}
      </div>
    </div>
  );
};

// ── Action Panel ──────────────────────────────────────────────
const ActionPanel = ({ request, onApprove, onReject, acting,
  feasData, checkingFeas, onCheckFeas, onLoadMoreFeas, loadingMoreFeas, loadMoreFeasError,
  rawBedOptions, loadingBeds, bedsError, onLoadMoreBedOptions, loadingMoreBeds, loadMoreBedsError,
  roomId, onSetRoom,
  selFeasOpt, onSelFeasOpt, T, language }) => {

  const { canEditRegion } = useAuth();
  const [rejectText, setRejectText] = useState('');
  const [showReject, setShowReject] = useState(false);
  const isAdd = request.request_type==='add_student';
  const isRem = request.request_type==='remove_student';
  const isSwap = request.request_type==='swap';
  const hasFeas = feasData?.feasible !== undefined;

  if (request.status!=='pending') return null;

  // A region_transfer's approve/reject authority is the DESTINATION
  // region (or central admin) - see _user_can_review_request() in
  // views.py, which the backend already enforces regardless of what the
  // frontend shows. canEditRegion() is the same region-authority check
  // already used elsewhere in the app (EDIT_ANY_REGION for central admin,
  // EDIT_OWN_REGION matched against the target region for a regional
  // boss), reused here rather than re-derived, so this can never drift
  // from the backend's own rule. The SOURCE region (and any unrelated
  // region) can still see this request in the list/detail pane - they
  // just get a status note here instead of action buttons they could
  // never actually use.
  if (request.request_type === 'region_transfer' && !canEditRegion(request.target_region)) {
    return (
      <div className="action-panel">
        <span className="ap-label">{T.actionsLabel}</span>
        <div className="scope-region-note">
          <MapPin size={13}/> {T.pendingDestinationReviewNote}
        </div>
      </div>
    );
  }

  return (
    <div className="action-panel">
      <span className="ap-label">{T.actionsLabel}</span>
      {showReject ? (
        <div className="reject-form">
          <textarea rows={2} value={rejectText} onChange={e=>setRejectText(e.target.value)} placeholder={T.rejectPlaceholder}/>
          <div className="rf-row">
            <button className="btn-ghost-sm" onClick={()=>setShowReject(false)}>{T.cancel}</button>
            <button className="btn-rej-sm" onClick={()=>onReject(request.id,rejectText)} disabled={acting}>
              {acting?<Spinner size={12}/>:<XCircle size={12}/>} {T.rejectBtn}
            </button>
          </div>
        </div>
      ) : isRem ? (
        <div className="act-row">
          <button className="btn-approve-danger" onClick={()=>onApprove(request.id)} disabled={acting}>
            {acting?<Spinner size={12}/>:<UserMinus size={12}/>} {T.approveRemoveBtn}
          </button>
          <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> {T.rejectBtn}</button>
        </div>
      ) : isSwap ? (
        <div className="act-row">
          <button className="btn-approve" onClick={()=>onApprove(request.id)} disabled={acting}>
            {acting?<Spinner size={12}/>:<RefreshCw size={12}/>} {T.approveSwapBtn}
          </button>
          <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> {T.rejectBtn}</button>
        </div>
      ) : isAdd ? (
        <>
          {bedsError && <div className="feas-no"><AlertTriangle size={13}/>{bedsError}</div>}
          <BedMatchPicker
            buildings={rawBedOptions?.buildings||[]}
            totalBuildings={rawBedOptions?.total_buildings}
            totalApartments={rawBedOptions?.total_apartments}
            totalRooms={rawBedOptions?.total_rooms}
            totalValidBeds={rawBedOptions?.total_valid_beds}
            counts={rawBedOptions?.counts}
            dataIntegrity={rawBedOptions?.data_integrity}
            conflictExamples={rawBedOptions?.conflict_examples}
            loading={loadingBeds}
            loadingMore={loadingMoreBeds}
            hasMore={!!rawBedOptions?.has_more}
            onLoadMore={onLoadMoreBedOptions}
            loadMoreError={loadMoreBedsError}
            selectedBedId={roomId?.bed_id}
            onSelectBed={(bed)=>onSetRoom(bed)}
            language={language}
          />
          {roomId && (
            <div className="assign-confirm-note">
              <CheckCircle size={13}/>
              {T.assignNotePrefix} {T.loc3(roomId.building, roomId.apartment, roomId.room)}
              {roomId.single_bed_room ? ` · ${T.singlePlace}` : ` · ${T.bedWord} ${roomId.bed_display || roomId.bed_label}`}
            </div>
          )}
          <div className="act-row" style={{marginTop:8}}>
            <button className="btn-approve" onClick={()=>onApprove(request.id,roomId?.room_id,roomId?.bed_id)} disabled={acting||!roomId||!roomId.bed_id}>
              {acting?<Spinner size={12}/>:<Check size={12}/>} {roomId ? assignActionLabel(roomId, language) : T.selectBedToApprove}
            </button>
            <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> {T.rejectBtn}</button>
          </div>
        </>
      ) : !hasFeas ? (
        <div className="act-row">
          <button className="btn-check" onClick={()=>onCheckFeas(request.id)} disabled={checkingFeas}>
            {checkingFeas?<><Spinner size={12}/> {T.checkingEllipsis}</>:<><Activity size={12}/> {T.checkAvailabilityBtn}</>}
          </button>
          <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> {T.rejectBtn}</button>
        </div>
      ) : (
        <>
          {(feasData.search_regions||[]).length>0 && (
            <div className="scope-region-note">
              <MapPin size={13}/>
              {request.transfer_scope==='cross_region'
                ? <>
                    {request.source_region_name
                      ? <>{T.crossRegionFromPrefix}<strong>{request.source_region_name}</strong>{T.crossRegionFromSuffix}</>
                      : T.targetRegionColon}
                    <strong>{feasData.search_regions.map(r=>r.name).join(', ')}</strong>
                    <span className="scope-region-hint">{T.crossRegionHint}</span>
                  </>
                : <>{T.targetRegionColon}<strong>{feasData.search_regions.map(r=>r.name).join(', ')}</strong></>}
            </div>
          )}
          <BedMatchPicker
            buildings={feasData.buildings||[]}
            totalBuildings={feasData.total_buildings}
            totalApartments={feasData.total_apartments}
            totalRooms={feasData.total_rooms}
            totalValidBeds={feasData.total_valid_beds}
            counts={feasData.counts}
            dataIntegrity={feasData.data_integrity}
            conflictExamples={feasData.conflict_examples}
            loading={checkingFeas}
            loadingMore={loadingMoreFeas}
            hasMore={!!feasData.has_more}
            onLoadMore={onLoadMoreFeas}
            loadMoreError={loadMoreFeasError}
            selectedBedId={selFeasOpt?.bed_id}
            onSelectBed={onSelFeasOpt}
            language={language}
            scopeContext={
              request.transfer_scope==='cross_region' ? 'cross_region'
              : request.same_apartment===true ? 'same_apartment'
              : 'same_region'
            }
          />
          {selFeasOpt && (
            <div className="assign-confirm-note">
              <CheckCircle size={13}/>
              {T.assignNotePrefix} {T.loc3(selFeasOpt.building, selFeasOpt.apartment, selFeasOpt.room)}
              {selFeasOpt.single_bed_room ? ` · ${T.singlePlace}` : ` · ${T.bedWord} ${selFeasOpt.bed_display || selFeasOpt.bed_label}`}
              {selFeasOpt.region_name ? ` (${selFeasOpt.region_name})` : ''}
            </div>
          )}
          <div className="act-row">
            {feasData.feasible===true && (
              <button className="btn-approve" disabled={acting||!selFeasOpt||!selFeasOpt.bed_id}
                onClick={()=>onApprove(request.id,selFeasOpt?.room_id,selFeasOpt?.bed_id)}>
                {acting?<Spinner size={12}/>:<Check size={12}/>} {selFeasOpt ? assignActionLabel(selFeasOpt, language) : T.selectBedToApprove}
              </button>
            )}
            <button className="btn-recheck" onClick={()=>onCheckFeas(request.id)} disabled={checkingFeas}><RefreshCw size={12}/> {T.recheckBtn}</button>
            <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> {T.rejectBtn}</button>
          </div>
        </>
      )}
    </div>
  );
};

// ── Detail Pane ───────────────────────────────────────────────
const DetailPane = ({
  request,
  onApprove,
  onReject,
  onDelete,
  acting,
  deleting,
  language,
  T,
                      feasData, checkingFeas, onCheckFeas, onLoadMoreFeas, loadingMoreFeas, loadMoreFeasError,
  rawBedOptions, loadingBeds, bedsError, onLoadMoreBedOptions, loadingMoreBeds, loadMoreBedsError,
  roomId, onSetRoom,
  selFeasOpt, onSelFeasOpt }) => {

  const [histOpen, setHistOpen] = useState(false);
  const typeCfg   = typeCfgFor(request);
  const statusCfg = STATUS_CFG[request.status]        || STATUS_CFG.pending;
  const TypeIcon  = typeCfg.Icon;
  const StatIcon  = statusCfg.Icon;

  const tl = [
    { label:T.tlCreated,             sub:`${fmtDate(request.created_at)} · ${request.requested_by_name||T.dash}`, done:true },
    { label:T.tlPendingApproval,      sub:'',  done:request.status!=='pending', active:request.status==='pending' },
    { label:request.status==='approved'?(language==='he'?STATUS_CFG.approved.labelHe:STATUS_CFG.approved.labelEn)
      :request.status==='rejected'?(language==='he'?STATUS_CFG.rejected.labelHe:STATUS_CFG.rejected.labelEn):T.tlApprovalFallback,
      sub:request.reviewed_at?`${fmtDate(request.reviewed_at)} · ${request.reviewed_by_name||''}` : '',
      done:request.status==='approved'||request.status==='rejected' },
  ];

  return (
    <div className="dp-root">
      {/* Header */}
      <div className="dp-hdr">
        <div className="dp-id-row">
          <span className="dp-req-id"><Hash size={11}/>{fmtReqId(request)}</span>
          <Pill color={statusCfg.color}><StatIcon size={10}/> {language==='he'?statusCfg.labelHe:statusCfg.labelEn}</Pill>
        </div>
        <div className="dp-stu-row">
          <div className={`dp-ava dp-ava-${typeCfg.color}`}>{(request.student_name||'?')[0]}</div>
          <div>
            <h2 className="dp-stu-name">{request.student_name}</h2>
            <div className="dp-stu-meta">
              <span className="mono">{request.student_id_number}</span>
              {request.student_phone && <span>· {request.student_phone}</span>}
            </div>
          </div>
<div className={`dp-type-tag dp-type-${typeCfg.color}`}>
  <TypeIcon size={12}/>
  <span className="dp-type-label">{T.dpTypeLabel}</span>
  <span>{language === 'he' ? typeCfg.labelHe : typeCfg.labelEn}</span>
</div>
        </div>
      </div>

      {/* Body */}
      <div className="dp-body">
      {/* Timeline */}
        <section>
          <div className="sec-title">{T.sectionRequestRoute}</div>
          <Timeline events={tl}/>
        </section>

        {/* Current placement */}
        {request.current_building && (
          <section>
            <div className="sec-title">{T.sectionCurrentPlacement}</div>
            <div className="assign-rows">
              {request.current_region && (
                <div className="assign-row"><MapPin size={18}/><span className="assign-row-label">{T.fieldRegion}</span><span className="assign-row-val">{request.current_region}</span></div>
              )}
              <div className="assign-row"><Building2 size={18}/><span className="assign-row-label">{T.fieldBuilding}</span><span className="assign-row-val">{request.current_building}</span></div>
              <div className="assign-row"><DoorOpen  size={18}/><span className="assign-row-label">{T.fieldApartment}</span><span className="assign-row-val">{request.current_apartment}</span></div>
              <div className="assign-row"><Home      size={18}/><span className="assign-row-label">{T.fieldRoom}</span><span className="assign-row-val">{request.current_room}</span></div>
              {request.current_bed && (
                <div className="assign-row"><BedDouble size={18}/><span className="assign-row-label">{T.fieldBed}</span><span className="assign-row-val">{request.current_bed}</span></div>
              )}
            </div>
          </section>
        )}

        {/* Details */}
        <section>
          <div className="sec-title">{T.sectionRequestDetails}</div>
          {(request.request_type==='room'||request.request_type==='apartment') && (
            <div className="kv"><span>{T.kvTransferType}</span><strong>{
              request.transfer_scope==='cross_region' ? T.transferTypeCrossRegion
              : request.same_apartment===true ? T.transferTypeSameApartment
              : request.same_apartment===false ? T.transferTypeSameRegionDiffApt
              : (request.transfer_scope_display || T.transferTypeFallback)
            }</strong></div>
          )}
          {request.transfer_scope && request.source_region_name && (
            <div className="kv"><span>{T.kvSourceRegion}</span><strong>{request.source_region_name}</strong></div>
          )}
          {request.transfer_scope==='cross_region' && (request.destination_region_names||[]).length>0 && (
            <div className="kv"><span>{T.kvTargetRegion}</span><strong>{request.destination_region_names.join(', ')}</strong></div>
          )}
          {request.status==='approved' && request.target_room_name && (
            <div className="kv"><span>{T.kvFinalPlacement}</span><strong>
              {T.loc3(request.target_building_number, request.target_apartment_number, request.target_room_name)}
              {request.final_bed_label ? ` · ${T.bedWord} ${String(request.final_bed_label).replace(/^bed\s*/i,'')}` : ''}
            </strong></div>
          )}
          {request.request_type==='swap' && request.swap_with_student_name && (
            <div className="kv"><span>{T.kvSwapWith}</span><strong>{request.swap_with_student_name} ({request.swap_with_student_id_number})</strong></div>
          )}
          {request.reason && <div className="kv"><span>{T.kvReason}</span><strong className="kv-reason">{request.reason}</strong></div>}
          {request.other_description && <div className="kv"><span>{T.kvDescription}</span><strong>{request.other_description}</strong></div>}
          <div className="kv"><span>{T.kvOpenedBy}</span><strong>{request.requested_by_name||T.dash}</strong></div>
          <div className="kv"><span>{T.kvDate}</span><strong>{fmtDate(request.created_at)}</strong></div>
          {request.reviewed_by_name && <div className="kv"><span>{T.kvHandledBy}</span><strong>{request.reviewed_by_name}</strong></div>}
        </section>

        {/* History */}
        {Array.isArray(request.placement_history)&&request.placement_history.length>0&&(
          <section>
            <button className="hist-toggle" onClick={()=>setHistOpen(h=>!h)}>
              <Activity size={12}/> {T.historyToggle(request.placement_history.length)} {histOpen?<ChevronUp size={12}/>:<ChevronDown size={12}/>}
            </button>
            {histOpen && (
              <div className="hist-list">
                {request.placement_history.map((p,i)=>(
                  <div key={i} className="hist-item">
                    <div className="hi-loc">{p.region&&<span className="hi-reg">{p.region}</span>}<span>{T.loc3(p.building, p.apartment, p.room)}</span></div>
                    <span className="hi-date">{fmtDate(p.assigned_at)}{p.ended_at?` → ${fmtDate(p.ended_at)}`:''}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Rejection */}
        {request.status==='rejected'&&request.rejection_reason&&(
          <div className="rej-banner"><AlertTriangle size={13}/><strong>{T.rejectionReasonLabel}</strong> {request.rejection_reason}</div>
        )}

        {/* Actions */}
        <ActionPanel
          request={request} onApprove={onApprove} onReject={onReject} acting={acting}
          feasData={feasData} checkingFeas={checkingFeas} onCheckFeas={onCheckFeas}
          onLoadMoreFeas={onLoadMoreFeas} loadingMoreFeas={loadingMoreFeas} loadMoreFeasError={loadMoreFeasError}
          rawBedOptions={rawBedOptions} loadingBeds={loadingBeds} bedsError={bedsError}
          onLoadMoreBedOptions={onLoadMoreBedOptions} loadingMoreBeds={loadingMoreBeds} loadMoreBedsError={loadMoreBedsError}
          roomId={roomId} onSetRoom={onSetRoom}
          selFeasOpt={selFeasOpt} onSelFeasOpt={onSelFeasOpt}
          T={T} language={language}
        />


        {['pending', 'rejected', 'cancelled'].includes(request.status) && (
  <div className="delete-request-section">
    <button
      type="button"
      className="btn-delete-request"
      onClick={() => onDelete(request)}
      disabled={deleting}
    >
      {deleting
        ? <Spinner size={12}/>
        : <Trash2 size={13}/>
      }

      {T.deleteRequestBtn}
    </button>
  </div>
)}
      </div>
    </div>
  );
};

// ── List Item ─────────────────────────────────────────────────
const ListItem = ({ request, selected, onClick, language }) => {
  const tc = typeCfgFor(request);
  const sc = STATUS_CFG[request.status]||STATUS_CFG.pending;
  const TI = tc.Icon, SI = sc.Icon;
  return (
    <button className={`rq-item rq-item-${tc.color}${selected?' rq-sel':''}`} onClick={onClick}>
      <div className="ri-top">
        <span className="ri-id"><Hash size={9}/>{fmtReqId(request)}</span>
        <SI size={12} className={`si-${sc.color}`}/>
      </div>
      <div className="ri-stu">
        <div className={`ri-ava ri-ava-${tc.color}`}>{(request.student_name||'?')[0]}</div>
        <div className="ri-inf">
          <span className="ri-name">{request.student_name||'—'}</span>
          <span className="ri-meta mono">{request.student_id_number}</span>
        </div>
      </div>
      <div className="ri-bot">
        <span className={`ri-type ri-type-${tc.color}`}><TI size={9}/> {language==='he'?tc.labelHe:tc.labelEn}</span>
        {request.current_region && <span className="ri-region">{request.current_region}</span>}
        <span className="ri-date">{fmtDateShort(request.created_at)}</span>
      </div>
    </button>
  );
};

// ── Main Page ─────────────────────────────────────────────────
export default function TransfersPage({ language = 'he' }) {
  const isHe = language === 'he';
  const dir = isHe ? 'rtl' : 'ltr';
  const T = buildT(isHe);
  const { isCentralAdmin } = useAuth();

  const [requests, setRequests]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [pageError, setPageError] = useState('');
  const [selected, setSelected]   = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [tab, setTab]             = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQ, setSearchQ]     = useState('');

  // Region filter - central admins only (§9/§11). Loaded from the real
  // regions API, never hardcoded. Regional users never see this selector
  // and the backend ignores any region param they might send directly.
  const [regions, setRegions] = useState([]);
  const [regionFilter, setRegionFilter] = useState('all');

  useEffect(() => {
    if (isCentralAdmin()) {
      regionsAPI.getAll().then(setRegions).catch(() => setRegions([]));
    }
  }, []); // eslint-disable-line

  const [feasData, setFeasData]   = useState({});
  const [checkingFeas, setCheckingFeas] = useState(null);
  const [loadingMoreFeasId, setLoadingMoreFeasId] = useState(null);
  const [actionId, setActionId]   = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [bedOptions, setBedOpts]  = useState({});
  const [loadingBeds, setLdBeds]  = useState(null);
  const [loadingMoreBedsId, setLoadingMoreBedsId] = useState(null);
  const [bedsError, setBedsErr]   = useState({});
  // Failed "load more buildings" attempts, keyed by request id - existing
  // results always stay visible; the picker shows the error with a retry.
  const [loadMoreFeasErr, setLoadMoreFeasErr] = useState({});
  const [loadMoreBedsErr, setLoadMoreBedsErr] = useState({});
  const [selRoom, setSelRoom]     = useState({});
  const [selFeasOpt, setSelFeasOpt] = useState({});
  const feasAbortRef = useRef(null);
  const bedsAbortRef = useRef(null);

  // ── Draggable splitter ──
  const [listWidth, setListWidth] = useState(430);
  const dragging = useRef(false);
  const dragStart = useRef(0);
  const widthStart = useRef(0);

  const onSplitterMouseDown = (e) => {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = e.clientX;
    widthStart.current = listWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const delta = dragStart.current - e.clientX; // RTL: drag left = wider list
      const newW = Math.min(640, Math.max(220, widthStart.current + delta));
      setListWidth(newW);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []); // eslint-disable-line

useEffect(() => {
  loadRequests();
}, [regionFilter]); // eslint-disable-line
  const loadRequests = async () => {
  setLoading(true);
  setPageError('');

  try {
    const params = {};

    // מנהל מרכזי עדיין יכול לסנן לפי אזור
    if (isCentralAdmin() && regionFilter !== 'all') {
      params.region = regionFilter;
    }

    // תמיד מביאים את כל הסטטוסים.
    // הסינון לפי הכל / ממתינות / אושרו / נדחו נעשה ב-Frontend.
    const d = await requestsAPI.getAll(params);

    const list = Array.isArray(d)
      ? d
      : (d.results || []);

    setRequests(list);

    if (selected) {
      const upd = list.find(r => r.id === selected.id);

      if (upd) {
        setSelected(upd);
      }
    }

  } catch (err) {
    setPageError(err.message || T.errLoad);
  } finally {
    setLoading(false);
  }
};

  const counts = useMemo(() => ({
    all:           requests.length,
    pending:       requests.filter(r => r.status === 'pending').length,
    approved:      requests.filter(r => r.status === 'approved').length,
    rejected:      requests.filter(r => r.status === 'rejected').length,
    add_student:   requests.filter(r => r.request_type === 'add_student').length,
    remove_student:requests.filter(r => r.request_type === 'remove_student').length,
    transfers:     requests.filter(r => ['room','apartment'].includes(r.request_type)).length,
  }), [requests]);

  const visible = useMemo(() => {
    let list = requests.filter(r => tab === 'all' || r.status === tab);
    if (typeFilter !== 'all') list = list.filter(r => r.request_type === typeFilter);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(r =>
        (r.student_name || '').toLowerCase().includes(q) ||
        (r.student_id_number || '').includes(q) ||
        fmtReqId(r).toLowerCase().includes(q)
      );
    }
    return list;
  }, [requests, tab, typeFilter, searchQ]);

  const handleSelect = async (req) => {
    setSelected(req);
    if (req.request_type === 'add_student' && !bedOptions[req.id]) {
      if (bedsAbortRef.current) bedsAbortRef.current.abort();
      const controller = new AbortController();
      bedsAbortRef.current = controller;
      setLdBeds(req.id);
      try {
        const d = await requestsAPI.getAddStudentBeds(req.id, { signal: controller.signal });
        setBedOpts(p => ({ ...p, [req.id]: d }));
      } catch (err) {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        setBedsErr(p => ({ ...p, [req.id]: err.message }));
      }
      finally { if (bedsAbortRef.current === controller) setLdBeds(null); }
    }
  };

  const loadMoreBedOptions = async (id) => {
    const current = bedOptions[id];
    if (!current || loadingMoreBedsId) return;
    setLoadingMoreBedsId(id);
    setLoadMoreBedsErr(p => ({ ...p, [id]: '' }));
    try {
      // Pagination unit is the BUILDING: the next page starts after the
      // buildings already loaded, and is APPENDED - never replaces them.
      const d = await requestsAPI.getAddStudentBeds(id, { offset: (current.buildings || []).length });
      setBedOpts(p => ({ ...p, [id]: { ...d, buildings: mergeBuildings(p[id]?.buildings, d.buildings) } }));
    } catch (err) {
      setLoadMoreBedsErr(p => ({ ...p, [id]: err.message || T.errGeneric }));
    } finally { setLoadingMoreBedsId(null); }
  };

  const checkFeasibility = async (id) => {
    if (feasAbortRef.current) feasAbortRef.current.abort();
    const controller = new AbortController();
    feasAbortRef.current = controller;
    setCheckingFeas(id);
    // Clear any stale results for this request immediately - "שוב" (recheck)
    // must never leave a previous filter's results mixed with the new ones.
    setFeasData(p => ({ ...p, [id]: null }));
    try {
      const d = await requestsAPI.checkFeasibility(id, { signal: controller.signal });
      setFeasData(p => ({ ...p, [id]: d }));
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      setFeasData(p => ({ ...p, [id]: { feasible:false, reason:err.message, options:[] } }));
    }
    finally { if (feasAbortRef.current === controller) setCheckingFeas(null); }
  };

  const loadMoreFeasibility = async (id) => {
    const current = feasData[id];
    if (!current || loadingMoreFeasId) return;
    setLoadingMoreFeasId(id);
    setLoadMoreFeasErr(p => ({ ...p, [id]: '' }));
    try {
      const d = await requestsAPI.checkFeasibility(id, { offset: (current.buildings || []).length });
      setFeasData(p => ({ ...p, [id]: { ...d, buildings: mergeBuildings(p[id]?.buildings, d.buildings) } }));
    } catch (err) {
      setLoadMoreFeasErr(p => ({ ...p, [id]: err.message || T.errGeneric }));
    } finally { setLoadingMoreFeasId(null); }
  };

  const doApprove = async (id, roomId, bedId) => {
    setActionId(id);
    const payload = {};
    if (roomId) payload.target_room = roomId;
    if (bedId) payload.bed_id = bedId;
    try { await requestsAPI.approve(id, payload); await loadRequests(); }
    catch (err) { alert(err.message || T.errGeneric); }
    finally { setActionId(null); }
  };

  const doReject = async (id, reason) => {
    setActionId(id);
    try { await requestsAPI.reject(id, reason); await loadRequests(); }
    catch (err) { alert(err.message || T.errGeneric); }
    finally { setActionId(null); }
  };
  const doDelete = async (request) => {
  if (!request?.id) return;

  const confirmed = window.confirm(
    T.deleteRequestConfirmText(request.student_name || T.dash)
  );

  if (!confirmed) return;

  setDeletingId(request.id);

  try {
    await requestsAPI.delete(request.id);

    setRequests(prev =>
      prev.filter(r => r.id !== request.id)
    );

    if (selected?.id === request.id) {
      setSelected(null);
    }
  } catch (err) {
    alert(err.message || T.deleteRequestError);
  } finally {
    setDeletingId(null);
  }
};

  const statCards = [
    { key:'all',           label:T.statTotal,    Icon:Inbox,       color:'slate' },
    { key:'pending',       label:T.statPending, Icon:Clock,       color:'amber' },
    { key:'approved',      label:T.statApproved,   Icon:CheckCircle, color:'green' },
    { key:'rejected',      label:T.statRejected,    Icon:XCircle,     color:'rose'  },
  ];

  const typeFilters = [
  { v:'all',            l:T.typeFilterAll },
  { v:'add_student',    l:T.typeFilterAddStudent    },
  { v:'remove_student', l:T.typeFilterRemoveStudent    },
  { v:'room',           l:T.typeFilterRoom       },
  { v:'apartment',      l:T.typeFilterApartment},
  { v:'swap',           l:T.typeFilterSwap  },
  { v:'other',          l:T.typeFilterOther       },
];

  return (
    <div className="tp-root" dir={dir}>

      {/* Top bar */}
      <div className="tp-top">
        <div className="tp-title-row">
          <div>
            <h1>{T.pageTitle}</h1>
            <span className="tp-sub">{T.pageSubtitle}</span>
          </div>
        </div>
        <div className="tp-top-actions">
          <button className="btn-refresh" onClick={loadRequests} disabled={loading} title={T.refresh}>
            <RefreshCw size={13} className={loading ? 'spin' : ''}/>
          </button>
          <button className="btn-new" onClick={() => setShowModal(true)}>
            <Plus size={14}/> {T.newRequest}
          </button>
        </div>
      </div>

      {/* Stats — full width */}
      <div className="stats-row">
        {statCards.map(sc => (
            <StatCard key={sc.key}
                      label={sc.label} value={counts[sc.key] ?? 0}
            icon={sc.Icon} color={sc.color}
            active={tab === sc.key || (sc.key === 'all' && tab === 'all' && typeFilter === 'all')}
            onClick={() => {
  setTab(sc.key);
  setTypeFilter('all');
    setSelected(null);

}}
          />
        ))}
      </div>

      {pageError && <div className="page-err"><AlertTriangle size={13}/> {pageError}</div>}

      {/* Two-pane */}
      <div className="tp-body" style={{ gridTemplateColumns: `${listWidth}px 6px 1fr` }}>

        {/* List pane */}
        <div className="list-pane">
          <div className="list-toolbar">
            <div className="lt-search">
              <Search size={12}/>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder={T.searchPlaceholder}/>
              {searchQ && <button onClick={()=>setSearchQ('')}><X size={10}/></button>}
            </div>
            <div className="status-tabs">
              {[{v:'all',l:T.tabAll},{v:'pending',l:T.tabPending},{v:'approved',l:T.tabApproved},{v:'rejected',l:T.tabRejected}].map(tb=> (
                  <button
                      key={tb.v}
                      className={`stab${tab === tb.v ? ' stab-active' : ''}`}
                      onClick={() => {
                        setTab(tb.v);
                        setSelected(null);
                      }}
                  >
                    {tb.l}
                  </button>
              ))}
            </div>
            <div className="filter-row">
              <span className="filter-label">{T.requestTypeLabel}</span>

              <select
                  className="type-select"
                  value={typeFilter}
onChange={(e) => {
  setTypeFilter(e.target.value);
  setSelected(null);
}}              >
                {typeFilters.map(tf => (
                    <option key={tf.v} value={tf.v}>
                      {tf.l}
                    </option>
                ))}
              </select>
            </div>
            {isCentralAdmin() && (
  <div className="filter-row">
    <span className="filter-label">{T.regionLabel}</span>

    <select
      className="region-select"
      value={regionFilter}
      onChange={(e) => setRegionFilter(e.target.value)}
      title={T.regionFilterTitle}
    >
      <option value="all">{T.allRegions}</option>
      {regions.map(r => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  </div>
)}
            <div className="lt-count">{T.requestsCount(visible.length)}</div>
          </div>

          <div className="rq-list">
            {loading && !requests.length && <div className="list-loading"><Spinner/> {T.loadingRequests}</div>}
            {!loading && visible.length === 0 && (
  requests.length === 0
    ? (
      <EmptyPane
        icon={Inbox}
        title={T.emptyNoRequestsTitle}
        sub={T.emptyNoRequestsSub}
      />
    )
    : (
      <EmptyPane
        icon={Search}
        title={T.emptyNoResultsTitle}
        sub={T.emptyNoResultsSub}
      />
    )
)}
            {visible.map(r => (
              <ListItem key={r.id} request={r} selected={selected?.id===r.id}
                onClick={()=>handleSelect(r)} language={language}/>
            ))}
          </div>
        </div>

        {/* Splitter */}
        <div className="splitter" onMouseDown={onSplitterMouseDown}>
          <div className="splitter-handle"/>
        </div>

        {/* Detail pane */}
        <div className="detail-outer">
          {!selected
            ? (
                  <div className="empty-detail-state">
                    <div className="eds-inner">

                      <div className="eds-icon">
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                          <rect width="48" height="48" rx="14" fill="var(--blue-bg)"/>
                          <rect x="12" y="14" width="24" height="3" rx="1.5" fill="var(--blue)"/>
                          <rect x="12" y="21" width="18" height="3" rx="1.5" fill="var(--blue-bdr)"/>
                          <rect x="12" y="28" width="20" height="3" rx="1.5" fill="var(--blue-bdr)"/>
                          <circle cx="36" cy="34" r="7" fill="var(--blue)" opacity=".12"/>
                          <path
                              d="M33.5 34h5M36 31.5v5"
                              stroke="var(--blue)"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                          />
                        </svg>
                      </div>

                      {requests.length === 0 ? (
                          <>
                            <h3 className="eds-title">{T.emptyDetailNoneTitle}</h3>
                            <p className="eds-sub">
                              {T.emptyDetailNoneSub}
                            </p>
                          </>
                      ) : (
                          <>
                            <h3 className="eds-title">{T.emptyDetailPickTitle}</h3>
                            <p className="eds-sub">
                              {T.emptyDetailPickSub}
                            </p>
                          </>
                      )}

                    </div>
                  </div>
              )
              : <DetailPane
                  request={selected} language={language} T={T}
                  acting={actionId === selected.id}
                  onApprove={doApprove} onReject={doReject}
                    onDelete={doDelete}
  deleting={deletingId === selected.id}
                  feasData={feasData[selected.id]}
                  checkingFeas={checkingFeas === selected.id}
                  onCheckFeas={checkFeasibility}
                  onLoadMoreFeas={() => loadMoreFeasibility(selected.id)}
                  loadingMoreFeas={loadingMoreFeasId === selected.id}
                  loadMoreFeasError={loadMoreFeasErr[selected.id] || ''}
                  rawBedOptions={bedOptions[selected.id]}
                  loadingBeds={loadingBeds === selected.id}
                  bedsError={bedsError[selected.id]}
                  onLoadMoreBedOptions={() => loadMoreBedOptions(selected.id)}
                  loadingMoreBeds={loadingMoreBedsId === selected.id}
                  loadMoreBedsError={loadMoreBedsErr[selected.id] || ''}
                  roomId={selRoom[selected.id]}
                  onSetRoom={rid => setSelRoom(p => ({...p, [selected.id]: rid}))}
                selFeasOpt={selFeasOpt[selected.id]}
                onSelFeasOpt={opt=>setSelFeasOpt(p=>({...p,[selected.id]:opt}))}
              />
          }
        </div>
      </div>
      {showModal && (
        <NewRequestModal
          regions={regions}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            loadRequests();
          }}
          T={T} language={language}
        />
      )}

      <style>{`
        /* ═══════════════════════════════════════════════
           DORMIFY · TRANSFERS PAGE
           Design target: Linear / GitHub Issues / Jira
           Font: system-ui matching sidebar
           Density: tight but readable, built for large screens
        ═══════════════════════════════════════════════ */

        /* ── Reset & base ─────────────────────────── */
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .tp-root {
          /* ── Palette ── */
          --bg:         #f4f5f7;
          --surf:       #ffffff;
          --surf-2:     #f8f9fb;
          --bdr:        #dfe1e6;
          --bdr-2:      #c1c7d0;
          --bdr-focus:  #4c9aff;

          --t1:  #172b4d;
          --t2:  #253858;
          --t3:  #5e6c84;
          --t4:  #97a0af;

          --blue:       #0052cc;
          --blue-lt:    #0065ff;
          --blue-bg:    #deebff;
          --blue-bdr:   #4c9aff;

          --violet:     #5243aa;
          --violet-bg:  #eae6ff;
          --violet-bdr: #998dd9;

          --teal:       #00875a;
          --teal-bg:    #e3fcef;
          --teal-bdr:   #57d9a3;

          --amber:      #974f0c;
          --amber-bg:   #fff7e6;
          --amber-bdr:  #ffc400;

          --green:      #006644;
          --green-bg:   #e3fcef;
          --green-bdr:  #79f2c0;

          --rose:       #bf2600;
          --rose-bg:    #ffebe6;
          --rose-bdr:   #ff8f73;

          --indigo:     #4338ca;
          --indigo-bg:  #eef2ff;
          --indigo-bdr: #a5b4fc;

          --slate:      #42526e;
          --slate-bg:   #f4f5f7;
          --slate-bdr:  #ebecf0;

          /* ── Radius ── */
          --r3:   3px;
          --r4:   4px;
          --r6:   6px;
          --r8:   8px;
          --r12: 12px;
          --r16: 16px;

          /* ── Shadows ── */
          --sh0: 0 1px 2px rgba(9,30,66,.08);
          --sh1: 0 1px 4px rgba(9,30,66,.12), 0 0 1px rgba(9,30,66,.08);
          --sh2: 0 4px 12px rgba(9,30,66,.12), 0 0 1px rgba(9,30,66,.1);
          --sh3: 0 12px 32px rgba(9,30,66,.15), 0 0 1px rgba(9,30,66,.12);

          /* ── Typography — matches Jira/Linear sidebar ── */
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                       'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: var(--t1);
          background: var(--bg);
          min-height: 100vh;
          direction: ${dir};
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .spin { animation: _sp .75s linear infinite; }
        @keyframes _sp { to { transform: rotate(360deg); } }
        .mono { font-family: 'SF Mono', 'Fira Mono', 'Roboto Mono', Consolas, monospace; }

        /* ── Top bar ───────────────────────────────── */
        .tp-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px 0;
          gap: 12px;
        }
        .tp-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.delete-request-section {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

.btn-delete-request {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  padding: 8px 12px;

  background: transparent;
  border: 1px solid var(--rose-bdr);
  border-radius: var(--r4);

  color: var(--rose);

  font-family: inherit;
  font-size: 13px;
  font-weight: 600;

  cursor: pointer;

  transition:
    background .12s,
    border-color .12s;
}

.btn-delete-request:hover:not(:disabled) {
  background: var(--rose-bg);
  border-color: var(--rose);
}

.btn-delete-request:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.tp-title-row > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
        .tp-title-row h1 {
          font-size: 20px;
          font-weight: 700;
          color: var(--t1);
          letter-spacing: -.3px;
        }
        .tp-sub {
          font-size: 13px;
          color: var(--t3);
          font-weight: 400;
        }
        .tp-top-actions { display: flex; gap: 8px; align-items: center; }

        .btn-refresh {
          width: 32px; height: 32px;
          border: 1px solid var(--bdr);
          background: var(--surf);
          border-radius: var(--r4);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--t3);
          transition: background .12s, border-color .12s;
        }
        .btn-refresh:hover { background: var(--slate-bg); border-color: var(--bdr-2); }
        .btn-refresh:disabled { opacity: .5; cursor: not-allowed; }

        .btn-new {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 7px 14px;
          background: var(--blue); color: #fff;
          border: none; border-radius: var(--r4);
          font-family: inherit; font-size: 14px; font-weight: 600;
          cursor: pointer;
          transition: background .12s;
        }
        .btn-new:hover { background: var(--blue-lt); }

        /* ── Stats row — full page width, equal columns ── */
        .stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(150px, 1fr));
  gap: 10px;
  padding: 14px 20px 0;
}
       .stat-card {
  display: flex;
  align-items: center;
  gap: 12px;

  padding: 12px 16px;

  background: var(--surf);

  border: 1px solid var(--bdr);
  border-radius: var(--r8);

  cursor: pointer;

  transition:
    background .1s,
    border-color .1s,
    box-shadow .1s;

  position: relative;

  box-shadow: var(--sh0);
}

.stat-card:hover {
  background: var(--surf-2);
  border-color: var(--bdr-2);
}
        .stat-card:hover { background: var(--surf-2); }

        .sc-ico {
          width: 32px; height: 32px; flex-shrink: 0;
          border-radius: var(--r6);
          display: flex; align-items: center; justify-content: center;
        }
        .sc-text { flex: 1; min-width: 0; }
        .sc-val {
          display: block;
          font-size: 22px;
          font-weight: 700;
          color: var(--t1);
          line-height: 1.1;
          letter-spacing: -.5px;
        }
        .sc-lbl {
          display: block;
          font-size: 11px;
          font-weight: 500;
          color: var(--t3);
          white-space: nowrap;
          margin-top: 1px;
        }

        .stat-slate  .sc-ico { background: var(--slate-bdr); color: var(--slate); }
        .stat-amber  .sc-ico { background: var(--amber-bg);  color: var(--amber); }
        .stat-green  .sc-ico { background: var(--green-bg);  color: var(--green); }
        .stat-rose   .sc-ico { background: var(--rose-bg);   color: var(--rose);  }
        .stat-blue   .sc-ico { background: var(--blue-bg);   color: var(--blue);  }
        .stat-violet .sc-ico { background: var(--violet-bg); color: var(--violet);}

        .stat-active {
          background: var(--blue-bg) !important;
        }
        .stat-active::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 3px;
          background: var(--blue);
          border-radius: 3px 3px 0 0;
        }
        .stat-active .sc-val { color: var(--blue); }
        .stat-active .sc-lbl { color: var(--blue); opacity: .8; }

        /* ── Two-pane body ─────────────────────────── */
        .tp-body {
          display: grid;
          /* grid-template-columns set inline via style prop for draggable splitter */
          margin: 12px 20px 20px;
          height: calc(100vh - 190px);
          min-height: 460px;
          background: var(--surf);
          border: 1px solid var(--bdr);
          border-radius: var(--r8);
          overflow: hidden;
          box-shadow: var(--sh1);
        }

        /* ── Splitter ───────────────────────────────── */
        .splitter {
          width: 6px;
          background: var(--bdr);
          cursor: col-resize;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background .15s;
          position: relative;
          z-index: 10;
          flex-shrink: 0;
        }
        .splitter:hover, .splitter:active { background: var(--blue-bdr); }
        .splitter-handle {
          width: 2px;
          height: 32px;
          background: var(--bdr-2);
          border-radius: 2px;
          transition: background .15s;
        }
        .splitter:hover .splitter-handle { background: var(--blue); }

        /* ── List pane ─────────────────────────────── */
        .list-pane {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--surf-2);
          min-width: 0;
        }

        .list-toolbar {
          padding: 10px 12px;
          border-bottom: 1px solid var(--bdr);
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--surf);
          flex-shrink: 0;
        }

        .lt-search {
          display: flex;
          align-items: center;
          gap: 7px;
          background: var(--surf-2);
          border: 1px solid var(--bdr);
          border-radius: var(--r4);
          padding: 7px 10px;
          transition: border-color .12s;
        }
        .lt-search:focus-within { border-color: var(--bdr-focus); }
        .lt-search svg { color: var(--t4); flex-shrink: 0; }
        .lt-search input {
          flex: 1; border: none; background: transparent;
          font-family: inherit; font-size: 14px; outline: none; min-width: 0;
          color: var(--t1);
        }
        .lt-search input::placeholder { color: var(--t4); }
        .lt-search button {
          background: none; border: none; cursor: pointer;
          color: var(--t4); display: flex; align-items: center;
          border-radius: var(--r3); padding: 1px;
        }
        .lt-search button:hover { color: var(--t2); }

        .status-tabs {
          display: flex;
          gap: 1px;
          background: var(--slate-bdr);
          padding: 2px;
          border-radius: var(--r4);
        }
        .stab {
          flex: 1; padding: 5px 6px;
          border: none; background: transparent;
          border-radius: var(--r3);
          font-family: inherit; font-size: 13px; font-weight: 500;
          color: var(--t3); cursor: pointer;
          white-space: nowrap; transition: all .1s;
        }
        .stab:hover { color: var(--t1); }
        .stab-active {
          background: var(--surf) !important;
          color: var(--t1) !important;
          font-weight: 600;
          box-shadow: var(--sh0);
        }

        .filter-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--t3);
}

.type-select,
.region-select {
  width: 100%;

  padding: 7px 9px;

  border: 1px solid var(--bdr);
  border-radius: var(--r4);

  font-family: inherit;
  font-size: 13px;
  font-weight: 500;

  color: var(--t2);
  background: var(--surf);

  cursor: pointer;
  outline: none;
}

.type-select:focus,
.region-select:focus {
  border-color: var(--bdr-focus);
}

        .lt-count { font-size: 12px; font-weight: 400; color: var(--t4); }

        .rq-list {
          flex: 1; overflow-y: auto;
          padding: 4px;
          display: flex; flex-direction: column; gap: 1px;
        }
        .rq-list::-webkit-scrollbar { width: 6px; }
        .rq-list::-webkit-scrollbar-track { background: transparent; }
        .rq-list::-webkit-scrollbar-thumb { background: var(--bdr); border-radius: 3px; }

        .list-loading {
          display: flex; align-items: center; justify-content: center;
          gap: 8px; padding: 40px;
          color: var(--t3); font-size: 14px;
        }

        /* ── List item — GitHub Issues row style ─── */
        .rq-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 10px 12px;
          border: 1px solid transparent;
          border-radius: var(--r6);
          background: transparent;
          cursor: pointer;
          text-align: start;
          font-family: inherit;
          transition: background .1s, border-color .1s;
          position: relative;
        }
        .rq-item:hover { background: var(--surf); border-color: var(--bdr); }
        .rq-sel {
          background: var(--blue-bg) !important;
          border-color: var(--blue-bdr) !important;
        }

        /* Type colour strip on the leading (start) edge - mirrors
           automatically between RTL (right) and LTR (left). */
        .rq-item-violet { border-inline-start: 3px solid var(--violet); }
        .rq-item-teal   { border-inline-start: 3px solid var(--teal);   }
        .rq-item-amber  { border-inline-start: 3px solid var(--amber);  }
        .rq-item-blue   { border-inline-start: 3px solid var(--blue);   }
        .rq-item-rose   { border-inline-start: 3px solid var(--rose);   }
        .rq-item-indigo { border-inline-start: 3px solid var(--indigo); }

        .ri-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .ri-id {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--t4);
          font-family: 'SF Mono', Consolas, monospace;
          letter-spacing: .02em;
          display: inline-flex; align-items: center; gap: 2px;
        }
        .si-amber { color: var(--amber) !important; }
        .si-green { color: var(--green) !important; }
        .si-rose  { color: var(--rose)  !important; }
        .si-indigo  { color: var(--indigo)  !important; }

        .ri-stu {
          display: flex;
          align-items: center;
          gap: 9px;
        }
        .ri-ava {
          width: 30px; height: 30px;
          border-radius: var(--r6);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; color: #fff;
          flex-shrink: 0; letter-spacing: 0;
        }
        .ri-ava-violet { background: var(--violet); }
        .ri-ava-teal   { background: var(--teal);   }
        .ri-ava-amber  { background: #a36a00;        }
        .ri-ava-blue   { background: var(--blue);    }
        .ri-ava-rose   { background: var(--rose);    }
        .ri-ava-indigo   { background: var(--indigo);    }

        .ri-inf { flex: 1; min-width: 0; }
        .ri-name {
          display: block;
          font-size: 16px;
          font-weight: 600;
          color: var(--t1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.25;
        }
        .ri-meta {
          font-size: 13.5px;
          color: var(--t4);
          font-family: 'SF Mono', Consolas, monospace;
          margin-top: 1px;
        }

        .ri-bot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-top: 2px;
        }
        .ri-type {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 13px; font-weight: 600;
          padding: 3px 10px; border-radius: 20px;
        }
        .ri-type-violet { background: var(--violet-bg); color: var(--violet); }
        .ri-type-teal   { background: var(--teal-bg);   color: var(--teal);   }
        .ri-type-amber  { background: var(--amber-bg);  color: var(--amber);  }
        .ri-type-blue   { background: var(--blue-bg);   color: var(--blue);   }
        .ri-type-rose   { background: var(--rose-bg);   color: var(--rose);   }
        .ri-type-indigo   { background: var(--indigo-bg);   color: var(--indigo);   }
        .ri-region { font-size: 12px; color: var(--t3); background: var(--slate-bg); padding: 2px 8px; border-radius: 999px; }
        .ri-date { font-size: 13px; color: var(--t4); }

        /* ── Detail outer ─────────────────────────── */
        .detail-outer {
          overflow-y: auto;
          min-width: 0;
          border-inline-start: 1px solid var(--bdr);
        }
        .detail-outer::-webkit-scrollbar { width: 6px; }
        .detail-outer::-webkit-scrollbar-track { background: transparent; }
        .detail-outer::-webkit-scrollbar-thumb { background: var(--bdr); border-radius: 3px; }

        /* ── Empty detail state — Linear style ───── */
        .empty-detail-state {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surf-2);
        }
        .eds-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          text-align: center;
          padding: 48px 32px;
          max-width: 380px;
        }
        .eds-icon { margin-bottom: 4px; }
        .eds-title {
          font-size: 17px;
          font-weight: 600;
          color: var(--t2);
        }
        .eds-sub {
          font-size: 14px;
          color: var(--t3);
          line-height: 1.55;
          max-width: 280px;
        }
        .eds-hints {
          display: flex;
          gap: 16px;
          margin-top: 8px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .eds-hint {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--t4);
        }
        .eds-key {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--surf);
          border: 1px solid var(--bdr);
          border-bottom-width: 2px;
          border-radius: var(--r4);
          padding: 1px 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--t2);
          font-family: 'SF Mono', Consolas, monospace;
          box-shadow: var(--sh0);
          min-width: 24px;
          text-align: center;
        }

        /* ── Detail pane ────────────────────────────── */
        .dp-root { display: flex; flex-direction: column; height: 100%; }

        .dp-hdr {
          padding: 18px 24px 16px;
          border-bottom: 1px solid var(--bdr);
          background: var(--surf);
          flex-shrink: 0;
        }
        .dp-id-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .dp-req-id {
          font-size: 13px;
          font-weight: 700;
          color: var(--t3);
          font-family: 'SF Mono', Consolas, monospace;
          letter-spacing: .02em;
          display: inline-flex; align-items: center; gap: 4px;
        }
        .dp-stu-row {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .dp-ava {
          width: 44px; height: 44px;
          border-radius: var(--r8);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; font-weight: 700; color: #fff;
          flex-shrink: 0;
        }
        .dp-ava-violet { background: var(--violet); }
        .dp-ava-teal   { background: var(--teal);   }
        .dp-ava-amber  { background: #a36a00;        }
        .dp-ava-blue   { background: var(--blue);    }
        .dp-ava-rose   { background: var(--rose);    }
        .dp-ava-indigo   { background: var(--indigo);    }

        .dp-stu-name {
          font-size: 20px;
          font-weight: 700;
          color: var(--t1);
          letter-spacing: -.2px;
          line-height: 1.2;
        }
        .dp-stu-meta {
          display: flex;
          gap: 8px;
          font-size: 13px;
          color: var(--t3);
          margin-top: 3px;
          font-weight: 400;
        }
        .dp-type-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  margin-inline-start: auto;

  font-size: 13px;
  font-weight: 600;

  background: transparent !important;
  border: none !important;
  padding: 0;

  cursor: default;
  flex-shrink: 0;
}

.dp-type-label {
  color: var(--t3);
  font-weight: 500;
}

.dp-type-violet { color: var(--violet); }
.dp-type-teal   { color: var(--teal); }
.dp-type-amber  { color: var(--amber); }
.dp-type-blue   { color: var(--blue); }
.dp-type-rose   { color: var(--rose); }
.dp-type-indigo { color: var(--indigo); }

        .dp-body {
  padding: 12px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  overflow-y: auto;
}
        .dp-body::-webkit-scrollbar { width: 6px; }
        .dp-body::-webkit-scrollbar-thumb { background: var(--bdr); border-radius: 3px; }

        /* ── Section headers ── */
        .sec-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--t4);
  text-transform: uppercase;
  letter-spacing: .09em;
  margin-bottom: 6px;
}

        /* ── Timeline — larger, clearer ── */
        .tl-wrap { display: flex; align-items: flex-start; }
        .tl-item {
          display: flex; flex-direction: column; align-items: center;
          flex: 1; position: relative;
        }
        .tl-dot {
          width: 24px; height: 24px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid var(--bdr); background: var(--surf);
          z-index: 1; flex-shrink: 0;
        }
        .tl-done  .tl-dot { background: var(--green);  border-color: var(--green); color: #fff; }
        .tl-active .tl-dot { background: var(--blue); border-color: var(--blue);  color: #fff; animation: tl-pulse 1.6s infinite; }
        @keyframes tl-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,82,204,.3); }
          50%       { box-shadow: 0 0 0 6px rgba(0,82,204,.0); }
        }
        .tl-line {
          position: absolute;
          top: 12px;
          inset-inline-start: calc(50% + 12px);
          width: calc(100% - 24px);
          height: 2px;
          background: var(--bdr);
        }
        .tl-done .tl-line { background: var(--green); }
        .tl-body { text-align: center; margin-top: 7px; }
        .tl-lbl {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--t2);
        }
        .tl-sub {
          display: block;
          font-size: 11px;
          color: var(--t4);
          margin-top: 2px;
          line-height: 1.4;
        }

        /* ── Current assignment — readable rows ── */
        .assign-rows {
          border: 1px solid var(--bdr);
          border-radius: var(--r6);
          overflow: hidden;
        }
        .assign-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--bdr);
          background: var(--surf);
        }
        .assign-row:last-child { border-bottom: none; }
        .assign-row svg { color: var(--t3); flex-shrink: 0; }
        .assign-row-label {
          font-size: 13px;
          color: var(--t3);
          font-weight: 500;
          min-width: 48px;
          flex-shrink: 0;
        }
        .assign-row-val {
          font-size: 15px;
          font-weight: 600;
          color: var(--t1);
        }

        /* ── KV rows ── */
        .kv {
          display: flex; align-items: baseline; gap: 12px;
          padding: 10px 0; border-bottom: 1px solid var(--bdr);
        }
        .kv:last-child { border-bottom: none; }
        .kv span {
          font-size: 14px; color: var(--t3); font-weight: 500;
          min-width: 92px; flex-shrink: 0;
        }
        .kv strong {
          font-size: 15.5px; color: var(--t1); font-weight: 600;
          line-height: 1.55;
        }
        .kv-reason { white-space: pre-wrap; }

        /* Kept for fallback */
        .place-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .pchip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 5px 10px;
          background: var(--surf-2); border: 1px solid var(--bdr);
          border-radius: 20px; font-size: 13px; font-weight: 500; color: var(--t2);
        }

        /* ── History ── */
        .hist-toggle {
          background: none; border: none; cursor: pointer;
          font-family: inherit; font-size: 13px; font-weight: 600;
          color: var(--blue);
          display: inline-flex; align-items: center; gap: 5px; padding: 0;
        }
        .hist-list {
          background: var(--surf-2);
          border: 1px solid var(--bdr);
          border-radius: var(--r6);
          padding: 8px 12px;
          display: flex; flex-direction: column; gap: 6px; margin-top: 8px;
        }
        .hist-item {
          display: flex; justify-content: space-between; align-items: center;
          gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--bdr);
        }
        .hist-item:last-child { border-bottom: none; }
        .hi-loc { display: flex; align-items: center; gap: 6px; color: var(--t2); font-size: 13px; }
        .hi-reg {
          background: var(--amber-bg); color: var(--amber);
          padding: 1px 6px; border-radius: var(--r3);
          font-size: 11px; font-weight: 700;
        }
        .hi-date { font-size: 11px; color: var(--t4); white-space: nowrap; }

        /* ── Rejection banner ── */
        .rej-banner {
          display: flex; align-items: center; gap: 9px;
          background: var(--rose-bg); border: 1px solid var(--rose-bdr);
          border-radius: var(--r6); padding: 11px 14px;
          font-size: 14px; color: var(--rose); font-weight: 500;
        }

        /* ── Action panel ── */
        .action-panel {
          background: var(--surf-2);
          border: 1px solid var(--bdr);
          border-radius: var(--r8);
          padding: 14px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .ap-label {
          font-size: 11px; font-weight: 700; color: var(--t4);
          text-transform: uppercase; letter-spacing: .08em;
        }
        .act-row { display: flex; gap: 8px; flex-wrap: wrap; }

        /* ── Buttons ── */
        .btn-check {
          flex: 2;
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 10px 16px;
          background: var(--blue); color: #fff;
          border: none; border-radius: var(--r4);
          font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
          transition: background .12s;
        }
        .btn-check:hover { background: var(--blue-lt); }
        .btn-check:disabled { opacity: .55; cursor: not-allowed; }

        .btn-approve {
          flex: 1;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 9px 14px;
          background: var(--green); color: #fff;
          border: none; border-radius: var(--r4);
          font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
          transition: filter .12s;
        }
        .btn-approve:hover { filter: brightness(1.1); }
        .btn-approve:disabled { opacity: .5; cursor: not-allowed; }

        .btn-approve-danger {
          flex: 1;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 9px 14px;
          background: var(--rose); color: #fff;
          border: none; border-radius: var(--r4);
          font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
          transition: filter .12s;
        }
        .btn-approve-danger:hover { filter: brightness(1.1); }
        .btn-approve-danger:disabled { opacity: .5; cursor: not-allowed; }

        .btn-rej-outline {
          flex: 1;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 9px 14px;
          background: transparent;
          border: 1.5px solid var(--rose); color: var(--rose);
          border-radius: var(--r4);
          font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
          transition: background .12s;
        }
        .btn-rej-outline:hover { background: var(--rose-bg); }

        .btn-recheck {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 12px;
          background: var(--surf); border: 1px solid var(--bdr); color: var(--t2);
          border-radius: var(--r4);
          font-family: inherit; font-weight: 500; font-size: 13px; cursor: pointer;
          transition: border-color .12s;
        }
        .btn-recheck:hover { border-color: var(--bdr-2); }

        .reject-form { display: flex; flex-direction: column; gap: 8px; }
        .reject-form textarea {
          padding: 9px 11px;
          border: 1px solid var(--bdr); border-radius: var(--r4);
          font-family: inherit; font-size: 14px;
          resize: vertical; outline: none; line-height: 1.5; color: var(--t1);
        }
        .reject-form textarea:focus { border-color: var(--bdr-focus); }
        .rf-row { display: flex; gap: 7px; }
        .btn-ghost-sm {
          flex: 1; padding: 8px;
          border: 1px solid var(--bdr); background: var(--surf);
          border-radius: var(--r4);
          font-family: inherit; font-size: 13px; font-weight: 500;
          color: var(--t3); cursor: pointer;
        }
        .btn-ghost-sm:hover { background: var(--surf-2); }
        .btn-rej-sm {
          flex: 1;
          display: inline-flex; align-items: center; justify-content: center; gap: 4px;
          padding: 8px; background: var(--rose); color: #fff;
          border: none; border-radius: var(--r4);
          font-family: inherit; font-weight: 600; font-size: 13px; cursor: pointer;
        }
        .btn-rej-sm:disabled { opacity: .5; cursor: not-allowed; }

        /* ── Feasibility ── */
        .feas-no {
          display: flex; align-items: center; gap: 8px;
          background: var(--rose-bg); border: 1px solid var(--rose-bdr);
          border-radius: var(--r4);
          padding: 10px 12px;
          font-size: 14px; color: var(--rose); font-weight: 500;
        }
        .checking-state {
          display: flex; align-items: center; gap: 8px;
          font-size: 14px; color: var(--t3); padding: 10px 0;
        }
        .check-feas-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px;
          background: var(--blue-bg); border: 1.5px dashed var(--blue-bdr);
          border-radius: var(--r4);
          font-family: inherit; font-size: 14px; font-weight: 600;
          color: var(--blue); cursor: pointer;
          transition: background .12s;
        }
        .check-feas-btn:hover { background: #c5dbff; }

        /* ── Recommendation cards ── */
        .rec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
        .compact-rec { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
        .rec-card {
          position: relative;
          background: var(--surf); border: 1.5px solid var(--bdr);
          border-radius: var(--r6); padding: 10px;
          text-align: start; font-family: inherit; cursor: pointer;
          transition: border-color .12s, background .12s;
        }
        .rec-card:hover { border-color: var(--green); background: var(--green-bg); }
        .rec-sel {
          border-color: var(--green) !important;
          background: var(--green-bg) !important;
          box-shadow: 0 0 0 3px rgba(0,102,68,.1);
        }
        .match-mismatch { opacity: .5; cursor: not-allowed; border-color: var(--rose-bdr) !important; }
        .rec-star {
          position: absolute; top: -1px; inset-inline-end: 8px;
          background: var(--amber-bg); color: var(--amber);
          border-radius: 0 0 5px 5px; padding: 2px 7px;
          font-size: 10px; font-weight: 700;
          display: inline-flex; align-items: center; gap: 3px;
        }
        .rec-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; margin-top: 6px; }
        .rec-num {
          font-size: 10px; font-weight: 700; color: var(--blue);
          background: var(--blue-bg); padding: 2px 6px; border-radius: var(--r3);
        }
        .rec-score { font-size: 14px; font-weight: 700; color: var(--green); }
        .rec-loc { display: flex; flex-direction: column; gap: 4px; }
        .rec-loc span { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t2); }
        .rec-loc svg { color: var(--t4); flex-shrink: 0; }
        .rec-res { display: flex; align-items: center; gap: 3px; margin-top: 8px; }
        .res-chip {
          width: 20px; height: 20px; background: var(--blue); color: #fff;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700;
        }
        .rec-more { font-size: 10px; color: var(--t4); }
        .rec-chk { margin-top: 8px; display: flex; align-items: center; gap: 4px; color: var(--green); font-size: 12px; font-weight: 700; }

        /* ── Apt two-column ── */
        .apt-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-height: 280px; }
        .apt-list-col, .apt-detail-col { overflow-y: auto; }
        .col-head {
          font-size: 10px; font-weight: 700; color: var(--t4);
          text-transform: uppercase; letter-spacing: .07em; margin-bottom: 6px;
        }
        .apt-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 8px 10px;
          border: 1px solid var(--bdr); background: var(--surf);
          border-radius: var(--r4); font-family: inherit;
          text-align: start; cursor: pointer; margin-bottom: 4px;
          transition: border-color .1s, background .1s;
        }
        .apt-row:hover:not(:disabled) { border-color: var(--green); background: var(--green-bg); }
        .apt-sel { border-color: var(--green) !important; background: var(--green-bg) !important; }
        .apt-row:disabled { opacity: .5; cursor: not-allowed; }
        .apt-row > div { flex: 1; min-width: 0; }
        .apt-row strong { display: block; font-size: 12px; color: var(--t1); }
        .apt-row span   { font-size: 11px; color: var(--t4); }
        .apt-star { color: var(--amber); }
        .free-badge {
          background: var(--green-bg); color: var(--green);
          border-radius: var(--r3); padding: 1px 6px;
          font-size: 10px; font-weight: 700; white-space: nowrap;
        }
        .apt-empty { font-size: 13px; color: var(--t4); text-align: center; padding: 18px 0; }
        .res-row-sm { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; font-size: 13px; }
        .rs-ava {
          width: 22px; height: 22px; background: var(--blue); color: #fff;
          border-radius: var(--r4); display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; flex-shrink: 0;
        }
        .rs-room {
          margin-inline-start: auto; font-size: 10px; color: var(--t4);
          background: var(--blue-bg); padding: 2px 5px; border-radius: var(--r3); font-weight: 600;
        }
        .room-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .room-chip {
          padding: 6px 9px; border: 1px solid var(--bdr); background: var(--surf);
          border-radius: var(--r4); font-family: inherit; cursor: pointer;
          display: flex; flex-direction: column; gap: 1px; transition: border-color .1s;
        }
        .room-chip strong { display: block; font-size: 12px; color: var(--t1); font-weight: 600; }
        .room-chip span   { font-size: 10px; color: var(--t4); }
        .room-chip:hover  { border-color: var(--green); }
        .room-chip-sel    { border-color: var(--green) !important; background: var(--green-bg) !important; }

        /* ── Pills ── */
        .pill {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 20px;
          font-size: 13px; font-weight: 600;
        }
        .pill-sm { padding: 2px 7px; font-size: 12px; }
        .pill-amber { background: var(--amber-bg); color: var(--amber); }
        .pill-green { background: var(--green-bg); color: var(--green); }
        .pill-rose  { background: var(--rose-bg);  color: var(--rose);  }
        .pill-indigo  { background: var(--indigo-bg);  color: var(--indigo);  }
        .pill-gray  { background: var(--slate-bdr); color: var(--slate); }
        .pill-blue  { background: var(--blue-bg);  color: var(--blue);  }

        /* ── Empty list pane ── */
        .empty-pane {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 10px; height: 100%; padding: 40px; text-align: center;
          color: var(--t4);
        }
        .ep-ico {
          width: 48px; height: 48px; border-radius: var(--r8);
          background: var(--slate-bdr);
          display: flex; align-items: center; justify-content: center;
        }
        .empty-pane h4 { font-size: 15px; font-weight: 600; color: var(--t2); }
        .empty-pane p  { font-size: 13px; max-width: 200px; line-height: 1.5; }
        .ep-btn {
          padding: 7px 14px; background: var(--blue); color: #fff;
          border: none; border-radius: var(--r4);
          font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        }

        /* ── Page error ── */
        .page-err {
          display: flex; align-items: center; gap: 8px;
          background: var(--rose-bg); border: 1px solid var(--rose-bdr);
          border-radius: var(--r4); padding: 10px 20px; margin: 10px 20px 0;
          font-size: 13px; color: var(--rose); font-weight: 500;
        }

        /* ── Modal ── */
        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(9,30,66,.55);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999; padding: 20px;
          backdrop-filter: blur(2px);
        }
        .modal-box {
  background: var(--surf);
  border-radius: var(--r12);

  width: min(900px, 92vw);
  max-width: 900px;

  height: min(720px, 88vh);
  max-height: 88vh;

  display: flex;
  flex-direction: column;

  box-shadow: var(--sh3);

  overflow: hidden;
}
        .modal-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px; border-bottom: 1px solid var(--bdr); flex-shrink: 0;
        }
        .mh-left { display: flex; align-items: center; gap: 10px; }
        .modal-head h2 { font-size: 17px; font-weight: 700; color: var(--t1); }
        .back-type {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none; color: var(--blue);
          font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .modal-close {
          width: 30px; height: 30px;
          border: 1px solid var(--bdr); background: var(--surf);
          border-radius: var(--r4);
          display: flex; align-items: center; justify-content: center;
          color: var(--t3); cursor: pointer; transition: background .1s;
        }
        .modal-close:hover { background: var(--surf-2); }

        /* ── Type picker ── */
        .type-picker { display: flex; flex-direction: column; overflow-y: auto; flex: 1; }
        .tp-card {
          display: flex; align-items: center; gap: 14px; padding: 14px 20px;
          border: none; background: transparent; cursor: pointer;
          font-family: inherit; text-align: start;
          border-bottom: 1px solid var(--bdr); transition: background .1s;
        }
        .tp-card:last-child { border-bottom: none; }
        .tp-card:hover { background: var(--surf-2); }
        .tp-ico {
          width: 38px; height: 38px; border-radius: var(--r6);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .tp-ico-blue   { background: var(--blue-bg);   color: var(--blue);   }
        .tp-ico-rose   { background: var(--rose-bg);   color: var(--rose);   }
        .tp-ico-indigo   { background: var(--indigo-bg);   color: var(--indigo);   }
        .tp-ico-violet { background: var(--violet-bg); color: var(--violet); }
        .tp-ico-teal   { background: var(--teal-bg);   color: var(--teal);   }
        .tp-ico-amber  { background: var(--amber-bg);  color: var(--amber);  }
        .tp-info { flex: 1; min-width: 0; }
        .tp-title { display: block; font-size: 15px; font-weight: 600; color: var(--t1); }
        .tp-sub   { display: block; font-size: 13px; color: var(--t3); margin-top: 2px; }
        .tp-arrow { margin-inline-start: auto; color: var(--t4); }

        /* ── Wizard ── */
        .wz-root { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
        .wz-bar {
          display: flex; align-items: center;
          padding: 14px 20px; border-bottom: 1px solid var(--bdr);
          background: var(--surf-2); gap: 0; flex-shrink: 0;
        }
        .wz-node { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
        .wz-circle {
          width: 26px; height: 26px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
          border: 2px solid var(--bdr); background: var(--surf); color: var(--t4);
        }
        .wz-done  .wz-circle { background: var(--green);  border-color: var(--green); color: #fff; }
        .wz-cur-blue   .wz-circle { background: var(--blue);   border-color: var(--blue);   color: #fff; }
        .wz-cur-rose   .wz-circle { background: var(--rose);   border-color: var(--rose);   color: #fff; }
        .wz-cur-indigo   .wz-circle { background: var(--indigo);   border-color: var(--indigo);   color: #fff; }
        .wz-cur-violet .wz-circle { background: var(--violet); border-color: var(--violet); color: #fff; }
        .wz-cur-teal   .wz-circle { background: var(--teal);   border-color: var(--teal);   color: #fff; }
        .wz-cur-amber  .wz-circle { background: var(--amber);  border-color: var(--amber);  color: #fff; }
        .wz-lbl { font-size: 10px; font-weight: 500; color: var(--t4); white-space: nowrap; }
        .wz-cur-blue .wz-lbl, .wz-cur-rose .wz-lbl, .wz-cur-violet .wz-lbl,
        .wz-cur-teal .wz-lbl, .wz-cur-amber .wz-lbl { color: var(--t1); font-weight: 700; }
        .wz-done .wz-lbl { color: var(--green); }
        .wz-conn { flex: 1; height: 2px; background: var(--bdr); margin-bottom: 18px; min-width: 8px; }
        .wz-conn-done { background: var(--green); }

.wz-content {
  flex: 1;
  min-height: 0;

  overflow-y: auto;

  padding: 24px;

  display: flex;
  flex-direction: column;
  gap: 18px;
}        .wz-title { font-size: 17px; font-weight: 700; color: var(--t1); }

        .wz-field { display: flex; flex-direction: column; gap: 5px; }
        .wz-field label { font-size: 13px; font-weight: 600; color: var(--t2); }
        .wz-field input, .wz-field select, .wz-field textarea {
          padding: 9px 11px;
          border: 1px solid var(--bdr); border-radius: var(--r4);
          font-family: inherit; font-size: 14px; outline: none;
          transition: border-color .12s; background: var(--surf); color: var(--t1);
        }
        .wz-field input:focus, .wz-field select:focus, .wz-field textarea:focus {
          border-color: var(--bdr-focus);
        }
        .req { color: var(--rose); margin-inline-start: 2px; }

        .wz-g3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .wz-g2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

        .wz-note {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 12px; border-radius: var(--r4);
          font-size: 13px; font-weight: 500; line-height: 1.45;
        }
        .rose-note { background: var(--rose-bg); border: 1px solid var(--rose-bdr); color: var(--rose); }

        .wz-summary {
          display: flex; flex-direction: column;
          border: 1px solid var(--bdr); border-radius: var(--r6); overflow: hidden;
        }
        .sum-row {
          display: flex; justify-content: space-between; gap: 10px;
          padding: 9px 12px; border-bottom: 1px solid var(--bdr); font-size: 14px;
        }
        .sum-row:last-child { border-bottom: none; }
        .sum-k { color: var(--t3); font-weight: 500; min-width: 72px; flex-shrink: 0; }
        .sum-v { color: var(--t1); font-weight: 500; text-align: end; line-height: 1.5; }

        .wz-err {
          background: var(--rose-bg); border: 1px solid var(--rose-bdr);
          border-radius: var(--r4); padding: 10px 12px;
          font-size: 13px; color: var(--rose); font-weight: 500;
        }

        .wz-footer {
          display: flex; align-items: center; gap: 10px;
          padding: 13px 20px; border-top: 1px solid var(--bdr);
          background: var(--surf-2); flex-shrink: 0;
        }
        .wz-back {
          display: inline-flex; align-items: center; gap: 5px; padding: 8px 14px;
          border: 1px solid var(--bdr); background: var(--surf); border-radius: var(--r4);
          font-family: inherit; font-size: 14px; font-weight: 500; color: var(--t2); cursor: pointer;
          transition: background .1s;
        }
        .wz-back:hover { background: var(--surf-2); }
        .wz-prog { flex: 1; text-align: center; font-size: 12px; font-weight: 500; color: var(--t4); }
        .wz-next {
          display: inline-flex; align-items: center; gap: 7px; padding: 9px 20px;
          border: none; color: #fff; border-radius: var(--r4);
          font-family: inherit; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: filter .12s;
        }
        .wz-next:disabled { opacity: .45; cursor: not-allowed; }
        .wz-next:not(:disabled):hover { filter: brightness(1.1); }
        .wz-blue   { background: var(--blue);   }
        .wz-rose   { background: var(--rose);   }
        .wz-indigo   { background: var(--indigo);   }
        .wz-violet { background: var(--violet); }
        .wz-teal   { background: var(--teal);   }
        .wz-amber  { background: var(--amber);  }

        /* ── Student search: now in src/components/StudentSearch.js ── */

        .picked-bar {
          display: flex; align-items: center; gap: 10px;
          background: var(--blue-bg); border: 1px solid var(--blue-bdr);
          border-radius: var(--r6); padding: 11px 13px;
        }
        .pb-ava {
          width: 36px; height: 36px; background: var(--blue); color: #fff;
          border-radius: var(--r6); display: flex; align-items: center; justify-content: center;
          font-size: 15px; font-weight: 700; flex-shrink: 0;
        }
        .pb-info { flex: 1; min-width: 0; }
        .pb-name { display: block; font-size: 15px; font-weight: 600; color: var(--t1); }
        .pb-id   { font-size: 12px; color: var(--t4); font-family: 'SF Mono', Consolas, monospace; }
        .pb-clear {
          background: var(--surf); border: 1px solid var(--bdr);
          width: 26px; height: 26px; border-radius: var(--r4);
          display: flex; align-items: center; justify-content: center;
          color: var(--t4); cursor: pointer; flex-shrink: 0;
        }

        /* ── Assignment panel in wizard ── */
        .assignment-panel { display: flex; flex-direction: column; gap: 8px; border-radius: var(--r6); padding: 12px 14px; }
        .violet-panel { background: var(--violet-bg); border: 1px solid var(--violet-bdr); }
        .rose-panel   { background: var(--rose-bg);   border: 1px solid var(--rose-bdr);   }
        .ap-row { display: flex; align-items: center; gap: 10px; font-size: 14px; }
        .ap-row svg  { color: var(--t3); flex-shrink: 0; }
        .ap-row span { color: var(--t3); min-width: 40px; font-weight: 500; }
        .ap-row strong { color: var(--t1); font-weight: 600; }

        /* ── Preference buttons ── */
        .pref-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .pref-btn:disabled { opacity: .55; cursor: not-allowed; }

        /* ── Transfer scope / destination-region selection ── */
        .scope-region-note {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
          margin: 12px 0 4px; padding: 10px 12px;
          background: var(--blue-bg); border: 1px solid var(--blue-bdr);
          border-radius: var(--r4); font-size: 14.5px; color: var(--t1);
        }
        .scope-region-note svg { color: var(--blue); flex-shrink: 0; }
        .scope-region-hint { font-size: 13px; color: var(--t3); flex-basis: 100%; }
        .assign-confirm-note {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          margin: 10px 0 2px; padding: 12px 14px;
          background: #f0fdf4; border: 1.5px solid #86efac;
          border-radius: var(--r4); font-size: 14.5px; font-weight: 700; color: #166534;
          line-height: 1.5;
        }
        .assign-confirm-note svg { color: #16a34a; flex-shrink: 0; }
        .region-ms { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
        .region-ms-label { font-size: 13px; font-weight: 600; color: var(--t2); }
        .region-ms-search {
          display: flex; align-items: center; gap: 6px;
          background: var(--surf-2); border: 1px solid var(--bdr);
          border-radius: var(--r4); padding: 7px 10px;
        }
        .region-ms-search input { border: none; background: none; outline: none; width: 100%; font-family: inherit; font-size: 13px; }
        .region-ms-list {
          display: flex; flex-direction: column; gap: 4px;
          max-height: 200px; overflow-y: auto;
          border: 1px solid var(--bdr); border-radius: var(--r4); padding: 6px;
        }
        .region-ms-row {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: var(--r4);
          font-size: 13.5px; color: var(--t1); cursor: pointer;
        }
        .region-ms-row:hover { background: var(--surf-2); }
        .region-ms-on { background: var(--blue-bg); font-weight: 600; }
        .region-ms-row input { accent-color: var(--blue); }
        .region-ms-cur { font-size: 11px; color: var(--t3); }
        .region-ms-empty { padding: 10px; font-size: 12.5px; color: var(--t3); text-align: center; }
        .region-ms-picked { font-size: 12.5px; color: var(--t2); }
        .pref-btn {
          flex: 1; min-width: 72px; padding: 9px 12px;
          border: 1.5px solid var(--bdr); background: var(--surf);
          border-radius: var(--r4);
          font-family: inherit; font-size: 14px; font-weight: 500; color: var(--t2);
          cursor: pointer; transition: all .1s;
        }
        .pref-btn:hover { border-color: var(--bdr-2); background: var(--surf-2); }
        .pref-active {
          background: var(--blue-bg) !important;
          border-color: var(--blue) !important;
          color: var(--blue) !important; font-weight: 600;
        }

        /* ── Responsive ── */
        @media (max-width: 920px) {
          .tp-body { grid-template-columns: 300px 6px 1fr !important; height: auto; }
          .stats-row { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .tp-body { grid-template-columns: 1fr !important; height: auto; }
          .splitter { display: none; }
          .list-pane { max-height: 380px; }
          .stats-row { grid-template-columns: repeat(2, 1fr); }
          .wz-g3 { grid-template-columns: 1fr 1fr; }
          .wz-g2 { grid-template-columns: 1fr; }
          .tp-top, .stats-row { padding-inline: 12px; }
          .tp-body { margin-inline: 10px; }
        }

        /* ── Accessibility ── */
        @media (prefers-contrast: more) {
          .tp-root { --bdr: #7a8394; --t3: #2d3a4d; --t4: #42526e; }
          .rq-item, .stat-card { border-width: 2px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .spin, .tl-active .tl-dot { animation: none; }
          *, *::before, *::after { transition-duration: 0ms !important; }
        }

        /* ── Large monitor optimisation ── */
        @media (min-width: 1600px) {
          .tp-root { font-size: 14.5px; }
          .ri-name  { font-size: 16px; }
          .dp-stu-name { font-size: 22px; }
          .sc-val   { font-size: 26px; }
        }
      `}</style>
    </div>
  );
}