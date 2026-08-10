import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { studentsAPI } from '../services/api';

// Debounced student-name/ID search dropdown. Originally local to
// TransfersPage.js; extracted so other pages (Assisted Allocation) reuse the
// exact same lookup instead of a second implementation. Self-contained
// styling (does not depend on a host page's CSS variables) so it renders
// correctly regardless of which page embeds it.
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

  const getName = (s) => s?.full_name || `${s?.first_name || ''} ${s?.last_name || ''}`.trim();

  return (
    <div className="shared-ss-wrap">
      <div className="shared-ss-field">
        <Search size={13} className="shared-ss-ico" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder || 'חיפוש...'}
        />
        {loading && <Loader2 size={13} className="shared-ss-spin" />}
        {q && !loading && (
          <button type="button" className="shared-ss-clear" onClick={() => { setQ(''); setRes([]); }}>
            <X size={11} />
          </button>
        )}
      </div>
      {res.length > 0 && (
        <div className="shared-ss-drop">
          {res.map((s) => {
            const name = getName(s);
            return (
              <button
                key={s.id}
                type="button"
                className="shared-ss-row"
                onClick={() => { onPick(s); setQ(''); setRes([]); }}
              >
                <div className="shared-ss-ava">{(name[0] || '?').toUpperCase()}</div>
                <div className="shared-ss-info">
                  <span className="shared-ss-name">{name}</span>
                  <span className="shared-ss-id">{s.student_id}</span>
                </div>
                <span className={`shared-ss-pill ${s.is_assigned ? 'is-assigned' : 'is-unassigned'}`}>
                  {s.is_assigned ? 'משובץ' : 'לא משובץ'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {q.length >= 2 && !loading && res.length === 0 && (
        <div className="shared-ss-empty">לא נמצאו תוצאות</div>
      )}

      <style>{`
        .shared-ss-wrap { position: relative; font-family: inherit; }
        .shared-ss-field {
          display: flex; align-items: center; gap: 8px;
          background: #fff; border: 1px solid #dfe1e6; border-radius: 8px;
          padding: 9px 12px;
        }
        .shared-ss-field:focus-within { border-color: #4c9aff; }
        .shared-ss-ico { color: #97a0af; flex-shrink: 0; }
        .shared-ss-field input {
          flex: 1; border: none; outline: none; font-size: 14px;
          font-family: inherit; color: #172b4d; background: transparent;
        }
        .shared-ss-field input::placeholder { color: #97a0af; }
        .shared-ss-clear {
          background: none; border: none; cursor: pointer; color: #97a0af;
          display: flex; align-items: center;
        }
        .shared-ss-spin { animation: shared-ss-spin 0.8s linear infinite; color: #97a0af; }
        @keyframes shared-ss-spin { to { transform: rotate(360deg); } }
        .shared-ss-drop {
          position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; left: 0;
          background: #fff; border: 1px solid #dfe1e6; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(23,43,77,0.14);
          max-height: 280px; overflow-y: auto;
        }
        .shared-ss-row {
          width: 100%; display: flex; align-items: center; gap: 10px;
          padding: 9px 12px; border: none; background: none; cursor: pointer;
          text-align: right; font-family: inherit;
        }
        .shared-ss-row:hover { background: #f8f9fb; }
        .shared-ss-ava {
          width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
          background: #deebff; color: #0052cc; font-weight: 700; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
        }
        .shared-ss-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .shared-ss-name { font-size: 14px; font-weight: 600; color: #172b4d; }
        .shared-ss-id { font-size: 12px; color: #97a0af; direction: ltr; text-align: right; }
        .shared-ss-pill {
          font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
          flex-shrink: 0;
        }
        .shared-ss-pill.is-assigned { background: #e3fcef; color: #006644; }
        .shared-ss-pill.is-unassigned { background: #f4f5f7; color: #42526e; }
        .shared-ss-empty { padding: 14px; text-align: center; font-size: 13px; color: #97a0af; }
      `}</style>
    </div>
  );
};

export default StudentSearch;
