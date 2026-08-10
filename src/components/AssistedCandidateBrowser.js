import React, { useMemo, useState } from 'react';
import {
  Building2, DoorOpen, BedDouble, ChevronDown, ChevronUp, Search,
  CheckCircle2, AlertTriangle, ShieldAlert, User,
} from 'lucide-react';

// Central allocation workspace for the Assisted Allocation page: ONE
// hierarchical Building -> Apartment -> Room -> Bed browser (collapsed by
// default) over the candidates the backend already restricted to the
// student's accepted dorm type and classified into three tiers
// (assisted_status: recommended/possible/override_required). There is no
// second "manual placement" list - every selectable bed, however it ranks,
// lives in this same tree; override_required apartments are simply
// visually flagged rather than living in a separate section.
//
// Selecting a bed only calls onSelectBed - it never assigns. The parent
// page renders the confirm panel from the selection this returns.

const STATUS_CFG = {
  recommended: { label: 'מומלץ', color: '#15803d', bg: '#dcfce7', border: '#86efac' },
  possible: { label: 'אפשרי', color: '#1d4ed8', bg: '#dbeafe', border: '#93c5fd' },
  override_required: { label: 'דורש חריגה', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
};

function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.possible;
  return (
    <span className="acb-pill" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {cfg.label}
    </span>
  );
}

export function buildBedSelection(building, apartment, room, bed) {
  return {
    bed_id: bed.bed_id,
    bed_label: bed.bed_label,
    room_id: room.room_id,
    room_name: room.room_name,
    single_bed_room: room.capacity === 1,
    apartment_id: apartment.apartment_id,
    apartment_number: apartment.apartment_number,
    building_id: building.building_id,
    building_number: building.building_number,
    assisted_status: apartment.assisted_status,
    assisted_status_label: apartment.assisted_status_label,
    matched_reasons: apartment.matched_reasons || [],
    warnings: apartment.warnings || [],
    override_violations: apartment.override_violations || [],
  };
}

function ApartmentReasonLine({ apartment }) {
  const good = (apartment.matched_reasons || []).slice(0, 2).map((r) => r.label);
  const warn = (apartment.warnings || [])[0]?.label;
  const violation = (apartment.override_violations || [])[0]?.label;
  if (!good.length && !warn && !violation) return null;
  return (
    <div className="acb-apt-reasonline">
      {good.length > 0 && <span className="acb-reason-good"><CheckCircle2 size={11} /> {good.join(' · ')}</span>}
      {warn && <span className="acb-reason-warn"><AlertTriangle size={11} /> {warn}</span>}
      {violation && <span className="acb-reason-violation"><ShieldAlert size={11} /> {violation}</span>}
    </div>
  );
}

function BedRow({ building, apartment, room, bed, selected, onSelect }) {
  const selectable = bed.is_selectable && !bed.is_occupied;
  return (
    <button
      type="button"
      className={`acb-bed-row${selected ? ' acb-bed-row-selected' : ''}${bed.is_occupied ? ' acb-bed-row-occupied' : ''}`}
      disabled={!selectable}
      onClick={() => onSelect(selected ? null : buildBedSelection(building, apartment, room, bed))}
    >
      <span className={`acb-radio${selected ? ' acb-radio-on' : ''}`} aria-hidden="true" />
      <BedDouble size={13} />
      <span className="acb-bed-label">מיטה {bed.bed_label}</span>
      {bed.is_occupied ? (
        <span className="acb-bed-status acb-bed-status-occ">תפוסה{bed.occupant_name ? ` · ${bed.occupant_name}` : ''}</span>
      ) : (
        <span className="acb-bed-status acb-bed-status-free">פנויה</span>
      )}
      {selected && <CheckCircle2 size={14} className="acb-check" />}
    </button>
  );
}

