import React, { useState, useEffect, useRef } from 'react';
import FiltersDrawer from '../components/FiltersDrawer';
import BedMatchPicker, { assignActionLabel, mergeBuildings } from '../components/BedMatchPicker';
import { studentsAPI, requestsAPI, regionsAPI, api } from '../services/api';
import { localizeRegionName, localizeDormTypeName } from '../utils/locationNames';
import { localizeGender } from '../utils/genderLabels';
import { useAuth } from '../context/AuthContext';
import {
  Search, Star, X, Users, Phone, Mail, Home, MapPin,
  BedDouble, Building2, User, Loader2, ArrowLeft, Contact2, Plus,
  DoorOpen, Tag, FileText, Calendar, LogIn, LogOut, RefreshCw,
  UserPlus, FileSearch, Filter, UserCheck, UserMinus, AlertTriangle,
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
  const { user, isCentralAdmin } = useAuth();
  // ---------- STATE ----------
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [list, setList] = useState([]);
  // Backend now paginates (StandardResultsPagination, 25/page) - listTotal
  // is the real server-side count (for the header/results text), separate
  // from list.length (just the currently-loaded page(s)).
  const [listTotal, setListTotal] = useState(0);
  const [listNextUrl, setListNextUrl] = useState(null);
  const [loadingMoreStudents, setLoadingMoreStudents] = useState(false);
  const [counts, setCounts] = useState({ all: 0, new: 0, continuing: 0, transfer: 0, leaving: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const debounceRef = useRef(null);
  // Cancels the in-flight list request when a new search/filter fires before
  // it resolves, so a slow earlier response can never overwrite fresher
  // results (previously a real race: fast typing could show stale results).
  const listAbortRef = useRef(null);
  const [selectedRoomInApt, setSelectedRoomInApt] = useState(null);
  const [studentRequests, setStudentRequests] = useState([]);
  const [loadingStudentRequests, setLoadingStudentRequests] = useState(false);
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
    const [addStudentFieldErrors, setAddStudentFieldErrors] = useState({});
    const [addStudentSuccess, setAddStudentSuccess] = useState('');
    const [addStudentRegions, setAddStudentRegions] = useState([]);
    const [addStudentForm, setAddStudentForm] = useState({
      student_id: '',
      first_name: '',
      last_name: '',
      phone: '',
      email: '',
      city: '',
      gender: '',
      requested_religion: 'not_specified',
      region: '',
      accepted_dorm_type: '',
      housing_type: '',
      category: 'new',
      reason: '',
    });

    // Edit Student modal state - shares field shape with Add Student, but
    // pre-filled from an existing student and saved via PATCH. Reachable
    // both from the student detail page and from the "missing data" blocking
    // message inside the Assign Bed modal (§3).
    const [showEditStudentModal, setShowEditStudentModal] = useState(false);
    const [editStudentLoading, setEditStudentLoading] = useState(false);
    const [editStudentError, setEditStudentError] = useState('');
    const [editStudentFieldErrors, setEditStudentFieldErrors] = useState({});
    const [editStudentSuccess, setEditStudentSuccess] = useState('');
    const [editStudentTarget, setEditStudentTarget] = useState(null);
    const [editStudentForm, setEditStudentForm] = useState({
      first_name: '', last_name: '', phone: '', email: '', city: '',
      gender: '',
      requested_religion: 'not_specified',
      region: '', accepted_dorm_type: '', housing_type: '', category: 'new',
    });
    // When Edit Student is opened from the Assign Bed "missing data"
    // blocking message, remember that so saving can re-open the assign
    // modal and re-run match-options instead of just closing.
    const [editStudentReturnToAssign, setEditStudentReturnToAssign] = useState(false);

  const [showAddRequest, setShowAddRequest] = useState(false);
  const [reqType, setReqType] = useState('transfer');
  // Unified transfer scope: same_apartment / same_region / cross_region -
  // maps onto the existing request fields (request_type / same_apartment /
  // transfer_scope / destination_regions), no new backend fields.
  const [reqScope, setReqScope] = useState(null);
  // Holds the selected target region ID as a NUMBER (never a name/string) -
  // the backend expects real Region PKs in destination_regions.
  const [reqTargetRegion, setReqTargetRegion] = useState(null);
  const [reqRegions, setReqRegions] = useState([]);
  const [reqOtherDesc, setReqOtherDesc] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState('');
  const [reqSuccess, setReqSuccess] = useState('');

  // Assign Bed modal state - buildings are the pagination unit; each loaded
  // building carries its complete apartment/room/bed subtree.
  const [showAssignBed, setShowAssignBed] = useState(false);
  const [availableBuildings, setAvailableBuildings] = useState([]);
  const [bedResultMeta, setBedResultMeta] = useState({
    total_valid_beds: 0, total_buildings: 0, total_apartments: 0, total_rooms: 0,
    has_more: false, conflict_examples: [], counts: null, data_integrity: null,
  });
  const [loadMoreBedsError, setLoadMoreBedsError] = useState('');
  const [assignBedStudent, setAssignBedStudent] = useState(null);
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [loadingMoreBeds, setLoadingMoreBeds] = useState(false);
  const [assigningBed, setAssigningBed] = useState(false);
  const [assignBedError, setAssignBedError] = useState('');
  const [assignBedSuccess, setAssignBedSuccess] = useState('');
  // Set when match-options returns a single student-level blocking reason
  // (missing housing_type/region/etc.) instead of per-room results - the
  // modal then shows one clear message + an edit-student shortcut instead
  // of listing the same conflict on every candidate room (§3).
  const [assignBedBlockingField, setAssignBedBlockingField] = useState(null);
  // Central-admin-only region override for the assign/reassign search - null
  // means "use the student's own home region" (the backend default). Never
  // sent for regional users; the backend ignores/locks it to their own
  // region regardless, but the selector itself is simply not shown to them.
  const [assignRegionOverride, setAssignRegionOverride] = useState(null);

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
      studentRequestsTitle: 'בקשות עבור סטודנט זה',
      loading: 'טוען...',
      phone: 'טלפון', email: 'אימייל', city: 'עיר',
      building: 'בניין', apartment: 'דירה', room: 'חדר', bed: 'מיטה', dormType: 'סוג מעון',
      gender: 'מגדר', religion: 'דת', category: 'קטגוריה',
      assigned: 'משובץ', unassigned: 'לא משובץ',
      noRoommates: 'אין שותפים נוספים בחדר',
      notAssigned: 'הסטודנט אינו משובץ לחדר כרגע',
      priority: 'עדיפות', currentAssignment: 'פרטי השיבוץ הנוכחי',
      addRequest: 'הוסף בקשה', newRequestTitle: 'בקשה חדשה',
      requestType: 'סוג בקשה',
      typeTransfer: 'בקשת מעבר', typeOther: 'בקשה אחרת',
      typeRemoveStudent: 'הסרה מהמעונות',
      scopeLabel: 'סוג המעבר',
      scopeSameApt: 'בתוך אותה דירה',
      scopeSameRegion: 'לדירה אחרת באותו אזור',
      scopeCrossRegion: 'לאזור אחר',
      targetRegionLabel: 'אזור יעד',
      selectTargetRegion: 'בחר אזור יעד',
      missingScope: 'יש לבחור את סוג המעבר',
      missingTargetRegion: 'יש לבחור אזור יעד',
      centralOnlyCross: 'רק מנהל מרכזי יכול ליצור מעבר לאזור אחר',
      crossRegionLockedNote: 'משתמש אזורי מוגבל לאזור המורשה שלו',
      removeStudentNote: 'הסטודנט יוסר מהמעונות ומיטתו תתפנה לאחר אישור המנהל.',
      removeReasonPlaceholder: 'סיבת ההסרה מהמעונות...',
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
      addStudentRequest: 'הוספת סטודנט',
      createAddStudentRequest: 'הוספת סטודנט חדש',
      addStudentSubtitle: 'הסטודנט יישמר במערכת באופן מיידי.',
      studentIdentity: 'פרטי הסטודנט',
      contact: 'פרטי קשר',
      housingPlacement: 'שיבוץ ומעונות',
      requestReason: 'הערות',
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
      reason: 'הערות',
      selectGender: 'בחר מגדר',
      male: localizeGender('male', 'he'),
      female: localizeGender('female', 'he'),
      notSpecified: 'לא צוין',
      jewish: 'יהודי',
      muslims: 'מוסלמי',
      christian: 'נוצרי',
      druze: 'דרוזי',
      selectDormType: 'בחר סוג מעון',
      selectRegionFirst: 'בחר אזור תחילה',
      newCategory: 'חדש',
      stayingCategory: 'ממשיך',
      transferringCategory: 'עובר',
      leavingCategory: 'עוזב',
      createAddStudentBtn: 'שמור סטודנט',
      saveAndMatchBtn: 'שמור וחפש שיבוץ מתאים',
      creating: 'שומר...',
      fillRequiredFields: 'יש למלא את כל שדות החובה.',
      addStudentSuccess: 'הסטודנט נוסף בהצלחה.',
      addStudentFailed: 'הוספת הסטודנט נכשלה.',
      contactInfo: 'פרטי קשר',
      addStudentReasonPlaceholder: 'הערות נוספות (אופציונלי)',
      selectRegion: 'בחר אזור',
      myRegionLabel: 'אזור',
      noMatchFound: 'הסטודנט נשמר, אך לא נמצא שיבוץ מתאים כרגע.',
      housingType: 'סוג דיור',
      selectHousingType: 'בחר סוג דיור',
      // Edit Student
      editStudentBtn: 'עריכת פרטי הסטודנט',
      editStudentTitle: 'עריכת פרטי סטודנט',
      editStudentSubtitle: 'שינויים יישמרו במערכת באופן מיידי.',
      saveEditStudentBtn: 'שמור שינויים',
      editStudentSuccess: 'פרטי הסטודנט עודכנו בהצלחה.',
      editStudentFailed: 'עדכון פרטי הסטודנט נכשל.',
      // Assign-modal blocking message (student-level, not per-room)
      assignBlockedTitle: 'לא ניתן לבצע שיבוץ',
      assignBlockedHousingType: 'לא ניתן לבצע שיבוץ: חסר סוג דיור בפרטי הסטודנט.',
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
      studentRequestsTitle: 'Requests For This Student',
      loading: 'Loading...',
      phone: 'Phone', email: 'Email', city: 'City',
      building: 'Building', apartment: 'Apartment', room: 'Room', bed: 'Bed', dormType: 'Dorm Type',
      gender: 'Gender', religion: 'Religion', category: 'Category',
      assigned: 'Assigned', unassigned: 'Unassigned',
      noRoommates: 'No other roommates in this room',
      notAssigned: 'Student is not currently assigned to a room',
      priority: 'Priority', currentAssignment: 'Current Assignment',
      addRequest: 'Add Request', newRequestTitle: 'New Request',
      requestType: 'Request type',
      typeTransfer: 'Transfer request', typeOther: 'Other request',
      typeRemoveStudent: 'Remove from Dorms',
      scopeLabel: 'Transfer scope',
      scopeSameApt: 'Within the same apartment',
      scopeSameRegion: 'Different apartment, same region',
      scopeCrossRegion: 'Move to another region',
      targetRegionLabel: 'Target region',
      selectTargetRegion: 'Select target region',
      missingScope: 'Please choose the transfer scope',
      missingTargetRegion: 'Please select a target region',
      centralOnlyCross: 'Only a central admin can create a cross-region transfer',
      crossRegionLockedNote: 'Regional users are limited to their own region',
      removeStudentNote: 'The student will be removed from dorms and their bed freed after admin approval.',
      removeReasonPlaceholder: 'Reason for removal from dorms...',
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
      // add student
      addStudentRequest: 'Add Student',
      createAddStudentRequest: 'Add New Student',
      addStudentSubtitle: 'The student will be saved immediately.',
      studentIdentity: 'Student identity',
      housingPlacement: 'Housing / placement',
      requestReason: 'Notes',
      firstName: 'First name',
      lastName: 'Last name',
      phone: 'Phone',
      email: 'Email',
      city: 'City',
      gender: 'Gender',
      religion: 'Religion',
      dormType: 'Dorm Type',
      category: 'Category',
      reason: 'Notes',
      selectGender: 'Select gender',
      male: localizeGender('male', 'en'),
      female: localizeGender('female', 'en'),
      notSpecified: 'Not specified',
      jewish: 'Jewish',
      muslims: 'Muslims',
      christian: 'Christian',
      druze: 'Druze',
      selectDormType: 'Select dorm type',
      selectRegionFirst: 'Select a region first',
      newCategory: 'New',
      stayingCategory: 'Staying',
      transferringCategory: 'Transferring',
      leavingCategory: 'Leaving',
      createAddStudentBtn: 'Save Student',
      saveAndMatchBtn: 'Save and Find Matching Accommodation',
      creating: 'Saving...',
      fillRequiredFields: 'Please fill all required fields.',
      addStudentSuccess: 'Student added successfully.',
      addStudentFailed: 'Failed to add student.',
      contactInfo: 'Contact',
      addStudentReasonPlaceholder: 'Additional notes (optional)',
      selectRegion: 'Select region',
      myRegionLabel: 'Region',
      noMatchFound: 'Student saved, but no matching accommodation was found right now.',
      housingType: 'Housing Type',
      selectHousingType: 'Select housing type',
      // Edit Student
      editStudentBtn: 'Edit Student Details',
      editStudentTitle: 'Edit Student',
      editStudentSubtitle: 'Changes are saved immediately.',
      saveEditStudentBtn: 'Save Changes',
      editStudentSuccess: 'Student details updated successfully.',
      editStudentFailed: 'Failed to update student details.',
      // Assign-modal blocking message (student-level, not per-room)
      assignBlockedTitle: 'Assignment blocked',
      assignBlockedHousingType: 'Cannot assign a bed: this student is missing a housing type.',
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
    return region ? localizeRegionName(region, language) : regionId;
  };

  const getBuildingName = (buildingId) => {
    const building = filterOptions?.buildings?.find((b) => String(b.id) === String(buildingId));
    return building ? `Building ${building.name}` : `Building ${buildingId}`;
  };
  // Matching/scoring is now computed server-side (find_matching_room_options
  // in the backend) and returned ready-to-render on each option
  // (match_score, match_level, matched_preferences, warnings, conflicts) -
  // BedMatchPicker consumes that directly, so no client-side re-scoring here.

  // Esc closes the Assign/Reassign Bed modal (§13 accessibility).
  useEffect(() => {
    if (!showAssignBed) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeAssignBed();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showAssignBed]); // eslint-disable-line

  // ---------- DATA LOADING ----------
  useEffect(() => { loadCounts(); }, []); // eslint-disable-line
  useEffect(() => {
    studentsAPI.getFilterOptions().then(setFilterOptions).catch(console.error);
  }, []);
  useEffect(() => {
    if (isCentralAdmin()) {
      regionsAPI.getAll().then(setAddStudentRegions).catch(() => setAddStudentRegions([]));
    }
  }, []); // eslint-disable-line
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
    if (listAbortRef.current) listAbortRef.current.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    try {
      setLoading(true); setError('');
      const params = {};
      if (activeTab !== 'all') params.category = activeTab;
      const q = searchQuery.trim();
      if (q.length >= 2) params.search = q;
      // Map drawer state -> the exact backend query params. The backend
      // reads gender/requested_religion/region/dorm_type/building/apartment/
      // room (comma-joined for multi) + status + has_roommate_request -
      // NEVER the raw frontend keys (genders/regions/...), which it ignores.
      const f = activeFilters;
      if (f.genders?.length) params.gender = f.genders.join(',');
      if (f.religions?.length) params.requested_religion = f.religions.join(',');
      if (f.regions?.length) params.region = f.regions.join(',');
      if (f.dormTypes?.length) params.dorm_type = f.dormTypes.join(',');
      if (f.buildings?.length) params.building = f.buildings.join(',');
      if (f.apartments?.length) params.apartment = f.apartments.join(',');
      if (f.rooms?.length) params.room = f.rooms.join(',');
      if (f.assignmentStatuses?.length) params.status = f.assignmentStatuses[0];
      if (f.hasRoommateRequest?.length) params.has_roommate_request = f.hasRoommateRequest[0];
      const data = await studentsAPI.getStudents(params, { signal: controller.signal });
      const items = Array.isArray(data) ? data : (data.results || []);
      setList(items);
      // Paginated response shape: {count, next, previous, results}. A plain
      // array (older/mocked callers) has no server-side total beyond what
      // was returned.
      setListTotal(Array.isArray(data) ? items.length : (data.count ?? items.length));
      setListNextUrl(Array.isArray(data) ? null : (data.next || null));
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      setError(err.message || 'Failed to load students');
      setList([]);
      setListTotal(0);
      setListNextUrl(null);
    } finally {
      if (listAbortRef.current === controller) setLoading(false);
    }
  };

  // "Load more" appends the next page rather than re-fetching everything -
  // the Students page must not pull the whole table just to show a bit more
  // of the current search/filter result.
  const loadMoreStudents = async () => {
    if (!listNextUrl || loadingMoreStudents) return;
    try {
      setLoadingMoreStudents(true);
      const { data } = await api.get(listNextUrl);
      setList((prev) => [...prev, ...(data.results || [])]);
      setListNextUrl(data.next || null);
    } catch (err) {
      console.error('Failed to load more students:', err);
    } finally {
      setLoadingMoreStudents(false);
    }
  };

  const loadFullDetails = async (student) => {
    try {
      setLoadingDetails(true); setSelectedStudent(student);
      const full = await studentsAPI.getById(student.id);
      setSelectedStudent(full);
      loadStudentRequests(full.id);
    } catch (err) { console.error('Failed to load full student details:', err); }
    finally { setLoadingDetails(false); }
  };

  const loadStudentRequests = async (studentId) => {
    try {
      setLoadingStudentRequests(true);
      const data = await studentsAPI.getRequests(studentId);
      setStudentRequests(data);
    } catch (err) {
      console.error('Failed to load student requests:', err);
      setStudentRequests([]);
    } finally { setLoadingStudentRequests(false); }
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
    setReqType(selectedStudent?.is_assigned ? 'transfer' : 'other');
    setReqScope(null); setReqTargetRegion(null); setReqOtherDesc('');
    setReqReason(''); setReqError(''); setReqSuccess('');
    setShowAddRequest(true);
    // Real regions from the backend for the cross-region dropdown
    // (central admin only - regional users cannot pick another region).
    if (isCentralAdmin() && reqRegions.length === 0) {
      regionsAPI.getAll().then(setReqRegions).catch(() => setReqRegions([]));
    }
  };
  const closeAddRequest = () => setShowAddRequest(false);

  const submitAddRequest = async () => {
    if (!selectedStudent || !reqReason.trim()) { setReqError(t.missingReason); return; }
    if (reqType === 'other' && !reqOtherDesc.trim()) { setReqError(t.missingOtherDesc); return; }
    if (reqType === 'transfer' && !reqScope) { setReqError(t.missingScope); return; }
    // Never rely on the backend's "Invalid pk" error: a cross-region
    // transfer must carry one real Region PK before submit. Region PKs are
    // slug strings (e.g. "broshim"), so validity = non-empty, not numeric.
    if (reqType === 'transfer' && reqScope === 'cross_region'
        && !(reqTargetRegion != null && String(reqTargetRegion).trim() !== '')) {
      setReqError(t.missingTargetRegion); return;
    }
    try {
      setReqSubmitting(true); setReqError('');
      const payload = { student: selectedStudent.id, request_type: reqType, reason: reqReason.trim() };
      if (reqType === 'transfer') {
        // Scope -> existing backend fields, mirroring the Transfers page:
        //   same_apartment -> room      + same_apartment=true
        //   same_region    -> apartment + same_apartment=false
        //   cross_region   -> apartment + cross_region + destination_regions
        payload.request_type = reqScope === 'same_apartment' ? 'room' : 'apartment';
        payload.same_apartment = reqScope === 'same_apartment' ? true : reqScope === 'same_region' ? false : null;
        payload.transfer_scope = reqScope === 'cross_region' ? 'cross_region' : 'same_region';
        payload.destination_regions = reqScope === 'cross_region'
          ? [reqTargetRegion].filter((v) => v != null && String(v).trim() !== '')
          : [];
      }
      if (reqType === 'other') payload.other_description = reqOtherDesc.trim();
      await requestsAPI.create(payload);
      setReqSuccess(t.requestSubmitted);
      loadStudentRequests(selectedStudent.id);
      setTimeout(() => { closeAddRequest(); setReqSuccess(''); }, 1500);
    } catch (err) {
      setReqError(err.message || 'Failed to create request');
    } finally { setReqSubmitting(false); }
  };

  // Single source of truth for the submit button. Cross-region transfer
  // needs ONLY: student + scope + valid region PK + non-empty reason.
  // Room/apartment/bed are chosen later, at APPROVAL time - never required
  // to create the request.
  // NOTE: Region PKs in this project are SLUG STRINGS (e.g. "broshim",
  // "technion") - never validate them numerically.
  const reqRegionValid = reqTargetRegion != null && String(reqTargetRegion).trim() !== '';
  const reqDisabledReason =
    reqSubmitting ? 'submitting'
    : reqSuccess ? 'already-submitted'
    : !selectedStudent ? 'no-student'
    : !reqReason.trim() ? 'empty-reason'
    : (reqType === 'transfer' && !reqScope) ? 'no-scope'
    : (reqType === 'transfer' && reqScope === 'cross_region' && !reqRegionValid) ? 'invalid-target-region'
    : (reqType === 'other' && !reqOtherDesc.trim()) ? 'empty-other-description'
    : null;
  const canSubmitRequest = !reqDisabledReason;

  // ---------- ASSIGN BED MODAL ----------
  const openAssignBed = async (studentOverride) => {
    const targetStudent = studentOverride || selectedStudent;
    if (!targetStudent) return;
    setAssignBedStudent(targetStudent);
    setShowAssignBed(true);
    setSelectedRoomInApt(null);
    setAssignRegionOverride(null); // reset to the student's own home region on every open
    setAssignBedError(''); setAssignBedSuccess(''); setAssignBedBlockingField(null);
    try {
      setLoadingBeds(true);
      const data = await studentsAPI.getAvailableBeds(targetStudent.id, { offset: 0 });
      setAvailableBuildings(data.buildings || []);
      setLoadMoreBedsError('');
      setBedResultMeta({
        total_valid_beds: data.total_valid_beds || 0,
        total_buildings: data.total_buildings || 0,
        total_apartments: data.total_apartments || 0,
        total_rooms: data.total_rooms || 0,
        has_more: !!data.has_more,
        conflict_examples: data.conflict_examples || [],
        counts: data.counts || null,
        data_integrity: data.data_integrity || null,
      });
      setAssignBedBlockingField(data.blocking_field || null);
      if (data.blocking_field) setAssignBedError(data.reason || '');
    } catch (err) {
      setAssignBedError(err.message || 'Failed to load beds');
    } finally { setLoadingBeds(false); }
  };

  const retryLoadBeds = () => loadBedsForRegion(assignRegionOverride);

  // Re-runs the search from scratch (offset 0) for a given region - shared
  // by the initial load, retry, and the region selector's onChange so all
  // three stay in sync instead of drifting into separate fetch paths.
  const loadBedsForRegion = async (regionId) => {
    if (!assignBedStudent) return;
    setSelectedRoomInApt(null);
    setAssignBedError(''); setAssignBedBlockingField(null);
    try {
      setLoadingBeds(true);
      const data = await studentsAPI.getAvailableBeds(assignBedStudent.id, {
        offset: 0, regionId: regionId || undefined,
      });
      setAvailableBuildings(data.buildings || []);
      setLoadMoreBedsError('');
      setBedResultMeta({
        total_valid_beds: data.total_valid_beds || 0,
        total_buildings: data.total_buildings || 0,
        total_apartments: data.total_apartments || 0,
        total_rooms: data.total_rooms || 0,
        has_more: !!data.has_more,
        conflict_examples: data.conflict_examples || [],
        counts: data.counts || null,
        data_integrity: data.data_integrity || null,
      });
      setAssignBedBlockingField(data.blocking_field || null);
      if (data.blocking_field) setAssignBedError(data.reason || '');
    } catch (err) {
      setAssignBedError(err.message || 'Failed to load beds');
    } finally { setLoadingBeds(false); }
  };

  const handleAssignRegionChange = (regionId) => {
    setAssignRegionOverride(regionId || null);
    loadBedsForRegion(regionId || null);
  };

  const loadMoreBeds = async () => {
    if (!assignBedStudent || loadingMoreBeds) return;
    try {
      setLoadingMoreBeds(true);
      setLoadMoreBedsError('');
      // offset = BUILDINGS already loaded, exactly as the backend expects
      // for the next page - appended, never replacing what's already shown.
      const data = await studentsAPI.getAvailableBeds(assignBedStudent.id, {
        offset: availableBuildings.length, regionId: assignRegionOverride || undefined,
      });
      setAvailableBuildings((prev) => mergeBuildings(prev, data.buildings));
      setBedResultMeta((prev) => ({ ...prev, has_more: !!data.has_more }));
    } catch (err) {
      setLoadMoreBedsError(err.message || 'Failed to load more buildings');
    } finally { setLoadingMoreBeds(false); }
  };

const closeAssignBed = () => {
  setShowAssignBed(false);
  setSelectedRoomInApt(null);
  setAvailableBuildings([]);
  setLoadMoreBedsError('');
  setBedResultMeta({ total_valid_beds: 0, total_buildings: 0, total_apartments: 0, total_rooms: 0, has_more: false, conflict_examples: [], counts: null, data_integrity: null });
  setAssignBedStudent(null);
  setAssignRegionOverride(null);
  setAssignBedError(''); setAssignBedSuccess('');
  setAssignBedBlockingField(null);
  setLoadingMoreBeds(false);
};
  const submitAssignBed = async () => {
  if (!selectedRoomInApt || !assignBedStudent) return;
  try {
    setAssigningBed(true); setAssignBedError('');
    if (assignBedStudent.is_assigned) {
      await studentsAPI.reassignBed(assignBedStudent.id, selectedRoomInApt.room_id, selectedRoomInApt.bed_id);
    } else {
      await studentsAPI.assignBed(assignBedStudent.id, selectedRoomInApt.room_id, selectedRoomInApt.bed_id);
    }
    setAssignBedSuccess(t.assignSuccess);
    setTimeout(async () => {
      const studentId = assignBedStudent.id;
      closeAssignBed();
      const full = await studentsAPI.getById(studentId);
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
    region: '',
    accepted_dorm_type: '',
    housing_type: '',
    category: 'new',
    reason: '',
  });
  setAddStudentFieldErrors({});
};

const handleAddStudentChange = (field, value) => {
  setAddStudentError('');
  setAddStudentSuccess('');
  setAddStudentFieldErrors((prev) => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });

  setAddStudentForm((prev) => {
    const next = { ...prev, [field]: value };
    // Changing the region invalidates whatever dorm type was picked from the previous region's list.
    if (field === 'region') next.accepted_dorm_type = '';
    return next;
  });
};

const closeAddStudentModal = () => {
  if (addStudentLoading) return;

  setShowAddStudentModal(false);
  setAddStudentError('');
  setAddStudentSuccess('');
  resetAddStudentForm();
};

// Central admins pick a region first, which narrows the dorm-type list to
// that region (accepted_dorm_type is what actually carries the student's
// region - there is no separate region field on Student). Regional staff's
// dorm-type list is already scoped to their own region server-side.
const addStudentDormTypeOptions = () => {
  const all = filterOptions?.dorm_types || [];
  if (!isCentralAdmin()) return all;
  if (!addStudentForm.region) return [];
  return all.filter((dt) => String(dt.region_id) === String(addStudentForm.region));
};

const submitAddStudent = async (mode) => {
  setAddStudentError('');
  setAddStudentFieldErrors({});
  setAddStudentSuccess('');

  const required = ['student_id', 'first_name', 'last_name', 'gender'];
  // housing_type/accepted_dorm_type (and region, for a central admin) are
  // only required for a student actually eligible for assignment - mirrors
  // Student.is_assignment_eligible on the backend (leaving students exempt).
  if (addStudentForm.category !== 'leaving') {
    required.push('accepted_dorm_type', 'housing_type');
    if (isCentralAdmin()) required.push('region');
  }

  const missing = required.filter((field) => !String(addStudentForm[field] || '').trim());
  if (missing.length > 0) {
    setAddStudentError(t.fillRequiredFields);
    return;
  }

  const payload = {
    student_id: addStudentForm.student_id.trim(),
    first_name: addStudentForm.first_name.trim(),
    last_name: addStudentForm.last_name.trim(),
    phone: addStudentForm.phone.trim(),
    email: addStudentForm.email.trim(),
    city: addStudentForm.city.trim(),
    gender: addStudentForm.gender,
    requested_religion: addStudentForm.requested_religion || 'not_specified',
    accepted_dorm_type: addStudentForm.accepted_dorm_type || null,
    housing_type: addStudentForm.housing_type || '',
    category: addStudentForm.category || 'new',
  };

  try {
    setAddStudentLoading(true);
    const created = await studentsAPI.create(payload);
    setAddStudentSuccess(t.addStudentSuccess);
    loadList();
    loadCounts();

    if (mode === 'save_and_match') {
      setTimeout(() => {
        setShowAddStudentModal(false);
        setAddStudentSuccess('');
        resetAddStudentForm();
        setSelectedStudent(created);
        openAssignBed(created);
      }, 500);
    } else {
      setTimeout(() => {
        setShowAddStudentModal(false);
        setAddStudentSuccess('');
        resetAddStudentForm();
      }, 900);
    }
  } catch (err) {
    if (err.fieldErrors) setAddStudentFieldErrors(err.fieldErrors);
    setAddStudentError(err.message || t.addStudentFailed);
  } finally {
    setAddStudentLoading(false);
  }
};

// ---------- EDIT STUDENT MODAL ----------
// Opened either from the student detail page, or from the Assign Bed
// modal's "missing data" blocking message (returnToAssign=true re-opens the
// assign flow and re-runs match-options after a successful save instead of
// just closing).
const openEditStudent = (student, { returnToAssign = false } = {}) => {
  if (!student) return;
  setEditStudentTarget(student);
  setEditStudentReturnToAssign(returnToAssign);
  setEditStudentError('');
  setEditStudentFieldErrors({});
  setEditStudentSuccess('');
  setEditStudentForm({
    first_name: student.first_name || '',
    last_name: student.last_name || '',
    phone: student.phone || '',
    email: student.email || '',
    city: student.city || '',
    gender: student.gender || '',
    requested_religion: student.requested_religion || 'not_specified',
    region: student.region_id != null ? String(student.region_id) : '',
    accepted_dorm_type: student.accepted_dorm_type != null ? String(student.accepted_dorm_type) : '',
    housing_type: student.housing_type || '',
    category: student.category || 'new',
  });
  setShowEditStudentModal(true);
};

const closeEditStudentModal = () => {
  if (editStudentLoading) return;
  setShowEditStudentModal(false);
  setEditStudentTarget(null);
  setEditStudentError('');
  setEditStudentFieldErrors({});
  setEditStudentSuccess('');
  setEditStudentReturnToAssign(false);
};

const handleEditStudentChange = (field, value) => {
  setEditStudentError('');
  setEditStudentSuccess('');
  setEditStudentFieldErrors((prev) => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });
  setEditStudentForm((prev) => {
    const next = { ...prev, [field]: value };
    if (field === 'region') next.accepted_dorm_type = '';
    return next;
  });
};

