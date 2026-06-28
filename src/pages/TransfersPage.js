import React, { useState, useEffect, useRef, useMemo } from 'react';
import { studentsAPI, requestsAPI } from '../services/api';
import {
  Search, X, Plus, Loader2, Check, AlertTriangle,
  Home, DoorOpen, FileText, MapPin, Building2, BedDouble,
  Clock, CheckCircle, XCircle, ChevronDown, ChevronUp,
  User, Calendar, Activity, UserPlus, UserMinus,
  Hash, Star, RefreshCw, ArrowRight, ArrowLeft,
  Eye, Inbox, Circle,
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
};
const STATUS_CFG = {
  pending:  { color:'amber', labelHe:'ממתינה', labelEn:'Pending',  Icon: Clock       },
  approved: { color:'green', labelHe:'אושרה',  labelEn:'Approved', Icon: CheckCircle },
  rejected: { color:'rose',  labelHe:'נדחתה',  labelEn:'Rejected', Icon: XCircle     },
};

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
const StudentSearch = ({ onPick, filter, placeholder }) => {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [loading, setLoading] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await studentsAPI.getAll({ search: t });
        const list = Array.isArray(d) ? d : (d.results || []);
        setRes(filter ? list.filter(filter) : list);
      } catch { setRes([]); }
      finally { setLoading(false); }
    }, 300);
  }, [q]);

  const getName = s => s?.full_name || `${s?.first_name||''} ${s?.last_name||''}`.trim();

  return (
    <div className="ss-wrap">
      <div className="ss-field">
        <Search size={13} className="ss-ico"/>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder={placeholder||'חיפוש...'} autoFocus/>
        {loading && <Spinner size={13}/>}
        {q && !loading && <button className="ss-clear" onClick={()=>{setQ('');setRes([]);}}><X size={11}/></button>}
      </div>
      {res.length > 0 && (
        <div className="ss-drop">
          {res.map(s => {
            const name = getName(s);
            return (
              <button key={s.id} type="button" className="ss-row"
                onClick={()=>{onPick(s);setQ('');setRes([]);}}>
                <div className="ss-ava">{(name[0]||'?').toUpperCase()}</div>
                <div className="ss-info">
                  <span className="ss-name">{name}</span>
                  <span className="ss-id mono">{s.student_id}</span>
                </div>
                <Pill color={s.is_assigned?'green':'gray'} small>{s.is_assigned?'משובץ':'לא משובץ'}</Pill>
              </button>
            );
          })}
        </div>
      )}
      {q.length>=2 && !loading && res.length===0 && <div className="ss-empty">לא נמצאו תוצאות</div>}
    </div>
  );
};

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

// ── Recommendation card ───────────────────────────────────────
const RecCard = ({ opt, index, selected, onSelect }) => {
  const isRec = opt.match==='empty' || opt.recommended;
  const score = opt.score ?? opt.confidence;
  return (
    <button type="button"
      className={`rec-card${selected?' rec-sel':''} match-${opt.match||'ok'}`}
      onClick={()=>onSelect(opt)}>
      {isRec && <div className="rec-star"><Star size={8} fill="currentColor"/> מומלץ</div>}
      <div className="rec-hdr">
        <span className="rec-num">#{index+1}</span>
        {score!=null && <span className="rec-score">{Math.round(score)}%</span>}
      </div>
      <div className="rec-loc">
        <span><Building2 size={10}/> בניין {opt.building}</span>
        <span><DoorOpen size={10}/>  דירה {opt.apartment}</span>
        <span><Home size={10}/>      חדר {opt.room}</span>
        {opt.bed_label && <span><BedDouble size={10}/> {opt.bed_label}</span>}
      </div>
      {Array.isArray(opt.apartment_residents) && opt.apartment_residents.length>0 && (
        <div className="rec-res">
          {opt.apartment_residents.slice(0,3).map(r=>(
            <span key={r.id} className="res-chip">{(r.full_name||'?')[0].toUpperCase()}</span>
          ))}
          {opt.apartment_residents.length>3 && <span className="rec-more">+{opt.apartment_residents.length-3}</span>}
        </div>
      )}
      {selected && <div className="rec-chk"><Check size={11}/> נבחר</div>}
    </button>
  );
};

