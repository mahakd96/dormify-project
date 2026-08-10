import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2, DoorOpen, BedDouble, Star, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Search, RotateCcw, CheckCircle2, History,
  MapPin, Home, User,
} from 'lucide-react';

// Hierarchical placement picker over the backend matching service
// (find_matching_room_options). The server paginates BUILDINGS (by primary
// key) and every loaded building carries its complete subtree, so the UI is
// a true accordion:
//
//   Building  →  Apartment  →  Room  →  Bed
//
// Used by both the Students page (assign/reassign) and the Transfers page
// (request feasibility / add-student allocation) so there is exactly one
// "available options" UI.
//
// Invariants this component maintains:
// - `buildings` is append-only input; loading more never replaces or
//   reorders what is already on screen.
// - Filter chips are pure derived rendering - switching chips never
//   destroys loaded data, so All → Recommended is instant.
// - Expansion state lives in Sets keyed by REAL database ids
//   (building_id / apartment_id / room_id), so appended pages and filter
//   switches never collapse what the user opened.
// - There is NO automatic load-on-scroll: the single visible
//   "הצג בניינים נוספים" button is the only way more data is requested.
// - Skeleton rows exist only while a real request is pending.
// - No percentages anywhere - only recommendation labels + reasons.

const RECOMMENDATION_CFG = {
  best: { color: '#15803d', bg: '#dcfce7', border: '#86efac' },
  good: { color: '#0f766e', bg: '#ccfbf1', border: '#5eead4' },
  valid: { color: '#1d4ed8', bg: '#dbeafe', border: '#93c5fd' },
  warning: { color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
  unavailable: { color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' },
};

const GENDER_LABEL = { male: 'זכרים', female: 'נקבות', mixed: 'מעורב' };

// UI-side display overrides for backend warning codes. The CODE comes from
// the server (real matching result); only the wording is adjusted here.
const WARNING_DISPLAY = {
  religion_conflict: 'אזהרה: דירה עם דיירים מדתות שונות — ניתן לשיבוץ, אך קיימת שונות דתית בדירה',
};
const warningLabel = (r) => WARNING_DISPLAY[r.code] || r.label;

// FUTURE WORK (documented, intentionally NOT implemented yet): a layered
// advanced scoring pass on top of the current hard-constraints + reasons
// model - direct roommate requests, student transfer history, similarity by
// study points / allocation group / city, and archetype matching. Until
// then, recommendations stay limited to the real fields the backend already
// returns (recommendation_level + matched_reasons/warnings/historical_reasons).

// "Bed 2" (DB label) → "2" for Hebrew display; unknown formats pass through.
export function bedDisplayLabel(label) {
  if (!label) return '';
  const m = /^bed\s*(.+)$/i.exec(String(label).trim());
  return m ? m[1] : String(label);
}

// The selection handed to onSelectBed always carries the COMPLETE location
// path (region → building → apartment → room → bed) plus the reasons, so
// every consumer (summary card, confirm button, request submission) can
// show where the bed is without re-walking the tree.
export function buildBedSelection(building, apartment, room, bed) {
  return {
    bed_id: bed.bed_id,
    bed_label: bed.bed_label,
    bed_display: bedDisplayLabel(bed.bed_label),
    room_id: room.room_id,
    room: room.room_name,
    room_name: room.room_name,
    room_capacity: room.capacity,
    occupied_beds: room.occupied_beds_count,
    available_beds: room.available_beds_count,
    single_bed_room: room.capacity === 1,
    apartment_id: apartment.apartment_id,
    apartment: apartment.apartment_number,
    apartment_gender: apartment.apartment_gender,
    building_id: building.building_id,
    building: building.building_number ?? building.building_name,
    building_name: building.building_name,
    region_name: building.region_name,
    dorm_type: building.dorm_type,
    recommendation_level: apartment.recommendation_level,
    recommendation_label: apartment.recommendation_label,
    matched_reasons: apartment.matched_reasons || [],
    warnings: apartment.warnings || [],
    historical_reasons: apartment.historical_reasons || [],
    // A selection can only ever be built from a selectable bed - kept as an
    // explicit field for consumers that gate their confirm button on it.
    is_selectable: true,
  };
}

// Append the next building page onto the already-loaded list, keyed by the
// building PRIMARY KEY: a building can never appear twice (e.g. when a
// concurrent data change shifts the backend's ordering between pages), and
// existing entries are never replaced - so expansion state, selection and
// scroll position all survive every "load more". Shared by every parent of
// this picker (Students assign/reassign, Transfers/Requests, add-student).
export function mergeBuildings(prev = [], next = []) {
  const seen = new Set(prev.map((b) => b.building_id));
  return [...prev, ...next.filter((b) => !seen.has(b.building_id))];
}

// Full-path confirm-button label, e.g.
// "שבץ למיטה 1 בחדר 2, דירה 3, בניין 105".
export function assignActionLabel(sel) {
  if (!sel) return 'אשר ושבץ';
  const path = `בחדר ${sel.room}, דירה ${sel.apartment}, בניין ${sel.building}`;
  if (sel.single_bed_room) return `שבץ למקום היחיד ${path}`;
  return `שבץ למיטה ${sel.bed_display || bedDisplayLabel(sel.bed_label)} ${path}`;
}

function ReasonList({ items, icon: Icon, tone }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className={`bmp-reason-list bmp-reason-${tone}`}>
      {items.map((r, i) => (
        <li key={r.code || i}>
          <Icon size={12} />
          <span>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

function RecommendationPill({ level, label }) {
  const cfg = RECOMMENDATION_CFG[level] || RECOMMENDATION_CFG.valid;
  if (!label) return null;
  return (
    <span className="bmp-pill" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {label}
    </span>
  );
}

function BedRow({ building, apartment, room, bed, selected, onSelect, isHe }) {
  const display = bedDisplayLabel(bed.bed_label);
  const occupied = bed.is_occupied;
  const selectable = bed.is_selectable && !occupied;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`bmp-bed-row${selected ? ' bmp-bed-row-selected' : ''}${occupied ? ' bmp-bed-row-occupied' : ''}`}
      disabled={!selectable}
      onClick={() => onSelect(selected ? null : buildBedSelection(building, apartment, room, bed))}
    >
      <span className={`bmp-bed-radio${selected ? ' bmp-bed-radio-on' : ''}`} aria-hidden="true" />
      <BedDouble size={14} />
      <span className="bmp-bed-name">{isHe ? `מיטה ${display}` : `Bed ${display}`}</span>
      {occupied ? (
        <span className="bmp-bed-status bmp-bed-status-occupied">
          {isHe ? 'תפוסה' : 'Occupied'}{bed.occupant_name ? ` · ${bed.occupant_name}` : ''}
        </span>
      ) : selectable ? (
        <span className="bmp-bed-status bmp-bed-status-free">{isHe ? 'פנויה' : 'Free'}</span>
      ) : (
        <span className="bmp-bed-status">{isHe ? 'לא זמינה' : 'Unavailable'}</span>
      )}
      {selected && <CheckCircle2 size={15} className="bmp-bed-check" aria-hidden="true" />}
    </button>
  );
}

function RoomRow({ building, apartment, room, expanded, onToggle, selectedBedId, onSelect, isHe }) {
  const freeCount = room.available_beds_count;
  const isFull = freeCount === 0 && room.occupied_beds_count >= room.capacity;
  const missingRecords = room.missing_bed_records > 0;
  const singleBed = room.capacity === 1;
  const containsSelection = (room.beds || []).some((b) => b.bed_id === selectedBedId);

  // A one-bed room is itself the selectable unit: clicking it selects its
  // single real bed directly (no extra expansion level for one bed).
  if (singleBed) {
    const onlyBed = (room.beds || [])[0] || null;
    const selected = !!onlyBed && onlyBed.bed_id === selectedBedId;
    const selectable = !!onlyBed && onlyBed.is_selectable && !onlyBed.is_occupied;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        className={`bmp-room bmp-room-single${selected ? ' bmp-room-selected' : ''}`}
        disabled={!selectable}
        onClick={() => onlyBed && onSelect(selected ? null : buildBedSelection(building, apartment, room, onlyBed))}
      >
        <span className={`bmp-bed-radio${selected ? ' bmp-bed-radio-on' : ''}`} aria-hidden="true" />
        <DoorOpen size={13} />
        <span className="bmp-room-name">{isHe ? `חדר ${room.room_name}` : `Room ${room.room_name}`}</span>
        <span className="bmp-dim">{isHe ? 'מקום אחד' : 'Single place'}</span>
        {missingRecords ? (
          <span className="bmp-integrity">{isHe ? 'חסרה רשומת מיטה (בעיית נתונים)' : 'Missing bed record (data issue)'}</span>
        ) : isFull || !onlyBed || onlyBed.is_occupied ? (
          <span className="bmp-bed-status bmp-bed-status-occupied">
            {isHe ? 'תפוס' : 'Occupied'}{onlyBed?.occupant_name ? ` · ${onlyBed.occupant_name}` : ''}
          </span>
        ) : (
          <span className="bmp-bed-status bmp-bed-status-free">{isHe ? 'מקום פנוי אחד' : 'One free place'}</span>
        )}
        {selected && <CheckCircle2 size={15} className="bmp-bed-check" aria-hidden="true" />}
      </button>
    );
  }

  const occupancyText = isFull
    ? (isHe ? `תפוסה מלאה: ${room.occupied_beds_count} מתוך ${room.capacity}` : `Full: ${room.occupied_beds_count}/${room.capacity}`)
    : (isHe ? `${freeCount} מתוך ${room.capacity} מיטות פנויות` : `${freeCount} of ${room.capacity} beds free`);

  return (
    <div className={`bmp-room${containsSelection ? ' bmp-room-has-selection' : ''}`}>
      <button
        type="button"
        className="bmp-room-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <DoorOpen size={13} />
        <span className="bmp-room-name">{isHe ? `חדר ${room.room_name}` : `Room ${room.room_name}`}</span>
        <span className={`bmp-dim${isFull ? ' bmp-full-text' : ''}`}>{occupancyText}</span>
        {missingRecords && (
          <span className="bmp-integrity">
            {isHe ? `חסרות ${room.missing_bed_records} רשומות מיטה` : `${room.missing_bed_records} missing bed records`}
          </span>
        )}
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {expanded && (
        <div className="bmp-bed-list" role="radiogroup"
          aria-label={isHe ? `בחר מיטה בחדר ${room.room_name}` : `Select a bed in room ${room.room_name}`}>
          {(room.beds || []).length === 0 ? (
            <div className="bmp-integrity bmp-integrity-block">
              {isHe ? 'לא קיימות רשומות מיטה לחדר זה (בעיית נתונים).' : 'No bed records exist for this room (data issue).'}
            </div>
          ) : (
            room.beds.map((bed) => (
              <BedRow
                key={bed.bed_id}
                building={building} apartment={apartment} room={room} bed={bed}
                selected={bed.bed_id === selectedBedId}
                onSelect={onSelect}
                isHe={isHe}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ApartmentRow({ building, apartment, expanded, onToggle, expandedRooms, onToggleRoom, selectedBedId, onSelect, isHe, t }) {
  const genderLabel = GENDER_LABEL[apartment.apartment_gender] || apartment.apartment_gender;
  const residents = apartment.residents || [];
  // Compact "why is this recommended" line, shown even when collapsed -
  // built ONLY from the real backend reason labels (matched_reasons /
  // warnings), never invented client-side.
  const reasonSummary = (apartment.matched_reasons || []).slice(0, 2).map((r) => r.label);
  const firstWarning = (apartment.warnings || [])[0] ? warningLabel(apartment.warnings[0]) : null;
  return (
    <div className="bmp-apartment">
      <button type="button" className="bmp-apartment-head" onClick={onToggle} aria-expanded={expanded}
        title={[...(apartment.matched_reasons || []), ...(apartment.warnings || [])].map((r) => r.label).join(' · ') || undefined}>
        {apartment.recommendation_level === 'best' && <Star size={11} fill="currentColor" className="bmp-star" />}
        <span className="bmp-apt-title">{isHe ? `דירה ${apartment.apartment_number}` : `Apt ${apartment.apartment_number}`}</span>
        {genderLabel && <span className="bmp-dim">{genderLabel}</span>}
        <span className="bmp-dim">{residents.length} {t.residentsWord}</span>
        <RecommendationPill level={apartment.recommendation_level} label={apartment.recommendation_label} />
        {apartment.has_roommate_match && <span className="bmp-pill bmp-pill-roommate">{t.roommateHere}</span>}
        <span className="bmp-free">{apartment.available_bed_count} {t.beds}</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {!expanded && (reasonSummary.length > 0 || firstWarning) && (
        <div className="bmp-apt-reasonline">
          {reasonSummary.length > 0 && (
            <span className="bmp-reasonline-good"><CheckCircle2 size={12} /> {reasonSummary.join(' · ')}</span>
          )}
          {firstWarning && (
            <span className="bmp-reasonline-warn"><AlertTriangle size={12} /> {firstWarning}</span>
          )}
        </div>
      )}

      {expanded && (
        <div className="bmp-rooms">
          {(apartment.matched_reasons?.length > 0 || apartment.warnings?.length > 0 || apartment.historical_reasons?.length > 0) && (
            <div className="bmp-apt-reasons">
              <ReasonList items={apartment.matched_reasons} icon={CheckCircle2} tone="good" />
              <ReasonList items={(apartment.warnings || []).map((w) => ({ ...w, label: warningLabel(w) }))} icon={AlertTriangle} tone="warn" />
              {apartment.warnings?.length > 0 && (
                <span className="bmp-warn-allowed">שיבוץ מותר עם אזהרה</span>
              )}
              <ReasonList items={apartment.historical_reasons} icon={History} tone="history" />
            </div>
          )}

          {residents.length > 0 && (
            <div className="bmp-residents">
              <span className="bmp-residents-title">{t.residents}:</span>
              <div className="bmp-resident-list">
                {residents.map((r) => {
                  // Only show religion/sector/city when the system actually
                  // has a real value (never "not specified"/"unknown") -
                  // missing fields are hidden, never invented.
                  const religionTag = (r.religion_display && r.religion !== 'not_specified') ? r.religion_display : null;
                  const sectorTag = (r.sector_display && r.placement_sector !== 'unknown') ? r.sector_display : null;
                  const cityTag = (r.city || '').trim() || null;
                  return (
                    <span key={r.id} className="bmp-resident-chip">
                      <span className="bmp-resident-name"><User size={10} /> {r.full_name}</span>
                      <span className="bmp-resident-tags">
                        {[religionTag, cityTag,
                          r.room_name ? (isHe ? `חדר ${r.room_name}` : `Room ${r.room_name}`) : null,
                          sectorTag]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {(apartment.rooms || []).map((room) => (
            <RoomRow
              key={room.room_id}
              building={building} apartment={apartment} room={room}
              expanded={expandedRooms.has(room.room_id)}
              onToggle={() => onToggleRoom(room.room_id)}
              selectedBedId={selectedBedId}
              onSelect={onSelect}
              isHe={isHe}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BedMatchPicker({
  buildings = [],
  totalBuildings = 0, totalApartments = 0, totalRooms = 0, totalValidBeds = 0,
  counts = null, dataIntegrity = null,
  loading = false, loadingMore = false, hasMore = false, onLoadMore, loadMoreError = '',
  conflictExamples = [],
  selectedBedId = null, onSelectBed,
  language = 'he', error = '', onRetry,
  // 'same_apartment' | 'same_region' | 'cross_region' - lets the empty
  // state explain WHAT was searched and suggest the next step, instead of
  // a generic "no beds found".
  scopeContext = null,
}) {
  const isHe = language === 'he';
  // Chip filtering is derived rendering only - it never mutates or discards
  // the loaded buildings, so switching chips back and forth always restores
  // instantly with zero requests.
  const [filter, setFilter] = useState('recommended');
  // Cross-region results: an extra derived chip row filters the loaded
  // buildings by region. 'all' shows every region.
  const [regionFilter, setRegionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedBuildings, setExpandedBuildings] = useState(() => new Set());
  const [expandedApts, setExpandedApts] = useState(() => new Set());
  const [expandedRooms, setExpandedRooms] = useState(() => new Set());

  const toggleIn = (setter) => (id) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleBuilding = toggleIn(setExpandedBuildings);
  const toggleApt = toggleIn(setExpandedApts);
  const toggleRoom = toggleIn(setExpandedRooms);

  // Locate the selected bed's full path among the loaded buildings.
  const selectedPath = useMemo(() => {
    if (selectedBedId == null) return null;
    for (const b of buildings) {
      for (const a of b.apartments || []) {
        for (const r of a.rooms || []) {
          for (const bed of r.beds || []) {
            if (bed.bed_id === selectedBedId) return { building: b, apartment: a, room: r, bed };
          }
        }
      }
    }
    return null;
  }, [buildings, selectedBedId]);

  // When a selection already exists (e.g. reopening the panel), expand its
  // ancestors once so the selection is visible. Only ever ADDS ids - the
  // user can still collapse anything afterwards without being fought.
  useEffect(() => {
    if (!selectedPath) return;
    const { building, apartment, room } = selectedPath;
    setExpandedBuildings((prev) => (prev.has(building.building_id) ? prev : new Set(prev).add(building.building_id)));
    setExpandedApts((prev) => (prev.has(apartment.apartment_id) ? prev : new Set(prev).add(apartment.apartment_id)));
    if (room.capacity > 1) {
      setExpandedRooms((prev) => (prev.has(room.room_id) ? prev : new Set(prev).add(room.room_id)));
    }
  }, [selectedBedId]); // eslint-disable-line

  // Distinct regions among the LOADED buildings (with loaded-building
  // counts) - drives the region chip row for cross-region results.
  const loadedRegions = useMemo(() => {
    const counts = new Map();
    buildings.forEach((b) => {
      if (b.region_name) counts.set(b.region_name, (counts.get(b.region_name) || 0) + 1);
    });
    return Array.from(counts.entries());
  }, [buildings]);

  const filteredBuildings = useMemo(() => {
    let list = buildings;
    if (regionFilter !== 'all') list = list.filter((b) => b.region_name === regionFilter);
    if (filter === 'recommended') list = list.filter((b) => (b.recommended_bed_count || 0) > 0);
    else if (filter === 'with_roommate') list = list.filter((b) => (b.roommate_bed_count || 0) > 0);
    // "With warnings" = selectable beds the backend allows but flagged
    // (available minus warning-free) - both counts are real server numbers.
    else if (filter === 'with_warnings') list = list.filter((b) => ((b.available_bed_count || 0) - (b.warning_free_bed_count || 0)) > 0);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((b) =>
        String(b.building_number ?? '').toLowerCase().includes(q) ||
        String(b.building_name ?? '').toLowerCase().includes(q) ||
        String(b.region_name ?? '').toLowerCase().includes(q) ||
        String(b.dorm_type ?? '').toLowerCase().includes(q) ||
        (b.apartments || []).some((a) =>
          String(a.apartment_number ?? '').toLowerCase().includes(q) ||
          (a.rooms || []).some((r) => String(r.room_name ?? '').toLowerCase().includes(q))
        )
      );
    }
    return list;
  }, [buildings, filter, regionFilter, search]);

  const c = counts || { all: totalValidBeds, best_match: 0, empty: 0, warning_free: 0, with_roommate: 0 };
  const recommendedCount = (c.best_match || 0) + (c.empty ?? c.fully_empty ?? 0);

  const t = {
    recommended: isHe ? `מומלצות (${recommendedCount})` : `Recommended (${recommendedCount})`,
    withRoommate: isHe ? `עם השותף המבוקש (${c.with_roommate || 0})` : `With requested roommate (${c.with_roommate || 0})`,
    withWarnings: isHe ? `עם אזהרות (${c.with_warnings || 0})` : `With warnings (${c.with_warnings || 0})`,
    all: isHe ? `הכול (${c.all || 0})` : `All (${c.all || 0})`,
    search: isHe ? 'חיפוש בניין / דירה / חדר...' : 'Search building/apartment/room...',
    summary: isHe
      ? `${totalBuildings} בניינים · ${totalApartments} דירות · ${totalRooms} חדרים · ${totalValidBeds} מיטות פנויות`
      : `${totalBuildings} buildings · ${totalApartments} apartments · ${totalRooms} rooms · ${totalValidBeds} available beds`,
    showingOf: (loaded, total) => (isHe ? `מוצגים ${loaded} מתוך ${total} בניינים` : `Showing ${loaded} of ${total} buildings`),
    loadMoreBuildings: isHe ? 'הצג בניינים נוספים' : 'Show more buildings',
    loadingBuildings: isHe ? 'טוען בניינים נוספים...' : 'Loading more buildings...',
    allLoaded: isHe ? 'כל הבניינים נטענו' : 'All buildings loaded',
    loadMoreFailed: isHe ? 'טעינת בניינים נוספים נכשלה' : 'Failed to load more buildings',
    retry: isHe ? 'נסה שוב' : 'Retry',
    noOptions: isHe ? 'לא נמצאו מיטות פנויות התואמות לכללי החובה.' : 'No available beds match the hard constraints.',
noOptionsForFilter: isHe
  ? 'לא נמצאו בניינים תחת הסינון הנוכחי'
  : 'No buildings found for the current filter.',
showAllInstead: isHe ? 'הצגת בניינים אפשריים' : 'Show available buildings',
    whyNot: isHe ? 'אפשרויות שאינן זמינות' : 'Unavailable options',
    residents: isHe ? 'דיירים קיימים בדירה' : 'Current residents in apartment',
    residentsWord: isHe ? 'דיירים' : 'residents',
    beds: isHe ? 'פנויות' : 'free',
    apartmentsWord: isHe ? 'דירות' : 'apartments',
    roomsWord: isHe ? 'חדרים' : 'rooms',
    searching: isHe ? 'מחפש אפשרויות שיבוץ מתאימות...' : 'Searching for matching options...',
    errorTitle: isHe ? 'שגיאה בטעינת אפשרויות השיבוץ' : 'Failed to load assignment options',
    yourSelection: isHe ? 'הבחירה שלך:' : 'Your selection:',
    regionWord: isHe ? 'אזור' : 'Region',
    buildingWord: isHe ? 'בניין' : 'Building',
    apartmentWord: isHe ? 'דירה' : 'Apartment',
    roomWord: isHe ? 'חדר' : 'Room',
    bedWord: isHe ? 'מיטה' : 'Bed',
    singlePlace: isHe ? 'מקום יחיד' : 'Single place',
    reasonsTitle: isHe ? 'סיבות להמלצה:' : 'Reasons:',
    warningsTitle: isHe ? 'אזהרות:' : 'Warnings:',
    noWarnings: isHe ? 'אין אזהרות' : 'No warnings',
    clearSelection: isHe ? 'נקה בחירה' : 'Clear',
    roommateHere: isHe ? 'עם השותף/ה המבוקש/ת' : 'Roommate match',
    integrityNote: (rooms, bedsN) => (isHe
      ? `בעיית נתונים: ב-${rooms} חדרים חסרות רשומות מיטה (${bedsN} מיטות) - הם אינם זמינים לשיבוץ עד הרצת תהליך אתחול ייעודי.`
      : `Data issue: ${rooms} rooms are missing bed records (${bedsN} beds) - unavailable until an explicit setup operation runs.`),
  };

  if (error) {
    return (
      <div className="bmp-error">
        <XCircle size={28} />
        <p className="bmp-error-title">{t.errorTitle}</p>
        <p className="bmp-error-detail">{error}</p>
        {onRetry && (
          <button type="button" className="bmp-retry-btn" onClick={onRetry}>
            <RotateCcw size={13} /> {t.retry}
          </button>
        )}
        <style>{BMP_STYLES}</style>
      </div>
    );
  }

  // Skeletons ONLY while the initial request is pending - the moment
  // loading turns false this branch is unreachable, so no skeleton can
  // ever persist.
  if (loading && buildings.length === 0) {
    return (
      <div className="bmp-skeleton">
        <div className="bmp-searching-note">{t.searching}</div>
        {[1, 2, 3].map((i) => <div key={i} className="bmp-skeleton-row" />)}
        <style>{BMP_STYLES}</style>
      </div>
    );
  }

  // Scope-aware empty-state wording: the search itself is server-side; this
  // only explains what WAS searched and what the user can do next.
  const scopeEmptyCfg = {
    same_apartment: {
      msg: isHe ? 'אין מיטות פנויות בדירה הנוכחית - כל החדרים בדירה זו מלאים.' : 'No free beds in the current apartment - every room is full.',
      hint: isHe ? 'ניתן ליצור בקשת מעבר לדירה אחרת באותו אזור, או מעבר לאזור אחר, במקום שינוי חדר.' : 'Consider a different-apartment transfer in the same region, or a cross-region transfer, instead of a room change.',
    },
    same_region: {
      msg: isHe ? 'לא נמצאו מיטות פנויות באזור הנוכחי במסגרת בקשה זו.' : 'No free beds found in the current region for this request.',
      hint: isHe ? 'ניתן לנסות בקשת מעבר לאזור אחר.' : 'Consider a cross-region transfer.',
    },
    cross_region: {
      msg: isHe ? 'לא נמצאו מיטות פנויות באזור היעד שנבחר.' : 'No free beds found in the selected target region.',
      hint: isHe ? 'ניתן לבחור אזור יעד אחר בבקשה חדשה.' : 'Consider a different target region in a new request.',
    },
  }[scopeContext] || null;

  if (!loading && buildings.length === 0) {
    return (
      <div className="bmp-empty">
        <AlertTriangle size={28} />
        <p>{scopeEmptyCfg ? scopeEmptyCfg.msg : t.noOptions}</p>
        {scopeEmptyCfg && <p className="bmp-empty-hint">{scopeEmptyCfg.hint}</p>}
        {dataIntegrity?.missing_bed_records > 0 && (
          <p className="bmp-integrity bmp-integrity-block">
            {t.integrityNote(dataIntegrity.rooms_missing_bed_records, dataIntegrity.missing_bed_records)}
          </p>
        )}
        {conflictExamples.length > 0 && (
          <div className="bmp-conflicts">
            <span className="bmp-conflicts-title">{t.whyNot}</span>
            {conflictExamples.map((cEx, i) => (
              <div key={cEx.room_id || i} className="bmp-conflict-row">
                <XCircle size={13} />
                <span>
                  {isHe
                    ? `${cEx.region_name ? `${cEx.region_name} · ` : ''}בניין ${cEx.building} · דירה ${cEx.apartment} · חדר ${cEx.room}`
                    : `${cEx.region_name ? `${cEx.region_name} · ` : ''}Building ${cEx.building} · Apt ${cEx.apartment} · Room ${cEx.room}`}
                </span>
                <span className="bmp-conflict-reasons">{(cEx.conflicts || []).join('; ')}</span>
              </div>
            ))}
          </div>
        )}
        <style>{BMP_STYLES}</style>
      </div>
    );
  }

  const sel = selectedPath
    ? buildBedSelection(selectedPath.building, selectedPath.apartment, selectedPath.room, selectedPath.bed)
    : null;

  return (
    <div className="bmp-root">
<div className="bmp-section-head">
  <div>
    <h3 className="bmp-section-title">אפשרויות שיבוץ זמינות</h3>
    <p className="bmp-section-sub">
      בחרי בניין, דירה, חדר ומיטה המתאימים לסטודנט
    </p>
  </div>
</div>

      <div className="bmp-summary-grid">
        <div className="bmp-summary-card">
          <Building2 size={16}/>
          <div>
            <strong>{totalBuildings}</strong>
            <span>בניינים</span>
          </div>
        </div>

        <div className="bmp-summary-card">
          <DoorOpen size={16}/>
          <div>
            <strong>{totalApartments}</strong>
            <span>דירות</span>
          </div>
        </div>

        <div className="bmp-summary-card">
          <Home size={16}/>
          <div>
            <strong>{totalRooms}</strong>
            <span>חדרים</span>
          </div>
        </div>

        <div className="bmp-summary-card bmp-summary-card-free">
          <BedDouble size={16}/>
          <div>
            <strong>{totalValidBeds}</strong>
            <span>מיטות פנויות</span>
          </div>
        </div>
      </div>
      {dataIntegrity?.missing_bed_records > 0 && (
        <div className="bmp-integrity bmp-integrity-banner">
          <AlertTriangle size={13} />
          {t.integrityNote(dataIntegrity.rooms_missing_bed_records, dataIntegrity.missing_bed_records)}
        </div>
      )}

      <div className="bmp-toolbar">
        <div className="bmp-filters">
          {[
            ['recommended', t.recommended], ['with_roommate', t.withRoommate],
            ['with_warnings', t.withWarnings], ['all', t.all],
          ].map(([key, label]) => (
            <button
              key={key} type="button"
              className={`bmp-chip${filter === key ? ' bmp-chip-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="bmp-search">
          <Search size={13} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} aria-label={t.search} />
        </div>
      </div>

      {/* Region chips - only when the loaded results span more than one
          region (cross-region transfers). Pure derived filtering: never
          discards loaded data, survives load-more untouched. */}
      {loadedRegions.length > 1 && (
        <div className="bmp-region-chips" role="group" aria-label={isHe ? 'סינון לפי אזור' : 'Filter by region'}>
          <MapPin size={13} className="bmp-region-ico" />
          <button
            type="button"
            className={`bmp-chip bmp-chip-sm${regionFilter === 'all' ? ' bmp-chip-active' : ''}`}
            onClick={() => setRegionFilter('all')}
          >
            {isHe ? `כל האזורים (${buildings.length})` : `All regions (${buildings.length})`}
          </button>
          {loadedRegions.map(([name, count]) => (
            <button
              key={name} type="button"
              className={`bmp-chip bmp-chip-sm${regionFilter === name ? ' bmp-chip-active' : ''}`}
              onClick={() => setRegionFilter(name)}
            >
              {name} ({count})
            </button>
          ))}
        </div>
      )}

      {sel && (
        <div className="bmp-selection-card">
          <div className="bmp-selection-head">
            <CheckCircle2 size={16} />
            <span>{t.yourSelection}</span>
            <button type="button" className="bmp-clear-selection" onClick={() => onSelectBed && onSelectBed(null)}>
              <XCircle size={12} /> {t.clearSelection}
            </button>
          </div>
          <div className="bmp-selection-path">
            {sel.region_name && <span className="bmp-sel-line"><MapPin size={12} /> {t.regionWord}: {sel.region_name}{sel.dorm_type ? ` · ${sel.dorm_type}` : ''}</span>}
            <span className="bmp-sel-line"><Building2 size={12} /> {t.buildingWord}: {sel.building}</span>
            <span className="bmp-sel-line"><DoorOpen size={12} /> {t.apartmentWord}: {sel.apartment}</span>
            <span className="bmp-sel-line"><Home size={12} /> {t.roomWord}: {sel.room}</span>
            <span className="bmp-sel-line">
              <BedDouble size={12} /> {t.bedWord}: {sel.single_bed_room ? t.singlePlace : sel.bed_display}
            </span>
          </div>
          <div className="bmp-selection-reasons">
            <span className="bmp-selection-subtitle">{t.reasonsTitle}</span>
            {(sel.matched_reasons.length > 0 || sel.historical_reasons.length > 0) ? (
              <>
                <ReasonList items={sel.matched_reasons} icon={CheckCircle2} tone="good" />
                <ReasonList items={sel.historical_reasons} icon={History} tone="history" />
              </>
            ) : (
              <span className="bmp-selection-none">—</span>
            )}
          </div>
          <div className="bmp-selection-reasons">
            <span className="bmp-selection-subtitle">{t.warningsTitle}</span>
            {sel.warnings.length > 0 ? (
              <>
                <ReasonList items={sel.warnings.map((w) => ({ ...w, label: warningLabel(w) }))} icon={AlertTriangle} tone="warn" />
                <span className="bmp-warn-allowed">שיבוץ מותר עם אזהרה</span>
              </>
            ) : (
              <span className="bmp-selection-none">{t.noWarnings}</span>
            )}
          </div>
        </div>
      )}

      {/* THE one scrollable region - summary/filters/selection above never
          scroll; buildings through the load-more footer live inside it. */}
      <div className="bmp-buildings" tabIndex={0} role="region" aria-label={isHe ? 'תוצאות שיבוץ' : 'Assignment results'}>
        {filteredBuildings.length === 0 ? (
            <div className="bmp-empty bmp-empty-inline">
              {filter !== 'all' && (
                  <button
                      type="button"
                      className="bmp-load-more"
                      onClick={() => setFilter('all')}
                  >
                    {t.showAllInstead}
                  </button>
              )}
            </div>
        ) : (
            filteredBuildings.map((b) => {
              const isOpen = expandedBuildings.has(b.building_id);
              return (
                  <div key={b.building_id} className="bmp-building">
                    <button
                        type="button"
                      className="bmp-building-head"
                      onClick={() => toggleBuilding(b.building_id)}
                      aria-expanded={isOpen}
                  >
                    <div className="bmp-building-main">

                      <div className="bmp-building-icon">
                        <Building2 size={17}/>
                      </div>

                      <div className="bmp-building-info">
                        <div className="bmp-building-name-row">
        <span className="bmp-building-title">
          {b.building_name ||
              (isHe
                  ? `בניין ${b.building_number}`
                  : `Building ${b.building_number}`)}
        </span>

                          <RecommendationPill
                              level={b.recommendation_level}
                              label={b.recommendation_label}
                          />
                        </div>

                        <div className="bmp-building-meta">
                          {b.region_name && <span>{b.region_name}</span>}

                          {b.dorm_type && (
                              <>
                                <span className="bmp-meta-dot">•</span>
                                <span>{b.dorm_type}</span>
                              </>
                          )}

                          <span className="bmp-meta-dot">•</span>

                          <span>
          {b.apartment_count} {t.apartmentsWord}
        </span>

                          <span className="bmp-meta-dot">•</span>

                          <span>
          {b.room_count} {t.roomsWord}
        </span>
                        </div>
                      </div>

                    </div>

                    <div className="bmp-building-side">

                      {b.has_roommate_match && (
                          <span className="bmp-pill bmp-pill-roommate">
        {t.roommateHere}
      </span>
                      )}

                      <span className="bmp-free">
      <BedDouble size={13}/>
                        {b.available_bed_count} {t.beds}
    </span>

                      {isOpen
                          ? <ChevronUp size={16}/>
                          : <ChevronDown size={16}/>
                      }

                    </div>
                  </button>

                  {isOpen && (
                      <div className="bmp-apartments">
                        {(b.apartments || []).map((a) => (
                            <ApartmentRow
                                key={a.apartment_id}
                                building={b} apartment={a}
                                expanded={expandedApts.has(a.apartment_id)}
                                onToggle={() => toggleApt(a.apartment_id)}
                                expandedRooms={expandedRooms}
                                onToggleRoom={toggleRoom}
                                selectedBedId={selectedBedId}
                                onSelect={onSelectBed}
                                isHe={isHe} t={t}
                            />
                        ))}
                      </div>
                  )}
                </div>
            );
          })
        )}

        <div className="bmp-results-footer">
          <span className="bmp-loaded-count">{t.showingOf(buildings.length, totalBuildings)}</span>
          {loadMoreError && (
              <span className="bmp-loadmore-error">
              <AlertTriangle size={12}/> {t.loadMoreFailed}: {loadMoreError}
            </span>
          )}
          {hasMore ? (
              <button
                  type="button"
                  className="bmp-load-more bmp-load-more-primary"
                  onClick={onLoadMore}
                  disabled={loading || loadingMore}
              >
                {loadingMore ? t.loadingBuildings : (loadMoreError ? t.retry : t.loadMoreBuildings)}
              </button>
          ) : (
              buildings.length > 0 && <span className="bmp-all-loaded">{t.allLoaded}</span>
          )}
        </div>
      </div>

      <style>{BMP_STYLES}</style>
    </div>
  );
}

const BMP_STYLES = `
.bmp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bmp-section-title {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  color: #0f172a;
}

.bmp-section-sub {
  margin: 3px 0 0;
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}


/* ── Summary cards ───────────────── */

.bmp-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.bmp-summary-card {
  display: flex;
  align-items: center;
  gap: 9px;

  padding: 10px 12px;

  border: 1px solid #e2e8f0;
  border-radius: 10px;

  background: #f8fafc;

  color: #475569;
}

.bmp-summary-card svg {
  color: #64748b;
  flex-shrink: 0;
}

.bmp-summary-card div {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.bmp-summary-card strong {
  font-size: 17px;
  color: #0f172a;
  font-weight: 800;
}

.bmp-summary-card span {
  font-size: 11.5px;
  color: #64748b;
  font-weight: 600;
}

.bmp-summary-card-free {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.bmp-summary-card-free svg,
.bmp-summary-card-free strong {
  color: #15803d;
}
  .bmp-root { display:flex; flex-direction:column; gap:14px; font-size:15px; min-height:0; flex:1; }
  .bmp-summary { font-size:15px; font-weight:700; color:#334155; }
  .bmp-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .bmp-filters { display:flex; gap:6px; flex-wrap:wrap; }
  .bmp-chip { border:1px solid #e2e8f0; background:white; border-radius:999px; padding:7px 16px; font-size:14px; font-weight:600; cursor:pointer; color:#475569; }
  .bmp-chip:hover { border-color:#94a3b8; }
  .bmp-chip-active { background:#0f172a; color:white; border-color:#0f172a; }
  .bmp-region-chips { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .bmp-region-ico { color:#64748b; flex-shrink:0; }
  .bmp-chip-sm { padding:5px 13px; font-size:13px; }
  .bmp-search { display:flex; align-items:center; gap:6px; background:#f1f5f9; border-radius:10px; padding:8px 12px; min-width:220px; }
  .bmp-search input { border:none; background:none; outline:none; font-size:14px; width:100%; font-family:inherit; }

  .bmp-integrity { font-size:11px; color:#b45309; font-weight:700; display:inline-flex; align-items:center; gap:4px; }
  .bmp-integrity-banner { background:#fffbeb; border:1px solid #fcd34d; border-radius:10px; padding:8px 12px; font-size:12px; }
  .bmp-integrity-block { display:block; padding:8px 10px; background:#fffbeb; border-radius:8px; }

  .bmp-selection-card { display:flex; flex-direction:column; gap:8px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:14px 16px; }
  .bmp-selection-head { display:flex; align-items:center; gap:8px; color:#1d4ed8; font-weight:800; font-size:15px; }
  .bmp-selection-path { display:flex; flex-direction:column; gap:5px; color:#0f172a; font-weight:700; font-size:14.5px; }
  .bmp-sel-line { display:flex; align-items:center; gap:6px; }
  .bmp-sel-line svg { color:#3b82f6; flex-shrink:0; }
  .bmp-selection-reasons { display:flex; flex-direction:column; gap:4px; }
  .bmp-selection-subtitle { font-size:13px; font-weight:800; color:#475569; }
  .bmp-selection-none { font-size:12px; color:#94a3b8; }
  .bmp-clear-selection { display:flex; align-items:center; gap:4px; margin-inline-start:auto; border:1px solid #bfdbfe; background:white; color:#1d4ed8; border-radius:8px; padding:4px 10px; font-size:12px; font-weight:700; cursor:pointer; }
  .bmp-clear-selection:hover { background:#dbeafe; }

  /* THE scrollable results region: flex:1 + min-height:0 inside cooperating
     flex parents (StudentsPage modal body), max-height fallback inside
     plain block parents (TransfersPage .dp-body) - either way THIS element
     scrolls, no nested-scroll fight, and the last building/footer is always
     reachable. */
  .bmp-buildings {
    display:flex; flex-direction:column; gap:12px;
    flex:1 1 auto; min-height:280px; max-height:min(58vh, 620px);
    overflow-y:auto; overscroll-behavior:contain;
    padding-inline-end:2px; padding-bottom:28px;
    scrollbar-gutter: stable;
  }
  .bmp-buildings:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
  .bmp-building { border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; flex-shrink:0; }
.bmp-building-head {
  width: 100%;

  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: 14px;

  padding: 12px 14px;

  background: #fff;

  border: none;

  cursor: pointer;

  text-align: inherit;

  min-height: 66px;

  font-family: inherit;
}

.bmp-building-head:hover {
  background: #f8fafc;
}  .bmp-building-head:hover { background:#f1f5f9; }
.bmp-building-main {
  display: flex;
  align-items: center;
  gap: 11px;

  min-width: 0;
  flex: 1;
}

.bmp-building-icon {
  width: 34px;
  height: 34px;

  border-radius: 9px;

  background: #eff6ff;
  color: #2563eb;

  display: flex;
  align-items: center;
  justify-content: center;

  flex-shrink: 0;
}

.bmp-building-info {
  display: flex;
  flex-direction: column;

  gap: 3px;

  min-width: 0;
}

.bmp-building-name-row {
  display: flex;
  align-items: center;

  gap: 8px;

  flex-wrap: wrap;
}

.bmp-building-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;

  white-space: nowrap;
}

.bmp-building-meta {
  display: flex;
  align-items: center;
  gap: 5px;

  flex-wrap: wrap;

  font-size: 12.5px;
  color: #64748b;
  font-weight: 500;
}

.bmp-meta-dot {
  color: #cbd5e1;
}

.bmp-building-side {
  display: flex;
  align-items: center;

  gap: 10px;

  flex-shrink: 0;
}

.bmp-free {
  margin-inline-start: 0;

  display: inline-flex;
  align-items: center;

  gap: 5px;

  font-size: 13px;

  color: #15803d;
  font-weight: 800;

  white-space: nowrap;
}
  .bmp-building-title { font-weight:800; white-space:nowrap; }
  .bmp-dim { color:#64748b; font-weight:600; font-size:14px; }
  .bmp-full-text { color:#b91c1c; font-weight:700; }
  .bmp-star { color:#f59e0b; flex-shrink:0; }
  .bmp-apartments { display:flex; flex-direction:column; }
  .bmp-apartment { border-top:1px solid #f1f5f9; }
  .bmp-apartment-head { width:100%; display:flex; align-items:center; gap:10px; padding:13px 16px 13px 12px; border:none; background:white; cursor:pointer; font-size:14.5px; text-align:inherit; min-height:52px; font-family:inherit; }
  .bmp-apartment-head:hover { background:#f8fafc; }
  .bmp-building-head:focus-visible, .bmp-apartment-head:focus-visible, .bmp-room-head:focus-visible,
  .bmp-bed-row:focus-visible, .bmp-room-single:focus-visible, .bmp-chip:focus-visible, .bmp-load-more:focus-visible {
    outline: 2px solid #2563eb; outline-offset: 2px;
  }
  .bmp-apt-title { font-weight:800; color:#0f172a; font-size:15.5px; }
.bmp-pill {
  border-radius: 999px;

  padding: 3px 9px;

  font-size: 11.5px;
  font-weight: 700;

  white-space: nowrap;
}  .bmp-pill-roommate { background:#ede9fe; color:#6d28d9; border:1px solid #c4b5fd; }
  .bmp-free { margin-inline-start:auto; font-size:13.5px; color:#16a34a; font-weight:800; white-space:nowrap; }

  .bmp-rooms { display:flex; flex-direction:column; gap:10px; padding:10px 16px 16px 16px; background:#fafbfc; }
  .bmp-apt-reasons { display:flex; flex-direction:column; gap:4px; padding:4px 2px 2px; }
  .bmp-apt-reasonline { display:flex; flex-wrap:wrap; gap:6px 14px; padding:0 16px 10px 12px; background:white; }
  .bmp-apt-reasonline span { display:inline-flex; align-items:center; gap:5px; font-size:13px; font-weight:600; }
  .bmp-reasonline-good { color:#15803d; }
  .bmp-reasonline-warn { color:#b45309; }
  .bmp-warn-allowed { align-self:flex-start; font-size:12px; font-weight:800; color:#92400e; background:#fef3c7; border:1px solid #fcd34d; border-radius:999px; padding:3px 10px; }
  .bmp-residents { display:flex; align-items:flex-start; gap:8px; flex-wrap:wrap; font-size:13px; color:#64748b; }
  .bmp-residents-title { font-weight:700; padding-top:5px; }
  .bmp-resident-list { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .bmp-resident-chip { display:flex; flex-direction:column; align-items:flex-start; gap:2px; background:#eef2ff; color:#4338ca; border-radius:10px; padding:5px 12px; font-weight:600; line-height:1.35; font-size:13px; }
  .bmp-resident-name { font-weight:700; display:flex; align-items:center; gap:3px; }
  .bmp-resident-tags { font-size:11.5px; font-weight:600; color:#6366f1; opacity:0.85; }

  .bmp-room { border:1px solid #e2e8f0; border-radius:10px; background:white; overflow:hidden; }
  .bmp-room-has-selection { border-color:#93c5fd; }
  .bmp-room-head { width:100%; display:flex; align-items:center; gap:9px; padding:11px 14px; background:#f8fafc; border:none; cursor:pointer; font-size:14.5px; text-align:inherit; font-family:inherit; min-height:46px; }
  .bmp-room-head:hover { background:#f1f5f9; }
  .bmp-room-name { font-weight:800; color:#0f172a; white-space:nowrap; }
  .bmp-room-single { width:100%; display:flex; align-items:center; gap:9px; padding:11px 14px; background:white; border:1px solid #e2e8f0; border-radius:10px; cursor:pointer; font-size:14.5px; text-align:inherit; font-family:inherit; min-height:50px; }
  .bmp-room-single:hover:not(:disabled) { border-color:#94a3b8; }
  .bmp-room-single:disabled { opacity:0.55; cursor:not-allowed; }
  .bmp-room-selected { border-color:#2563eb; background:#eff6ff; }

  .bmp-bed-list { display:flex; flex-direction:column; gap:8px; padding:10px; }
  .bmp-bed-row { display:flex; align-items:center; gap:10px; padding:11px 14px; border:1.5px solid #e2e8f0; border-radius:10px; background:white; cursor:pointer; font-size:14.5px; text-align:inherit; width:100%; min-height:48px; font-family:inherit; }
  .bmp-bed-row:hover:not(:disabled) { border-color:#94a3b8; }
  .bmp-bed-row:disabled { cursor:not-allowed; }
  .bmp-bed-row-occupied { opacity:0.6; background:#f8fafc; }
  .bmp-bed-row-selected { border-color:#2563eb; background:#eff6ff; }
  .bmp-bed-radio { width:15px; height:15px; border-radius:50%; border:2px solid #cbd5e1; flex-shrink:0; }
  .bmp-bed-radio-on { border-color:#2563eb; background:radial-gradient(circle, #2563eb 40%, transparent 44%); }
  .bmp-bed-name { font-weight:700; color:#0f172a; white-space:nowrap; }
  .bmp-bed-status { font-size:13px; font-weight:700; color:#94a3b8; }
  .bmp-bed-status-free { color:#16a34a; }
  .bmp-bed-status-occupied { color:#b91c1c; }
  .bmp-bed-check { color:#2563eb; margin-inline-start:auto; }

  .bmp-reason-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
  .bmp-reason-list li { display:flex; align-items:center; gap:6px; font-size:13px; }
  .bmp-reason-good li, .bmp-reason-good { color:#15803d; }
  .bmp-reason-warn li, .bmp-reason-warn { color:#b45309; }
  .bmp-reason-history li, .bmp-reason-history { color:#6366f1; }

  .bmp-results-footer { display:flex; flex-direction:column; align-items:center; gap:8px; padding:14px 4px 6px; flex-shrink:0; }
  .bmp-load-more { align-self:center; border:1px solid #e2e8f0; background:white; border-radius:999px; padding:9px 22px; font-size:13px; font-weight:700; cursor:pointer; color:#334155; font-family:inherit; }
  .bmp-load-more:hover { background:#f8fafc; }
  .bmp-load-more:disabled { opacity:0.6; cursor:not-allowed; }
  .bmp-load-more-primary { background:#0f172a; color:white; border-color:#0f172a; padding:10px 28px; }
  .bmp-load-more-primary:hover:not(:disabled) { background:#1e293b; }
  .bmp-loaded-count { font-size:13px; color:#64748b; font-weight:600; }
  .bmp-all-loaded { font-size:12px; color:#16a34a; font-weight:700; }
  .bmp-loadmore-error { display:flex; align-items:center; gap:4px; font-size:12px; color:#b91c1c; font-weight:700; }

  .bmp-skeleton { display:flex; flex-direction:column; gap:10px; }
  .bmp-searching-note { font-size:13px; color:#64748b; font-weight:600; }
  .bmp-skeleton-row { height:58px; border-radius:12px; background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 37%,#f1f5f9 63%); background-size:400% 100%; animation:bmp-shimmer 1.4s ease infinite; }
  @keyframes bmp-shimmer { 0%{background-position:100% 50%;} 100%{background-position:0 50%;} }

  .bmp-empty { display:flex; flex-direction:column; align-items:center; gap:10px; padding:36px 16px; color:#64748b; text-align:center; font-size:15px; font-weight:600; }
  .bmp-empty-hint { font-size:13.5px; color:#2563eb; font-weight:700; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:8px 14px; }
  .bmp-empty-inline { padding:24px 16px; }
  .bmp-conflicts { margin-top:12px; width:100%; text-align:inherit; background:#fef2f2; border-radius:12px; padding:12px 14px; }
  .bmp-conflicts-title { font-size:13px; font-weight:800; color:#b91c1c; display:block; margin-bottom:8px; }
  .bmp-conflict-row { display:flex; align-items:center; gap:6px; font-size:12px; color:#7f1d1d; padding:4px 0; flex-wrap:wrap; }
  .bmp-conflict-reasons { color:#991b1b; margin-inline-start:auto; }

  .bmp-error { display:flex; flex-direction:column; align-items:center; gap:8px; padding:32px 16px; color:#b91c1c; text-align:center; }
  .bmp-error-title { font-weight:800; font-size:14px; }
  .bmp-error-detail { font-size:12px; color:#7f1d1d; }
  .bmp-retry-btn { display:flex; align-items:center; gap:6px; margin-top:6px; border:1px solid #fca5a5; background:white; color:#b91c1c; border-radius:999px; padding:8px 18px; font-size:13px; font-weight:700; cursor:pointer; }
  .bmp-retry-btn:hover { background:#fef2f2; }

  @media (max-width: 720px) {
    .bmp-toolbar { flex-direction:column; align-items:stretch; }
    .bmp-search { min-width:0; }
    .bmp-filters { overflow-x:auto; flex-wrap:nowrap; padding-bottom:2px; }
  }
`;
