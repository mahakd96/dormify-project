import React, { useState, useEffect, useRef } from 'react';
import FiltersDrawer from '../components/FiltersDrawer';
import { studentsAPI, requestsAPI } from '../services/api';
import {
  Search, Star, X, Users, Phone, Mail, Home, MapPin,
  BedDouble, Building2, User, Loader2, ArrowLeft, Contact2, Plus,
  DoorOpen, Tag, FileText, Calendar, LogIn, LogOut, RefreshCw,
  UserPlus, FileSearch, Filter, UserCheck, UserMinus,
} from 'lucide-react';

// ============================================================
// Helpers
// ============================================================
const AVATAR_PALETTE = [
  { bg: 'linear-gradient(135deg, #dbeafe, #93c5fd)', color: '#1d4ed8' },
  { bg: 'linear-gradient(135deg, #dcfce7, #86efac)', color: '#047857' },
  { bg: 'linear-gradient(135deg, #ede9fe, #c4b5fd)', color: '#6d28d9' },
  { bg: 'linear-gradient(135deg, #fce7f3, #f9a8d4)', color: '#be185d' },
  { bg: 'linear-gradient(135deg, #fef3c7, #fcd34d)', color: '#b45309' },
  { bg: 'linear-gradient(135deg, #ccfbf1, #5eead4)', color: '#0f766e' },
];
const pickAvatarColor = (seed) => {
  const s = String(seed || '');
  let total = 0;
  for (let i = 0; i < s.length; i++) total += s.charCodeAt(i);
  return AVATAR_PALETTE[total % AVATAR_PALETTE.length];
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch { return iso; }
};

const CATEGORY_META = {
  continuing: { color: 'green',  icon: UserCheck, dateKey: 'move_in_date',  dateLabelKey: 'movedInOn' },
  new:        { color: 'blue',   icon: UserPlus,  dateKey: 'move_in_date',  dateLabelKey: 'movingInOn' },
  transfer:   { color: 'purple', icon: RefreshCw, dateKey: 'move_in_date',  dateLabelKey: 'movedInOn' },
  leaving:    { color: 'red',    icon: LogOut,    dateKey: 'move_out_date', dateLabelKey: 'leavingOn' },
};