// ── Add Student Wizard ────────────────────────────────────────
const AddStudentWizard = ({ onSubmit, onCancel, submitting, error }) => {
  const [step, setStep] = useState(0);
  const [d, setD] = useState({ student_id:'', first_name:'', last_name:'', phone:'', email:'', city:'', gender:'', religion:'', dorm_type:'', reason:'' });
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  const steps = ['פרטי סטודנט','העדפות דיור','סיבה','סיכום'];

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
        <option value="">בחר...</option>
        {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );

  return (
    <div className="wz-root">
      <WizardBar steps={steps} current={step} colorKey="blue"/>
      <div className="wz-content">
        {step===0 && (<>
          <h3 className="wz-title">פרטי הסטודנט החדש</h3>
          <div className="wz-g3">{fld('student_id','תעודת זהות','text',true)}{fld('first_name','שם פרטי','text',true)}{fld('last_name','שם משפחה','text',true)}</div>
          <div className="wz-g3">{fld('phone','טלפון','tel')}{fld('email','אימייל','email')}{fld('city','עיר')}</div>
        </>)}
        {step===1 && (<>
          <h3 className="wz-title">העדפות דיור</h3>
          <div className="wz-g2">
            {sel('gender','מגדר',[{v:'male',l:'זכר'},{v:'female',l:'נקבה'}],true)}
            {sel('religion','דת',[{v:'Jewish',l:'יהודי'},{v:'Muslims',l:'מוסלמי'},{v:'Christian',l:'נוצרי'},{v:'Druze',l:'דרוזי'}])}
            {sel('dorm_type','סוג מעון',[{v:'couples',l:'זוגות'},{v:'single',l:'בודדים'}])}
          </div>
        </>)}
        {step===2 && (<>
          <h3 className="wz-title">סיבת הבקשה</h3>
          <div className="wz-field">
            <label>סיבה<span className="req">*</span></label>
            <textarea rows={4} value={d.reason} onChange={e=>set('reason',e.target.value)} placeholder="הסבר מדוע הסטודנט זקוק למקום במעון..."/>
          </div>
        </>)}
        {step===3 && (<>
          <h3 className="wz-title">סיכום לפני שליחה</h3>
          <div className="wz-summary">
            {[['שם',`${d.first_name} ${d.last_name}`],['ת.ז',d.student_id],['טלפון',d.phone||'—'],
              ['אימייל',d.email||'—'],['עיר',d.city||'—'],
              ['מגדר',d.gender==='male'?'זכר':d.gender==='female'?'נקבה':'—'],
              ['דת',d.religion||'—'],['סוג מעון',d.dorm_type||'—'],['סיבה',d.reason]
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
          {step===0?'ביטול':<><ArrowRight size={13}/> חזרה</>}
        </button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<steps.length-1
          ? <button className="wz-next wz-blue" disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>המשך <ArrowLeft size={13}/></button>
          : <button className="wz-next wz-blue" disabled={submitting} onClick={()=>onSubmit({...d,request_type:'add_student'})}>
              {submitting?<Spinner size={13}/>:<Check size={13}/>} שלח
            </button>}
      </div>
    </div>
  );
};

// ── Remove Student Wizard ─────────────────────────────────────
const RemoveWizard = ({ onSubmit, onCancel, submitting, error }) => {
  const [step, setStep] = useState(0);
  const [student, setStudent] = useState(null);
  const [reason, setReason] = useState('');
  const steps = ['בחר סטודנט','שיבוץ נוכחי','סיבה','אישור'];

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
          <h3 className="wz-title">בחר סטודנט להסרה</h3>
          {student ? <PickedBar student={student} onClear={()=>setStudent(null)}/> : <StudentSearch onPick={setStudent} filter={s=>s.is_assigned} placeholder="חפש סטודנט משובץ..."/>}
        </>)}
        {step===1 && student && (<>
          <h3 className="wz-title">שיבוץ נוכחי</h3>
          <div className="assignment-panel rose-panel">
            <div className="ap-row"><Building2 size={13}/><span>בניין</span><strong>{student.current_building||'—'}</strong></div>
            <div className="ap-row"><DoorOpen size={13}/><span>דירה</span><strong>{student.current_apartment||'—'}</strong></div>
            <div className="ap-row"><Home size={13}/><span>חדר</span><strong>{student.current_room||'—'}</strong></div>
            <div className="ap-row"><BedDouble size={13}/><span>מיטה</span><strong>{student.current_bed||'—'}</strong></div>
          </div>
          <div className="wz-note rose-note"><AlertTriangle size={13}/> לאחר האישור, המיטה תתפנה ופרטי הסטודנט יסומנו כלא פעיל.</div>
        </>)}
        {step===2 && (<>
          <h3 className="wz-title">סיבת ההסרה</h3>
          <div className="wz-field">
            <label>סיבה<span className="req">*</span></label>
            <textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="הסבר מדוע הסטודנט מוסר..."/>
          </div>
        </>)}
        {step===3 && (<>
          <h3 className="wz-title">אישור הסרה</h3>
          <div className="wz-summary">
            <div className="sum-row"><span className="sum-k">סטודנט</span><span className="sum-v">{student?.full_name}</span></div>
            <div className="sum-row"><span className="sum-k">ת.ז</span><span className="sum-v mono">{student?.student_id}</span></div>
            <div className="sum-row"><span className="sum-k">שיבוץ</span><span className="sum-v">בניין {student?.current_building} · דירה {student?.current_apartment} · חדר {student?.current_room}</span></div>
            <div className="sum-row"><span className="sum-k">סיבה</span><span className="sum-v">{reason}</span></div>
          </div>
          {error && <div className="wz-err">{error}</div>}
        </>)}
      </div>
      <div className="wz-footer">
        <button className="wz-back" onClick={step===0?onCancel:()=>setStep(s=>s-1)}>{step===0?'ביטול':<><ArrowRight size={13}/> חזרה</>}</button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<steps.length-1
          ? <button className="wz-next wz-rose" disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>המשך <ArrowLeft size={13}/></button>
          : <button className="wz-next wz-rose" disabled={submitting} onClick={()=>onSubmit({student:student?.id,reason,request_type:'remove_student'})}>
              {submitting?<Spinner size={13}/>:<UserMinus size={13}/>} אשר
            </button>}
      </div>
    </div>
  );
};