// Same region -> dorm-type scoping rule as Add Student.
const editStudentDormTypeOptions = () => {
  const all = filterOptions?.dorm_types || [];
  if (!isCentralAdmin()) return all;
  if (!editStudentForm.region) return [];
  return all.filter((dt) => String(dt.region_id) === String(editStudentForm.region));
};

const submitEditStudent = async () => {
  if (!editStudentTarget) return;
  setEditStudentError('');
  setEditStudentFieldErrors({});
  setEditStudentSuccess('');

  const required = ['first_name', 'last_name', 'gender'];
  if (editStudentForm.category !== 'leaving') {
    required.push('accepted_dorm_type', 'housing_type');
    if (isCentralAdmin()) required.push('region');
  }
  const missing = required.filter((field) => !String(editStudentForm[field] || '').trim());
  if (missing.length > 0) {
    setEditStudentError(t.fillRequiredFields);
    return;
  }

  const payload = {
    first_name: editStudentForm.first_name.trim(),
    last_name: editStudentForm.last_name.trim(),
    phone: editStudentForm.phone.trim(),
    email: editStudentForm.email.trim(),
    city: editStudentForm.city.trim(),
    gender: editStudentForm.gender,
    requested_religion: editStudentForm.requested_religion || 'not_specified',
    accepted_dorm_type: editStudentForm.accepted_dorm_type || null,
    housing_type: editStudentForm.housing_type || '',
    category: editStudentForm.category || 'new',
  };

  try {
    setEditStudentLoading(true);
    const updated = await studentsAPI.update(editStudentTarget.id, payload);
    setEditStudentSuccess(t.editStudentSuccess);
    loadList();
    loadCounts();

    const returnToAssign = editStudentReturnToAssign;
    setTimeout(async () => {
      setShowEditStudentModal(false);
      setEditStudentSuccess('');
      setEditStudentTarget(null);
      setEditStudentReturnToAssign(false);

      // Refresh whatever is currently showing this student, then re-run
      // matching so the assign flow picks up the field that was just fixed.
      if (selectedStudent && selectedStudent.id === updated.id) {
        setSelectedStudent(updated);
      }
      if (returnToAssign) {
        openAssignBed(updated);
      }
    }, 700);
  } catch (err) {
    if (err.fieldErrors) setEditStudentFieldErrors(err.fieldErrors);
    setEditStudentError(err.message || t.editStudentFailed);
  } finally {
    setEditStudentLoading(false);
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
                {listTotal} {listTotal === 1 ? t.result : t.results}
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
              <span className="matching-number">{listTotal}</span>
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
                <span key={v} className="filter-chip">
                  {localizeGender(v, language) || v}
                  <button onClick={() => setActiveFilters(f => ({ ...f, genders: f.genders.filter(x => x !== v) }))}><X size={12} /></button>
                </span>
              ))}
              {activeFilters.religions.map((v) => (
                <span key={v} className="filter-chip">
                  {(filterOptions?.religions || []).find((r) => (typeof r === 'object' ? r.id : r) === v)?.name || v}
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
            <div className="results-grid" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="result-row-skeleton">
                  <div className="skel-avatar" />
                  <div className="skel-lines">
                    <div className="skel-line skel-line-wide" />
                    <div className="skel-line skel-line-narrow" />
                  </div>
                </div>
              ))}
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

          {!loading && listNextUrl && (
            <button type="button" className="load-more-students-btn" onClick={loadMoreStudents} disabled={loadingMoreStudents}>
              {loadingMoreStudents ? <Loader2 size={16} className="spinner" /> : (language === 'he' ? 'טען עוד סטודנטים' : 'Load more students')}
            </button>
          )}
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
                <button className="edit-student-pill" onClick={() => openEditStudent(selectedStudent)}>
                  <User size={16} />
                  {t.editStudentBtn}
                </button>
                {/* Unassigned: Assign Bed directly */}
                {!isRemoved(selectedStudent) && (
                  // Must be wrapped - binding openAssignBed directly as the
                  // onClick handler makes React pass the click SyntheticEvent
                  // as its studentOverride argument. Since that event object
                  // is truthy, `studentOverride || selectedStudent` picks the
                  // event instead of the student, so targetStudent.id is
                  // undefined, student_id is silently dropped by
                  // JSON.stringify, and the backend ends up scoring a blank
                  // synthetic student (empty housing_type) instead of the
                  // real one - the exact cause of "every room conflicts
                  // identically no matter which student is opened".
                  <button className="assign-bed-pill" onClick={() => openAssignBed()}>
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
                <div className="info-row">
                  <span className="info-key"><Home size={15} /> {t.housingType}</span>
                  <span className="info-val">
                    {selectedStudent.housing_type || (
                      <span className="field-missing-badge">
                        {language === 'he' ? 'חסר' : 'Missing'}
                      </span>
                    )}
                  </span>
                </div>
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
                <div className="info-row"><span className="info-key">⚥ {t.gender}</span><span className="info-val">{localizeGender(selectedStudent.gender, language) || '—'}</span></div>
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

          <div className="card">
            <div className="card-header"><div className="card-icon requests"><FileSearch size={18} /></div><h3>{t.studentRequestsTitle}</h3></div>
            <div className="card-body">
              {loadingStudentRequests ? (
                <p className="muted">{t.loading}</p>
              ) : studentRequests.length > 0 ? (
                <ol className="requests-list">
                  {studentRequests.map((r) => (
                    <li key={r.id}>
                      <span className="rq-num">{r.status === 'approved' ? '✓' : r.status === 'rejected' ? '✕' : '…'}</span>
                      <span className="rq-name">
                        {r.request_type_display || r.request_type} — {r.status_display || r.status}
                        {r.created_at ? ` (${new Date(r.created_at).toLocaleDateString()})` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <p className="muted">—</p>}
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
                    { v: 'transfer', l: t.typeTransfer, icon: <MapPin size={20} />,   color: 'purple' },
                    { v: 'other',    l: t.typeOther,    icon: <FileText size={20} />, color: 'orange' },
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

              {reqType === 'transfer' && (
                <div className="form-section">
                  <label>{t.scopeLabel}</label>
                  <div className="sub-options">
                    {[
                      { v: 'same_apartment', l: t.scopeSameApt },
                      { v: 'same_region',    l: t.scopeSameRegion },
                      { v: 'cross_region',   l: t.scopeCrossRegion, centralOnly: true },
                    ].map((opt) => (
                      <button key={opt.v} type="button"
                        className={`sub-option ${reqScope === opt.v ? 'active' : ''}`}
                        disabled={opt.centralOnly && !isCentralAdmin()}
                        title={opt.centralOnly && !isCentralAdmin() ? t.centralOnlyCross : undefined}
                        onClick={() => setReqScope(opt.v)}>{opt.l}</button>
                    ))}
                  </div>
                  {!isCentralAdmin() && (
                    <div className="type-note" style={{ marginTop: 8 }}>
                      <MapPin size={14} /> {t.crossRegionLockedNote}
                      {user?.region_name ? <>: <strong>{user.region_name}</strong></> : null}
                    </div>
                  )}
                  {reqScope === 'cross_region' && isCentralAdmin() && (
                    <div style={{ marginTop: 10 }}>
                      <label>{t.targetRegionLabel} *</label>
                      {reqRegions.length === 0 ? (
                        <div className="type-note" style={{ marginTop: 6 }}>
                          <Loader2 size={14} className="spinner" /> {t.selectTargetRegion}...
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex', flexDirection: 'column', gap: 6,
                          maxHeight: 170, overflowY: 'auto', marginTop: 6,
                          border: '1px solid #e5e7eb', borderRadius: 10, padding: 6,
                          pointerEvents: 'auto', position: 'relative', zIndex: 1,
                        }}>
                          {reqRegions.map((r, idx) => {
                            // Region PK may arrive as number or numeric string
                            // (or under pk/region_id) - keep the RAW value and
                            // compare as strings; never coerce with Number()
                            // (NaN made clicks look like they did nothing).
                            const rid = r?.id ?? r?.pk ?? r?.region_id;
                            if (rid == null) return null;
                            const active = String(reqTargetRegion) === String(rid);
                            const isCurrent = selectedStudent?.region_name === r.name;
                            return (
                              <button key={String(rid) || idx} type="button"
                                className={`sub-option ${active ? 'active' : ''}`}
                                style={{
                                  width: '100%', justifyContent: 'space-between',
                                  display: 'flex', alignItems: 'center',
                                  cursor: 'pointer', pointerEvents: 'auto',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReqTargetRegion(rid);
                                  setReqError('');
                                }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <MapPin size={13} /> {localizeRegionName(r, language)}
                                </span>
                                <span style={{ fontSize: 11, opacity: 0.7 }}>
                                  {isCurrent ? (language === 'he' ? 'האזור הנוכחי' : 'current region') : ''}
                                  {active ? ' ✓' : ''}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {reqTargetRegion == null && (
                        <div className="msg" style={{ marginTop: 6, fontSize: 12, color: '#92400e' }}>
                          {t.missingTargetRegion}
                        </div>
                      )}
                    </div>
                  )}
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
              {!reqError && !reqSuccess && !canSubmitRequest && !reqSubmitting && (
                <div className="msg" style={{ background: '#fef3c7', color: '#92400e', fontSize: 13 }}>
                  {{
                    'empty-reason': t.missingReason,
                    'no-scope': t.missingScope,
                    'invalid-target-region': t.missingTargetRegion,
                    'empty-other-description': t.missingOtherDesc,
                  }[reqDisabledReason] || ''}
                </div>
              )}

              <div className="modal-actions">
                <button className="btn-secondary" onClick={closeAddRequest} disabled={reqSubmitting}>{t.cancel}</button>
                <button
                  className={`btn-primary${reqType === 'remove_student' ? ' danger' : ''}`}
                  onClick={submitAddRequest}
                  disabled={!canSubmitRequest}>
                  {reqSubmitting ? <Loader2 size={16} className="spinner" /> : <><Plus size={16} /> {t.submit}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* ============================================================
    ADD STUDENT MODAL
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
            <p className="modal-subtitle">{t.addStudentSubtitle}</p>
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
            <label className={addStudentFieldErrors.student_id ? 'field-error' : ''}>
              {t.studentId} *
              <input
                value={addStudentForm.student_id}
                onChange={(e) => handleAddStudentChange('student_id', e.target.value)}
                placeholder={language === 'he' ? 'לדוגמה: 213537467' : 'Example: 213537467'}
              />
              {addStudentFieldErrors.student_id && (
                <span className="field-error-msg">{[].concat(addStudentFieldErrors.student_id).join(' ')}</span>
              )}
            </label>

            <label className={addStudentFieldErrors.first_name ? 'field-error' : ''}>
              {t.firstName} *
              <input
                value={addStudentForm.first_name}
                onChange={(e) => handleAddStudentChange('first_name', e.target.value)}
              />
              {addStudentFieldErrors.first_name && (
                <span className="field-error-msg">{[].concat(addStudentFieldErrors.first_name).join(' ')}</span>
              )}
            </label>

            <label className={addStudentFieldErrors.last_name ? 'field-error' : ''}>
              {t.lastName} *
              <input
                value={addStudentForm.last_name}
                onChange={(e) => handleAddStudentChange('last_name', e.target.value)}
              />
              {addStudentFieldErrors.last_name && (
                <span className="field-error-msg">{[].concat(addStudentFieldErrors.last_name).join(' ')}</span>
              )}
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

            <label className={addStudentFieldErrors.email ? 'field-error' : ''}>
              {t.email}
              <input
                type="email"
                value={addStudentForm.email}
                onChange={(e) => handleAddStudentChange('email', e.target.value)}
              />
              {addStudentFieldErrors.email && (
                <span className="field-error-msg">{[].concat(addStudentFieldErrors.email).join(' ')}</span>
              )}
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

          {/* Central admin picks a region explicitly, loaded from the real
              regions API (never hardcoded); regional staff see their own
              region as a fixed, read-only value. */}
          {isCentralAdmin() ? (
            <div className="form-grid">
              <label className={addStudentFieldErrors.region ? 'field-error' : ''}>
                {t.region} *
                <select
                  value={addStudentForm.region}
                  onChange={(e) => handleAddStudentChange('region', e.target.value)}
                >
                  <option value="">{t.selectRegion}</option>
                  {addStudentRegions.map((r) => (
                    <option key={r.id} value={r.id}>{localizeRegionName(r, language)}</option>
                  ))}
                </select>
                {addStudentFieldErrors.region && (
                  <span className="field-error-msg">{[].concat(addStudentFieldErrors.region).join(' ')}</span>
                )}
              </label>
            </div>
          ) : (
            <div className="readonly-region-badge">
              {t.myRegionLabel}: <strong>{user?.region_name || '—'}</strong>
            </div>
          )}

          <div className="form-grid">
            <label className={addStudentFieldErrors.gender ? 'field-error' : ''}>
              {t.gender} *
              <select
                value={addStudentForm.gender}
                onChange={(e) => handleAddStudentChange('gender', e.target.value)}
              >
                <option value="">{t.selectGender}</option>
                <option value="male">{t.male}</option>
                <option value="female">{t.female}</option>
              </select>
              {addStudentFieldErrors.gender && (
                <span className="field-error-msg">{[].concat(addStudentFieldErrors.gender).join(' ')}</span>
              )}
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

            <label className={addStudentFieldErrors.accepted_dorm_type ? 'field-error' : ''}>
              {t.dormType} *
              <select
                value={addStudentForm.accepted_dorm_type}
                onChange={(e) => handleAddStudentChange('accepted_dorm_type', e.target.value)}
                disabled={isCentralAdmin() && !addStudentForm.region}
              >
                <option value="">
                  {isCentralAdmin() && !addStudentForm.region ? t.selectRegionFirst : t.selectDormType}
                </option>
                {addStudentDormTypeOptions().map((dt) => (
                  <option key={dt.id} value={dt.id}>{localizeDormTypeName(dt, language)}</option>
                ))}
              </select>
              {addStudentFieldErrors.accepted_dorm_type && (
                <span className="field-error-msg">{[].concat(addStudentFieldErrors.accepted_dorm_type).join(' ')}</span>
              )}
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

            {/* Only required for students actually eligible for assignment -
                a leaving student is exempt (mirrors the backend's
                Student.is_assignment_eligible check). Choices are loaded
                from Student.HousingType on the backend, never guessed from
                gender - the employee must pick the real value. */}
            {addStudentForm.category !== 'leaving' && (
              <label className={addStudentFieldErrors.housing_type ? 'field-error' : ''}>
                {t.housingType} *
                <select
                  value={addStudentForm.housing_type}
                  onChange={(e) => handleAddStudentChange('housing_type', e.target.value)}
                >
                  <option value="">{t.selectHousingType}</option>
                  {(filterOptions?.housing_types || []).map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                {addStudentFieldErrors.housing_type && (
                  <span className="field-error-msg">{[].concat(addStudentFieldErrors.housing_type).join(' ')}</span>
                )}
              </label>
            )}
          </div>
        </section>

        <section className="modal-section">
          <h3>{t.requestReason}</h3>

          <label>
            {t.reason}
            <textarea
              value={addStudentForm.reason}
              onChange={(e) => handleAddStudentChange('reason', e.target.value)}
              rows={3}
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
          className="secondary-btn"
          onClick={() => submitAddStudent('save')}
          disabled={addStudentLoading}
        >
          {addStudentLoading ? t.creating : t.createAddStudentBtn}
        </button>

        <button
          type="button"
          className="primary-btn"
          onClick={() => submitAddStudent('save_and_match')}
          disabled={addStudentLoading}
        >
          {addStudentLoading ? t.creating : t.saveAndMatchBtn}
        </button>
      </div>
    </div>
  </div>
)}
{/* ============================================================
    EDIT STUDENT MODAL
============================================================ */}
{showEditStudentModal && editStudentTarget && (
  <div className="modal-overlay" onClick={closeEditStudentModal}>
    <div
      className={`modal-content xwide add-student-modal ${language === 'he' ? 'rtl' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <div className="modal-title-row">
          <div className="modal-icon blue"><User size={18} /></div>
          <div>
            <h2>{t.editStudentTitle}</h2>
            <p className="modal-subtitle">{t.editStudentSubtitle}</p>
          </div>
        </div>
        <button type="button" className="modal-close" onClick={closeEditStudentModal}>×</button>
      </div>

      <div className="modal-body">
        {editStudentError && <div className="form-alert error">{editStudentError}</div>}
        {editStudentSuccess && <div className="form-alert success">{editStudentSuccess}</div>}

        <section className="modal-section">
          <h3>{t.studentIdentity}</h3>
          <div className="form-grid">
            <label>
              {t.studentId}
              <input value={editStudentTarget.student_id || ''} disabled />
            </label>
            <label className={editStudentFieldErrors.first_name ? 'field-error' : ''}>
              {t.firstName} *
              <input value={editStudentForm.first_name} onChange={(e) => handleEditStudentChange('first_name', e.target.value)} />
              {editStudentFieldErrors.first_name && (
                <span className="field-error-msg">{[].concat(editStudentFieldErrors.first_name).join(' ')}</span>
              )}
            </label>
            <label className={editStudentFieldErrors.last_name ? 'field-error' : ''}>
              {t.lastName} *
              <input value={editStudentForm.last_name} onChange={(e) => handleEditStudentChange('last_name', e.target.value)} />
              {editStudentFieldErrors.last_name && (
                <span className="field-error-msg">{[].concat(editStudentFieldErrors.last_name).join(' ')}</span>
              )}
            </label>
          </div>
        </section>

        <section className="modal-section">
          <h3>{t.contactInfo}</h3>
          <div className="form-grid">
            <label>
              {t.phone}
              <input value={editStudentForm.phone} onChange={(e) => handleEditStudentChange('phone', e.target.value)} />
            </label>
            <label className={editStudentFieldErrors.email ? 'field-error' : ''}>
              {t.email}
              <input type="email" value={editStudentForm.email} onChange={(e) => handleEditStudentChange('email', e.target.value)} />
              {editStudentFieldErrors.email && (
                <span className="field-error-msg">{[].concat(editStudentFieldErrors.email).join(' ')}</span>
              )}
            </label>
            <label>
              {t.city}
              <input value={editStudentForm.city} onChange={(e) => handleEditStudentChange('city', e.target.value)} />
            </label>
          </div>
        </section>

        <section className="modal-section">
          <h3>{t.housingPlacement}</h3>

          {/* Region is authoritative via accepted_dorm_type - central admins
              may re-point a student to any region; regional staff are
              locked to their own region both here and, authoritatively, on
              the backend (perform_update rejects any other region). */}
          {isCentralAdmin() ? (
            <div className="form-grid">
              <label className={editStudentFieldErrors.region ? 'field-error' : ''}>
                {t.region} *
                <select value={editStudentForm.region} onChange={(e) => handleEditStudentChange('region', e.target.value)}>
                  <option value="">{t.selectRegion}</option>
                  {addStudentRegions.map((r) => (
                    <option key={r.id} value={r.id}>{localizeRegionName(r, language)}</option>
                  ))}
                </select>
                {editStudentFieldErrors.region && (
                  <span className="field-error-msg">{[].concat(editStudentFieldErrors.region).join(' ')}</span>
                )}
              </label>
            </div>
          ) : (
            <div className="readonly-region-badge">
              {t.myRegionLabel}: <strong>{user?.region_name || '—'}</strong>
            </div>
          )}

          <div className="form-grid">
            <label className={editStudentFieldErrors.gender ? 'field-error' : ''}>
              {t.gender} *
              <select value={editStudentForm.gender} onChange={(e) => handleEditStudentChange('gender', e.target.value)}>
                <option value="">{t.selectGender}</option>
                <option value="male">{t.male}</option>
                <option value="female">{t.female}</option>
              </select>
              {editStudentFieldErrors.gender && (
                <span className="field-error-msg">{[].concat(editStudentFieldErrors.gender).join(' ')}</span>
              )}
            </label>

            <label>
              {t.religion}
              <select value={editStudentForm.requested_religion} onChange={(e) => handleEditStudentChange('requested_religion', e.target.value)}>
                <option value="not_specified">{t.notSpecified}</option>
                <option value="Jewish">{t.jewish}</option>
                <option value="Muslims">{t.muslims}</option>
                <option value="Christian">{t.christian}</option>
                <option value="Druze">{t.druze}</option>
              </select>
            </label>

            <label className={editStudentFieldErrors.accepted_dorm_type ? 'field-error' : ''}>
              {t.dormType} *
              <select
                value={editStudentForm.accepted_dorm_type}
                onChange={(e) => handleEditStudentChange('accepted_dorm_type', e.target.value)}
                disabled={isCentralAdmin() && !editStudentForm.region}
              >
                <option value="">
                  {isCentralAdmin() && !editStudentForm.region ? t.selectRegionFirst : t.selectDormType}
                </option>
                {editStudentDormTypeOptions().map((dt) => (
                  <option key={dt.id} value={dt.id}>{localizeDormTypeName(dt, language)}</option>
                ))}
              </select>
              {editStudentFieldErrors.accepted_dorm_type && (
                <span className="field-error-msg">{[].concat(editStudentFieldErrors.accepted_dorm_type).join(' ')}</span>
              )}
            </label>

            <label>
              {t.category}
              <select value={editStudentForm.category} onChange={(e) => handleEditStudentChange('category', e.target.value)}>
                <option value="new">{t.newCategory}</option>
                <option value="continuing">{t.stayingCategory}</option>
                <option value="transfer">{t.transferringCategory}</option>
                <option value="leaving">{t.leavingCategory}</option>
              </select>
            </label>

            {editStudentForm.category !== 'leaving' && (
              <label className={editStudentFieldErrors.housing_type ? 'field-error' : ''}>
                {t.housingType} *
                <select value={editStudentForm.housing_type} onChange={(e) => handleEditStudentChange('housing_type', e.target.value)}>
                  <option value="">{t.selectHousingType}</option>
                  {(filterOptions?.housing_types || []).map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                {editStudentFieldErrors.housing_type && (
                  <span className="field-error-msg">{[].concat(editStudentFieldErrors.housing_type).join(' ')}</span>
                )}
              </label>
            )}
          </div>
        </section>
      </div>

      <div className="modal-footer">
        <button type="button" className="secondary-btn" onClick={closeEditStudentModal} disabled={editStudentLoading}>
          {t.cancel}
        </button>
        <button type="button" className="primary-btn" onClick={submitEditStudent} disabled={editStudentLoading}>
          {editStudentLoading ? t.creating : t.saveEditStudentBtn}
        </button>
      </div>
    </div>
  </div>
)}
{showAssignBed && assignBedStudent && (
  <div className="modal-overlay" onClick={closeAssignBed}>
    <div className="modal-content xwide assign-bed-modal" onClick={(e) => e.stopPropagation()}>
      {/* 1. Header */}
      <div className="modal-header-modern">
        <div className="modal-title-wrap">
          <div className="modal-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            <BedDouble size={18} />
          </div>
          <div>
            <h3>{assignBedStudent.is_assigned ? 'שיבוץ מיטה מחדש' : 'שיבוץ מיטה'}</h3>
            <div className="assign-student-meta">
              {getName(assignBedStudent)} · {assignBedStudent.student_id}
            </div>
          </div>
        </div>
        <button className="modal-close" onClick={closeAssignBed} aria-label="סגור"><X size={20} /></button>
      </div>

      {/* 2. Student / current-assignment information */}
      {assignBedStudent.is_assigned && (
        <div className="current-assignment-banner">
          <div className="cab-title">
            <BedDouble size={13} />
            שיבוץ נוכחי: בניין {assignBedStudent.assigned_building_number} → דירה {assignBedStudent.assigned_apartment_number} → חדר {assignBedStudent.assigned_room_name} → מיטה {assignBedStudent.current_bed_label}
          </div>
          <div className="cab-note">
            <AlertTriangle size={13} /> השיבוץ הנוכחי יישמר עד שהשיבוץ החדש יושלם בהצלחה.
          </div>
        </div>
      )}

      {/* Region scope - central admins may search a region other than the
          student's own home region (e.g. deliberate cross-region transfer);
          regional employees never see this and stay locked to their own
          authorized region on the backend regardless. */}
      {isCentralAdmin() && (
        <div className="assign-region-scope">
          <span className="assign-region-scope-label">אזור חיפוש:</span>
          <select
            value={assignRegionOverride || assignBedStudent.region_id || ''}
            onChange={(e) => handleAssignRegionChange(e.target.value)}
            disabled={loadingBeds}
          >
            {(filterOptions?.regions || []).map((r) => (
              <option key={r.id} value={r.id}>
                {localizeRegionName(r, language)}
                {String(r.id) === String(assignBedStudent.region_id) ? ' (אזור הבית של הסטודנט/ית)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 3-5. Summary, filters, recommended options, selected-option summary */}
      <div className="assign-modal-body">
        {assignBedBlockingField ? (
          // A student-level field (housing type / region / category /
          // eligibility) is missing or invalid - every candidate room would
          // fail for the exact same reason, so show one clear blocking
          // message instead of hundreds of repeated per-room conflicts.
          <div className="assign-blocked-box">
            <AlertTriangle size={28} />
            <p className="assign-blocked-title">{t.assignBlockedTitle}</p>
            <p className="assign-blocked-msg">{assignBedError || t.assignBlockedHousingType}</p>
            <button
              type="button"
              className="assign-blocked-edit-btn"
              onClick={() => {
                const student = assignBedStudent;
                closeAssignBed();
                openEditStudent(student, { returnToAssign: true });
              }}
            >
              <User size={14} /> {t.editStudentBtn}
            </button>
          </div>
        ) : (
          <BedMatchPicker
            buildings={availableBuildings}
            totalBuildings={bedResultMeta.total_buildings}
            totalApartments={bedResultMeta.total_apartments}
            totalRooms={bedResultMeta.total_rooms}
            totalValidBeds={bedResultMeta.total_valid_beds}
            counts={bedResultMeta.counts}
            dataIntegrity={bedResultMeta.data_integrity}
            conflictExamples={bedResultMeta.conflict_examples}
            loading={loadingBeds}
            loadingMore={loadingMoreBeds}
            hasMore={bedResultMeta.has_more}
            onLoadMore={loadMoreBeds}
            loadMoreError={loadMoreBedsError}
            selectedBedId={selectedRoomInApt?.bed_id}
            onSelectBed={(bed) => setSelectedRoomInApt(bed)}
            language="he"
            error={assignBedError && availableBuildings.length === 0 ? assignBedError : ''}
            onRetry={retryLoadBeds}
          />
        )}

        {!assignBedBlockingField && assignBedError && availableBuildings.length > 0 && <div className="msg error-msg">{assignBedError}</div>}
        {assignBedSuccess && <div className="msg success-msg">{assignBedSuccess}</div>}
      </div>

      {/* 6. Sticky action footer */}
      <div className="assign-action-bar">
        <button className="btn-secondary" onClick={closeAssignBed} disabled={assigningBed}>ביטול</button>
        <button
          className="btn-assign"
          onClick={submitAssignBed}
          disabled={assigningBed || !selectedRoomInApt || !selectedRoomInApt.is_selectable || !!assignBedSuccess}
        >
          {assigningBed ? (
            <Loader2 size={16} className="spinner" />
          ) : (
            <>
              <BedDouble size={16} />
              {!selectedRoomInApt
                ? 'בחר מיטה תחילה'
                : assignBedStudent.is_assigned
                  ? assignActionLabel(selectedRoomInApt).replace('שבץ ', 'שבץ מחדש ')
                  : assignActionLabel(selectedRoomInApt)}
            </>
          )}
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
        totalCount={listTotal}
        language={language}
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
        .result-row-skeleton { background: white; border-radius: 14px; padding: 14px 18px; display: flex; align-items: center; gap: 14px; border: 1px solid #f1f5f9; }
        .skel-avatar { width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0; background: linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 37%,#f1f5f9 63%); background-size: 400% 100%; animation: skel-shimmer 1.4s ease infinite; }
        .skel-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .skel-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 37%,#f1f5f9 63%); background-size: 400% 100%; animation: skel-shimmer 1.4s ease infinite; }
        .skel-line-wide { width: 45%; }
        .skel-line-narrow { width: 25%; }
        @keyframes skel-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
        .load-more-students-btn { align-self: center; margin-top: 16px; border: 1px solid #e2e8f0; background: white; border-radius: 999px; padding: 10px 28px; font-size: 14px; font-weight: 700; cursor: pointer; color: #334155; font-family: inherit; display: flex; align-items: center; gap: 8px; }
        .load-more-students-btn:hover { background: #f8fafc; }
        .load-more-students-btn:disabled { opacity: 0.6; cursor: not-allowed; }
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
        .back-pill, .add-request-pill, .assign-bed-pill, .edit-student-pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.18); color: white; border: 1px solid rgba(255,255,255,0.32); padding: 9px 16px; border-radius: 12px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; backdrop-filter: blur(10px); transition: all 0.15s; }
        .back-pill:hover, .add-request-pill:hover, .assign-bed-pill:hover, .edit-student-pill:hover { background: rgba(255,255,255,0.28); }
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
        .assign-student-meta { font-size: 14px; color: #64748b; font-weight: 700; margin-top: 2px; }
        .current-assignment-banner {
          margin: 0 22px 12px;
          padding: 12px 16px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cab-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 800;
          color: #9a3412;
        }
        .cab-note {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #c2410c;
        }
        .assign-region-scope {
          margin: 0 22px 12px;
          padding: 10px 16px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .assign-region-scope-label { font-size: 13px; font-weight: 800; color: #1d4ed8; white-space: nowrap; }
        .assign-region-scope select {
          flex: 1;
          border: 1px solid #93c5fd;
          border-radius: 8px;
          padding: 7px 10px;
          font-size: 13px;
          font-weight: 700;
          color: #1e3a8a;
          background: white;
          font-family: inherit;
        }
        .assign-region-scope select:disabled { opacity: 0.6; cursor: not-allowed; }
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
.assign-blocked-box { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 20px; color: #b91c1c; text-align: center; }
.assign-blocked-title { font-weight: 800; font-size: 16px; margin: 0; }
.assign-blocked-msg { font-size: 14px; color: #7f1d1d; margin: 0; max-width: 420px; }
.assign-blocked-edit-btn { display: flex; align-items: center; gap: 6px; margin-top: 8px; border: none; background: #1d4ed8; color: white; border-radius: 10px; padding: 10px 20px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.assign-blocked-edit-btn:hover { background: #1e40af; }
.field-missing-badge { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 700; }
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

.add-student-modal select:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  cursor: not-allowed;
}

.add-student-modal label.field-error input,
.add-student-modal label.field-error select {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
}

.add-student-modal .field-error-msg {
  font-size: 12px;
  font-weight: 600;
  color: #dc2626;
}

.add-student-modal .readonly-region-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 16px;
}

.add-student-modal .modal-footer {
  padding: 18px 24px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
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