// ============================================================
// Component
// ============================================================
function StudentsPage({ language }) {
  // ---------- STATE ----------
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [list, setList] = useState([]);
  const [counts, setCounts] = useState({ all: 0, new: 0, continuing: 0, transfer: 0, leaving: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const debounceRef = useRef(null);
  const [aptTenants, setAptTenants] = useState([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [bedMatchFilter, setBedMatchFilter] = useState('all');
  const [selectedApartment, setSelectedApartment] = useState(null);
  const [selectedRoomInApt, setSelectedRoomInApt] = useState(null);
  // Filter state
  const [filterOptions, setFilterOptions] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    genders: [], religions: [], regions: [], dormTypes: [],
    buildings: [], apartments: [], rooms: [],
    assignmentStatuses: [], hasRoommateRequest: [],
  });

    // Add Student modal state
    const [showAddStudentModal, setShowAddStudentModal] = useState(false);
    const [addStudentLoading, setAddStudentLoading] = useState(false);
    const [addStudentError, setAddStudentError] = useState('');
    const [addStudentSuccess, setAddStudentSuccess] = useState('');
    const [addStudentForm, setAddStudentForm] = useState({
      student_id: '',
      first_name: '',
      last_name: '',
      phone: '',
      email: '',
      city: '',
      gender: '',
      requested_religion: 'not_specified',
      accepted_dorm_type: '',
      category: 'new',
      reason: '',
    });
  const [showAddRequest, setShowAddRequest] = useState(false);
  const [reqType, setReqType] = useState('room');
  const [reqSameApt, setReqSameApt] = useState(null);
  const [reqOtherDesc, setReqOtherDesc] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState('');
  const [reqSuccess, setReqSuccess] = useState('');

  // Assign Bed modal state
  const [showAssignBed, setShowAssignBed] = useState(false);
  const [availableBeds, setAvailableBeds] = useState([]);
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [assigningBed, setAssigningBed] = useState(false);
  const [assignBedError, setAssignBedError] = useState('');
  const [assignBedSuccess, setAssignBedSuccess] = useState('');
  const [bedSearchQuery, setBedSearchQuery] = useState('');

  // ---------- TRANSLATIONS ----------
  const t = ({
    he: {
      title: 'סטודנטים', subtitle: 'חיפוש או סינון סטודנטים לפי סטטוס',
      placeholder: 'חפש לפי שם, ת.ז או טלפון...',
      results: 'תוצאות', result: 'תוצאה',
      noResults: 'לא נמצאו סטודנטים',
      noResultsHint: 'נסה מילת חיפוש אחרת או בחר סטטוס שונה',
      clearFilters: 'נקה מסננים', filters: 'מסננים', back: 'חזרה לרשימה',
      tabAllPrimary: 'All Students', tabAllSecondary: 'כל הסטודנטים',
      tabStayingPrimary: 'Staying', tabStayingSecondary: 'נשארים',
      tabNewPrimary: 'New', tabNewSecondary: 'נכנסים חדשים',
      tabTransferringPrimary: 'Transferring', tabTransferringSecondary: 'מעברים',
      tabLeavingPrimary: 'Leaving', tabLeavingSecondary: 'עוזבים',
      catContinuing: 'ממשיך', catNew: 'חדש', catTransfer: 'מעבר', catLeaving: 'עוזב',
      movedInOn: 'נכנס בתאריך', movingInOn: 'יכנס בתאריך', leavingOn: 'יוצא בתאריך',
      housing: 'פרטי מגורים',
      roommates: 'שותפים לחדר', personal: 'פרטים אישיים',
      roommateRequests: 'בקשות שותפים',
      phone: 'טלפון', email: 'אימייל', city: 'עיר',
      building: 'בניין', apartment: 'דירה', room: 'חדר', bed: 'מיטה', dormType: 'סוג מעון',
      gender: 'מגדר', religion: 'דת', category: 'קטגוריה',
      assigned: 'משובץ', unassigned: 'לא משובץ',
      noRoommates: 'אין שותפים נוספים בחדר',
      notAssigned: 'הסטודנט אינו משובץ לחדר כרגע',
      priority: 'עדיפות', currentAssignment: 'פרטי השיבוץ הנוכחי',
      addRequest: 'הוסף בקשה', newRequestTitle: 'בקשה חדשה',
      requestType: 'סוג בקשה',
      typeRoom: 'שינוי חדר', typeApartment: 'מעבר מהדירה', typeOther: 'בקשה אחרת',
      typeRemoveStudent: 'הסרה מהמעונות',
      removeStudentNote: 'הסטודנט יוסר מהמעונות ומיטתו תתפנה לאחר אישור המנהל.',
      removeReasonPlaceholder: 'סיבת ההסרה מהמעונות...',
      sameApartmentLabel: 'איפה החדר החדש?',
      sameApt: 'באותה דירה', diffApt: 'בדירה אחרת', eitherApt: 'לא משנה',
      otherDescLabel: 'תיאור הבקשה',
      otherDescPlaceholder: 'תאר את הבקשה...',
      reasonLabel: 'סיבה', reasonPlaceholder: 'הסבר את סיבת הבקשה...',
      submit: 'שלח בקשה', cancel: 'ביטול',
      requestSubmitted: 'הבקשה נשלחה בהצלחה',
      missingReason: 'חובה למלא סיבה', missingOtherDesc: 'חובה לתאר את הבקשה',
      region: 'אזור', studentId: 'מזהה סטודנט',
      moveInDate: 'תאריך כניסה', moveOutDate: 'תאריך יציאה',
      // Assign Bed
      assignBed: 'שבץ מיטה',
      assignBedTitle: 'שיבוץ מיטה ידני',
      bedsAvailable: 'מיטות פנויות',
      searchRoom: 'חפש לפי בניין, דירה או חדר...',
      noBedsAvailable: 'אין מיטות פנויות מתאימות',
      loadingBeds: 'טוען מיטות פנויות...',
      assignSuccess: 'הסטודנט שובץ בהצלחה!',
      confirmAssign: 'אשר שיבוץ',
      selectRoomFirst: 'בחר חדר תחילה',
      availableBedCount: 'מיטות פנויות',
      addStudentRequest: 'בקשת הוספת סטודנט',
      createAddStudentRequest: 'יצירת בקשת הוספת סטודנט',
      studentIdentity: 'פרטי הסטודנט',
      contact: 'פרטי קשר',
      housingPlacement: 'שיבוץ ומעונות',
      requestReason: 'סיבת הבקשה',
      studentId: 'מספר סטודנט',
      firstName: 'שם פרטי',
      lastName: 'שם משפחה',
      phone: 'טלפון',
      email: 'אימייל',
      city: 'עיר',
      gender: 'מגדר',
      religion: 'דת',
      dormType: 'סוג מעון',
      category: 'קטגוריה',
      reason: 'סיבה',
      selectGender: 'בחר מגדר',
      male: 'זכר',
      female: 'נקבה',
      notSpecified: 'לא צוין',
      jewish: 'יהודי',
      muslims: 'מוסלמי',
      christian: 'נוצרי',
      druze: 'דרוזי',
      selectDormType: 'בחר סוג מעון',
      newCategory: 'חדש',
      stayingCategory: 'ממשיך',
      transferringCategory: 'עובר',
      leavingCategory: 'עוזב',
      createAddStudentBtn: 'צור בקשת הוספת סטודנט',
      creating: 'יוצר...',
      fillRequiredFields: 'יש למלא את כל שדות החובה.',
      addStudentSuccess: 'בקשת הוספת סטודנט נוצרה בהצלחה.',
      addStudentFailed: 'יצירת בקשת הוספת סטודנט נכשלה.',
      contactInfo: 'פרטי קשר',
      addStudentReasonPlaceholder: 'מדוע צריך להוסיף את הסטודנט?',
    },
    en: {
      title: 'Students', subtitle: 'Search or filter students by status',
      placeholder: 'Search by name, ID, or phone...',
      results: 'results', result: 'result',
      noResults: 'No students found',
      noResultsHint: 'Try a different search term or select another status',
      clearFilters: 'Clear filters', filters: 'Filters', back: 'Back to list',
      tabAllPrimary: 'All Students', tabAllSecondary: '',
      tabStayingPrimary: 'Staying', tabStayingSecondary: '',
      tabNewPrimary: 'New', tabNewSecondary: '',
      tabTransferringPrimary: 'Transferring', tabTransferringSecondary: '',
      tabLeavingPrimary: 'Leaving', tabLeavingSecondary: '',
      catContinuing: 'Staying', catNew: 'New', catTransfer: 'Transfer', catLeaving: 'Leaving',
      movedInOn: 'Moved in on', movingInOn: 'Moving in on', leavingOn: 'Leaving on',
      contact: 'Contact', housing: 'Housing',
      roommates: 'Roommates', personal: 'Personal',
      roommateRequests: 'Roommate Requests',
      phone: 'Phone', email: 'Email', city: 'City',
      building: 'Building', apartment: 'Apartment', room: 'Room', bed: 'Bed', dormType: 'Dorm Type',
      gender: 'Gender', religion: 'Religion', category: 'Category',
      assigned: 'Assigned', unassigned: 'Unassigned',
      noRoommates: 'No other roommates in this room',
      notAssigned: 'Student is not currently assigned to a room',
      priority: 'Priority', currentAssignment: 'Current Assignment',
      addRequest: 'Add Request', newRequestTitle: 'New Request',
      requestType: 'Request type',
      typeRoom: 'Change room', typeApartment: 'Move from apartment', typeOther: 'Other request',
      typeRemoveStudent: 'Remove from Dorms',
      removeStudentNote: 'The student will be removed from dorms and their bed freed after admin approval.',
      removeReasonPlaceholder: 'Reason for removal from dorms...',
      sameApartmentLabel: 'Where should the new room be?',
      sameApt: 'Same apartment', diffApt: 'Different apartment', eitherApt: 'Either is fine',
      otherDescLabel: 'Request description',
      otherDescPlaceholder: 'Describe the request...',
      reasonLabel: 'Reason', reasonPlaceholder: 'Explain the reason for this request...',
      submit: 'Submit Request', cancel: 'Cancel',
      requestSubmitted: 'Request submitted successfully',
      missingReason: 'Please write a reason', missingOtherDesc: 'Please describe the request',
      region: 'Region', studentId: 'Student ID',
      moveInDate: 'Move-in date', moveOutDate: 'Move-out date',
      // Assign Bed
      assignBed: 'Assign Bed',
      assignBedTitle: 'Manual Bed Assignment',
      bedsAvailable: 'beds available',
      searchRoom: 'Search by building, apartment or room...',
      noBedsAvailable: 'No matching available beds',
      loadingBeds: 'Loading available beds...',
      assignSuccess: 'Student assigned successfully!',
      confirmAssign: 'Confirm Assignment',
      selectRoomFirst: 'Select a room first',
      availableBedCount: 'free beds',
      // add student request
      addStudentRequest: 'Add Student Request',
      createAddStudentRequest: 'Create Add Student Request',
      studentIdentity: 'Student identity',
      housingPlacement: 'Housing / placement',
      requestReason: 'Request reason',
      firstName: 'First name',
      lastName: 'Last name',
      phone: 'Phone',
      email: 'Email',
      city: 'City',
      gender: 'Gender',
      religion: 'Religion',
      dormType: 'Dorm Type',
      category: 'Category',
      reason: 'Reason',
      selectGender: 'Select gender',
      male: 'Male',
      female: 'Female',
      notSpecified: 'Not specified',
      jewish: 'Jewish',
      muslims: 'Muslims',
      christian: 'Christian',
      druze: 'Druze',
      selectDormType: 'Select dorm type',
      newCategory: 'New',
      stayingCategory: 'Staying',
      transferringCategory: 'Transferring',
      leavingCategory: 'Leaving',
      createAddStudentBtn: 'Create Add Student Request',
      creating: 'Creating...',
      fillRequiredFields: 'Please fill all required fields.',
      addStudentSuccess: 'Add Student request created successfully.',
      addStudentFailed: 'Failed to create add student request.',
      contactInfo: 'Contact',
      addStudentReasonPlaceholder: 'Why should this student be added?',
    },
  })[language] || {};

  const TAB_DEFS = [
    { v: 'all',       color: 'gray',   primary: t.tabAllPrimary,           secondary: t.tabAllSecondary,           icon: Users,      countKey: 'all' },
    { v: 'continuing',color: 'green',  primary: t.tabStayingPrimary,       secondary: t.tabStayingSecondary,       icon: UserCheck,  countKey: 'continuing' },
    { v: 'new',       color: 'blue',   primary: t.tabNewPrimary,           secondary: t.tabNewSecondary,           icon: UserPlus,   countKey: 'new' },
    { v: 'transfer',  color: 'purple', primary: t.tabTransferringPrimary,  secondary: t.tabTransferringSecondary,  icon: RefreshCw,  countKey: 'transfer' },
    { v: 'leaving',   color: 'red',    primary: t.tabLeavingPrimary,       secondary: t.tabLeavingSecondary,       icon: LogOut,     countKey: 'leaving' },
  ];

  // ---------- DERIVED ----------
  const activeFilterCount =
    activeFilters.genders.length + activeFilters.religions.length +
    activeFilters.regions.length + activeFilters.dormTypes.length +
    activeFilters.buildings.length + activeFilters.apartments.length +
    activeFilters.rooms.length + activeFilters.assignmentStatuses.length +
    activeFilters.hasRoommateRequest.length;

  const getRegionName = (regionId) => {
    const region = filterOptions?.regions?.find((r) => String(r.id) === String(regionId));
    return region?.name || regionId;
  };

  const getBuildingName = (buildingId) => {
    const building = filterOptions?.buildings?.find((b) => String(b.id) === String(buildingId));
    return building ? `Building ${building.name}` : `Building ${buildingId}`;
  };
// Group rooms by apartment
// Group rooms by apartment + score by match quality
const groupByApartment = (rooms, student) => {
  const groups = {};
  const matchOrder = { ok: 0, empty: 1, warning: 2, mismatch: 3 };

  for (const r of rooms) {
    const key = `${r.building}-${r.apartment}`;
    if (!groups[key]) {
      groups[key] = {
        key,
        building: r.building,
        apartment: r.apartment,
        dorm_type: r.dorm_type,
        region: r.region,
        apartment_gender: r.apartment_gender,
        apartment_residents: r.apartment_residents || [],
        known_religions: r.known_religions || [],
        unknown_religion_count: r.unknown_religion_count || 0,
        available_rooms: [],
        free_beds: 0,
        match: r.match,
        warnings: new Set(),
        is_selectable: true,
        _score: 0,
        _hasRoommateMatch: false,
      };
    }
    groups[key].available_rooms.push(r);
    groups[key].free_beds += r.available_beds;
    (r.warnings || []).forEach(w => groups[key].warnings.add(w));
    if (matchOrder[r.match] > matchOrder[groups[key].match]) {
      groups[key].match = r.match;
    }
    if (r.is_selectable === false) groups[key].is_selectable = false;
  }

  // SCORING
  const studentReligion = student?.requested_religion;
  const studentCity = (student?.city || '').toLowerCase().trim();
  const roommateNames = [
    student?.roommate_request_1, student?.roommate_request_2,
    student?.roommate_request_3, student?.roommate_request_4,
    student?.roommate_request_5,
  ].filter(Boolean).map(n => n.toLowerCase().trim());
  const roommateIds = [
    student?.roommate_request_student_id_1, student?.roommate_request_student_id_2,
    student?.roommate_request_student_id_3, student?.roommate_request_student_id_4,
    student?.roommate_request_student_id_5,
  ].filter(Boolean);

  const studentGroup =
    studentReligion === 'Jewish' ? 'jewish' :
    ['Muslims', 'Christian', 'Druze'].includes(studentReligion) ? 'arab' :
    'unknown';

  Object.values(groups).forEach(g => {
    if (!g.is_selectable || g.match === 'mismatch') {
      g._score = -100;
      return;
    }
    let score = 0;

    // 1. Roommate request match (strongest signal)
    const roommateMatch = g.apartment_residents.find(r =>
      roommateIds.includes(r.student_id) ||
      roommateNames.some(n => n && (r.full_name || '').toLowerCase().includes(n))
    );
    if (roommateMatch) {
      score += 50;
      g._hasRoommateMatch = true;
    }

    // 2. Religion compatibility
    if (g.apartment_residents.length === 0) {
      score += 15;
    } else if (studentGroup !== 'unknown') {
      const allMatch = g.apartment_residents.every(r => {
        const rGroup =
          r.religion === 'Jewish' ? 'jewish' :
          ['Muslims', 'Christian', 'Druze'].includes(r.religion) ? 'arab' :
          'unknown';
        return rGroup === studentGroup || rGroup === 'unknown';
      });
      if (allMatch && g.unknown_religion_count === 0) score += 20;
      else if (allMatch) score += 10;
    }

    // 3. City match
    if (studentCity) {
      const cityMatches = g.apartment_residents.filter(r =>
        (r.city || '').toLowerCase().trim() === studentCity
      ).length;
      if (cityMatches > 0) score += 8;
    }

    // 4. Less crowded
    if (g.apartment_residents.length === 0) score += 5;
    else if (g.apartment_residents.length <= 2) score += 3;

    // 5. Warning penalty
    if (g.match === 'warning') score -= 8;

    g._score = score;
  });

  return Object.values(groups).map(g => ({
    ...g,
    warnings: Array.from(g.warnings),
  })).sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    if (matchOrder[a.match] !== matchOrder[b.match]) return matchOrder[a.match] - matchOrder[b.match];
    if (a.building !== b.building) return a.building - b.building;
    return String(a.apartment).localeCompare(String(b.apartment));
  });
};

const apartmentGroups = groupByApartment(availableBeds, selectedStudent);

const recommendedKeys = new Set(
  apartmentGroups.filter(g => g._score >= 20).slice(0, 2).map(g => g.key)
);

const filteredApartments = apartmentGroups.filter(g => {
  if (bedMatchFilter === 'all') return true;
  if (bedMatchFilter === 'ok') return recommendedKeys.has(g.key) || g._score >= 15;
  if (bedMatchFilter === 'empty') return g.apartment_residents.length === 0;
  if (bedMatchFilter === 'warning') return g.match === 'warning';
  if (bedMatchFilter === 'mismatch') return !g.is_selectable || g.match === 'mismatch';
  return true;
});



 const filteredBeds = availableBeds.filter(opt => {
  if (bedMatchFilter !== 'all' && opt.match !== bedMatchFilter) return false;
  if (!bedSearchQuery.trim()) return true;
  const q = bedSearchQuery.toLowerCase();
  const residentsText = (opt.apartment_residents || [])
    .map(r => `${r.full_name || ''} ${r.city || ''} ${r.religion_display || ''}`)
    .join(' ').toLowerCase();
  return (
    String(opt.building).toLowerCase().includes(q) ||
    String(opt.apartment).toLowerCase().includes(q) ||
    String(opt.room_name).toLowerCase().includes(q) ||
    String(opt.dorm_type).toLowerCase().includes(q) ||
    residentsText.includes(q)
  );
});

  // ---------- DATA LOADING ----------
  useEffect(() => { loadCounts(); }, []); // eslint-disable-line
  useEffect(() => {
    studentsAPI.getFilterOptions().then(setFilterOptions).catch(console.error);
  }, []);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadList(), 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line
  }, [activeTab, searchQuery, activeFilters]);

  const loadCounts = async () => {
    try {
      const data = await studentsAPI.getCounts();
      setCounts(data);
    } catch (err) { console.error('Failed to load counts:', err); }
  };

  const loadList = async () => {
    try {
      setLoading(true); setError('');
      const params = {};
      if (activeTab !== 'all') params.category = activeTab;
      const q = searchQuery.trim();
      if (q.length >= 2) params.search = q;
      const data = await studentsAPI.getStudents({ ...params, ...activeFilters });
      const items = Array.isArray(data) ? data : (data.results || []);
      setList(items);
    } catch (err) {
      setError(err.message || 'Failed to load students');
      setList([]);
    } finally { setLoading(false); }
  };

  const loadFullDetails = async (student) => {
    try {
      setLoadingDetails(true); setSelectedStudent(student);
      const full = await studentsAPI.getById(student.id);
      setSelectedStudent(full);
    } catch (err) { console.error('Failed to load full student details:', err); }
    finally { setLoadingDetails(false); }
  };

  const closeDetail = () => setSelectedStudent(null);

  const clearFilters = () => {
    setActiveTab('all'); setSearchQuery('');
    setActiveFilters({ genders: [], religions: [], regions: [], dormTypes: [], buildings: [], apartments: [], rooms: [], assignmentStatuses: [], hasRoommateRequest: [] });
  };

  // ---------- HELPERS ----------
  const getName = (s) => s?.full_name || `${s?.first_name || ''} ${s?.last_name || ''}`.trim();
  const getInitial = (s) => { const n = getName(s); return n ? n[0] : '?'; };
  const getRoommateRequests = (s) =>
    [s?.roommate_request_1, s?.roommate_request_2, s?.roommate_request_3,
     s?.roommate_request_4, s?.roommate_request_5].filter(Boolean);

  const isRemoved = (s) => s?.move_out_date && !s?.is_assigned;

  const renderCategoryBadge = (s) => {
    const meta = CATEGORY_META[s?.category];
    if (!meta) return null;
    const Icon = meta.icon;
    const label =
      s.category === 'continuing' ? t.catContinuing :
      s.category === 'new'        ? t.catNew :
      s.category === 'transfer'   ? t.catTransfer :
      s.category === 'leaving'    ? t.catLeaving :
      s.category_display || s.category;
    return (
      <span className={`cat-pill ${meta.color}`}>
        <Icon size={12} />{label}
      </span>
    );
  };

  const renderRelevantDate = (s) => {
    const meta = CATEGORY_META[s?.category];
    if (!meta) return null;
    const date = s[meta.dateKey];
    if (!date) return null;
    return (
      <span className="date-chip">
        <Calendar size={11} />
        {t[meta.dateLabelKey]}: <strong>{fmtDate(date)}</strong>
      </span>
    );
  };

  // ---------- ADD REQUEST MODAL ----------
  const openAddRequest = () => {
    setReqType(selectedStudent?.is_assigned ? 'room' : 'other');
    setReqSameApt(null); setReqOtherDesc('');
    setReqReason(''); setReqError(''); setReqSuccess('');
    setShowAddRequest(true);
  };
  const closeAddRequest = () => setShowAddRequest(false);

  const submitAddRequest = async () => {
    if (!selectedStudent || !reqReason.trim()) { setReqError(t.missingReason); return; }
    if (reqType === 'other' && !reqOtherDesc.trim()) { setReqError(t.missingOtherDesc); return; }
    try {
      setReqSubmitting(true); setReqError('');
      const payload = { student: selectedStudent.id, request_type: reqType, reason: reqReason.trim() };
      if (reqType === 'room')  payload.same_apartment = reqSameApt;
      if (reqType === 'other') payload.other_description = reqOtherDesc.trim();
      await requestsAPI.create(payload);
      setReqSuccess(t.requestSubmitted);
      setTimeout(() => { closeAddRequest(); setReqSuccess(''); }, 1500);
    } catch (err) {
      setReqError(err.message || 'Failed to create request');
    } finally { setReqSubmitting(false); }
  };

  // ---------- ASSIGN BED MODAL ----------
  const openAssignBed = async () => {
    setShowAssignBed(true);
    setSelectedRoom(null);
    setAssignBedError(''); setAssignBedSuccess('');
    setBedSearchQuery('');
    try {
      setLoadingBeds(true);
      const data = await studentsAPI.getAvailableBeds(selectedStudent.id);
      setAvailableBeds(data.options || []);
    } catch (err) {
      setAssignBedError(err.message || 'Failed to load beds');
    } finally { setLoadingBeds(false); }
  };