// ── Transfer Wizard (room / apartment / other) ────────────────
const TransferWizard = ({ type, onSubmit, onCancel, submitting, error, feasData, onCheckFeas, checkingFeas }) => {
  const [step, setStep] = useState(0);
  const [student, setStudent] = useState(null);
  const [sameApt, setSameApt] = useState(null);
  const [reason, setReason] = useState('');
  const [otherDesc, setOtherDesc] = useState('');
  const [selOpt, setSelOpt] = useState(null);

  const isRoom = type==='room';
  const colorKey = type==='room'?'violet':type==='apartment'?'teal':'amber';
  const steps = isRoom
    ? ['בחר סטודנט','העדפה','אפשרויות','אישור']
    : ['בחר סטודנט','פרטים','אישור'];

  const canNext = () => {
    if (step===0) return !!student;
    if (step===1 && !isRoom) return reason.trim().length>0;
    if (isRoom && step===2) return !!selOpt;
    return true;
  };

  const lastStep = steps.length-1;

  return (
    <div className="wz-root">
      <WizardBar steps={steps} current={step} colorKey={colorKey}/>
      <div className="wz-content">
        {step===0 && (<>
          <h3 className="wz-title">בחר סטודנט</h3>
          {student ? <PickedBar student={student} onClear={()=>setStudent(null)}/> : <StudentSearch onPick={setStudent} filter={s=>s.is_assigned} placeholder="חפש סטודנט משובץ..."/>}
          {student && (
            <div className="assignment-panel violet-panel" style={{marginTop:12}}>
              <div className="ap-row"><Building2 size={13}/><span>בניין</span><strong>{student.current_building||'—'}</strong></div>
              <div className="ap-row"><DoorOpen size={13}/><span>דירה</span><strong>{student.current_apartment||'—'}</strong></div>
              <div className="ap-row"><Home size={13}/><span>חדר</span><strong>{student.current_room||'—'}</strong></div>
            </div>
          )}
        </>)}
        {step===1 && isRoom && (<>
          <h3 className="wz-title">העדפת מיקום</h3>
          <div className="pref-group">
            {[{v:true,l:'באותה דירה'},{v:false,l:'בדירה אחרת'},{v:null,l:'לא משנה'}].map(o=>(
              <button key={String(o.v)} type="button"
                className={`pref-btn${sameApt===o.v?' pref-active':''}`}
                onClick={()=>setSameApt(o.v)}>{o.l}</button>
            ))}
          </div>
          <div className="wz-field" style={{marginTop:14}}>
            <label>סיבת הבקשה</label>
            <textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="הסבר מדוע הסטודנט מבקש להחליף חדר..."/>
          </div>
        </>)}
        {step===1 && !isRoom && (<>
          <h3 className="wz-title">פרטי הבקשה</h3>
          {type==='other' && (
            <div className="wz-field">
              <label>תיאור הבקשה</label>
              <input value={otherDesc} onChange={e=>setOtherDesc(e.target.value)} placeholder="תאר את הבקשה..."/>
            </div>
          )}
          <div className="wz-field">
            <label>סיבה<span className="req">*</span></label>
            <textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="הסבר את סיבת הבקשה..."/>
          </div>
        </>)}
        {step===2 && isRoom && (<>
          <h3 className="wz-title">חדרים פנויים מתאימים</h3>
          {!feasData && !checkingFeas && (
            <button className="check-feas-btn" onClick={()=>onCheckFeas(null,student?.id,type,sameApt)}>
              <Activity size={14}/> בדוק אפשרויות פנויות
            </button>
          )}
          {checkingFeas && <div className="checking-state"><Spinner/> מחפש...</div>}
          {feasData?.feasible===false && <div className="feas-no"><AlertTriangle size={13}/> לא נמצאו אפשרויות מתאימות</div>}
          {feasData?.feasible===true && (
            <div className="rec-grid">
              {(feasData.options||[]).map((o,i)=>(
                <RecCard key={i} opt={o} index={i} selected={selOpt===o} onSelect={setSelOpt}/>
              ))}
            </div>
          )}
        </>)}
        {((step===2&&!isRoom)||(step===3&&isRoom)) && (<>
          <h3 className="wz-title">סיכום לפני שליחה</h3>
          <div className="wz-summary">
            <div className="sum-row"><span className="sum-k">סטודנט</span><span className="sum-v">{student?.full_name}</span></div>
            <div className="sum-row"><span className="sum-k">שיבוץ נוכחי</span><span className="sum-v">בניין {student?.current_building} · דירה {student?.current_apartment} · חדר {student?.current_room}</span></div>
            {isRoom&&selOpt && <div className="sum-row"><span className="sum-k">יעד נבחר</span><span className="sum-v">בניין {selOpt.building} · דירה {selOpt.apartment} · חדר {selOpt.room}</span></div>}
            {reason && <div className="sum-row"><span className="sum-k">סיבה</span><span className="sum-v">{reason}</span></div>}
            {otherDesc && <div className="sum-row"><span className="sum-k">תיאור</span><span className="sum-v">{otherDesc}</span></div>}
          </div>
          {error && <div className="wz-err">{error}</div>}
        </>)}
      </div>
      <div className="wz-footer">
        <button className="wz-back" onClick={step===0?onCancel:()=>setStep(s=>s-1)}>{step===0?'ביטול':<><ArrowRight size={13}/> חזרה</>}</button>
        <span className="wz-prog">{step+1}/{steps.length}</span>
        {step<lastStep
          ? <button className={`wz-next wz-${colorKey}`} disabled={!canNext()} onClick={()=>setStep(s=>s+1)}>המשך <ArrowLeft size={13}/></button>
          : <button className={`wz-next wz-${colorKey}`} disabled={submitting}
              onClick={()=>onSubmit({student:student?.id,request_type:type,reason,other_description:otherDesc,same_apartment:sameApt,target_option:selOpt?.room_id||selOpt?.roomId})}>
              {submitting?<Spinner size={13}/>:<Check size={13}/>} שלח
            </button>}
      </div>
    </div>
  );
};