function RoomBlock({ building, apartment, room, selectedBedId, onSelect }) {
  const [open, setOpen] = useState(false);
  if (room.capacity === 1) {
    const bed = (room.beds || [])[0];
    const selected = !!bed && bed.bed_id === selectedBedId;
    const selectable = !!bed && bed.is_selectable && !bed.is_occupied;
    return (
      <button
        type="button"
        className={`acb-room acb-room-single${selected ? ' acb-room-selected' : ''}`}
        disabled={!selectable}
        onClick={() => bed && onSelect(selected ? null : buildBedSelection(building, apartment, room, bed))}
      >
        <span className={`acb-radio${selected ? ' acb-radio-on' : ''}`} aria-hidden="true" />
        <DoorOpen size={12} />
        <span className="acb-room-name">חדר {room.room_name}</span>
        <span className="acb-dim">מקום יחיד</span>
        {selectable ? (
          <span className="acb-bed-status acb-bed-status-free">פנוי</span>
        ) : (
          <span className="acb-bed-status acb-bed-status-occ">תפוס{bed?.occupant_name ? ` · ${bed.occupant_name}` : ''}</span>
        )}
        {selected && <CheckCircle2 size={14} className="acb-check" />}
      </button>
    );
  }

  const containsSelection = (room.beds || []).some((b) => b.bed_id === selectedBedId);
  return (
    <div className={`acb-room-multi${containsSelection ? ' acb-room-has-selection' : ''}`}>
      <button type="button" className="acb-room-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <DoorOpen size={12} />
        <span className="acb-room-name">חדר {room.room_name}</span>
        <span className="acb-dim">{room.available_beds_count} מתוך {room.capacity} מיטות פנויות</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="acb-bed-list">
          {(room.beds || []).map((bed) => (
            <BedRow
              key={bed.bed_id} building={building} apartment={apartment} room={room} bed={bed}
              selected={bed.bed_id === selectedBedId} onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApartmentBlock({ building, apartment, selectedBedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const containsSelection = (apartment.rooms || []).some((r) => (r.beds || []).some((b) => b.bed_id === selectedBedId));
  return (
    <div className={`acb-apartment${containsSelection ? ' acb-apartment-has-selection' : ''}`}>
      <button type="button" className="acb-apartment-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="acb-apt-title">דירה {apartment.apartment_number}</span>
        <span className="acb-dim">{(apartment.residents || []).length} דיירים</span>
        <StatusPill status={apartment.assisted_status} />
        <span className="acb-free">{apartment.available_bed_count} פנויות</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {!open && <ApartmentReasonLine apartment={apartment} />}
      {open && (
        <div className="acb-rooms">
          <ApartmentReasonLine apartment={apartment} />
          {(apartment.residents || []).length > 0 && (
            <div className="acb-residents">
              <span className="acb-residents-title">דיירים קיימים:</span>
              {apartment.residents.map((r) => (
                <span key={r.id} className="acb-resident-chip"><User size={10} /> {r.full_name}</span>
              ))}
            </div>
          )}
          {(apartment.rooms || []).map((room) => (
            <RoomBlock
              key={room.room_id} building={building} apartment={apartment} room={room}
              selectedBedId={selectedBedId} onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BuildingCard({ building, selectedBedId, onSelect, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="acb-building">
      <button type="button" className="acb-building-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Building2 size={15} />
        <span className="acb-building-title">בניין {building.building_number ?? building.building_name}</span>
        <span className="acb-dim">
          {building.apartment_count} דירות · {building.room_count} חדרים · {building.available_bed_count} מיטות פנויות
        </span>
        <StatusPill status={building.assisted_status} />
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && (
        <div className="acb-apartments">
          {(building.apartments || []).map((a) => (
            <ApartmentBlock
              key={a.apartment_id} building={building} apartment={a}
              selectedBedId={selectedBedId} onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssistedCandidateBrowser({ candidates, selectedBedId, onSelectBed }) {
  const [tier, setTier] = useState('all');
  const [search, setSearch] = useState('');

  const buildings = candidates?.buildings || [];
  const counts = candidates?.assisted_status_counts || { recommended: 0, possible: 0, override_required: 0 };

  const filtered = useMemo(() => {
    let list = buildings;
    if (tier !== 'all') {
      list = list
        .map((b) => ({ ...b, apartments: (b.apartments || []).filter((a) => a.assisted_status === tier) }))
        .filter((b) => b.apartments.length > 0);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list
        .map((b) => ({
          ...b,
          apartments: (b.apartments || []).filter((a) =>
            String(b.building_number ?? '').toLowerCase().includes(q) ||
            String(a.apartment_number ?? '').toLowerCase().includes(q) ||
            (a.rooms || []).some((r) => String(r.room_name ?? '').toLowerCase().includes(q))
          ),
        }))
        .filter((b) => b.apartments.length > 0);
    }
    return list;
  }, [buildings, tier, search]);

  if (buildings.length === 0) {
    return (
      <div className="acb-empty">
        <AlertTriangle size={24} />
        <p>לא נמצאו מיטות פנויות בסוג המעונות שאליו הסטודנט/ית התקבל/ה</p>
      </div>
    );
  }

  return (
    <div className="acb-root">
      <div className="acb-toolbar">
        <div className="acb-filters">
          {[
            ['all', `הכול (${candidates.total_valid_beds})`],
            ['recommended', `מומלץ (${counts.recommended})`],
            ['possible', `אפשרי (${counts.possible})`],
            ['override_required', `דורש חריגה (${counts.override_required})`],
          ].map(([key, label]) => (
            <button
              key={key} type="button"
              className={`acb-chip${tier === key ? ' acb-chip-active' : ''}`}
              onClick={() => setTier(key)}
              disabled={key !== 'all' && counts[key] === 0}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="acb-search">
          <Search size={13} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש בניין / דירה / חדר..." />
        </div>
      </div>

      <div className="acb-summary">
        {candidates.total_buildings} בניינים · {candidates.total_apartments} דירות · {candidates.total_rooms} חדרים · {candidates.total_valid_beds} מיטות פנויות
      </div>

      {filtered.length === 0 ? (
        <div className="acb-empty acb-empty-inline">
          <AlertTriangle size={20} />
          <p>אין תוצאות עבור הסינון הנוכחי</p>
        </div>
      ) : (
        <div className="acb-buildings">
          {filtered.map((b, i) => (
            <BuildingCard
              key={b.building_id} building={b} selectedBedId={selectedBedId} onSelect={onSelectBed}
              defaultOpen={filtered.length === 1 || (i === 0 && !!selectedBedId)}
            />
          ))}
        </div>
      )}

      <style>{ACB_STYLES}</style>
    </div>
  );
}

const ACB_STYLES = `
  .acb-root { display:flex; flex-direction:column; gap:12px; }
  .acb-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .acb-filters { display:flex; gap:6px; flex-wrap:wrap; }
  .acb-chip { border:1px solid #dfe1e6; background:#fff; border-radius:999px; padding:6px 14px; font-size:12.5px; font-weight:600; cursor:pointer; color:#42526e; font-family:inherit; }
  .acb-chip:hover:not(:disabled) { border-color:#97a0af; }
  .acb-chip:disabled { opacity:0.45; cursor:not-allowed; }
  .acb-chip-active { background:#172b4d; color:#fff; border-color:#172b4d; }
  .acb-search { display:flex; align-items:center; gap:6px; background:#f4f5f7; border-radius:8px; padding:7px 10px; min-width:200px; }
  .acb-search input { border:none; background:none; outline:none; font-size:13px; width:100%; font-family:inherit; }
  .acb-summary { font-size:12.5px; color:#5e6c84; font-weight:600; }

  .acb-pill { border-radius:999px; padding:3px 10px; font-size:11.5px; font-weight:800; white-space:nowrap; }
  .acb-dim { color:#5e6c84; font-weight:500; font-size:12.5px; }
  .acb-free { margin-inline-start:auto; font-size:12px; color:#006644; font-weight:700; white-space:nowrap; }

  .acb-buildings { display:flex; flex-direction:column; gap:10px; }
  .acb-building { border:1px solid #ebecf0; border-radius:12px; overflow:hidden; }
  .acb-building-head { width:100%; display:flex; align-items:center; gap:9px; padding:12px 14px; background:#f8f9fb; font-size:13.5px; font-weight:700; color:#172b4d; border:none; cursor:pointer; text-align:inherit; font-family:inherit; }
  .acb-building-head:hover { background:#f4f5f7; }
  .acb-building-title { font-weight:800; white-space:nowrap; }

  .acb-apartments { display:flex; flex-direction:column; }
  .acb-apartment { border-top:1px solid #f4f5f7; }
  .acb-apartment-has-selection { background:#f0f7ff; }
  .acb-apartment-head { width:100%; display:flex; align-items:center; gap:9px; padding:10px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; text-align:inherit; font-family:inherit; }
  .acb-apartment-head:hover { background:#f8f9fb; }
  .acb-apt-title { font-weight:700; color:#172b4d; }
  .acb-apt-reasonline { display:flex; flex-wrap:wrap; gap:4px 12px; padding:0 14px 8px 14px; }
  .acb-reason-good, .acb-reason-warn, .acb-reason-violation { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; }
  .acb-reason-good { color:#006644; }
  .acb-reason-warn { color:#974f0c; }
  .acb-reason-violation { color:#ae2e24; }

  .acb-rooms { display:flex; flex-direction:column; gap:8px; padding:0 14px 12px 14px; }
  .acb-residents { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:12px; }
  .acb-residents-title { color:#5e6c84; font-weight:600; }
  .acb-resident-chip { display:inline-flex; align-items:center; gap:4px; background:#f4f5f7; color:#42526e; border-radius:8px; padding:3px 8px; font-weight:600; }

  .acb-room-multi { border:1px solid #ebecf0; border-radius:9px; overflow:hidden; }
  .acb-room-has-selection { border-color:#4c9aff; }
  .acb-room-head { width:100%; display:flex; align-items:center; gap:8px; padding:9px 12px; background:#fafbfc; border:none; cursor:pointer; font-size:12.5px; text-align:inherit; font-family:inherit; }
  .acb-room-head:hover { background:#f4f5f7; }
  .acb-room-name { font-weight:700; color:#172b4d; white-space:nowrap; }
  .acb-room-single { width:100%; display:flex; align-items:center; gap:8px; padding:9px 12px; background:#fff; border:1px solid #ebecf0; border-radius:9px; cursor:pointer; font-size:12.5px; text-align:inherit; font-family:inherit; }
  .acb-room-single:hover:not(:disabled) { border-color:#97a0af; }
  .acb-room-single:disabled { opacity:0.55; cursor:not-allowed; }
  .acb-room-selected { border-color:#4c9aff; background:#deebff; }

  .acb-bed-list { display:flex; flex-direction:column; gap:6px; padding:8px; }
  .acb-bed-row { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid #ebecf0; border-radius:8px; background:#fff; cursor:pointer; font-size:12.5px; text-align:inherit; width:100%; font-family:inherit; }
  .acb-bed-row:hover:not(:disabled) { border-color:#97a0af; }
  .acb-bed-row:disabled { cursor:not-allowed; }
  .acb-bed-row-occupied { opacity:0.55; background:#f8f9fb; }
  .acb-bed-row-selected { border-color:#4c9aff; background:#deebff; }
  .acb-radio { width:13px; height:13px; border-radius:50%; border:2px solid #c1c7d0; flex-shrink:0; }
  .acb-radio-on { border-color:#0052cc; background:radial-gradient(circle, #0052cc 40%, transparent 44%); }
  .acb-bed-label { font-weight:700; color:#172b4d; white-space:nowrap; }
  .acb-bed-status { font-size:11.5px; font-weight:700; color:#97a0af; margin-inline-start:auto; }
  .acb-bed-status-free { color:#006644; }
  .acb-bed-status-occ { color:#ae2e24; }
  .acb-check { color:#0052cc; }

  .acb-empty { display:flex; flex-direction:column; align-items:center; gap:8px; padding:30px 16px; color:#5e6c84; text-align:center; font-size:13.5px; }
  .acb-empty-inline { padding:20px 16px; }
`;