const closeAssignBed = () => {
  setShowAssignBed(false);
  setSelectedRoom(null);
  setSelectedApartment(null);
  setSelectedRoomInApt(null);
  setAvailableBeds([]);
  setAssignBedError(''); setAssignBedSuccess('');
};
  const submitAssignBed = async () => {
  if (!selectedRoomInApt) return;
  try {
    setAssigningBed(true); setAssignBedError('');
    await studentsAPI.assignBed(selectedStudent.id, selectedRoomInApt.room_id);
    setAssignBedSuccess(t.assignSuccess);
    setTimeout(async () => {
      closeAssignBed();
      const full = await studentsAPI.getById(selectedStudent.id);
      setSelectedStudent(full);
      loadCounts();
    }, 1500);
  } catch (err) {
    setAssignBedError(err.message || 'Failed to assign bed');
  } finally { setAssigningBed(false); }
};
 const resetAddStudentForm = () => {
  setAddStudentForm({
    student_id: '',
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    city: '',
    gender: '',
    requested_religion: 'not_specified',
    accepted_dorm_type: '',
    category: 'new',
    reason: '',
  });
};

const handleAddStudentChange = (field, value) => {
  setAddStudentError('');
  setAddStudentSuccess('');

  setAddStudentForm((prev) => ({
    ...prev,
    [field]: value,
  }));
};

const closeAddStudentModal = () => {
  if (addStudentLoading) return;

  setShowAddStudentModal(false);
  setAddStudentError('');
  setAddStudentSuccess('');
  resetAddStudentForm();
};