// ── New Request Modal ─────────────────────────────────────────
const NewRequestModal = ({ onClose, onSuccess }) => {
  const [type, setType] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [feasData, setFeasData] = useState(null);
  const [checkingFeas, setCheckingFeas] = useState(false);

  const typeCards = [
    { v:'add_student',    Icon:UserPlus,  color:'blue',   title:'הוספת סטודנט', sub:'רישום סטודנט חדש למעונות' },
    { v:'remove_student', Icon:UserMinus, color:'rose',   title:'הסרה ממעונות', sub:'הסרת סטודנט קיים' },
    { v:'room',           Icon:Home,      color:'violet', title:'שינוי חדר',    sub:'העברה לחדר אחר' },
    { v:'apartment',      Icon:DoorOpen,  color:'teal',   title:'מעבר מדירה',  sub:'מעבר לדירה אחרת' },
    { v:'other',          Icon:FileText,  color:'amber',  title:'בקשה אחרת',   sub:'הארכת שהייה ועוד' },
  ];

  const handleSubmit = async (payload) => {
    setError(''); setSubmitting(true);
    try { await requestsAPI.create(payload); onSuccess(); onClose(); }
    catch (err) { setError(err.message||'שגיאה בשליחה'); }
    finally { setSubmitting(false); }
  };

  const handleCheckFeas = async (_id, studentId, reqType, sameApt) => {
    setCheckingFeas(true);
    try {
      const d = requestsAPI.checkFeasibilityForStudent
        ? await requestsAPI.checkFeasibilityForStudent(studentId, reqType, sameApt)
        : { feasible: null, options: [], reason: '' };
      setFeasData(d);
    } catch (err) { setFeasData({ feasible:false, reason:err.message, options:[] }); }
    finally { setCheckingFeas(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="mh-left">
            {type && <button className="back-type" onClick={()=>setType(null)}><ArrowRight size={13}/> סוגי בקשות</button>}
            <h2>{type?'בקשה חדשה':'בחר סוג בקשה'}</h2>
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
                  <ArrowLeft size={13} className="tp-arrow"/>
                </button>
              );
            })}
          </div>
        )}
        {type==='add_student'    && <AddStudentWizard onSubmit={handleSubmit} onCancel={onClose} submitting={submitting} error={error}/>}
        {type==='remove_student' && <RemoveWizard     onSubmit={handleSubmit} onCancel={onClose} submitting={submitting} error={error}/>}
        {(type==='room'||type==='apartment'||type==='other') && (
          <TransferWizard type={type} onSubmit={handleSubmit} onCancel={onClose}
            submitting={submitting} error={error}
            feasData={feasData} onCheckFeas={handleCheckFeas} checkingFeas={checkingFeas}/>
        )}
      </div>
    </div>
  );
};