const submitAddStudentRequest = async () => {
  setAddStudentError('');
  setAddStudentSuccess('');

  const required = [
    'student_id',
    'first_name',
    'last_name',
    'gender',
    'accepted_dorm_type',
    'reason',
  ];

  const missing = required.filter((field) => !String(addStudentForm[field] || '').trim());

  if (missing.length > 0) {
    setAddStudentError(t.fillRequiredFields);
    return;
  }

  try {
    setAddStudentLoading(true);

    await requestsAPI.create({
      request_type: 'add_student',
      reason: addStudentForm.reason.trim(),
      student_data: {
        student_id: addStudentForm.student_id.trim(),
        first_name: addStudentForm.first_name.trim(),
        last_name: addStudentForm.last_name.trim(),
        phone: addStudentForm.phone.trim(),
        email: addStudentForm.email.trim(),
        city: addStudentForm.city.trim(),
        gender: addStudentForm.gender,
        requested_religion: addStudentForm.requested_religion || 'not_specified',
        accepted_dorm_type: addStudentForm.accepted_dorm_type,
        category: addStudentForm.category || 'new',
      },
    });

    setAddStudentSuccess(t.addStudentSuccess);

    setTimeout(() => {
      setShowAddStudentModal(false);
      setAddStudentError('');
      setAddStudentSuccess('');
      resetAddStudentForm();
      loadList();
      loadCounts();
    }, 700);
  } catch (err) {
    setAddStudentError(err.message || t.addStudentFailed);
  } finally {
    setAddStudentLoading(false);
  }
};

  const handleSelectRoom = async (opt) => {
  setSelectedRoom(opt);
  setAptTenants([]);
  if (opt) {
    try {
      setLoadingTenants(true);
      const data = await studentsAPI.getApartmentTenants(opt.room_id);
      setAptTenants(data.tenants || []);
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setLoadingTenants(false);
    }
  }
};
  const showDetail = selectedStudent !== null;

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="students-page">
      {!showDetail && (
        <>
          <div className="page-top students-page-header">
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>

          <div className="page-top-actions">
            <button
              type="button"
              className="add-student-primary-btn"
              onClick={() => {
                setAddStudentError('');
                setAddStudentSuccess('');
                setShowAddStudentModal(true);
              }}
            >
              <span className="add-student-plus">+</span>
              {t.addStudentRequest}
            </button>

            {!loading && (
              <span className="results-count">
                {list.length} {list.length === 1 ? t.result : t.results}
              </span>
            )}
          </div>
        </div>

          {/* STAT TAB CARDS */}
          <div className="stat-tabs">
            {TAB_DEFS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.v;
              return (
                <button key={tab.v} className={`stat-tab ${tab.color} ${isActive ? 'active' : ''}`} onClick={() => setActiveTab(tab.v)}>
                  <div className="stat-icon-wrap"><Icon size={22} /></div>
                  <div className="stat-text">
                    <div className="stat-primary">{tab.primary}</div>
                    {tab.secondary && <div className="stat-secondary">{tab.secondary}</div>}
                  </div>
                  <div className="stat-count">{counts[tab.countKey] ?? 0}</div>
                </button>
              );
            })}
          </div>

          {/* SEARCH ROW */}
          <div className="search-row">
            <div className="search-box">
              <Search size={20} className="search-icon" />
              <input type="text" placeholder={t.placeholder} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {loading && <Loader2 size={18} className="spinner" />}
              {searchQuery && !loading && <button className="clear-btn" onClick={() => setSearchQuery('')}><X size={16} /></button>}
            </div>
            <button className="matching-students-btn" type="button">
              <span className="matching-number">{list.length}</span>
              <span className="matching-text">Students<small>Matching selected filters</small></span>
            </button>
            <button className={`filters-btn ${activeFilterCount > 0 ? 'has-filters' : ''}`} onClick={() => setFiltersOpen(true)}>
              <Filter size={16} />{t.filters}
              {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
            </button>
          </div>

          {/* ACTIVE FILTER CHIPS */}
          {activeFilterCount > 0 && (
            <div className="active-filter-chips">
              {activeFilters.genders.map((v) => (
                <span key={v} className="filter-chip">{v === 'M' ? 'Male' : v === 'F' ? 'Female' : v}
                  <button onClick={() => setActiveFilters(f => ({ ...f, genders: f.genders.filter(x => x !== v) }))}><X size={12} /></button>
                </span>
              ))}
              {activeFilters.religions.map((v) => (
                <span key={v} className="filter-chip">{v}
                  <button onClick={() => setActiveFilters(f => ({ ...f, religions: f.religions.filter(x => x !== v) }))}><X size={12} /></button>
                </span>
              ))}
              {activeFilters.assignmentStatuses.map((v) => (
                <span key={v} className="filter-chip">{v === 'assigned' ? 'Assigned' : 'Unassigned'}
                  <button onClick={() => setActiveFilters(f => ({ ...f, assignmentStatuses: f.assignmentStatuses.filter(x => x !== v) }))}><X size={12} /></button>
                </span>
              ))}
              {activeFilters.regions.map((regionId) => (
                <span key={regionId} className="filter-chip">{getRegionName(regionId)}
                  <button onClick={() => setActiveFilters((f) => ({ ...f, regions: f.regions.filter((x) => String(x) !== String(regionId)), buildings: [] }))}><X size={12} /></button>
                </span>
              ))}
              {activeFilters.buildings.map((buildingId) => (
                <span key={buildingId} className="filter-chip">{getBuildingName(buildingId)}
                  <button onClick={() => setActiveFilters((f) => ({ ...f, buildings: f.buildings.filter((x) => String(x) !== String(buildingId)) }))}><X size={12} /></button>
                </span>
              ))}
              <button className="clear-all-chip" onClick={clearFilters}>Clear all</button>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          {!loading && list.length === 0 && !error ? (
            <div className="empty-card">
              <div className="empty-illustration"><FileSearch size={64} /></div>
              <h3>{t.noResults}</h3>
              <p>{t.noResultsHint}</p>
              <button className="clear-filters-btn" onClick={clearFilters}>{t.clearFilters}</button>
            </div>
          ) : loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <Loader2 size={32} className="spinner" style={{ color: '#3d9fe0' }} />
            </div>
          ) : list.length > 0 ? (
            <div className="results-grid">
              {list.map((s) => (
                <div key={s.id} className={`result-row ${isRemoved(s) ? 'removed' : ''}`} onClick={() => loadFullDetails(s)}>
                  <div className={`avatar ${isRemoved(s) ? 'removed' : ''}`}>{getInitial(s)}</div>
                  <div className="row-info">
                    <div className="row-name">
                      {getName(s)}
                      {s.is_priority && <Star size={14} className="priority-icon" />}
                      {isRemoved(s) && <span className="removed-badge">Removed</span>}
                    </div>
                    <div className="row-meta">
                      <span className="mono">{s.student_id}</span>
                      {s.phone && <span>· {s.phone}</span>}
                    </div>
                    <div className="row-badges">
                      {renderCategoryBadge(s)}
                      <span className={`status-badge ${s.is_assigned ? 'assigned' : 'unassigned'}`}>
                        {s.is_assigned ? t.assigned : t.unassigned}
                      </span>
                      {renderRelevantDate(s)}
                      {isRemoved(s) && s.move_out_date && (
                        <span className="date-chip removed-date">
                          <LogOut size={11} /> Left: <strong>{fmtDate(s.move_out_date)}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {/* ============================================================
          DETAIL VIEW
      ============================================================ */}
      {showDetail && (
        <div className="detail-wrap">
          <div className={`hero-card ${isRemoved(selectedStudent) ? 'hero-removed' : ''}`}>
            <div className="hero-top-row">
              <button className="back-pill" onClick={closeDetail}>
                <ArrowLeft size={16} /> {t.back}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Unassigned: Assign Bed directly */}
                {!isRemoved(selectedStudent) && (
                  <button className="assign-bed-pill" onClick={openAssignBed}>
                    <BedDouble size={16} />
                    {selectedStudent.is_assigned ? 'Reassign Bed' : t.assignBed}
                  </button>
                )}
                {/* Assigned: Add Request (room/apartment/other/remove) */}
                {selectedStudent.is_assigned && (
                  <button className="add-request-pill" onClick={openAddRequest}>
                    <Plus size={16} /> {t.addRequest}
                  </button>
                )}
              </div>
            </div>

            <div className="hero-body">
              <div className="hero-left">
                <div className="hero-avatar">{getInitial(selectedStudent)}</div>
                <div className="hero-info">
                  <h1>{getName(selectedStudent)}</h1>
                  <div className="hero-id">{t.studentId} <strong>{selectedStudent.student_id}</strong></div>
                  <div className="hero-badges">
                    {isRemoved(selectedStudent) ? (
                      <span className="hero-removed-badge">
                        <LogOut size={13} /> Removed from Dorms
                      </span>
                    ) : (
                      <span className={`hero-status ${selectedStudent.is_assigned ? 'assigned' : 'unassigned'}`}>
                        {selectedStudent.is_assigned ? `✓ ${t.assigned}` : t.unassigned}
                      </span>
                    )}
                    {renderCategoryBadge(selectedStudent)}
                    {selectedStudent.is_priority && (
                      <span className="hero-priority"><Star size={12} /> {t.priority}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="hero-meta">
                {selectedStudent.assigned_region && (
                  <div className="hero-meta-row"><MapPin size={15} /><span><strong>{t.region}:</strong> {selectedStudent.assigned_region}</span></div>
                )}
                {selectedStudent.accepted_dorm_type_name && (
                  <div className="hero-meta-row"><Building2 size={15} /><span><strong>{t.dormType}:</strong> {selectedStudent.accepted_dorm_type_name}</span></div>
                )}
                {selectedStudent.move_in_date && (
                  <div className="hero-meta-row"><LogIn size={15} /><span><strong>{t.moveInDate}:</strong> {fmtDate(selectedStudent.move_in_date)}</span></div>
                )}
                {selectedStudent.move_out_date && (
                  <div className="hero-meta-row"><LogOut size={15} /><span><strong>{t.moveOutDate}:</strong> {fmtDate(selectedStudent.move_out_date)}</span></div>
                )}
              </div>
              {loadingDetails && <Loader2 size={20} className="spinner detail-spinner" />}
            </div>
          </div>

          {selectedStudent.is_assigned && (
            <>
              <div className="section-heading">{t.currentAssignment}</div>
              <div className="stats-row">
                <div className="stat-card"><div className="mini-stat-icon blue"><Building2 size={26} /></div><div className="stat-label">{t.building}</div><div className="stat-value">{selectedStudent.assigned_building_number || '—'}</div></div>
                <div className="stat-card"><div className="mini-stat-icon green"><DoorOpen size={26} /></div><div className="stat-label">{t.apartment}</div><div className="stat-value">{selectedStudent.assigned_apartment_number || '—'}</div></div>
                <div className="stat-card"><div className="mini-stat-icon purple"><Home size={26} /></div><div className="stat-label">{t.room}</div><div className="stat-value">{selectedStudent.assigned_room_name || '—'}</div></div>
                <div className="stat-card"><div className="mini-stat-icon orange"><BedDouble size={26} /></div><div className="stat-label">{t.bed}</div><div className="stat-value sm">{selectedStudent.current_bed_label || '—'}</div></div>
                <div className="stat-card"><div className="mini-stat-icon yellow"><Star size={26} /></div><div className="stat-label">{t.priority}</div><div className="stat-value">{selectedStudent.is_priority ? '★' : '—'}</div></div>
              </div>
            </>
          )}

          <div className="two-col">
            <div className="card">
              <div className="card-header"><div className="card-icon contact"><Contact2 size={18} /></div><h3>{t.contact}</h3></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key"><Mail size={15} /> {t.email}</span><span className="info-val">{selectedStudent.email || '—'}</span></div>
                <div className="info-row"><span className="info-key"><Phone size={15} /> {t.phone}</span><span className="info-val">{selectedStudent.phone || '—'}</span></div>
                {selectedStudent.city && <div className="info-row"><span className="info-key"><MapPin size={15} /> {t.city}</span><span className="info-val">{selectedStudent.city}</span></div>}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-icon housing"><Home size={18} /></div><h3>{t.housing}</h3></div>
              <div className="card-body">
                {selectedStudent.is_assigned ? (
                  <>
                    <div className="info-row"><span className="info-key"><Building2 size={15} /> {t.dormType}</span><span className="info-val">{selectedStudent.accepted_dorm_type_name || '—'}</span></div>
                    <div className="info-row"><span className="info-key"><Building2 size={15} /> {t.building}</span><span className="info-val">{selectedStudent.assigned_building_number || '—'}</span></div>
                    <div className="info-row"><span className="info-key"><DoorOpen size={15} /> {t.apartment}</span><span className="info-val">{selectedStudent.assigned_apartment_number || '—'}</span></div>
                    <div className="info-row"><span className="info-key"><Home size={15} /> {t.room}</span><span className="info-val">{selectedStudent.assigned_room_name || '—'}</span></div>
                    <div className="info-row"><span className="info-key"><BedDouble size={15} /> {t.bed}</span><span className="info-val">{selectedStudent.current_bed_label || '—'}</span></div>
                  </>
                ) : (
                  <p className="muted">{t.notAssigned}</p>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-icon roommates"><Users size={18} /></div><h3>{t.roommates}</h3></div>
            <div className="card-body">
              {Array.isArray(selectedStudent.roommates) && selectedStudent.roommates.length > 0 ? (
                <div className="roommates-grid">
                  {selectedStudent.roommates.map((r) => {
                    const color = pickAvatarColor(r.student_id || r.full_name);
                    return (
                      <div key={r.id} className="roommate-card">
                        <div className="rm-avatar" style={{ background: color.bg, color: color.color }}>{r.full_name ? r.full_name[0] : '?'}</div>
                        <div className="rm-info">
                          <div className="rm-name">{r.full_name}</div>
                          {r.bed_label && <div className="rm-meta"><Users size={11} /> {t.bed}: {r.bed_label}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">{t.noRoommates}</p>
              )}
            </div>
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-header"><div className="card-icon personal"><User size={18} /></div><h3>{t.personal}</h3></div>
              <div className="card-body">
                <div className="info-row"><span className="info-key">⚥ {t.gender}</span><span className="info-val">{selectedStudent.gender_display || '—'}</span></div>
                <div className="info-row"><span className="info-key"><Star size={15} /> {t.religion}</span><span className="info-val">{selectedStudent.requested_religion_display || '—'}</span></div>
                <div className="info-row"><span className="info-key"><Tag size={15} /> {t.category}</span><span className="info-val">{selectedStudent.category_display || '—'}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-icon requests"><FileText size={18} /></div><h3>{t.roommateRequests}</h3></div>
              <div className="card-body">
                {getRoommateRequests(selectedStudent).length > 0 ? (
                  <ol className="requests-list">
                    {getRoommateRequests(selectedStudent).map((name, i) => (
                      <li key={i}><span className="rq-num">{i + 1}</span><span className="rq-name">{name}</span></li>
                    ))}
                  </ol>
                ) : <p className="muted">—</p>}
              </div>
            </div>
          </div>

          {selectedStudent.is_priority && selectedStudent.priority_reason && (
            <div className="priority-notice"><Star size={18} /><span>{selectedStudent.priority_reason}</span></div>
          )}
        </div>
      )}

      {/* ============================================================
          ADD REQUEST MODAL (assigned students only)
      ============================================================ */}
      {showAddRequest && selectedStudent && (
        <div className="modal-overlay" onClick={closeAddRequest}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-modern">
              <div className="modal-title-wrap">
                <div className="modal-icon"><Plus size={18} /></div>
                <h3>{t.newRequestTitle}</h3>
              </div>
              <button className="modal-close" onClick={closeAddRequest}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="selected-student-pill">
                <div className="mini-avatar">{getInitial(selectedStudent)}</div>
                <div><div className="ss-name">{getName(selectedStudent)}</div><div className="ss-meta mono">{selectedStudent.student_id}</div></div>
              </div>

              <div className="form-section">
                <label>{t.requestType}</label>
                {/* Primary types */}
                <div className="type-options-modern" style={{ marginBottom: 10 }}>
                  {[
                    { v: 'room',      l: t.typeRoom,      icon: <Home size={20} />,     color: 'purple' },
                    { v: 'apartment', l: t.typeApartment, icon: <DoorOpen size={20} />, color: 'green'  },
                    { v: 'other',     l: t.typeOther,     icon: <FileText size={20} />, color: 'orange' },
                  ].map((opt) => (
                    <button key={opt.v} type="button"
                      className={`type-option-modern ${opt.color} ${reqType === opt.v ? 'active' : ''}`}
                      onClick={() => setReqType(opt.v)}>
                      <div className="opt-icon">{opt.icon}</div>
                      <span>{opt.l}</span>
                    </button>
                  ))}
                </div>
                {/* Remove student */}
                <button type="button"
                  className={`type-option-special red full-width ${reqType === 'remove_student' ? 'active' : ''}`}
                  onClick={() => setReqType('remove_student')}>
                  <div className="opt-icon-sm"><UserMinus size={18} /></div>
                  <span>{t.typeRemoveStudent}</span>
                </button>
              </div>

              {reqType === 'remove_student' && (
                <div className="type-note red"><UserMinus size={14} /> {t.removeStudentNote}</div>
              )}

              {reqType === 'room' && (
                <div className="form-section">
                  <label>{t.sameApartmentLabel}</label>
                  <div className="sub-options">
                    {[{ v: true, l: t.sameApt }, { v: false, l: t.diffApt }, { v: null, l: t.eitherApt }].map((opt, i) => (
                      <button key={i} type="button" className={`sub-option ${reqSameApt === opt.v ? 'active' : ''}`} onClick={() => setReqSameApt(opt.v)}>{opt.l}</button>
                    ))}
                  </div>
                </div>
              )}

              {reqType === 'other' && (
                <div className="form-section">
                  <label>{t.otherDescLabel}</label>
                  <textarea rows={2} placeholder={t.otherDescPlaceholder} value={reqOtherDesc} onChange={(e) => setReqOtherDesc(e.target.value)} />
                </div>
              )}

              <div className="form-section">
                <label>{t.reasonLabel}</label>
                <textarea rows={4}
                  placeholder={reqType === 'remove_student' ? t.removeReasonPlaceholder : t.reasonPlaceholder}
                  value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
              </div>

              {reqError && <div className="msg error-msg">{reqError}</div>}
              {reqSuccess && <div className="msg success-msg">{reqSuccess}</div>}

              <div className="modal-actions">
                <button className="btn-secondary" onClick={closeAddRequest} disabled={reqSubmitting}>{t.cancel}</button>
                <button
                  className={`btn-primary${reqType === 'remove_student' ? ' danger' : ''}`}
                  onClick={submitAddRequest} disabled={reqSubmitting || !!reqSuccess}>
                  {reqSubmitting ? <Loader2 size={16} className="spinner" /> : <><Plus size={16} /> {t.submit}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* ============================================================
    ADD STUDENT REQUEST MODAL
============================================================ */}
{showAddStudentModal && (
  <div className="modal-overlay" onClick={closeAddStudentModal}>
    <div
      className={`modal-content xwide add-student-modal ${language === 'he' ? 'rtl' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <div className="modal-title-row">
          <div className="modal-icon blue">+</div>
          <div>
            <h2>{t.createAddStudentRequest}</h2>
            <p className="modal-subtitle">
              {language === 'he'
                ? 'הסטודנט יישאר במצב ממתין עד שמנהל יאשר וישבץ חדר.'
                : 'The student will stay pending until an admin approves and assigns a room.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="modal-close"
          onClick={closeAddStudentModal}
        >
          ×
        </button>
      </div>

      <div className="modal-body">
        {addStudentError && (
          <div className="form-alert error">
            {addStudentError}
          </div>
        )}

        {addStudentSuccess && (
          <div className="form-alert success">
            {addStudentSuccess}
          </div>
        )}

        <section className="modal-section">
          <h3>{t.studentIdentity}</h3>

          <div className="form-grid">
            <label>
              {t.studentId} *
              <input
                value={addStudentForm.student_id}
                onChange={(e) => handleAddStudentChange('student_id', e.target.value)}
                placeholder={language === 'he' ? 'לדוגמה: 213537467' : 'Example: 213537467'}
              />
            </label>

            <label>
              {t.firstName} *
              <input
                value={addStudentForm.first_name}
                onChange={(e) => handleAddStudentChange('first_name', e.target.value)}
              />
            </label>

            <label>
              {t.lastName} *
              <input
                value={addStudentForm.last_name}
                onChange={(e) => handleAddStudentChange('last_name', e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="modal-section">
          <h3>{t.contactInfo}</h3>

          <div className="form-grid">
            <label>
              {t.phone}
              <input
                value={addStudentForm.phone}
                onChange={(e) => handleAddStudentChange('phone', e.target.value)}
              />
            </label>

            <label>
              {t.email}
              <input
                type="email"
                value={addStudentForm.email}
                onChange={(e) => handleAddStudentChange('email', e.target.value)}
              />
            </label>

            <label>
              {t.city}
              <input
                value={addStudentForm.city}
                onChange={(e) => handleAddStudentChange('city', e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="modal-section">
          <h3>{t.housingPlacement}</h3>

          <div className="form-grid">
            <label>
              {t.gender} *
              <select
                value={addStudentForm.gender}
                onChange={(e) => handleAddStudentChange('gender', e.target.value)}
              >
                <option value="">{t.selectGender}</option>
                <option value="male">{t.male}</option>
                <option value="female">{t.female}</option>
              </select>
            </label>

            <label>
              {t.religion}
              <select
                value={addStudentForm.requested_religion}
                onChange={(e) => handleAddStudentChange('requested_religion', e.target.value)}
              >
                <option value="not_specified">{t.notSpecified}</option>
                <option value="Jewish">{t.jewish}</option>
                <option value="Muslims">{t.muslims}</option>
                <option value="Christian">{t.christian}</option>
                <option value="Druze">{t.druze}</option>
              </select>
            </label>

            <label>
              {t.dormType} *
              <select
                value={addStudentForm.accepted_dorm_type}
                onChange={(e) => handleAddStudentChange('accepted_dorm_type', e.target.value)}
              >
                <option value="">{t.selectDormType}</option>
                {filterOptions?.dorm_types?.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    {dt.name}{dt.region_name ? ` — ${dt.region_name}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t.category}
              <select
                value={addStudentForm.category}
                onChange={(e) => handleAddStudentChange('category', e.target.value)}
              >
                <option value="new">{t.newCategory}</option>
                <option value="continuing">{t.stayingCategory}</option>
                <option value="transfer">{t.transferringCategory}</option>
                <option value="leaving">{t.leavingCategory}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="modal-section">
          <h3>{t.requestReason}</h3>

          <label>
            {t.reason} *
            <textarea
              value={addStudentForm.reason}
              onChange={(e) => handleAddStudentChange('reason', e.target.value)}
              rows={4}
              placeholder={t.addStudentReasonPlaceholder}
            />
          </label>
        </section>
      </div>

      <div className="modal-footer">
        <button
          type="button"
          className="secondary-btn"
          onClick={closeAddStudentModal}
          disabled={addStudentLoading}
        >
          {t.cancel}
        </button>

        <button
          type="button"
          className="primary-btn"
          onClick={submitAddStudentRequest}
          disabled={
            addStudentLoading ||
            !addStudentForm.student_id ||
            !addStudentForm.first_name ||
            !addStudentForm.last_name ||
            !addStudentForm.gender ||
            !addStudentForm.accepted_dorm_type ||
            !addStudentForm.reason
          }
        >
          {addStudentLoading ? t.creating : t.createAddStudentBtn}
        </button>
      </div>
    </div>
  </div>
)}
{showAssignBed && selectedStudent && (
  <div className="modal-overlay" onClick={closeAssignBed}>
    <div className="modal-content xwide" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header-modern">
        <div className="modal-title-wrap">
          <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            <BedDouble size={18} />
          </div>
          <div>
            <h3>{selectedStudent.is_assigned ? 'Reassign Bed' : t.assignBedTitle}</h3>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
              {getName(selectedStudent)} · {selectedStudent.student_id}
            </div>
            {selectedStudent.is_assigned && (
              <div className="reassign-warning">
                ⚠ This student is already assigned. Selecting another room will end the current assignment.
              </div>
            )}
          </div>
        </div>
        <button className="modal-close" onClick={closeAssignBed}><X size={20} /></button>
      </div>

      <div className="assign-modal-body">
        {loadingBeds ? (
          <div className="beds-loading">
            <Loader2 size={24} className="spinner" />
            <span>{t.loadingBeds}</span>
          </div>
        ) : (
          <div className="assign-two-col">
            {/* LEFT — apartment list */}
            <div className="assign-left">
              <div className="beds-summary">
                <BedDouble size={16} />
                <strong>{apartmentGroups.length}</strong> apartments · {availableBeds.length} rooms available
              </div>

              <div className="quick-chips">
                {[
                  { v: 'all', l: 'All' },
                  { v: 'ok', l: 'Best match' },
                  { v: 'empty', l: 'Empty' },
                  { v: 'warning', l: 'Warnings' },
                  { v: 'mismatch', l: 'Conflicts' },
                ].map(c => (
                  <button
                    key={c.v}
                    className={`quick-chip ${bedMatchFilter === c.v ? 'active' : ''}`}
                    onClick={() => setBedMatchFilter(c.v)}
                  >
                    {c.l}
                  </button>
                ))}
              </div>

              {filteredApartments.length === 0 ? (
                <div className="no-beds">
                  <BedDouble size={40} />
                  <p>No matching apartments</p>
                </div>
              ) : (
                <div className="rooms-list">
                  {filteredApartments.map((apt) => {
                    const isDisabled = !apt.is_selectable || apt.match === 'mismatch';
                    const isSelected = selectedApartment?.key === apt.key;
                    const aptStatus =
                      apt.apartment_gender === 'empty' ? 'Apartment is empty' :
                      apt.apartment_gender === 'male' ? 'Male apartment' :
                      apt.apartment_gender === 'female' ? 'Female apartment' :
                      'Mixed apartment';

                    return (
                      <button
                        key={apt.key}
                        type="button"
                        disabled={isDisabled}
                        className={`room-card match-${apt.match} ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                        onClick={() => {
                          if (isDisabled) return;
                          setSelectedApartment(apt);
                          setSelectedRoomInApt(null);
                        }}
                      >
                        {recommendedKeys.has(apt.key) && (
                          <div className="rec-tag">
                            ⭐ {apt._hasRoommateMatch ? 'Roommate request match' : 'Recommended'}
                          </div>
                        )}
                        <div className="room-card-head">
                          <div className="room-loc">
                            <span className="rc-building">Building {apt.building}</span>
                            <span className="rc-sep">·</span>
                            <span>Apartment {apt.apartment}</span>
                          </div>
                          <span className="rc-beds-badge">{apt.free_beds} free</span>
                        </div>
                        {apt.dorm_type && <div className="rc-dorm">{apt.dorm_type}</div>}
                        <div className="rc-status">
                          {apt.available_rooms.length} available room{apt.available_rooms.length !== 1 ? 's' : ''}
                          {apt.apartment_residents.length > 0 && ` · ${apt.apartment_residents.length} resident${apt.apartment_residents.length !== 1 ? 's' : ''}`}
                        </div>
                        <div className="rc-status" style={{ marginTop: 4 }}>{aptStatus}</div>
                        {apt.known_religions.length > 0 && (
                          <div className="rc-religion">{apt.known_religions.join(', ')}</div>
                        )}
                        {apt.unknown_religion_count > 0 && (
                          <div className="rc-religion-warn">{apt.unknown_religion_count} unknown religion</div>
                        )}
                        {apt.match === 'mismatch' && (
                          <div className="rc-tag red">Cannot assign here</div>
                        )}
                        {apt.match === 'warning' && (
                          <div className="rc-tag yellow">⚠ Please verify manually</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT — details panel */}
            <div className="assign-right">
              {!selectedApartment ? (
                <div className="rp-empty">
                  <BedDouble size={48} />
                  <p>Select an apartment from the list</p>
                </div>
              ) : (
                <>
                  <div className="rp-head">
                    <div className="rp-title">Building {selectedApartment.building} · Apartment {selectedApartment.apartment}</div>
                    <div className="rp-meta">
                      <span>{selectedApartment.free_beds} free beds</span>
                      {selectedApartment.dorm_type && <span>{selectedApartment.dorm_type}</span>}
                    </div>
                  </div>

                  {selectedApartment.warnings.length > 0 && (
                    <div className={`rp-warning ${selectedApartment.match === 'mismatch' ? 'red' : 'yellow'}`}>
                      {selectedApartment.warnings.join(' · ')}
                    </div>
                  )}

                  <div className="rp-section-title">
                    Current Residents ({selectedApartment.apartment_residents.length})
                  </div>
                  {selectedApartment.apartment_residents.length > 0 ? (
                    <div className="rp-residents" style={{ marginBottom: 16 }}>
                      {selectedApartment.apartment_residents.map((r) => (
                        <div key={r.id} className="rp-resident">
                          <div className="rp-resident-top">
                            <strong>{r.full_name}</strong>
                            <span className="rp-resident-id">{r.student_id}</span>
                          </div>
                          <div className="rp-resident-tags">
                            <span>{r.city || 'No city'}</span>
                            <span>{r.gender_display || r.gender}</span>
                            <span className={r.religion === 'not_specified' ? 'unknown' : ''}>
                              {r.religion === 'not_specified' ? 'Unknown religion' : r.religion_display}
                            </span>
                            <span>Room {r.room_name} · {r.bed_label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rp-empty-state" style={{ marginBottom: 16 }}>
                      Apartment is empty — no current residents
                    </div>
                  )}

                  <div className="rp-section-title">Choose a Room</div>
                  <div className="rp-rooms">
                    {selectedApartment.available_rooms.map((room) => {
                      const isPicked = selectedRoomInApt?.room_id === room.room_id;
                      return (
                        <button
                          key={room.room_id}
                          type="button"
                          className={`rp-room-pick ${isPicked ? 'picked' : ''}`}
                          onClick={() => setSelectedRoomInApt(room)}
                        >
                          <div className="rp-room-name">Room {room.room_name}</div>
                          <div className="rp-room-meta">{room.available_beds} free bed{room.available_beds !== 1 ? 's' : ''}</div>
                          {isPicked && <div className="rp-room-check">✓ Selected</div>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {assignBedError && <div className="msg error-msg">{assignBedError}</div>}
        {assignBedSuccess && <div className="msg success-msg">{assignBedSuccess}</div>}
      </div>

      <div className="assign-action-bar">
        <button className="btn-secondary" onClick={closeAssignBed} disabled={assigningBed}>{t.cancel}</button>
        <button
          className="btn-assign"
          onClick={submitAssignBed}
          disabled={assigningBed || !selectedRoomInApt || !!assignBedSuccess}
        >
          {assigningBed
            ? <Loader2 size={16} className="spinner" />
            : <><BedDouble size={16} /> {selectedRoomInApt ? `Assign to Room ${selectedRoomInApt.room_name}` : 'Select a room first'}</>}
        </button>
      </div>
    </div>
  </div>
)}
      {/* FILTERS DRAWER */}
      <FiltersDrawer
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={activeFilters}
        onFiltersChange={(next) => setActiveFilters(next)}
        filterOptions={filterOptions}
        totalCount={list.length}
      />

      <style>{`
        .students-page { padding: 28px 32px 60px; background: #f8fafc; min-height: calc(100vh - 80px); }
        .page-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; gap: 16px; flex-wrap: wrap; }
        .page-top h1 { font-size: 28px; font-weight: 800; margin-bottom: 4px; color: #0f172a; letter-spacing: -0.4px; }
        .page-top p { color: #64748b; font-size: 15px; }
        .results-count { background: #eff6ff; color: #1d4ed8; padding: 10px 20px; border-radius: 999px; font-size: 14px; font-weight: 600; }
        .stat-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 22px; }
        .stat-tab { position: relative; background: white; border-radius: 16px; padding: 18px 18px 22px; display: flex; align-items: center; gap: 14px; border: 2px solid transparent; font-family: inherit; cursor: pointer; transition: all 0.18s; text-align: start; box-shadow: 0 2px 8px rgba(15,23,42,0.04); }
        .stat-tab:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(15,23,42,0.08); }
        .stat-icon-wrap { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .stat-text { flex: 1; min-width: 0; }
        .stat-primary { font-weight: 800; color: #0f172a; font-size: 15px; line-height: 1.2; }
        .stat-secondary { font-size: 12px; color: #64748b; font-weight: 600; margin-top: 3px; }
        .stat-count { font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
        .stat-tab.gray   .stat-icon-wrap { background: #f1f5f9; color: #475569; }
        .stat-tab.green  .stat-icon-wrap { background: #d1fae5; color: #059669; }
        .stat-tab.blue   .stat-icon-wrap { background: #dbeafe; color: #2563eb; }
        .stat-tab.purple .stat-icon-wrap { background: #ede9fe; color: #7c3aed; }
        .stat-tab.red    .stat-icon-wrap { background: #fee2e2; color: #dc2626; }
        .stat-tab.active::after { content: ''; position: absolute; left: 22px; right: 22px; bottom: 8px; height: 3px; border-radius: 999px; }
        .stat-tab.gray.active   { border-color: #cbd5e1; } .stat-tab.gray.active::after   { background: #475569; }
        .stat-tab.green.active  { border-color: #6ee7b7; background: #ecfdf5; } .stat-tab.green.active::after  { background: #059669; }
        .stat-tab.blue.active   { border-color: #93c5fd; background: #eff6ff; } .stat-tab.blue.active::after   { background: #2563eb; }
        .stat-tab.purple.active { border-color: #c4b5fd; background: #faf5ff; } .stat-tab.purple.active::after { background: #7c3aed; }
        .stat-tab.red.active    { border-color: #fca5a5; background: #fef2f2; } .stat-tab.red.active::after    { background: #dc2626; }
        .search-row { display: flex; gap: 10px; align-items: stretch; margin-bottom: 12px; }
        .search-box { flex: 1; display: flex; align-items: center; gap: 12px; background: white; padding: 14px 22px; border-radius: 14px; border: 1px solid #e5e7eb; box-shadow: 0 2px 6px rgba(15,23,42,0.04); transition: all 0.2s; }
        .search-box:focus-within { border-color: #3d9fe0; box-shadow: 0 4px 18px rgba(61,159,224,0.15); }
        .search-icon { color: #94a3b8; flex-shrink: 0; }
        .search-box input { flex: 1; border: none; outline: none; font-size: 15px; font-family: inherit; background: transparent; min-width: 0; }
        .clear-btn { background: #f1f5f9; border: none; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: #64748b; cursor: pointer; flex-shrink: 0; }
        .clear-btn:hover { background: #e2e8f0; }
        .spinner { color: #3d9fe0; animation: spin 1s linear infinite; flex-shrink: 0; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .matching-students-btn { display: inline-flex; align-items: center; gap: 10px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 8px 16px; border-radius: 14px; font-family: inherit; cursor: default; white-space: nowrap; min-width: 150px; }
        .matching-number { font-size: 22px; font-weight: 900; line-height: 1; }
        .matching-text { display: flex; flex-direction: column; align-items: flex-start; font-size: 13px; font-weight: 800; line-height: 1.1; }
        .matching-text small { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 3px; }
        .filters-btn { position: relative; display: inline-flex; align-items: center; gap: 8px; background: white; color: #2563eb; border: 1px solid #bfdbfe; padding: 0 22px; border-radius: 14px; font-family: inherit; font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .filters-btn:hover { background: #eff6ff; }
        .filters-btn.has-filters { background: #eff6ff; border-color: #2563eb; }
        .filter-badge { background: #2563eb; color: white; border-radius: 999px; min-width: 20px; height: 20px; padding: 0 6px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .active-filter-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center; }
        .filter-chip { display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 13px; font-weight: 600; padding: 5px 10px; border-radius: 999px; }
        .filter-chip button { display: flex; align-items: center; background: none; border: none; color: #93c5fd; cursor: pointer; padding: 0; }
        .filter-chip button:hover { color: #1d4ed8; }
        .clear-all-chip { background: none; border: 1px solid #e2e8f0; color: #64748b; font-size: 13px; font-weight: 600; padding: 5px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; }
        .clear-all-chip:hover { background: #f1f5f9; }
        .error-box { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; font-weight: 600; }
        .empty-card { background: white; border-radius: 18px; padding: 60px 30px; text-align: center; border: 1px solid #f1f5f9; box-shadow: 0 2px 8px rgba(15,23,42,0.04); }
        .empty-illustration { width: 120px; height: 120px; margin: 0 auto 20px; background: linear-gradient(135deg, #eff6ff, #dbeafe); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #3d9fe0; }
        .empty-card h3 { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
        .empty-card p { color: #64748b; font-size: 15px; margin-bottom: 22px; }
        .clear-filters-btn { padding: 11px 28px; background: transparent; color: #2563eb; border: 1px solid #bfdbfe; border-radius: 12px; font-family: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
        .clear-filters-btn:hover { background: #eff6ff; }
        .results-grid { display: flex; flex-direction: column; gap: 10px; }
        .result-row { background: white; border-radius: 14px; padding: 14px 18px; display: flex; align-items: center; gap: 14px; cursor: pointer; border: 1px solid #f1f5f9; transition: all 0.15s; }
        .result-row:hover { border-color: #3d9fe0; box-shadow: 0 4px 14px rgba(61,159,224,0.10); transform: translateY(-1px); }
        .result-row.removed { border-color: #fecaca; background: #fff8f8; opacity: 0.85; }
        .result-row.removed:hover { border-color: #f87171; }
        .avatar { width: 44px; height: 44px; background: linear-gradient(135deg, #3d9fe0, #2563eb); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 18px; flex-shrink: 0; }
        .avatar.removed { background: linear-gradient(135deg, #fca5a5, #ef4444); }
        .row-info { flex: 1; min-width: 0; }
        .row-name { display: flex; align-items: center; gap: 6px; font-weight: 700; color: #0f172a; font-size: 15px; margin-bottom: 3px; flex-wrap: wrap; }
        .priority-icon { color: #f59e0b; }
        .removed-badge { background: #fee2e2; color: #b91c1c; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
        .row-meta { font-size: 13px; color: #64748b; margin-bottom: 8px; display: flex; gap: 4px; flex-wrap: wrap; }
        .row-badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .mono { font-family: 'SF Mono', Menlo, monospace; }
        .status-badge { display: inline-block; padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .status-badge.assigned { background: #d1fae5; color: #059669; }
        .status-badge.unassigned { background: #fee2e2; color: #dc2626; }
        .cat-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .cat-pill.green  { background: #d1fae5; color: #047857; }
        .cat-pill.blue   { background: #dbeafe; color: #1d4ed8; }
        .cat-pill.purple { background: #ede9fe; color: #6d28d9; }
        .cat-pill.red    { background: #fee2e2; color: #b91c1c; }
        .date-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #f1f5f9; border-radius: 999px; font-size: 12px; color: #475569; }
        .date-chip strong { font-weight: 800; color: #1e293b; }
        .date-chip.removed-date { background: #fee2e2; color: #b91c1c; }
        .detail-wrap { display: flex; flex-direction: column; gap: 20px; }
        .hero-card { background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); border-radius: 22px; padding: 22px 28px 28px; color: white; box-shadow: 0 10px 30px rgba(37,99,235,0.20); position: relative; overflow: hidden; }
        .hero-card.hero-removed { background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); box-shadow: 0 10px 30px rgba(220,38,38,0.20); }
        .hero-card::before { content: ''; position: absolute; top: -50%; right: -10%; width: 400px; height: 400px; background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%); pointer-events: none; }
        .hero-top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; position: relative; flex-wrap: wrap; gap: 10px; }
        .back-pill, .add-request-pill, .assign-bed-pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.18); color: white; border: 1px solid rgba(255,255,255,0.32); padding: 9px 16px; border-radius: 12px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; backdrop-filter: blur(10px); transition: all 0.15s; }
        .back-pill:hover, .add-request-pill:hover, .assign-bed-pill:hover { background: rgba(255,255,255,0.28); }
        .assign-bed-pill { background: rgba(16,185,129,0.25); border-color: rgba(16,185,129,0.5); }
        .assign-bed-pill:hover { background: rgba(16,185,129,0.4) !important; }
        .hero-body { display: flex; gap: 28px; justify-content: space-between; align-items: flex-start; position: relative; flex-wrap: wrap; }
        .hero-left { display: flex; gap: 22px; align-items: center; }
        .hero-avatar { width: 96px; height: 96px; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); border-radius: 24px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 42px; flex-shrink: 0; }
        .hero-info h1 { font-size: 30px; font-weight: 800; margin-bottom: 6px; letter-spacing: -0.4px; }
        .hero-id { font-size: 14px; opacity: 0.9; margin-bottom: 10px; }
        .hero-id strong { font-family: monospace; margin-inline-start: 4px; }
        .hero-badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .hero-status { padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; }
        .hero-status.assigned { background: #d1fae5; color: #059669; }
        .hero-status.unassigned { background: #fee2e2; color: #b91c1c; }
        .hero-removed-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.2); padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; }
        .hero-priority { display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.22); padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .hero-meta { display: flex; flex-direction: column; gap: 10px; min-width: 200px; }
        .hero-meta-row { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .hero-meta-row svg { opacity: 0.85; flex-shrink: 0; }
        .hero-meta-row strong { font-weight: 700; opacity: 0.9; margin-inline-end: 4px; }
        .detail-spinner { position: absolute; top: 20px; right: 50%; color: white; opacity: 0.8; }
        .section-heading { font-size: 17px; font-weight: 800; color: #0f172a; padding: 0 4px; margin-top: 4px; }
        .stats-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
        .stat-card { background: white; border-radius: 16px; padding: 20px 16px; text-align: center; box-shadow: 0 2px 6px rgba(15,23,42,0.04); border: 1px solid #f1f5f9; }
        .mini-stat-icon { width: 56px; height: 56px; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; }
        .mini-stat-icon.blue   { background: #eff6ff; color: #2563eb; }
        .mini-stat-icon.green  { background: #d1fae5; color: #059669; }
        .mini-stat-icon.purple { background: #ede9fe; color: #7c3aed; }
        .mini-stat-icon.orange { background: #ffedd5; color: #ea580c; }
        .mini-stat-icon.yellow { background: #fef3c7; color: #d97706; }
        .stat-label { font-size: 13px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
        .stat-value { font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
        .stat-value.sm { font-size: 20px; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .card { background: white; border-radius: 18px; box-shadow: 0 2px 8px rgba(15,23,42,0.05); border: 1px solid #f1f5f9; overflow: hidden; }
        .card-header { display: flex; align-items: center; gap: 10px; padding: 18px 22px 14px; border-bottom: 1px solid #f8fafc; }
        .card-header h3 { font-size: 16px; font-weight: 800; color: #0f172a; }
        .card-icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .card-icon.contact   { background: #eff6ff; color: #2563eb; }
        .card-icon.housing   { background: #1e293b; color: white; }
        .card-icon.roommates { background: #ede9fe; color: #7c3aed; }
        .card-icon.personal  { background: #f1f5f9; color: #475569; }
        .card-icon.requests  { background: #fef3c7; color: #d97706; }
        .card-body { padding: 8px 22px 18px; }
        .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f8fafc; }
        .info-row:last-child { border-bottom: none; }
        .info-key { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #64748b; font-weight: 600; }
        .info-val { font-size: 15px; font-weight: 700; color: #0f172a; text-align: end; word-break: break-word; }
        .muted { color: #94a3b8; font-size: 14px; font-style: italic; padding: 8px 0; }
        .roommates-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
        .roommate-card { display: flex; align-items: center; gap: 12px; background: #f8fafc; border-radius: 14px; padding: 14px 16px; border: 1px solid #f1f5f9; }
        .rm-avatar { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; flex-shrink: 0; }
        .rm-info { flex: 1; min-width: 0; }
        .rm-name { font-weight: 700; color: #0f172a; font-size: 15px; margin-bottom: 2px; }
        .rm-meta { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 4px; }
        .requests-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .requests-list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f8fafc; }
        .requests-list li:last-child { border-bottom: none; }
        .rq-num { width: 26px; height: 26px; background: #f1f5f9; color: #475569; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; flex-shrink: 0; }
        .rq-name { font-size: 14px; font-weight: 600; color: #0f172a; }
        .priority-notice { display: flex; align-items: center; gap: 10px; padding: 16px 20px; background: #fef9c3; border: 1px solid #fde68a; border-radius: 14px; color: #92400e; font-size: 14px; font-weight: 600; }
        .priority-notice svg { color: #d97706; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal-content { background: white; border-radius: 18px; width: 92%; max-width: 520px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 50px rgba(0,0,0,0.20); }
        .modal-content.wide { max-width: 680px; }
        .modal-header-modern { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%); border-bottom: 1px solid #e5e7eb; }
        .modal-title-wrap { display: flex; align-items: center; gap: 12px; }
        .modal-icon { width: 38px; height: 38px; background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .modal-header-modern h3 { font-size: 19px; font-weight: 800; color: #0f172a; }
        .modal-close { background: white; border: 1px solid #e5e7eb; width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #64748b; cursor: pointer; flex-shrink: 0; }
        .modal-close:hover { background: #f1f5f9; }
        .modal-body { padding: 22px; }
        .selected-student-pill { display: flex; align-items: center; gap: 12px; padding: 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; margin-bottom: 20px; }
        .mini-avatar { background: linear-gradient(135deg, #3d9fe0, #2563eb); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 16px; }
        .ss-name { font-weight: 700; color: #0f172a; font-size: 15px; }
        .ss-meta { font-size: 13px; color: #64748b; }
        .form-section { margin-bottom: 18px; }
        .form-section > label { display: block; font-size: 14px; font-weight: 700; color: #475569; margin-bottom: 10px; }
        .form-section textarea { width: 100%; padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px; font-family: inherit; font-size: 15px; resize: vertical; outline: none; box-sizing: border-box; }
        .form-section textarea:focus { border-color: #3d9fe0; }
        .type-options-modern { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .type-option-modern { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px; border: 2px solid #e5e7eb; background: white; border-radius: 14px; font-family: inherit; font-size: 13px; font-weight: 700; color: #475569; cursor: pointer; transition: all 0.15s; }
        .type-option-modern .opt-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #64748b; }
        .type-option-modern:hover { border-color: #cbd5e1; transform: translateY(-1px); }
        .type-option-modern.active.purple { border-color: #7c3aed; background: #faf5ff; }
        .type-option-modern.active.purple .opt-icon { background: #ede9fe; color: #7c3aed; }
        .type-option-modern.active.purple span { color: #6d28d9; }
        .type-option-modern.active.green { border-color: #059669; background: #f0fdf4; }
        .type-option-modern.active.green .opt-icon { background: #d1fae5; color: #059669; }
        .type-option-modern.active.green span { color: #047857; }
        .type-option-modern.active.orange { border-color: #ea580c; background: #fff7ed; }
        .type-option-modern.active.orange .opt-icon { background: #ffedd5; color: #ea580c; }
        .type-option-modern.active.orange span { color: #c2410c; }
        .type-option-special { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 2px solid #e5e7eb; background: white; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 700; color: #475569; cursor: pointer; transition: all 0.15s; width: 100%; margin-top: 10px; }
        .type-option-special.full-width { width: 100%; box-sizing: border-box; }
        .type-option-special .opt-icon-sm { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #64748b; flex-shrink: 0; }
        .type-option-special:hover { border-color: #cbd5e1; }
        .type-option-special.active.red { border-color: #ef4444; background: #fef2f2; }
        .type-option-special.active.red .opt-icon-sm { background: #fee2e2; color: #ef4444; }
        .type-option-special.active.red span { color: #b91c1c; }
        .type-note { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
        .type-note.red { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .sub-options { display: flex; gap: 10px; flex-wrap: wrap; }
        .sub-option { flex: 1; min-width: 100px; padding: 12px 14px; border: 2px solid #e5e7eb; background: white; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 600; color: #475569; cursor: pointer; transition: all 0.15s; }
        .sub-option:hover { border-color: #cbd5e1; }
        .sub-option.active { background: linear-gradient(135deg, #eff6ff, #dbeafe); border-color: #2563eb; color: #1d4ed8; }
        .msg { padding: 11px 14px; border-radius: 10px; font-size: 14px; margin-bottom: 12px; font-weight: 700; }
        .error-msg { background: #fee2e2; color: #b91c1c; }
        .success-msg { background: #d1fae5; color: #059669; }
        .modal-actions { display: flex; gap: 10px; margin-top: 14px; }
        .btn-secondary { flex: 1; padding: 12px; border: 1px solid #e5e7eb; background: white; border-radius: 12px; font-family: inherit; font-weight: 700; color: #475569; cursor: pointer; font-size: 15px; }
        .btn-primary { flex: 1; padding: 12px; border: none; background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; border-radius: 12px; font-family: inherit; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; }
        .btn-primary.danger { background: linear-gradient(135deg, #f87171, #ef4444); }
        .btn-primary:disabled, .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-assign { flex: 2; padding: 12px; border: none; background: linear-gradient(135deg, #10b981, #059669); color: white; border-radius: 12px; font-family: inherit; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; transition: all 0.15s; }
        .btn-assign:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(5,150,105,0.3); }
        .btn-assign:disabled { opacity: 0.5; cursor: not-allowed; }
        .beds-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 40px; color: #64748b; font-size: 15px; font-weight: 600; }
        .beds-summary { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #475569; font-weight: 600; margin-bottom: 14px; padding: 10px 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; }
        .beds-summary strong { color: #059669; font-size: 18px; font-weight: 800; }
        .no-beds { text-align: center; padding: 40px 20px; color: #94a3b8; }
        .no-beds svg { opacity: 0.4; margin-bottom: 10px; }
        .no-beds p { font-size: 15px; color: #64748b; }
        .beds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 4px; }
        .bed-option { background: white; border: 2px solid #e5e7eb; border-radius: 14px; padding: 14px 16px; cursor: pointer; font-family: inherit; text-align: start; transition: all 0.15s; }
        .bed-option:hover { border-color: #10b981; background: #f0fdf4; transform: translateY(-1px); }
        .bed-option.selected { border-color: #059669; background: #ecfdf5; box-shadow: 0 0 0 3px rgba(5,150,105,0.15); }
        .bed-option-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
        .bed-loc { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #0f172a; flex-wrap: wrap; }
        .bed-building { font-weight: 800; color: #2563eb; }
        .bed-sep { color: #cbd5e1; }
        .bed-count-badge { background: #d1fae5; color: #059669; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
        .bed-option.selected .bed-count-badge { background: #059669; color: white; }
        .bed-dorm-type { font-size: 12px; color: #64748b; font-weight: 600; margin-top: 4px; }
        .bed-selected-check { font-size: 12px; color: #059669; font-weight: 800; margin-top: 6px; }
        .bed-option.match-ok     { border-color: #e5e7eb; }
        .bed-option.match-ok:hover { border-color: #10b981; background: #f0fdf4; }
        .bed-option.match-empty  { border-color: #e5e7eb; background: white; }
        .bed-option.match-empty:hover { border-color: #10b981; background: #f0fdf4; }
        .bed-option.match-mismatch { border-color: #fecaca; background: #fff8f8; }
        .bed-option.match-mismatch:hover { border-color: #ef4444; }
        .bed-option.match-warning { border-color: #fed7aa; background: #fff7ed; }
        .bed-option.match-warning:hover { border-color: #f97316; }
        .bed-option.selected.match-ok      { border-color: #059669; background: #ecfdf5; }
        .bed-option.selected.match-empty   { border-color: #059669; background: #ecfdf5; }
        .bed-option.selected.match-mismatch { border-color: #dc2626; background: #fef2f2; }
        .rec-tag { display: inline-block; background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 999px; margin-bottom: 6px; }
        .rp-rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
        .rp-room-pick { background: white; border: 2px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-family: inherit; text-align: start; transition: all 0.15s; }
        .rp-room-pick:hover { border-color: #10b981; background: #f0fdf4; }
        .rp-room-pick.picked { border-color: #059669; background: #ecfdf5; box-shadow: 0 0 0 3px rgba(5,150,105,0.15); }
        .rp-room-name { font-size: 14px; font-weight: 800; color: #0f172a; }
        .rp-room-meta { font-size: 11px; color: #64748b; font-weight: 600; margin-top: 2px; }
        .modal-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.modal-subtitle {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
}

.modal-icon.blue {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
}

.form-alert {
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 16px;
}

.form-alert.error {
  background: #fee2e2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

.form-alert.success {
  background: #d1fae5;
  color: #047857;
  border: 1px solid #86efac;
}
        .rp-room-check { font-size: 11px; color: #059669; font-weight: 800; margin-top: 4px; }
        .reassign-warning {
                margin-top: 10px;
                background: #fff7ed;
                border: 1px solid #fed7aa;
                color: #c2410c;
                padding: 10px 12px;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 700;
                max-width: 520px;
              }
        .bed-option.selected.match-warning { border-color: #ea580c; background: #fff7ed; }
                .bed-option.disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .bed-option.disabled:hover {
          transform: none;
          background: #fff8f8;
          border-color: #fecaca;
        }

        .apt-summary-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }

        .apt-summary-badge {
          background: #f1f5f9;
          color: #475569;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 999px;
        }

        .apt-summary-badge.empty {
          background: #ecfdf5;
          color: #059669;
        }

        .apt-summary-badge.warning {
          background: #fef3c7;
          color: #b45309;
        }

        .bed-warning-tag.yellow {
          background: #fef3c7;
          color: #b45309;
        }

        .room-card-residents {
          margin-top: 10px;
          padding-top: 9px;
          border-top: 1px solid #e5e7eb;
        }

        .room-card-residents-title {
          font-size: 11px;
          font-weight: 800;
          color: #475569;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .room-card-resident {
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 7px 8px;
          margin-bottom: 6px;
        }

        .resident-main {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: center;
          margin-bottom: 5px;
          font-size: 12px;
          color: #0f172a;
        }

        .resident-id {
          font-family: 'SF Mono', Menlo, monospace;
          font-size: 10px;
          color: #64748b;
          font-weight: 700;
        }

        .resident-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .resident-tags span {
          background: white;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 999px;
        }

        .resident-tags span.unknown {
          background: #fef3c7;
          color: #b45309;
          border-color: #fde68a;
        }
        .bed-warning-tag { font-size: 11px; font-weight: 700; color: #b91c1c; background: #fee2e2; padding: 3px 8px; border-radius: 6px; margin-top: 6px; display: inline-block; }
        .bed-empty-tag { font-size: 11px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 3px 8px; border-radius: 6px; margin-top: 6px; display: inline-block; }
        .tenant-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-top: 12px; }
        .tenant-panel-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: #475569; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
        .tenant-loading { font-size: 13px; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
        .tenant-empty { font-size: 13px; color: #94a3b8; font-style: italic; }
        .tenant-list { display: flex; flex-direction: column; gap: 8px; }
        .tenant-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: white; border-radius: 10px; border: 1px solid #f1f5f9; }
        .tenant-avatar { width: 32px; height: 32px; background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex-shrink: 0; }
        .tenant-info { flex: 1; min-width: 0; }
        .tenant-name { font-size: 14px; font-weight: 700; color: #0f172a; }
        .tenant-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 3px; }
        .tenant-meta span { font-size: 12px; color: #64748b; }
        .tenant-religion { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
        .tenant-religion.jewish { background: #dbeafe; color: #1d4ed8; }
        .tenant-religion.arab   { background: #dcfce7; color: #166534; }
        .modal-content.xwide { max-width: 1100px; }
 .modal-content.xwide { max-width: 1100px; max-height: 92vh; display: flex; flex-direction: column; }
.assign-modal-body { padding: 16px 22px 0; flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.assign-two-col { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; flex: 1; min-height: 0; }
.assign-left { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.rooms-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; flex: 1; min-height: 0; }
.assign-left { display: flex; flex-direction: column; min-height: 0; }
.assign-right { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; overflow-y: auto; }
.quick-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.quick-chip { padding: 5px 12px; background: white; border: 1px solid #e5e7eb; color: #475569; border-radius: 999px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }
.quick-chip:hover { background: #f1f5f9; }
.quick-chip.active { background: #2563eb; border-color: #2563eb; color: white; }
.rooms-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; flex: 1; min-height: 0; }
.room-card { background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; cursor: pointer; font-family: inherit; text-align: start; transition: all 0.15s; }
.room-card:hover:not(:disabled) { border-color: #10b981; transform: translateY(-1px); }
.room-card.selected { border-color: #059669; background: #ecfdf5; box-shadow: 0 0 0 3px rgba(5,150,105,0.15); }
.room-card.disabled { opacity: 0.6; cursor: not-allowed; background: #fff8f8; border-color: #fecaca; }
.room-card.match-empty { border-color: #d1fae5; }
.room-card.match-warning { border-color: #fed7aa; background: #fffbeb; }
.room-card.match-mismatch { border-color: #fecaca; background: #fff8f8; }
.room-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
.room-loc { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #0f172a; flex-wrap: wrap; }
.rc-building { color: #2563eb; }
.rc-sep { color: #cbd5e1; }
.rc-beds-badge { background: #d1fae5; color: #059669; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 999px; }
.rc-dorm { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
.rc-status { font-size: 12px; font-weight: 700; color: #475569; }
.rc-religion { font-size: 11px; color: #64748b; margin-top: 2px; }
.rc-religion-warn { font-size: 11px; color: #b45309; font-weight: 700; margin-top: 2px; }
.rc-tag { font-size: 11px; font-weight: 800; padding: 4px 8px; border-radius: 6px; margin-top: 6px; display: inline-block; }
.rc-tag.red { background: #fee2e2; color: #b91c1c; }
.rc-tag.yellow { background: #fef3c7; color: #b45309; }

.rp-empty { text-align: center; padding: 60px 20px; color: #94a3b8; }
.rp-empty svg { opacity: 0.4; margin-bottom: 10px; }
.rp-head { padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; margin-bottom: 12px; }
.rp-title { font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
.rp-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.rp-meta span { background: white; border: 1px solid #e5e7eb; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #475569; }
.rp-warning { padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; margin-bottom: 12px; }
.rp-warning.red { background: #fee2e2; color: #b91c1c; }
.rp-warning.yellow { background: #fef3c7; color: #b45309; }
.rp-section-title { font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px; }
.rp-residents { display: flex; flex-direction: column; gap: 8px; }
.rp-resident { background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
.rp-resident-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 13px; color: #0f172a; }
.rp-resident-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #64748b; font-weight: 700; }
.rp-resident-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.rp-resident-tags span { background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.rp-resident-tags span.unknown { background: #fef3c7; color: #b45309; }
.rp-empty-state { background: white; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 30px; text-align: center; color: #94a3b8; font-style: italic; font-size: 13px; }

.assign-action-bar { display: flex; gap: 10px; padding: 14px 22px; border-top: 1px solid #e5e7eb; background: white; position: sticky; bottom: 0; }
        .tenant-room { background: #f1f5f9; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #475569; }
        @media (max-width: 1280px) { .stat-tabs { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 1100px) { .stats-row { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 860px) {
          .stat-tabs { grid-template-columns: repeat(2, 1fr); }
          .two-col { grid-template-columns: 1fr; }
          .stats-row { grid-template-columns: repeat(2, 1fr); }
          .hero-body { flex-direction: column; }
          .hero-meta { width: 100%; }
          .search-row { flex-direction: column; }
          .beds-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .students-page { padding: 18px; }
          .stat-tabs { grid-template-columns: 1fr; }
          .stats-row { grid-template-columns: 1fr 1fr; }
          .hero-card { padding: 18px; }
          .hero-avatar { width: 72px; height: 72px; font-size: 32px; }
          .hero-info h1 { font-size: 24px; }
          .roommates-grid { grid-template-columns: 1fr; }
          .type-options-modern { grid-template-columns: 1fr; }
        }
        .add-student-modal {
  max-width: 900px;
  width: 92vw;
  max-height: 88vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.add-student-modal .modal-body {
  padding: 24px;
  overflow-y: auto;
}

.add-student-modal .modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.add-student-modal .modal-header h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #0f172a;
}

.add-student-modal .modal-section {
  margin-bottom: 24px;
  padding: 18px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
}

.add-student-modal .modal-section h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}

.add-student-modal .form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.add-student-modal label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.add-student-modal input,
.add-student-modal select,
.add-student-modal textarea {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 14px;
  color: #0f172a;
  background: white;
  outline: none;
}

.add-student-modal textarea {
  min-height: 100px;
  resize: vertical;
}

.add-student-modal input:focus,
.add-student-modal select:focus,
.add-student-modal textarea:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.add-student-modal .modal-footer {
  padding: 18px 24px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: white;
}

.add-student-modal .secondary-btn,
.add-student-modal .primary-btn {
  border: none;
  border-radius: 12px;
  padding: 11px 18px;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.add-student-modal .secondary-btn {
  background: #f1f5f9;
  color: #334155;
}

.add-student-modal .primary-btn {
  background: #2563eb;
  color: white;
}

.add-student-modal .secondary-btn:disabled,
.add-student-modal .primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .add-student-modal .form-grid {
    grid-template-columns: 1fr;
  }
}
.page-top-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.add-student-primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 16px;
  padding: 14px 22px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(37, 99, 235, 0.25);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  white-space: nowrap;
}

.add-student-primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 30px rgba(37, 99, 235, 0.32);
}

.add-student-plus {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
  font-weight: 900;
}

@media (max-width: 900px) {
  .page-top-actions {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .add-student-primary-btn {
    justify-content: center;
    width: 100%;
  }
}
      `}</style>
    </div>
  );
}

export default StudentsPage;