// ── Action Panel ──────────────────────────────────────────────
const ActionPanel = ({ request, onApprove, onReject, acting,
  feasData, checkingFeas, onCheckFeas,
  aptOptions, loadingBeds, bedsError,
  selectedApt, onSetApt, roomId, onSetRoom,
  selFeasOpt, onSelFeasOpt }) => {

  const [rejectText, setRejectText] = useState('');
  const [showReject, setShowReject] = useState(false);
  const isAdd = request.request_type==='add_student';
  const isRem = request.request_type==='remove_student';
  const hasFeas = feasData?.feasible !== undefined;

  if (request.status!=='pending') return null;

  return (
    <div className="action-panel">
      <span className="ap-label">פעולות</span>
      {showReject ? (
        <div className="reject-form">
          <textarea rows={2} value={rejectText} onChange={e=>setRejectText(e.target.value)} placeholder="סיבת הדחייה (אופציונלי)..."/>
          <div className="rf-row">
            <button className="btn-ghost-sm" onClick={()=>setShowReject(false)}>ביטול</button>
            <button className="btn-rej-sm" onClick={()=>onReject(request.id,rejectText)} disabled={acting}>
              {acting?<Spinner size={12}/>:<XCircle size={12}/>} דחה
            </button>
          </div>
        </div>
      ) : isRem ? (
        <div className="act-row">
          <button className="btn-approve-danger" onClick={()=>onApprove(request.id)} disabled={acting}>
            {acting?<Spinner size={12}/>:<UserMinus size={12}/>} אשר הסרה
          </button>
          <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> דחה</button>
        </div>
      ) : isAdd ? (
        <>
          {loadingBeds && <div className="checking-state"><Spinner size={13}/> טוען דירות...</div>}
          {bedsError && <div className="feas-no"><AlertTriangle size={13}/>{bedsError}</div>}
          {!loadingBeds && aptOptions.length>0 && (
            <div className="apt-two-col">
              <div className="apt-list-col">
                <div className="col-head">דירות פנויות ({aptOptions.length})</div>
                {aptOptions.map(apt=>(
                  <button key={apt.key}
                    className={`apt-row${selectedApt?.key===apt.key?' apt-sel':''} match-${apt.match}`}
                    disabled={apt.match==='mismatch'}
                    onClick={()=>{onSetApt(apt);onSetRoom('');}}>
                    {apt.match==='empty'&&<Star size={9} className="apt-star" fill="currentColor"/>}
                    <div><strong>בניין {apt.building} · דירה {apt.apartment}</strong><span>{apt.dorm_type}</span></div>
                    <span className="free-badge">{apt.freeBeds} פנויות</span>
                  </button>
                ))}
              </div>
              <div className="apt-detail-col">
                {!selectedApt ? <div className="apt-empty">בחר דירה</div> : (
                  <>
                    <div className="col-head">בניין {selectedApt.building} · דירה {selectedApt.apartment}</div>
                    {selectedApt.residents?.length>0
                      ? selectedApt.residents.map(r=>(
                          <div key={r.id} className="res-row-sm">
                            <div className="rs-ava">{(r.full_name||'?')[0]}</div>
                            <span>{r.full_name}</span>
                            <span className="rs-room">חדר {r.room_name}</span>
                          </div>
                        ))
                      : <div className="apt-empty">דירה ריקה</div>}
                    <div className="col-head" style={{marginTop:8}}>בחר חדר</div>
                    <div className="room-chips">
                      {selectedApt.rooms?.map(rm=>(
                        <button key={rm.room_id}
                          className={`room-chip${String(roomId)===String(rm.room_id)?' room-chip-sel':''}`}
                          onClick={()=>onSetRoom(rm.room_id)}>
                          <strong>חדר {rm.room_name||rm.room}</strong>
                          <span>{rm.available_beds} מיטות</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="act-row" style={{marginTop:8}}>
            <button className="btn-approve" onClick={()=>onApprove(request.id,roomId)} disabled={acting||!roomId}>
              {acting?<Spinner size={12}/>:<Check size={12}/>} אשר ושבץ
            </button>
            <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> דחה</button>
          </div>
        </>
      ) : !hasFeas ? (
        <div className="act-row">
          <button className="btn-check" onClick={()=>onCheckFeas(request.id)} disabled={checkingFeas}>
            {checkingFeas?<><Spinner size={12}/> בודק...</>:<><Activity size={12}/> בדוק אפשרויות</>}
          </button>
          <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> דחה</button>
        </div>
      ) : (
        <>
          {feasData.feasible===true && (
            <div className="rec-grid compact-rec">
              {(feasData.options||[]).map((o,i)=>(
                <RecCard key={i} opt={o} index={i} selected={selFeasOpt===o} onSelect={onSelFeasOpt}/>
              ))}
            </div>
          )}
          {feasData.feasible===false && <div className="feas-no"><AlertTriangle size={13}/> לא נמצאו אפשרויות מתאימות</div>}
          <div className="act-row">
            {feasData.feasible===true && (
              <button className="btn-approve" disabled={acting||!selFeasOpt}
                onClick={()=>onApprove(request.id,selFeasOpt?.room_id||selFeasOpt?.roomId)}>
                {acting?<Spinner size={12}/>:<Check size={12}/>} אשר
              </button>
            )}
            <button className="btn-recheck" onClick={()=>onCheckFeas(request.id)} disabled={checkingFeas}><RefreshCw size={12}/> שוב</button>
            <button className="btn-rej-outline" onClick={()=>setShowReject(true)}><XCircle size={12}/> דחה</button>
          </div>
        </>
      )}
    </div>
  );
};

// ── Detail Pane ───────────────────────────────────────────────
const DetailPane = ({ request, onApprove, onReject, acting, language,
  feasData, checkingFeas, onCheckFeas,
  aptOptions, loadingBeds, bedsError,
  selectedApt, onSetApt, roomId, onSetRoom,
  selFeasOpt, onSelFeasOpt }) => {

  const [histOpen, setHistOpen] = useState(false);
  const typeCfg   = TYPE_CFG[request.request_type]   || TYPE_CFG.other;
  const statusCfg = STATUS_CFG[request.status]        || STATUS_CFG.pending;
  const TypeIcon  = typeCfg.Icon;
  const StatIcon  = statusCfg.Icon;

  const tl = [
    { label:'נוצרה',             sub:`${fmtDate(request.created_at)} · ${request.requested_by_name||'—'}`, done:true },
    { label:'ממתינה לאישור',      sub:'',  done:request.status!=='pending', active:request.status==='pending' },
    { label:request.status==='approved'?'אושרה':request.status==='rejected'?'נדחתה':'אישור',
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
          <div className={`dp-type-tag dp-type-${typeCfg.color}`}><TypeIcon size={12}/> {language==='he'?typeCfg.labelHe:typeCfg.labelEn}</div>
        </div>
      </div>

      {/* Body */}
      <div className="dp-body">
        {/* Timeline */}
        <section>
          <div className="sec-title">מסלול הבקשה</div>
          <Timeline events={tl}/>
        </section>

        {/* Current placement */}
        {request.current_building && (
          <section>
            <div className="sec-title">שיבוץ נוכחי</div>
            <div className="assign-rows">
              {request.current_region && (
                <div className="assign-row"><MapPin size={18}/><span className="assign-row-label">אזור</span><span className="assign-row-val">{request.current_region}</span></div>
              )}
              <div className="assign-row"><Building2 size={18}/><span className="assign-row-label">בניין</span><span className="assign-row-val">{request.current_building}</span></div>
              <div className="assign-row"><DoorOpen  size={18}/><span className="assign-row-label">דירה</span><span className="assign-row-val">{request.current_apartment}</span></div>
              <div className="assign-row"><Home      size={18}/><span className="assign-row-label">חדר</span><span className="assign-row-val">{request.current_room}</span></div>
              {request.current_bed && (
                <div className="assign-row"><BedDouble size={18}/><span className="assign-row-label">מיטה</span><span className="assign-row-val">{request.current_bed}</span></div>
              )}
            </div>
          </section>
        )}

        {/* Details */}
        <section>
          <div className="sec-title">פרטי הבקשה</div>
          {request.request_type==='room' && request.same_apartment!==undefined && (
            <div className="kv"><span>העדפה</span><strong>{request.same_apartment===true?'באותה דירה':request.same_apartment===false?'בדירה אחרת':'לא משנה'}</strong></div>
          )}
          {request.reason && <div className="kv"><span>סיבה</span><strong className="kv-reason">{request.reason}</strong></div>}
          {request.other_description && <div className="kv"><span>תיאור</span><strong>{request.other_description}</strong></div>}
          <div className="kv"><span>נפתח ע"י</span><strong>{request.requested_by_name||'—'}</strong></div>
          <div className="kv"><span>תאריך</span><strong>{fmtDate(request.created_at)}</strong></div>
          {request.reviewed_by_name && <div className="kv"><span>טופל ע"י</span><strong>{request.reviewed_by_name}</strong></div>}
        </section>

        {/* History */}
        {Array.isArray(request.placement_history)&&request.placement_history.length>0&&(
          <section>
            <button className="hist-toggle" onClick={()=>setHistOpen(h=>!h)}>
              <Activity size={12}/> היסטוריית שיבוצים ({request.placement_history.length}) {histOpen?<ChevronUp size={12}/>:<ChevronDown size={12}/>}
            </button>
            {histOpen && (
              <div className="hist-list">
                {request.placement_history.map((p,i)=>(
                  <div key={i} className="hist-item">
                    <div className="hi-loc">{p.region&&<span className="hi-reg">{p.region}</span>}<span>בניין {p.building} · דירה {p.apartment} · חדר {p.room}</span></div>
                    <span className="hi-date">{fmtDate(p.assigned_at)}{p.ended_at?` → ${fmtDate(p.ended_at)}`:''}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Rejection */}
        {request.status==='rejected'&&request.rejection_reason&&(
          <div className="rej-banner"><AlertTriangle size={13}/><strong>סיבת הדחייה:</strong> {request.rejection_reason}</div>
        )}

        {/* Actions */}
        <ActionPanel
          request={request} onApprove={onApprove} onReject={onReject} acting={acting}
          feasData={feasData} checkingFeas={checkingFeas} onCheckFeas={onCheckFeas}
          aptOptions={aptOptions} loadingBeds={loadingBeds} bedsError={bedsError}
          selectedApt={selectedApt} onSetApt={onSetApt} roomId={roomId} onSetRoom={onSetRoom}
          selFeasOpt={selFeasOpt} onSelFeasOpt={onSelFeasOpt}
        />
      </div>
    </div>
  );
};

// ── List Item ─────────────────────────────────────────────────
const ListItem = ({ request, selected, onClick, language }) => {
  const tc = TYPE_CFG[request.request_type]||TYPE_CFG.other;
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
        <span className="ri-date">{fmtDateShort(request.created_at)}</span>
      </div>
    </button>
  );
};

// ── Main Page ─────────────────────────────────────────────────
export default function TransfersPage({ language = 'he' }) {
  const isHe = language === 'he';

  const [requests, setRequests]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [pageError, setPageError] = useState('');
  const [selected, setSelected]   = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [tab, setTab]             = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQ, setSearchQ]     = useState('');

  const [feasData, setFeasData]   = useState({});
  const [checkingFeas, setCheckingFeas] = useState(null);
  const [actionId, setActionId]   = useState(null);
  const [bedOptions, setBedOpts]  = useState({});
  const [loadingBeds, setLdBeds]  = useState(null);
  const [bedsError, setBedsErr]   = useState({});
  const [selApt, setSelApt]       = useState({});
  const [selRoom, setSelRoom]     = useState({});
  const [selFeasOpt, setSelFeasOpt] = useState({});

  // ── Draggable splitter ──
  const [listWidth, setListWidth] = useState(360);
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

  useEffect(() => { loadRequests(); }, [tab]); // eslint-disable-line

  const loadRequests = async () => {
    setLoading(true); setPageError('');
    try {
      const params = tab === 'all' ? {} : { status: tab };
      const d = await requestsAPI.getAll(params);
      const list = Array.isArray(d) ? d : (d.results || []);
      setRequests(list);
      if (selected) { const upd = list.find(r => r.id === selected.id); if (upd) setSelected(upd); }
    } catch (err) { setPageError(err.message || 'שגיאה בטעינה'); }
    finally { setLoading(false); }
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

  const aptOptions = useMemo(() => {
    if (!selected) return [];
    const opts = bedOptions[selected.id] || [];
    const g = {};
    opts.forEach(o => {
      const k = `${o.building}-${o.apartment}`;
      if (!g[k]) g[k] = { key:k, building:o.building, apartment:o.apartment,
        dorm_type:o.dorm_type, region:o.region, rooms:[], residents:o.apartment_residents||[],
        freeBeds:0, match:o.match||'ok' };
      g[k].rooms.push(o);
      g[k].freeBeds += Number(o.available_beds || 0);
      if (o.match === 'mismatch') g[k].match = 'mismatch';
      else if (o.match === 'empty' && g[k].match === 'ok') g[k].match = 'empty';
    });
    return Object.values(g).sort((a,b) => {
      if (a.match==='empty'&&b.match!=='empty') return -1;
      if (b.match==='empty'&&a.match!=='empty') return 1;
      return 0;
    });
  }, [bedOptions, selected]);

  const handleSelect = async (req) => {
    setSelected(req);
    if (req.request_type === 'add_student' && !bedOptions[req.id]) {
      setLdBeds(req.id);
      try {
        const d = await requestsAPI.getAddStudentBeds(req.id);
        setBedOpts(p => ({ ...p, [req.id]: d.options || [] }));
      } catch (err) { setBedsErr(p => ({ ...p, [req.id]: err.message })); }
      finally { setLdBeds(null); }
    }
  };

  const checkFeasibility = async (id) => {
    setCheckingFeas(id);
    try {
      const d = await requestsAPI.checkFeasibility(id);
      setFeasData(p => ({ ...p, [id]: d }));
    } catch (err) { setFeasData(p => ({ ...p, [id]: { feasible:false, reason:err.message, options:[] } })); }
    finally { setCheckingFeas(null); }
  };

  const doApprove = async (id, roomId) => {
    setActionId(id);
    try { await requestsAPI.approve(id, roomId ? { target_room: roomId } : {}); await loadRequests(); }
    catch (err) { alert(err.message || 'שגיאה'); }
    finally { setActionId(null); }
  };

  const doReject = async (id, reason) => {
    setActionId(id);
    try { await requestsAPI.reject(id, reason); await loadRequests(); }
    catch (err) { alert(err.message || 'שגיאה'); }
    finally { setActionId(null); }
  };

  const statCards = [
    { key:'all',           label:'סה"כ',    Icon:Inbox,       color:'slate' },
    { key:'pending',       label:'ממתינות', Icon:Clock,       color:'amber' },
    { key:'approved',      label:'אושרו',   Icon:CheckCircle, color:'green' },
    { key:'rejected',      label:'נדחו',    Icon:XCircle,     color:'rose'  },
    { key:'add_student',   label:'הוספות',  Icon:UserPlus,    color:'blue'  },
    { key:'remove_student',label:'הסרות',   Icon:UserMinus,   color:'rose'  },
    { key:'transfers',     label:'העברות',  Icon:Home,        color:'violet'},
  ];

  const typeFilters = [
    { v:'all',           l:'הכל'           },
    { v:'add_student',   l:'הוספות'        },
    { v:'remove_student',l:'הסרות'         },
    { v:'room',          l:'שינוי חדר'     },
    { v:'apartment',     l:'מעבר מדירה'    },
    { v:'other',         l:'אחר'           },
  ];

  return (
    <div className="tp-root" dir="rtl">

      {/* Top bar */}
      <div className="tp-top">
        <div className="tp-title-row">
          <h1>בקשות</h1>
          <span className="tp-sub">ניהול בקשות סטודנטים</span>
        </div>
        <div className="tp-top-actions">
          <button className="btn-refresh" onClick={loadRequests} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''}/>
          </button>
          <button className="btn-new" onClick={() => setShowModal(true)}>
            <Plus size={14}/> בקשה חדשה
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
              if (['pending','approved','rejected'].includes(sc.key)) { setTab(sc.key); setTypeFilter('all'); }
              else if (sc.key === 'all') { setTab('all'); setTypeFilter('all'); }
              else if (sc.key === 'transfers') { setTab('all'); setTypeFilter('room'); }
              else { setTab('all'); setTypeFilter(sc.key); }
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
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="חיפוש..."/>
              {searchQ && <button onClick={()=>setSearchQ('')}><X size={10}/></button>}
            </div>
            <div className="status-tabs">
              {[{v:'all',l:'הכל'},{v:'pending',l:'ממתינות'},{v:'approved',l:'אושרו'},{v:'rejected',l:'נדחו'}].map(t=>(
                <button key={t.v} className={`stab${tab===t.v?' stab-active':''}`} onClick={()=>setTab(t.v)}>{t.l}</button>
              ))}
            </div>
            <div className="type-chips">
              {typeFilters.map(tf=>(
                <button key={tf.v} className={`type-chip${typeFilter===tf.v?' tc-active':''}`}
                  onClick={()=>setTypeFilter(tf.v)}>{tf.l}</button>
              ))}
            </div>
            <div className="lt-count">{visible.length} בקשות</div>
          </div>

          <div className="rq-list">
            {loading && !requests.length && <div className="list-loading"><Spinner/> טוען...</div>}
            {!loading && visible.length === 0 && (
              <EmptyPane icon={Inbox} title="אין בקשות" sub="נסה לשנות פילטרים" action="+ בקשה חדשה" onAction={()=>setShowModal(true)}/>
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
                      <path d="M33.5 34h5M36 31.5v5" stroke="var(--blue)" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <h3 className="eds-title">אין בקשה נבחרת</h3>
                  <p className="eds-sub">בחר בקשה מהרשימה כדי לצפות בפרטיה ולנקוט פעולה</p>
                  <div className="eds-hints">
                    <div className="eds-hint"><span className="eds-key">⏎</span>פתח בקשה</div>
                    <div className="eds-hint"><span className="eds-key">↑↓</span>ניווט</div>
                    <div className="eds-hint"><span className="eds-key">N</span>בקשה חדשה</div>
                  </div>
                </div>
              </div>
            )
            : <DetailPane
                request={selected} language={language}
                acting={actionId===selected.id}
                onApprove={doApprove} onReject={doReject}
                feasData={feasData[selected.id]}
                checkingFeas={checkingFeas===selected.id}
                onCheckFeas={checkFeasibility}
                aptOptions={aptOptions}
                loadingBeds={loadingBeds===selected.id}
                bedsError={bedsError[selected.id]}
                selectedApt={selApt[selected.id]}
                onSetApt={apt=>setSelApt(p=>({...p,[selected.id]:apt}))}
                roomId={selRoom[selected.id]}
                onSetRoom={rid=>setSelRoom(p=>({...p,[selected.id]:rid}))}
                selFeasOpt={selFeasOpt[selected.id]}
                onSelFeasOpt={opt=>setSelFeasOpt(p=>({...p,[selected.id]:opt}))}
              />
          }
        </div>
      </div>

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
          direction: rtl;
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
          align-items: baseline;
          gap: 10px;
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
          grid-template-columns: repeat(7, 1fr);
          gap: 0;
          padding: 12px 20px 0;
        }
        .stat-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--surf);
          border: 1px solid var(--bdr);
          border-right: none;
          cursor: pointer;
          transition: background .1s;
          position: relative;
        }
        .stat-card:first-child { border-radius: var(--r6) 0 0 var(--r6); border-right: 1px solid var(--bdr); }
        .stat-card:last-child  { border-radius: 0 var(--r6) var(--r6) 0; }
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
          height: calc(100vh - 200px);
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

        .type-chips { display: flex; gap: 4px; flex-wrap: wrap; }
        .type-chip {
          padding: 3px 9px;
          border: 1px solid var(--bdr);
          background: transparent;
          border-radius: 20px;
          font-family: inherit; font-size: 12px; font-weight: 500;
          color: var(--t3); cursor: pointer;
          transition: all .1s;
        }
        .type-chip:hover { border-color: var(--bdr-2); color: var(--t2); background: var(--surf); }
        .tc-active {
          background: var(--blue) !important;
          border-color: var(--blue) !important;
          color: #fff !important; font-weight: 600;
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

        /* Type colour strip — left edge (RTL = right border) */
        .rq-item-violet { border-right: 3px solid var(--violet); }
        .rq-item-teal   { border-right: 3px solid var(--teal);   }
        .rq-item-amber  { border-right: 3px solid var(--amber);  }
        .rq-item-blue   { border-right: 3px solid var(--blue);   }
        .rq-item-rose   { border-right: 3px solid var(--rose);   }

        .ri-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .ri-id {
          font-size: 11px;
          font-weight: 600;
          color: var(--t4);
          font-family: 'SF Mono', Consolas, monospace;
          letter-spacing: .02em;
          display: inline-flex; align-items: center; gap: 2px;
        }
        .si-amber { color: var(--amber) !important; }
        .si-green { color: var(--green) !important; }
        .si-rose  { color: var(--rose)  !important; }

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

        .ri-inf { flex: 1; min-width: 0; }
        .ri-name {
          display: block;
          font-size: 15px;
          font-weight: 600;
          color: var(--t1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.25;
        }
        .ri-meta {
          font-size: 12px;
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
          font-size: 12px; font-weight: 500;
          padding: 2px 8px; border-radius: 20px;
        }
        .ri-type-violet { background: var(--violet-bg); color: var(--violet); }
        .ri-type-teal   { background: var(--teal-bg);   color: var(--teal);   }
        .ri-type-amber  { background: var(--amber-bg);  color: var(--amber);  }
        .ri-type-blue   { background: var(--blue-bg);   color: var(--blue);   }
        .ri-type-rose   { background: var(--rose-bg);   color: var(--rose);   }
        .ri-date { font-size: 12px; color: var(--t4); }

        /* ── Detail outer ─────────────────────────── */
        .detail-outer {
          overflow-y: auto;
          min-width: 0;
          border-right: 1px solid var(--bdr);
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
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          margin-inline-start: auto;
          flex-shrink: 0;
        }
        .dp-type-violet { background: var(--violet-bg); color: var(--violet); }
        .dp-type-teal   { background: var(--teal-bg);   color: var(--teal);   }
        .dp-type-amber  { background: var(--amber-bg);  color: var(--amber);  }
        .dp-type-blue   { background: var(--blue-bg);   color: var(--blue);   }
        .dp-type-rose   { background: var(--rose-bg);   color: var(--rose);   }

        .dp-body {
          padding: 20px 24px;
          display: flex; flex-direction: column;
          gap: 20px;
          flex: 1;
          overflow-y: auto;
        }
        .dp-body::-webkit-scrollbar { width: 6px; }
        .dp-body::-webkit-scrollbar-thumb { background: var(--bdr); border-radius: 3px; }

        /* ── Section headers ── */
        .sec-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--t4);
          text-transform: uppercase;
          letter-spacing: .09em;
          margin-bottom: 10px;
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
          padding: 8px 0; border-bottom: 1px solid var(--bdr);
        }
        .kv:last-child { border-bottom: none; }
        .kv span {
          font-size: 13px; color: var(--t3); font-weight: 500;
          min-width: 88px; flex-shrink: 0;
        }
        .kv strong {
          font-size: 14px; color: var(--t1); font-weight: 500;
          line-height: 1.5;
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
          background: var(--surf); border-radius: var(--r12);
          width: 100%; max-width: 680px; max-height: 90vh;
          display: flex; flex-direction: column;
          box-shadow: var(--sh3); overflow: hidden;
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
        .wz-cur-violet .wz-circle { background: var(--violet); border-color: var(--violet); color: #fff; }
        .wz-cur-teal   .wz-circle { background: var(--teal);   border-color: var(--teal);   color: #fff; }
        .wz-cur-amber  .wz-circle { background: var(--amber);  border-color: var(--amber);  color: #fff; }
        .wz-lbl { font-size: 10px; font-weight: 500; color: var(--t4); white-space: nowrap; }
        .wz-cur-blue .wz-lbl, .wz-cur-rose .wz-lbl, .wz-cur-violet .wz-lbl,
        .wz-cur-teal .wz-lbl, .wz-cur-amber .wz-lbl { color: var(--t1); font-weight: 700; }
        .wz-done .wz-lbl { color: var(--green); }
        .wz-conn { flex: 1; height: 2px; background: var(--bdr); margin-bottom: 18px; min-width: 8px; }
        .wz-conn-done { background: var(--green); }

        .wz-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
        .wz-title { font-size: 17px; font-weight: 700; color: var(--t1); }

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
        .wz-violet { background: var(--violet); }
        .wz-teal   { background: var(--teal);   }
        .wz-amber  { background: var(--amber);  }

        /* ── Student search ── */
        .ss-wrap { position: relative; }
        .ss-field {
          display: flex; align-items: center; gap: 8px;
          border: 1px solid var(--bdr); border-radius: var(--r4);
          padding: 9px 12px; background: var(--surf); transition: border-color .12s;
        }
        .ss-field:focus-within { border-color: var(--bdr-focus); }
        .ss-ico { color: var(--t4); flex-shrink: 0; }
        .ss-field input {
          flex: 1; border: none; background: transparent;
          font-family: inherit; font-size: 14px; outline: none; min-width: 0; color: var(--t1);
        }
        .ss-field input::placeholder { color: var(--t4); }
        .ss-clear { background: none; border: none; cursor: pointer; color: var(--t4); display: flex; align-items: center; }
        .ss-drop {
          position: absolute; top: calc(100% + 4px);
          inset-inline-start: 0; inset-inline-end: 0;
          background: var(--surf); border: 1px solid var(--bdr); border-radius: var(--r8);
          box-shadow: var(--sh3); z-index: 100; max-height: 260px; overflow-y: auto;
        }
        .ss-row {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 10px 13px; border: none; background: transparent;
          font-family: inherit; cursor: pointer; text-align: start; transition: background .1s;
        }
        .ss-row:hover { background: var(--surf-2); }
        .ss-ava {
          width: 32px; height: 32px; background: var(--blue); color: #fff;
          border-radius: var(--r6); display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; flex-shrink: 0;
        }
        .ss-info { flex: 1; min-width: 0; }
        .ss-name { display: block; font-size: 14px; font-weight: 600; color: var(--t1); }
        .ss-id   { font-size: 12px; color: var(--t4); font-family: 'SF Mono', Consolas, monospace; }
        .ss-empty { padding: 14px; text-align: center; font-size: 13px; color: var(--t4); }

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
          .stats-row { grid-template-columns: repeat(4, 1fr); }
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