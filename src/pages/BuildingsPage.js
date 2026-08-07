import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bed,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Home,
  Info,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react';

import { api, dormInventoryAPI, whatIfAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import BuildingSetupWizard from '../components/BuildingSetupWizard';



// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = {
  he: { male: 'זכר', female: 'נקבה', mixed: 'מעורב / לא רלוונטי' },
  en: { male: 'Male', female: 'Female', mixed: 'Mixed / N/A' },
};

const APARTMENT_TYPE_LABELS = {
  he: { single: 'רווקים/ות', couple: 'זוגות', family: 'משפחה' },
  en: { single: 'Single', couple: 'Couple', family: 'Family' },
};

const GENDER_RESTRICTION_LABELS = {
  he: { male: 'בנים בלבד', female: 'בנות בלבד', '': 'ללא הגבלה' },
  en: { male: 'Male only', female: 'Female only', '': 'No restriction' },
};

const DEACTIVATION_REASONS = {
  he: [
    { value: 'maintenance', label: 'תחזוקה' },
    { value: 'renovation', label: 'שיפוץ' },
    { value: 'temporary_reservation', label: 'שריון זמני' },
    { value: 'safety_issue', label: 'בטיחות / תקלה' },
    { value: 'administrative_decision', label: 'החלטה מנהלתית' },
    { value: 'other', label: 'אחר' },
  ],
  en: [
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'renovation', label: 'Renovation' },
    { value: 'temporary_reservation', label: 'Temporary reservation' },
    { value: 'safety_issue', label: 'Safety / issue' },
    { value: 'administrative_decision', label: 'Administrative decision' },
    { value: 'other', label: 'Other' },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function idOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(value.id ?? value.pk ?? '');
  return String(value);
}

function asArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (key && Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().trim();
}

function getRegionIdFromDormType(dormType) {
  return idOf(dormType?.region_id ?? dormType?.region);
}

function composeReason(reason, note) {
  return [reason, note].filter(Boolean).join(' — ');
}

// ---------------------------------------------------------------------------
// Small reusable presentational components
// ---------------------------------------------------------------------------

function Spinner({ size = 16 }) {
  return <Loader2 className="inv-spin" size={size} />;
}

function IconButton({ icon: Icon, onClick, title, tone, disabled }) {
  return (
    <button
      type="button"
      className={`inv-iconBtn ${tone ? `inv-iconBtn-${tone}` : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      <Icon size={14} />
    </button>
  );
}

function StatusBadge({ active, activeText, inactiveText }) {
  return (
    <span className={`inv-statusBadge ${active ? 'is-active' : 'is-inactive'}`}>
      <span className="inv-statusDot" />
      {active ? activeText : inactiveText}
    </span>
  );
}

function OccupancyBadge({ occupied, total, label }) {
  const full = total > 0 && occupied >= total;
  return (
    <span className={`inv-occupancyBadge ${full ? 'is-full' : ''}`}>
      {occupied} / {total}
      {label ? ` ${label}` : ''}
    </span>
  );
}

function MiniMetric({ icon: Icon, value, label }) {
  return (
    <div className="inv-miniMetric">
      <Icon size={15} />
      <div>
        <div className="inv-miniMetricValue">{value}</div>
        <div className="inv-miniMetricLabel">{label}</div>
      </div>
    </div>
  );
}

function SectionHeader({ title, count, action }) {
  return (
    <div className="inv-sectionHeader">
      <h3>
        {title}
        {count !== undefined && count !== null ? ` (${count})` : ''}
      </h3>
      {action}
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, hint }) {
  return (
    <div className="inv-emptyPanel">
      {Icon && <Icon size={26} />}
      <div className="inv-emptyPanelTitle">{title}</div>
      {hint && <p>{hint}</p>}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="inv-detailRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FormField({ label, htmlFor, hint, children }) {
  return (
    <div className="inv-formField">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="inv-readonlyField">
      <label>{label}</label>
      <div className="inv-readonlyValue">{value ?? '—'}</div>
    </div>
  );
}

function ModalSection({ title, children }) {
  return (
    <div className="inv-modalSection">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function PageAlert({ tone = 'danger', children, onClose }) {
  return (
    <div className={`inv-alert inv-alert-${tone}`}>
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="close">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BuildingsPage({ language = 'he' }) {
  const { isCentralAdmin, isRegionBoss, getUserRegion } = useAuth();
  const [searchParams] = useSearchParams();

  const isHe = language === 'he';
  const canManageInventory = isCentralAdmin() || isRegionBoss();
  const viewOnly = !canManageInventory;
  const userRegionId = idOf(getUserRegion());

  const canCreateBed = canManageInventory && typeof dormInventoryAPI.createBed === 'function';
  const canDeleteBed = canManageInventory && typeof dormInventoryAPI.deleteBed === 'function';
  const canSetBedAvailability = canManageInventory && typeof dormInventoryAPI.setBedAvailability === 'function';

  const t = isHe
    ? {
        title: 'ניהול מבנים ומלאי מעונות',
        subtitle: 'ניהול היררכיית המבנים, כללי השיבוץ, הקיבולת וזמינות המלאי',
        viewOnlyIndicator: 'צפייה בלבד',
        refresh: 'רענן',
        addBuilding: 'הוסף בניין',
        breadcrumbRoot: 'מלאי מעונות',
        allDormTypes: 'כל סוגי המעונות',
        chooseRegion: 'אזור',
        chooseDormType: 'סוג מעונות',
        status: 'סטטוס',
        statusActive: 'פעיל',
        statusInactive: 'לא פעיל',
        statusAll: 'הכל',
        search: 'חיפוש בניין, דירה או חדר...',
        metricBuildings: 'בניינים',
        metricApartments: 'דירות',
        metricRooms: 'חדרים',
        metricBeds: 'מיטות',
        metricOccupied: 'מיטות תפוסות',
        metricFree: 'מיטות פנויות',
        navigatorTitle: 'בניינים',
        noBuildings: 'לא נמצאו בניינים',
        apartmentsCount: 'דירות',
        roomsCount: 'חדרים',
        bedsCount: 'מיטות',
        occupiedShort: 'תפוסות',
        selectBuildingTitle: 'בחרו בניין',
        selectBuildingHint: 'הדירות, החדרים והמיטות שלו יוצגו לאחר הבחירה.',
        apartmentsTable: 'דירות',
        roomsTable: 'חדרים',
        bedsTable: 'מיטות',
        addApartment: 'הוסף דירה',
        addRoom: 'הוסף חדר',
        addBed: 'הוסף מיטה',
        colApartment: 'דירה',
        colCategory: 'קטגוריה',
        colHousingType: 'סוג דיור',
        colRooms: 'חדרים',
        colOccupancy: 'תפוסה',
        colStatus: 'סטטוס',
        colActions: 'פעולות',
        colRoom: 'חדר',
        colCapacity: 'קיבולת',
        colBeds: 'מיטות',
        colBed: 'מיטה',
        colAvailability: 'זמינות',
        available: 'פנויה',
        occupied: 'תפוסה',
        selectApartmentHint: 'בחרו דירה כדי לראות את חדריה.',
        selectRoomHint: 'בחרו חדר כדי לראות את מיטותיו.',
        noApartments: 'אין דירות בבניין זה',
        noRooms: 'אין חדרים בדירה זו',
        noBeds: 'אין מיטות בחדר זה',
        bedRecordsMismatch: 'קיימת אי־התאמה בין קיבולת החדר לרשומות המיטה במסד הנתונים',
        bedNoActionsSupported: 'אין תמיכה בהוספה, מחיקה או השבתת מיטה בודדת בגרסה הנוכחית — ניתן לערוך רק את תווית המיטה.',
        viewDetails: 'הצג פרטים',
        hideDetails: 'הסתר פרטים',
        viewBeds: 'הצג מיטות',
        edit: 'עריכה',
        activate: 'הפעל',
        deactivate: 'השבת',
        deleteAction: 'מחק',
        buildingNumberLabel: 'מספר בניין',
        dormTypeLabel: 'סוג מעונות',
        regionLabel: 'אזור',
        genderRestrictionLabel: 'הגבלת מגדר',
        activeStatusLabel: 'סטטוס',
        apartmentCountLabel: 'מספר דירות',
        roomCountLabel: 'מספר חדרים',
        bedCountLabel: 'מספר מיטות',
        occupiedBedsLabel: 'מיטות תפוסות',
        freeBedsLabel: 'מיטות פנויות',
        parentBuildingLabel: 'בניין',
        apartmentNumberLabel: 'מספר דירה',
        genderCategoryLabel: 'קטגוריה (מגדר)',
        housingTypeLabel: 'סוג דיור',
        inactiveReasonLabel: 'סיבת אי-פעילות',
        plannedRoomCountLabel: 'חדרים מתוכננים',
        actualRoomCountLabel: 'חדרים בפועל',
        apartmentCapacityLabel: 'קיבולת דירה',
        totalBedsLabel: 'סך מיטות',
        parentApartmentLabel: 'דירה',
        roomNameLabel: 'שם/מספר חדר',
        capacityLabel: 'קיבולת',
        occupancyLabel: 'תפוסה',
        availableBedsLabel: 'מיטות פנויות',
        bedLabelField: 'תווית מיטה',
        parentRoomLabel: 'חדר',
        availabilityLabel: 'זמינות',
        none: 'ללא',
        // Drawer
        drawerCreateBuilding: 'בניין חדש',
        drawerEditBuilding: 'עריכת בניין',
        drawerCreateApartment: 'דירה חדשה',
        drawerEditApartment: 'עריכת דירה',
        drawerCreateRoom: 'חדר חדש',
        drawerEditRoom: 'עריכת חדר',
        drawerEditBed: 'עריכת מיטה',
        cancel: 'ביטול',
        save: 'שמור',
        create: 'צור',
        noRestriction: 'ללא הגבלה',
        genderRestrictionHint: 'לבניינים עם שירותים משותפים בלבד — ריק = ללא הגבלה.',
        isActiveEditHint: 'שינוי סטטוס פעיל/לא פעיל מתבצע רק דרך תהליך "שינוי זמינות".',
        // Editor modal sections
        sectionGeneralInfo: 'מידע כללי',
        sectionAllocationConfig: 'תצורת שיבוץ',
        sectionApartmentClassification: 'סיווג דירה',
        sectionCapacityConfig: 'תצורת קיבולת',
        sectionAvailabilityInfo: 'מידע זמינות',
        sectionStatus: 'סטטוס',
        availabilityManagedSeparately: 'זמינות מנוהלת בנפרד דרך פעולת ההפעלה / ההשבתה.',
        // Editor validation
        validationBuildingNumberRequired: 'יש להזין מספר בניין',
        validationDormTypeRequired: 'יש לבחור סוג מעונות',
        validationApartmentNumberRequired: 'יש להזין מספר דירה',
        validationRoomCountInvalid: 'יש להזין מספר חדרים תקין',
        validationCapacityInvalid: 'יש להזין קיבולת תקינה',
        validationRoomNameRequired: 'יש להזין שם/מספר חדר',
        validationRoomCapacityInvalid: 'יש להזין קיבולת חיובית תקינה',
        validationBedLabelRequired: 'יש להזין תווית מיטה',
        // Availability dialog
        deactivateTitle: (label) => `השבתת ${label}`,
        activateTitle: (label) => `הפעלת ${label}`,
        impactTitle: 'השפעת ההשבתה',
        loadingImpact: 'בודק השפעה...',
        impactApartments: 'דירות מושפעות',
        impactRooms: 'חדרים מושפעים',
        impactBeds: 'מיטות מושפעות',
        impactAssignments: 'סטודנטים בעלי שיוך פעיל',
        impactNote:
          'השיבוץ האוטומטי יפסיק להשתמש במלאי זה. דיירים קיימים יישארו משויכים — לא יוסרו ולא יועברו אוטומטית; תיפתח עבורם בקשת העברה ממתינה לטיפול ידני.',
        impactNoAssignments: 'אין כרגע סטודנטים עם שיוך פעיל בטווח זה.',
        reasonLabel: 'סיבה',
        chooseReason: 'בחר סיבה',
        noteLabel: 'הערה נוספת (לא חובה)',
        confirmProceed: 'אשר והמשך',
        confirmActivateShort: 'להפעיל מחדש?',
        reasonRequired: 'יש לבחור סיבה',
        // Bed delete
        deleteBedTitle: (label) => `מחיקת מיטה ${label}`,
        deleteBedOccupiedWarning: 'לא ניתן למחוק מיטה תפוסה.',
        confirmDelete: 'מחק',
        // Errors
        loadError: 'שגיאה בטעינת הנתונים',
        actionError: 'הפעולה נכשלה',
      }
    : {
        title: 'Buildings & Dormitory Inventory',
        subtitle: 'Manage hierarchy, allocation rules, capacity, and inventory availability',
        viewOnlyIndicator: 'View-only',
        refresh: 'Refresh',
        addBuilding: 'Add building',
        breadcrumbRoot: 'Dormitory inventory',
        allDormTypes: 'All dorm types',
        chooseRegion: 'Region',
        chooseDormType: 'Dorm type',
        status: 'Status',
        statusActive: 'Active',
        statusInactive: 'Inactive',
        statusAll: 'All',
        search: 'Search building, apartment, or room...',
        metricBuildings: 'Buildings',
        metricApartments: 'Apartments',
        metricRooms: 'Rooms',
        metricBeds: 'Beds',
        metricOccupied: 'Occupied beds',
        metricFree: 'Free beds',
        navigatorTitle: 'Buildings',
        noBuildings: 'No buildings found',
        apartmentsCount: 'apartments',
        roomsCount: 'rooms',
        bedsCount: 'beds',
        occupiedShort: 'occupied',
        selectBuildingTitle: 'Select a building',
        selectBuildingHint: 'Its apartments, rooms, and beds will appear after selection.',
        apartmentsTable: 'Apartments',
        roomsTable: 'Rooms',
        bedsTable: 'Beds',
        addApartment: 'Add apartment',
        addRoom: 'Add room',
        addBed: 'Add bed',
        colApartment: 'Apartment',
        colCategory: 'Category',
        colHousingType: 'Housing type',
        colRooms: 'Rooms',
        colOccupancy: 'Occupancy',
        colStatus: 'Status',
        colActions: 'Actions',
        colRoom: 'Room',
        colCapacity: 'Capacity',
        colBeds: 'Beds',
        colBed: 'Bed',
        colAvailability: 'Availability',
        available: 'Available',
        occupied: 'Occupied',
        selectApartmentHint: 'Select an apartment to see its rooms.',
        selectRoomHint: 'Select a room to see its beds.',
        noApartments: 'No apartments in this building',
        noRooms: 'No rooms in this apartment',
        noBeds: 'No beds in this room',
        bedRecordsMismatch: 'There is a mismatch between room capacity and bed records in the database',
        bedNoActionsSupported: 'Adding, deleting, or deactivating an individual bed is not supported in the current version — only the bed label can be edited.',
        viewDetails: 'View details',
        hideDetails: 'Hide details',
        viewBeds: 'View beds',
        edit: 'Edit',
        activate: 'Activate',
        deactivate: 'Deactivate',
        deleteAction: 'Delete',
        buildingNumberLabel: 'Building number',
        dormTypeLabel: 'Dorm type',
        regionLabel: 'Region',
        genderRestrictionLabel: 'Gender restriction',
        activeStatusLabel: 'Status',
        apartmentCountLabel: 'Apartment count',
        roomCountLabel: 'Room count',
        bedCountLabel: 'Bed count',
        occupiedBedsLabel: 'Occupied beds',
        freeBedsLabel: 'Free beds',
        parentBuildingLabel: 'Building',
        apartmentNumberLabel: 'Apartment number',
        genderCategoryLabel: 'Category (gender)',
        housingTypeLabel: 'Housing type',
        inactiveReasonLabel: 'Inactive reason',
        plannedRoomCountLabel: 'Planned rooms',
        actualRoomCountLabel: 'Actual rooms',
        apartmentCapacityLabel: 'Apartment capacity',
        totalBedsLabel: 'Total beds',
        parentApartmentLabel: 'Apartment',
        roomNameLabel: 'Room name/number',
        capacityLabel: 'Capacity',
        occupancyLabel: 'Occupancy',
        availableBedsLabel: 'Available beds',
        bedLabelField: 'Bed label',
        parentRoomLabel: 'Room',
        availabilityLabel: 'Availability',
        none: 'None',
        drawerCreateBuilding: 'New building',
        drawerEditBuilding: 'Edit building',
        drawerCreateApartment: 'New apartment',
        drawerEditApartment: 'Edit apartment',
        drawerCreateRoom: 'New room',
        drawerEditRoom: 'Edit room',
        drawerEditBed: 'Edit bed',
        cancel: 'Cancel',
        save: 'Save',
        create: 'Create',
        noRestriction: 'No restriction',
        genderRestrictionHint: 'For shared-facility buildings only — empty = no restriction.',
        isActiveEditHint: 'Active/inactive status can only be changed via the availability workflow.',
        // Editor modal sections
        sectionGeneralInfo: 'General information',
        sectionAllocationConfig: 'Allocation configuration',
        sectionApartmentClassification: 'Apartment classification',
        sectionCapacityConfig: 'Capacity configuration',
        sectionAvailabilityInfo: 'Availability information',
        sectionStatus: 'Status',
        availabilityManagedSeparately: 'Availability is managed separately through the Activate / Deactivate action.',
        // Editor validation
        validationBuildingNumberRequired: 'Building number is required',
        validationDormTypeRequired: 'Dormitory type is required',
        validationApartmentNumberRequired: 'Apartment number is required',
        validationRoomCountInvalid: 'Enter a valid room count',
        validationCapacityInvalid: 'Enter a valid capacity',
        validationRoomNameRequired: 'Room name/number is required',
        validationRoomCapacityInvalid: 'Enter a valid positive capacity',
        validationBedLabelRequired: 'Bed label is required',
        deactivateTitle: (label) => `Deactivate ${label}`,
        activateTitle: (label) => `Activate ${label}`,
        impactTitle: 'Deactivation impact',
        loadingImpact: 'Checking impact...',
        impactApartments: 'Affected apartments',
        impactRooms: 'Affected rooms',
        impactBeds: 'Affected beds',
        impactAssignments: 'Students with an active assignment',
        impactNote:
          'Automatic allocation will stop using this inventory. Existing occupants stay assigned — never auto-removed or moved; a pending movement request is created for manual staff follow-up.',
        impactNoAssignments: 'No students currently have an active assignment in this scope.',
        reasonLabel: 'Reason',
        chooseReason: 'Choose a reason',
        noteLabel: 'Additional note (optional)',
        confirmProceed: 'Confirm and proceed',
        confirmActivateShort: 'Reactivate?',
        reasonRequired: 'A reason is required',
        deleteBedTitle: (label) => `Delete bed ${label}`,
        deleteBedOccupiedWarning: 'An occupied bed cannot be deleted.',
        confirmDelete: 'Delete',
        loadError: 'Error loading data',
        actionError: 'Action failed',
      };

  const reasonOptions = DEACTIVATION_REASONS[isHe ? 'he' : 'en'];
  const categoryLabels = CATEGORY_LABELS[isHe ? 'he' : 'en'];
  const apartmentTypeLabels = APARTMENT_TYPE_LABELS[isHe ? 'he' : 'en'];
  const genderRestrictionLabels = GENDER_RESTRICTION_LABELS[isHe ? 'he' : 'en'];
  const BreadcrumbChevron = isHe ? ChevronLeft : ChevronRight;

  // -------------------------------------------------------------------
  // State (section 15)
  // -------------------------------------------------------------------
  const [regions, setRegions] = useState([]);
  const [dormTypes, setDormTypes] = useState([]);
  const [buildings, setBuildings] = useState([]);

  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedDormTypeId, setSelectedDormTypeId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [selectedApartmentId, setSelectedApartmentId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedBedId, setSelectedBedId] = useState('');

  const [buildingApartments, setBuildingApartments] = useState([]);
  const [buildingRooms, setBuildingRooms] = useState([]);
  const [roomBeds, setRoomBeds] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [loadingBeds, setLoadingBeds] = useState(false);

  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');

  const [editor, setEditor] = useState(null);
  const [availabilityDialog, setAvailabilityDialog] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(null);


  const [buildingDetailsOpen, setBuildingDetailsOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // -------------------------------------------------------------------
  // Derived data (section 16)
  // -------------------------------------------------------------------
  const dormTypesInRegion = useMemo(() => {
    if (!selectedRegionId) return dormTypes;
    return dormTypes.filter((dt) => getRegionIdFromDormType(dt) === idOf(selectedRegionId));
  }, [dormTypes, selectedRegionId]);

  const filteredBuildings = useMemo(() => {
    let list = buildings;

    if (selectedDormTypeId !== 'all') {
      list = list.filter((b) => idOf(b.dorm_type) === idOf(selectedDormTypeId));
    }
    if (statusFilter !== 'all') {
      const wantActive = statusFilter === 'active';
      list = list.filter((b) => Boolean(b.is_active) === wantActive);
    }
    const q = normalizeText(searchQuery);
    if (q) {
      list = list.filter((b) => [b.number, b.dorm_type_name, b.region_name].join(' ').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  }, [buildings, selectedDormTypeId, statusFilter, searchQuery]);

  const selectedRegion = useMemo(() => regions.find((r) => idOf(r.id) === idOf(selectedRegionId)) || null, [regions, selectedRegionId]);
  const selectedDormType = useMemo(
    () => (selectedDormTypeId === 'all' ? null : dormTypesInRegion.find((dt) => idOf(dt.id) === idOf(selectedDormTypeId)) || null),
    [dormTypesInRegion, selectedDormTypeId]
  );
  const selectedBuilding = useMemo(() => buildings.find((b) => idOf(b.id) === idOf(selectedBuildingId)) || null, [buildings, selectedBuildingId]);

  const apartmentsForSelectedBuilding = useMemo(() => {
    const q = normalizeText(searchQuery);
    if (!q) return buildingApartments;
    return buildingApartments.filter((a) => String(a.number ?? '').toLowerCase().includes(q));
  }, [buildingApartments, searchQuery]);

  const selectedApartment = useMemo(
    () => buildingApartments.find((a) => idOf(a.id) === idOf(selectedApartmentId)) || null,
    [buildingApartments, selectedApartmentId]
  );

  const roomsForSelectedApartment = useMemo(() => {
    let list = buildingRooms.filter((r) => idOf(r.apartment) === idOf(selectedApartmentId));
    const q = normalizeText(searchQuery);
    if (q) list = list.filter((r) => String(r.name ?? '').toLowerCase().includes(q));
    return list;
  }, [buildingRooms, selectedApartmentId, searchQuery]);

  const selectedRoom = useMemo(() => buildingRooms.find((r) => idOf(r.id) === idOf(selectedRoomId)) || null, [buildingRooms, selectedRoomId]);
  const selectedBed = useMemo(() => roomBeds.find((b) => idOf(b.id) === idOf(selectedBedId)) || null, [roomBeds, selectedBedId]);

  // Summary strip is scoped to region + selected dorm type, independent of
  // the active/inactive list filter (active-only for the 5 capacity
  // metrics, since inactive inventory is out of solver scope; total
  // building count includes both so the numbers stay internally consistent
  // with what staff see in the navigator when status = "all").
  const summaryMetrics = useMemo(() => {
    const scoped = selectedDormTypeId === 'all' ? buildings : buildings.filter((b) => idOf(b.dorm_type) === idOf(selectedDormTypeId));
    const active = scoped.filter((b) => b.is_active);
    const sum = (field) => active.reduce((acc, b) => acc + (Number(b[field]) || 0), 0);
    return {
      buildings: scoped.length,
      apartments: sum('apartment_count'),
      rooms: sum('room_count'),
      beds: sum('bed_count'),
      occupied: sum('occupied_beds'),
      free: sum('free_beds'),
    };
  }, [buildings, selectedDormTypeId]);

  // -------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------
  const loadRegionsAndDormTypes = useCallback(async () => {
    const [regionsRes, dormTypesRes] = await Promise.all([api.get('/api/regions/'), api.get('/api/dorm-types/')]);
    setRegions(asArray(regionsRes.data));
    setDormTypes(asArray(dormTypesRes.data));
    return { regionsList: asArray(regionsRes.data), dormTypesList: asArray(dormTypesRes.data) };
  }, []);

  const loadBuildings = useCallback(async (regionId) => {
    if (!regionId) {
      setBuildings([]);
      return;
    }
    const data = await dormInventoryAPI.getBuildings({ region: regionId, is_active: 'all' });
    setBuildings(asArray(data));
  }, []);

  const resetSelectionBelowBuilding = () => {
    setSelectedApartmentId('');
    setSelectedRoomId('');
    setSelectedBedId('');
    setBuildingApartments([]);
    setBuildingRooms([]);
    setRoomBeds([]);
  };

  const selectRegion = async (regionId) => {
    setSelectedRegionId(regionId);
    setSelectedDormTypeId('all');
    setSelectedBuildingId('');
    resetSelectionBelowBuilding();
    setLoading(true);
    try {
      await loadBuildings(regionId);
    } catch (err) {
      setPageError(err?.message || t.loadError);
    } finally {
      setLoading(false);
    }
  };

  const selectBuilding = async (buildingId) => {
    setBuildingDetailsOpen(false);
    if (idOf(selectedBuildingId) === idOf(buildingId)) {
      setSelectedBuildingId('');
      resetSelectionBelowBuilding();
      return;
    }
    setSelectedBuildingId(buildingId);
    resetSelectionBelowBuilding();
    setLoadingStructure(true);
    try {
      const [apartmentsData, roomsData] = await Promise.all([
        dormInventoryAPI.getApartments({ building: buildingId, is_active: 'all' }),
        dormInventoryAPI.getRooms({ building: buildingId, is_active: 'all' }),
      ]);
      setBuildingApartments(asArray(apartmentsData));
      setBuildingRooms(asArray(roomsData));
    } catch (err) {
      setActionError(err?.message || t.loadError);
    } finally {
      setLoadingStructure(false);
    }
  };

  function selectApartment(id) {
    setSelectedApartmentId((prev) => (idOf(prev) === idOf(id) ? '' : id));
    setSelectedRoomId('');
    setSelectedBedId('');
    setRoomBeds([]);
  }

  const selectRoom = async (id) => {
    if (idOf(selectedRoomId) === idOf(id)) {
      setSelectedRoomId('');
      setSelectedBedId('');
      setRoomBeds([]);
      return;
    }
    setSelectedRoomId(id);
    setSelectedBedId('');
    setLoadingBeds(true);
    try {
      const data = await dormInventoryAPI.getBeds({ room: id });
      setRoomBeds(asArray(data));
    } catch (err) {
      setActionError(err?.message || t.loadError);
    } finally {
      setLoadingBeds(false);
    }
  };

  function selectBed(id) {
    setSelectedBedId((prev) => (idOf(prev) === idOf(id) ? '' : id));
  }

  const refreshCurrentScope = useCallback(async () => {
    if (selectedRegionId) await loadBuildings(selectedRegionId);
    if (selectedBuildingId) {
      const [apartmentsData, roomsData] = await Promise.all([
        dormInventoryAPI.getApartments({ building: selectedBuildingId, is_active: 'all' }),
        dormInventoryAPI.getRooms({ building: selectedBuildingId, is_active: 'all' }),
      ]);
      setBuildingApartments(asArray(apartmentsData));
      setBuildingRooms(asArray(roomsData));
    }
    if (selectedRoomId) {
      const data = await dormInventoryAPI.getBeds({ room: selectedRoomId });
      setRoomBeds(asArray(data));
    }
  }, [selectedRegionId, selectedBuildingId, selectedRoomId, loadBuildings]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setPageError('');
      try {
        const { regionsList } = await loadRegionsAndDormTypes();

        const urlRegionRaw = searchParams.get('region');
        const urlDormTypeIdRaw = searchParams.get('dormTypeId');
        const canViewAllRegions = isCentralAdmin() || isRegionBoss();

        let resolvedRegionId = idOf(userRegionId || regionsList[0]?.id);
        if (urlRegionRaw) {
          const exists = regionsList.some((r) => idOf(r.id) === idOf(urlRegionRaw)) && (canViewAllRegions || idOf(urlRegionRaw) === idOf(userRegionId));
          if (exists) resolvedRegionId = idOf(urlRegionRaw);
        }
        setSelectedRegionId(resolvedRegionId);

        if (urlDormTypeIdRaw) setSelectedDormTypeId(idOf(urlDormTypeIdRaw));

        if (resolvedRegionId) await loadBuildings(resolvedRegionId);
      } catch (err) {
        console.error('ERROR LOADING BUILDINGS PAGE:', err);
        setPageError(err?.message || t.loadError);
      } finally {
        setLoading(false);
      }
    };
    init();
    // eslint-disable-next-line
  }, [language]);

  useEffect(() => {
    if (!selectedRegionId || selectedDormTypeId === 'all') return;
    const stillValid = dormTypesInRegion.some((dt) => idOf(dt.id) === idOf(selectedDormTypeId));
    if (!stillValid) setSelectedDormTypeId('all');
  }, [selectedRegionId, selectedDormTypeId, dormTypesInRegion]);

  const handleRefresh = async () => {
    setLoading(true);
    setPageError('');
    try {
      await refreshCurrentScope();
    } catch (err) {
      setPageError(err?.message || t.loadError);
    } finally {
      setLoading(false);
    }
  };


  const handleWizardCompleted = async (building) => {
    setWizardOpen(false);
    try {
      await loadBuildings(selectedRegionId);
    } catch (err) {
      setPageError(err?.message || t.loadError);
    }
    await selectBuilding(building.id);
  };

  // -------------------------------------------------------------------
  // Editor (create/edit drawer)
  // -------------------------------------------------------------------
  const openEditBuilding = (building) =>
    setEditor({
      type: 'building',
      mode: 'edit',
      id: building.id,
      parentId: null,
      data: { number: building.number ?? '', dorm_type: building.dorm_type ?? '', gender_restriction: building.gender_restriction ?? '' },
      saving: false,
      error: '',
    });

  const openCreateApartment = (buildingId) =>
    setEditor({
      type: 'apartment',
      mode: 'create',
      id: null,
      parentId: buildingId,
      data: { number: '', category: 'mixed', apartment_type: 'single', room_count: 1, apartment_capacity: '', inactive_reason: '' },
      saving: false,
      error: '',
    });

  const openEditApartment = (apartment) =>
    setEditor({
      type: 'apartment',
      mode: 'edit',
      id: apartment.id,
      parentId: apartment.building,
      data: {
        number: apartment.number ?? '',
        category: apartment.category ?? 'mixed',
        apartment_type: apartment.apartment_type ?? 'single',
        room_count: apartment.room_count ?? 1,
        apartment_capacity: apartment.apartment_capacity ?? '',
        inactive_reason: apartment.inactive_reason ?? '',
      },
      saving: false,
      error: '',
    });

  const openCreateRoom = (apartmentId) =>
    setEditor({ type: 'room', mode: 'create', id: null, parentId: apartmentId, data: { name: '', capacity: 1 }, saving: false, error: '' });

  const openEditRoom = (room) =>
    setEditor({
      type: 'room',
      mode: 'edit',
      id: room.id,
      parentId: room.apartment,
      data: { name: room.name ?? '', capacity: room.capacity ?? 1 },
      saving: false,
      error: '',
    });

  const openEditBed = (bed) =>
    setEditor({ type: 'bed', mode: 'edit', id: bed.id, parentId: bed.room, data: { label: bed.label ?? '' }, saving: false, error: '' });

  const closeEditor = () => setEditor(null);

  const validateEditor = () => {
    if (!editor) return '';
    if (editor.type === 'building') {
      if (editor.data.number === '' || editor.data.number === null || Number.isNaN(Number(editor.data.number))) {
        return t.validationBuildingNumberRequired;
      }
      if (!editor.data.dorm_type) return t.validationDormTypeRequired;
    } else if (editor.type === 'apartment') {
      if (!String(editor.data.number ?? '').trim()) return t.validationApartmentNumberRequired;
      if (editor.data.room_count === '' || Number.isNaN(Number(editor.data.room_count)) || Number(editor.data.room_count) < 0) {
        return t.validationRoomCountInvalid;
      }
      if (editor.data.apartment_capacity !== '' && editor.data.apartment_capacity !== null) {
        if (Number.isNaN(Number(editor.data.apartment_capacity)) || Number(editor.data.apartment_capacity) < 0) {
          return t.validationCapacityInvalid;
        }
      }
    } else if (editor.type === 'room') {
      if (!String(editor.data.name ?? '').trim()) return t.validationRoomNameRequired;
      if (editor.data.capacity === '' || Number.isNaN(Number(editor.data.capacity)) || Number(editor.data.capacity) <= 0) {
        return t.validationRoomCapacityInvalid;
      }
    } else if (editor.type === 'bed') {
      if (!String(editor.data.label ?? '').trim()) return t.validationBedLabelRequired;
    }
    return '';
  };

  const saveEditor = async () => {
    if (!editor) return;
    const validationError = validateEditor();
    if (validationError) {
      setEditor((prev) => (prev ? { ...prev, error: validationError } : prev));
      return;
    }
    setEditor((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      if (editor.type === 'building') {
        const payload = {
          number: Number(editor.data.number),
          dorm_type: editor.data.dorm_type || null,
          gender_restriction: editor.data.gender_restriction || '',
        };
        if (editor.mode === 'create') await dormInventoryAPI.createBuilding(payload);
        else await dormInventoryAPI.updateBuilding(editor.id, payload);
        closeEditor();
        await refreshCurrentScope();
      } else if (editor.type === 'apartment') {
        const payload = {
          number: editor.data.number,
          category: editor.data.category,
          apartment_type: editor.data.apartment_type,
          room_count: Number(editor.data.room_count) || 0,
          apartment_capacity: editor.data.apartment_capacity === '' ? null : Number(editor.data.apartment_capacity),
          inactive_reason: editor.data.inactive_reason || '',
        };
        if (editor.mode === 'create') {
          payload.building = editor.parentId;
          await dormInventoryAPI.createApartment(payload);
        } else {
          await dormInventoryAPI.updateApartment(editor.id, payload);
        }
        closeEditor();
        await selectBuilding(selectedBuildingId || editor.parentId);
        await refreshCurrentScope();
      } else if (editor.type === 'room') {
        const payload = { name: editor.data.name, capacity: Number(editor.data.capacity) || 0 };
        if (editor.mode === 'create') {
          payload.apartment = editor.parentId;
          await dormInventoryAPI.createRoom(payload);
        } else {
          await dormInventoryAPI.updateRoom(editor.id, payload);
        }
        closeEditor();
        await refreshCurrentScope();
      } else if (editor.type === 'bed') {
        await dormInventoryAPI.updateBed(editor.id, { label: editor.data.label });
        closeEditor();
        await refreshCurrentScope();
      }
    } catch (err) {
      setEditor((prev) => (prev ? { ...prev, saving: false, error: err?.fieldErrors?.message || err?.message || t.actionError } : prev));
    }
  };


  const entityLabel = (targetType, target) => {
    if (targetType === 'building') return `${t.buildingNumberLabel} ${target.number}`;
    if (targetType === 'apartment') return `${t.apartmentNumberLabel} ${target.number}`;
    return `${t.roomNameLabel} ${target.name}`;
  };

  const openAvailabilityDialog = async (targetType, target, action) => {
    setAvailabilityDialog({
      targetType,
      targetId: target.id,
      label: entityLabel(targetType, target),
      action,
      impact: null,
      loadingImpact: action === 'inactivate',
      reason: '',
      note: '',
      saving: false,
      error: '',
    });

    if (action !== 'inactivate') return;

    try {
      const data = await whatIfAPI.simulateAvailabilityChange({ targetType, targetIds: [target.id], action });
      setAvailabilityDialog((prev) => (prev ? { ...prev, impact: data.summary, loadingImpact: false } : prev));
    } catch (err) {
      setAvailabilityDialog((prev) => (prev ? { ...prev, loadingImpact: false, error: err?.message || t.actionError } : prev));
    }
  };

  const confirmAvailabilityChange = async () => {
    if (!availabilityDialog) return;

    if (availabilityDialog.action === 'inactivate' && !availabilityDialog.reason) {
      setAvailabilityDialog((prev) => ({ ...prev, error: t.reasonRequired }));
      return;
    }

    setAvailabilityDialog((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const reasonText =
        availabilityDialog.action === 'inactivate'
          ? composeReason(reasonOptions.find((r) => r.value === availabilityDialog.reason)?.label || availabilityDialog.reason, availabilityDialog.note)
          : isHe
          ? 'הפעלה מחדש דרך ניהול מבנים'
          : 'Reactivated via inventory management';

      await whatIfAPI.confirmAvailabilityChange({
        targetType: availabilityDialog.targetType,
        targetIds: [availabilityDialog.targetId],
        action: availabilityDialog.action,
        reason: reasonText,
      });
      setAvailabilityDialog(null);
      await refreshCurrentScope();
    } catch (err) {
      setAvailabilityDialog((prev) => ({ ...prev, saving: false, error: err?.message || t.actionError }));
    }
  };

  // -------------------------------------------------------------------
  // Bed deletion (only wired if the backend capability truly exists)
  // -------------------------------------------------------------------
  const openDeleteBedDialog = (bed) => setDeleteDialog({ id: bed.id, label: bed.label, occupied: bed.is_occupied, saving: false, error: '' });

  const confirmDeleteBed = async () => {
    if (!deleteDialog || deleteDialog.occupied || !canDeleteBed) return;
    setDeleteDialog((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      await dormInventoryAPI.deleteBed(deleteDialog.id);
      setDeleteDialog(null);
      if (selectedRoomId) {
        const data = await dormInventoryAPI.getBeds({ room: selectedRoomId });
        setRoomBeds(asArray(data));
      }
    } catch (err) {
      setDeleteDialog((prev) => ({ ...prev, saving: false, error: err?.message || t.actionError }));
    }
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (loading) {
    return (
      <div className="inv-page inv-centerFull" dir={isHe ? 'rtl' : 'ltr'}>
        <Spinner size={26} />
      </div>
    );
  }

  const dormTypeLabelText = (dt) => (dt ? `${dt.name}${dt.code ? ` (${dt.code})` : ''}` : '');


  const editorBuildingCtx =
    editor?.type === 'building' ? buildings.find((b) => idOf(b.id) === idOf(editor.id)) || selectedBuilding : null;

  const editorApartmentBuildingCtx =
    editor?.type === 'apartment' ? buildings.find((b) => idOf(b.id) === idOf(editor.parentId)) || selectedBuilding : null;
  const editorApartmentRecord =
    editor?.type === 'apartment' && editor.mode === 'edit'
      ? buildingApartments.find((a) => idOf(a.id) === idOf(editor.id)) || selectedApartment
      : null;

  const editorRoomApartmentCtx =
    editor?.type === 'room' ? buildingApartments.find((a) => idOf(a.id) === idOf(editor.parentId)) || selectedApartment : null;
  const editorRoomBuildingCtx = editorRoomApartmentCtx
    ? buildings.find((b) => idOf(b.id) === idOf(editorRoomApartmentCtx.building)) || selectedBuilding
    : null;
  const editorRoomRecord =
    editor?.type === 'room' && editor.mode === 'edit' ? buildingRooms.find((r) => idOf(r.id) === idOf(editor.id)) || selectedRoom : null;

  const editorBedRoomCtx = editor?.type === 'bed' ? buildingRooms.find((r) => idOf(r.id) === idOf(editor.parentId)) || selectedRoom : null;
  const editorBedApartmentCtx = editorBedRoomCtx
    ? buildingApartments.find((a) => idOf(a.id) === idOf(editorBedRoomCtx.apartment)) || selectedApartment
    : null;
  const editorBedBuildingCtx = editorBedApartmentCtx
    ? buildings.find((b) => idOf(b.id) === idOf(editorBedApartmentCtx.building)) || selectedBuilding
    : null;
  const editorBedRecord = editor?.type === 'bed' ? roomBeds.find((bd) => idOf(bd.id) === idOf(editor.id)) || selectedBed : null;

  const EditorIcon =
    editor?.type === 'building' ? Building2 : editor?.type === 'apartment' ? Home : editor?.type === 'room' ? DoorOpen : Bed;

  const editorTitle = editor
    ? editor.type === 'building'
      ? editor.mode === 'create'
        ? t.drawerCreateBuilding
        : t.drawerEditBuilding
      : editor.type === 'apartment'
      ? editor.mode === 'create'
        ? t.drawerCreateApartment
        : t.drawerEditApartment
      : editor.type === 'room'
      ? editor.mode === 'create'
        ? t.drawerCreateRoom
        : t.drawerEditRoom
      : t.drawerEditBed
    : '';

  let editorContextLine = '';
  if (editor?.type === 'building') {
    if (editor.mode === 'edit' && editorBuildingCtx) {
      editorContextLine = [editorBuildingCtx.dorm_type_name, editorBuildingCtx.region_name].filter(Boolean).join(' • ');
    } else if (editor.mode === 'create') {
      editorContextLine = [selectedDormType?.name, selectedRegion?.name].filter(Boolean).join(' • ');
    }
  } else if (editor?.type === 'apartment') {
    const buildingLabel = editorApartmentBuildingCtx ? `${t.buildingNumberLabel} ${editorApartmentBuildingCtx.number}` : '';
    editorContextLine =
      editor.mode === 'edit' ? [`${t.apartmentNumberLabel} ${editor.data.number}`, buildingLabel].filter(Boolean).join(' • ') : buildingLabel;
  } else if (editor?.type === 'room') {
    const apartmentLabel = editorRoomApartmentCtx ? `${t.apartmentNumberLabel} ${editorRoomApartmentCtx.number}` : '';
    const buildingLabel = editorRoomBuildingCtx ? `${t.buildingNumberLabel} ${editorRoomBuildingCtx.number}` : '';
    editorContextLine = [apartmentLabel, buildingLabel].filter(Boolean).join(' • ');
  } else if (editor?.type === 'bed') {
    const roomLabel = editorBedRoomCtx ? `${t.parentRoomLabel} ${editorBedRoomCtx.name}` : '';
    const apartmentLabel = editorBedApartmentCtx ? `${t.apartmentNumberLabel} ${editorBedApartmentCtx.number}` : '';
    const buildingLabel = editorBedBuildingCtx ? `${t.buildingNumberLabel} ${editorBedBuildingCtx.number}` : '';
    editorContextLine = [roomLabel, apartmentLabel, buildingLabel].filter(Boolean).join(' • ');
  }

  return (
    <div className="inv-page" dir={isHe ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="inv-pageHeader">
        <div className="inv-pageHeaderLeft">
          <div className="inv-pageHeaderIcon">
            <Building2 size={22} />
          </div>
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <div className="inv-pageHeaderRight">
          {viewOnly && (
            <span className="inv-viewOnlyIndicator">
              <Shield size={13} /> {t.viewOnlyIndicator}
            </span>
          )}
          <IconButton icon={RefreshCw} onClick={handleRefresh} title={t.refresh} />
          {canManageInventory && (
            <button type="button" className="inv-primaryBtn" onClick={() => setWizardOpen(true)} disabled={!selectedRegionId}>
              <Plus size={15} /> {t.addBuilding}
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="inv-breadcrumb">
        <span>{t.breadcrumbRoot}</span>
        {selectedRegion && (
          <>
            <BreadcrumbChevron size={13} />
            <span>{selectedRegion.name}</span>
          </>
        )}
        {(selectedDormType || selectedBuilding) && (
          <>
            <BreadcrumbChevron size={13} />
            <span>{selectedBuilding ? selectedBuilding.dorm_type_name : selectedDormType?.name}</span>
          </>
        )}
        {selectedBuilding && (
          <>
            <BreadcrumbChevron size={13} />
            <span className="inv-breadcrumbActive">
              {t.buildingNumberLabel} {selectedBuilding.number}
            </span>
          </>
        )}
        {selectedApartment && (
          <>
            <BreadcrumbChevron size={13} />
            <span className="inv-breadcrumbActive">
              {t.apartmentNumberLabel} {selectedApartment.number}
            </span>
          </>
        )}
        {selectedRoom && (
          <>
            <BreadcrumbChevron size={13} />
            <span className="inv-breadcrumbActive">
              {t.colRoom} {selectedRoom.name}
            </span>
          </>
        )}
        {selectedBed && (
          <>
            <BreadcrumbChevron size={13} />
            <span className="inv-breadcrumbActive">
              {t.colBed} {selectedBed.label}
            </span>
          </>
        )}
      </div>

      {pageError && <PageAlert onClose={() => setPageError('')}>{pageError}</PageAlert>}
      {actionError && <PageAlert onClose={() => setActionError('')}>{actionError}</PageAlert>}

      {/* Filter toolbar */}
      <div className="inv-filterBar">
        <div className="inv-filterField">
          <label>{t.chooseRegion}</label>
          <select value={selectedRegionId} disabled={!(isCentralAdmin() || isRegionBoss())} onChange={(e) => selectRegion(e.target.value)}>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
        <div className="inv-filterField">
          <label>{t.chooseDormType}</label>
          <select value={selectedDormTypeId} onChange={(e) => setSelectedDormTypeId(e.target.value)}>
            <option value="all">{t.allDormTypes}</option>
            {dormTypesInRegion.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dormTypeLabelText(dt)}
              </option>
            ))}
          </select>
        </div>
        <div className="inv-filterField">
          <label>{t.status}</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="active">{t.statusActive}</option>
            <option value="inactive">{t.statusInactive}</option>
            <option value="all">{t.statusAll}</option>
          </select>
        </div>
        <div className="inv-filterSearch">
          <Search size={15} />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t.search} />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label="clear">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="inv-summaryStrip">
        <MiniMetric icon={Building2} value={summaryMetrics.buildings} label={t.metricBuildings} />
        <MiniMetric icon={Home} value={summaryMetrics.apartments} label={t.metricApartments} />
        <MiniMetric icon={DoorOpen} value={summaryMetrics.rooms} label={t.metricRooms} />
        <MiniMetric icon={Bed} value={summaryMetrics.beds} label={t.metricBeds} />
        <MiniMetric icon={Bed} value={summaryMetrics.occupied} label={t.metricOccupied} />
        <MiniMetric icon={Bed} value={summaryMetrics.free} label={t.metricFree} />
      </div>

      {/* Three-column workspace */}
      <div className="inv-workspace">
        {/* Navigator */}
        <div className="inv-panel inv-navigatorPanel">
          <SectionHeader
            title={t.navigatorTitle}
            count={filteredBuildings.length}
            action={
              canManageInventory && (
                <IconButton icon={Plus} onClick={() => setWizardOpen(true)} title={t.addBuilding} disabled={!selectedRegionId} />
              )
            }
          />
          <div className="inv-buildingList">
            {filteredBuildings.length === 0 ? (
              <EmptyPanel icon={Building2} title={t.noBuildings} />
            ) : (
              filteredBuildings.map((building) => (
                <button
                  key={building.id}
                  type="button"
                  className={`inv-buildingItem ${idOf(selectedBuildingId) === idOf(building.id) ? 'is-selected' : ''} ${
                    !building.is_active ? 'is-inactive' : ''
                  }`}
                  onClick={() => selectBuilding(building.id)}
                >
                  <div className="inv-buildingItemTop">
                    <span className="inv-buildingItemNumber">
                      {t.buildingNumberLabel} {building.number}
                    </span>
                    <StatusBadge active={building.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                  </div>
                  <div className="inv-buildingItemMeta">{building.dorm_type_name}</div>
                  <div className="inv-buildingItemCounts">
                    {building.apartment_count} {t.apartmentsCount} · {building.room_count} {t.roomsCount} · {building.bed_count} {t.bedsCount}
                  </div>
                  <div className="inv-buildingItemBottom">
                    <OccupancyBadge occupied={building.occupied_beds} total={building.bed_count} label={t.occupiedShort} />
                    {building.gender_restriction && (
                      <span className="inv-genderTag">{genderRestrictionLabels[building.gender_restriction]}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>


        <div className="inv-panel inv-structurePanel">
          {!selectedBuilding ? (
            <EmptyPanel icon={Building2} title={t.selectBuildingTitle} hint={t.selectBuildingHint} />
          ) : loadingStructure ? (
            <div className="inv-centerInline">
              <Spinner size={20} />
            </div>
          ) : (
            <>
              <div className="inv-summaryBar">
                <div className="inv-summaryBarMain">
                  <Building2 size={17} />
                  <div>
                    <div className="inv-summaryBarTitle">
                      {t.buildingNumberLabel} {selectedBuilding.number}
                    </div>
                    <div className="inv-summaryBarMeta">{selectedBuilding.dorm_type_name}</div>
                  </div>
                  <StatusBadge active={selectedBuilding.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                </div>
                <div className="inv-summaryBarActions">
                  <button type="button" className="inv-linkBtn" onClick={() => setBuildingDetailsOpen((o) => !o)}>
                    {buildingDetailsOpen ? t.hideDetails : t.viewDetails}
                    <ChevronDown size={13} className={buildingDetailsOpen ? 'inv-chevron is-open' : 'inv-chevron'} />
                  </button>
                  {canManageInventory && (
                    <>
                      <IconButton icon={Pencil} onClick={() => openEditBuilding(selectedBuilding)} title={t.edit} />
                      {selectedBuilding.is_active ? (
                        <IconButton
                          icon={PowerOff}
                          tone="danger"
                          onClick={() => openAvailabilityDialog('building', selectedBuilding, 'inactivate')}
                          title={t.deactivate}
                        />
                      ) : (
                        <IconButton
                          icon={Power}
                          tone="success"
                          onClick={() => openAvailabilityDialog('building', selectedBuilding, 'reactivate')}
                          title={t.activate}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>

              {buildingDetailsOpen && (
                <div className="inv-detailsStrip">
                  <DetailRow label={t.regionLabel} value={selectedBuilding.region_name} />
                  <DetailRow
                    label={t.genderRestrictionLabel}
                    value={genderRestrictionLabels[selectedBuilding.gender_restriction] || t.noRestriction}
                  />
                  <DetailRow label={t.apartmentCountLabel} value={selectedBuilding.apartment_count} />
                  <DetailRow label={t.roomCountLabel} value={selectedBuilding.room_count} />
                  <DetailRow label={t.bedCountLabel} value={selectedBuilding.bed_count} />
                  <DetailRow label={t.occupiedBedsLabel} value={selectedBuilding.occupied_beds} />
                  <DetailRow label={t.freeBedsLabel} value={selectedBuilding.free_beds} />
                </div>
              )}

              <SectionHeader
                title={t.apartmentsTable}
                count={apartmentsForSelectedBuilding.length}
                action={
                  canManageInventory && (
                    <button type="button" className="inv-secondaryBtn" onClick={() => openCreateApartment(selectedBuildingId)}>
                      <Plus size={13} /> {t.addApartment}
                    </button>
                  )
                }
              />

              {apartmentsForSelectedBuilding.length === 0 ? (
                <EmptyPanel title={t.noApartments} />
              ) : (
                <div className="inv-accordionList">
                  {apartmentsForSelectedBuilding.map((apt) => {
                    const isOpen = idOf(selectedApartmentId) === idOf(apt.id);
                    return (
                      <div key={apt.id} className={`inv-accordionItem ${isOpen ? 'is-open' : ''} ${!apt.is_active ? 'is-inactive' : ''}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          className="inv-accordionHeader"
                          onClick={() => selectApartment(apt.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectApartment(apt.id);
                            }
                          }}
                        >
                          <ChevronDown size={14} className={isOpen ? 'inv-chevron is-open' : 'inv-chevron'} />
                          <Home size={15} />
                          <span className="inv-accordionTitle">
                            {t.apartmentNumberLabel} {apt.number}
                          </span>
                          <span className="inv-accordionTag">{categoryLabels[apt.category] || apt.category}</span>
                          <span className="inv-accordionTag">{apartmentTypeLabels[apt.apartment_type] || apt.apartment_type}</span>
                          <span className="inv-accordionMeta">
                            {apt.actual_room_count} {t.roomsCount}
                          </span>
                          <OccupancyBadge occupied={apt.occupied_beds} total={apt.bed_count} />
                          <StatusBadge active={apt.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                          {canManageInventory && (
                            <span className="inv-accordionRowAction" onClick={(e) => e.stopPropagation()}>
                              <IconButton icon={Pencil} onClick={() => openEditApartment(apt)} title={t.edit} />
                            </span>
                          )}
                        </div>

                        {isOpen && (
                          <div className="inv-accordionBody">
                            <div className="inv-detailsStrip">
                              <DetailRow label={t.apartmentCapacityLabel} value={apt.apartment_capacity ?? '—'} />
                              <DetailRow label={t.totalBedsLabel} value={apt.bed_count} />
                              <DetailRow label={t.freeBedsLabel} value={apt.free_beds} />
                              {!apt.is_active && <DetailRow label={t.inactiveReasonLabel} value={apt.inactive_reason_display || t.none} />}
                              {canManageInventory && (
                                <div className="inv-detailsStripActions">
                                  {apt.is_active ? (
                                    <button
                                      type="button"
                                      className="inv-dangerBtn"
                                      onClick={() => openAvailabilityDialog('apartment', apt, 'inactivate')}
                                    >
                                      <PowerOff size={13} /> {t.deactivate}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="inv-successBtn"
                                      onClick={() => openAvailabilityDialog('apartment', apt, 'reactivate')}
                                    >
                                      <Power size={13} /> {t.activate}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            <SectionHeader
                              title={t.roomsTable}
                              count={roomsForSelectedApartment.length}
                              action={
                                canManageInventory && (
                                  <button type="button" className="inv-secondaryBtn" onClick={() => openCreateRoom(selectedApartmentId)}>
                                    <Plus size={13} /> {t.addRoom}
                                  </button>
                                )
                              }
                            />

                            {roomsForSelectedApartment.length === 0 ? (
                              <EmptyPanel title={t.noRooms} />
                            ) : (
                              <div className="inv-accordionList inv-accordionList-nested">
                                {roomsForSelectedApartment.map((room) => {
                                  const roomOpen = idOf(selectedRoomId) === idOf(room.id);
                                  return (
                                    <div
                                      key={room.id}
                                      className={`inv-accordionItem ${roomOpen ? 'is-open' : ''} ${!room.is_active ? 'is-inactive' : ''}`}
                                    >
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        className="inv-accordionHeader"
                                        onClick={() => selectRoom(room.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            selectRoom(room.id);
                                          }
                                        }}
                                      >
                                        <ChevronDown size={14} className={roomOpen ? 'inv-chevron is-open' : 'inv-chevron'} />
                                        <DoorOpen size={15} />
                                        <span className="inv-accordionTitle">
                                          {t.colRoom} {room.name}
                                        </span>
                                        {room.has_missing_bed_records && (
                                          <span className="inv-warnIcon" title={t.bedRecordsMismatch}>
                                            <AlertTriangle size={12} />
                                          </span>
                                        )}
                                        <span className="inv-accordionMeta">
                                          {t.capacityLabel}: {room.capacity}
                                        </span>
                                        <OccupancyBadge occupied={room.current_occupancy} total={room.capacity} />
                                        <StatusBadge active={room.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                                        {canManageInventory && (
                                          <span className="inv-accordionRowAction" onClick={(e) => e.stopPropagation()}>
                                            <IconButton icon={Pencil} onClick={() => openEditRoom(room)} title={t.edit} />
                                          </span>
                                        )}
                                      </div>

                                      {roomOpen && (
                                        <div className="inv-accordionBody">
                                          <div className="inv-detailsStrip">
                                            <DetailRow label={t.availableBedsLabel} value={room.available_beds} />
                                            <DetailRow label={t.bedCountLabel} value={room.bed_count} />
                                            {canManageInventory && (
                                              <div className="inv-detailsStripActions">
                                                {room.is_active ? (
                                                  <button
                                                    type="button"
                                                    className="inv-dangerBtn"
                                                    onClick={() => openAvailabilityDialog('room', room, 'inactivate')}
                                                  >
                                                    <PowerOff size={13} /> {t.deactivate}
                                                  </button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="inv-successBtn"
                                                    onClick={() => openAvailabilityDialog('room', room, 'reactivate')}
                                                  >
                                                    <Power size={13} /> {t.activate}
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                          {room.has_missing_bed_records && (
                                            <p className="inv-inspectorWarning">
                                              <AlertTriangle size={13} /> {t.bedRecordsMismatch}
                                            </p>
                                          )}

                                          <SectionHeader
                                            title={t.bedsTable}
                                            count={roomBeds.length}
                                            action={
                                              canCreateBed && (
                                                <button type="button" className="inv-secondaryBtn">
                                                  <Plus size={13} /> {t.addBed}
                                                </button>
                                              )
                                            }
                                          />
                                          <div className="inv-tableWrap">
                                            {loadingBeds ? (
                                              <div className="inv-centerInline">
                                                <Spinner size={18} />
                                              </div>
                                            ) : roomBeds.length === 0 ? (
                                              <EmptyPanel title={t.noBeds} />
                                            ) : (
                                              <table className="inv-table">
                                                <thead>
                                                  <tr>
                                                    <th>{t.colBed}</th>
                                                    <th>{t.colAvailability}</th>
                                                    <th>{t.colActions}</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {roomBeds.map((bed) => (
                                                    <tr
                                                      key={bed.id}
                                                      className={idOf(selectedBedId) === idOf(bed.id) ? 'is-selected' : ''}
                                                      onClick={() => selectBed(bed.id)}
                                                    >
                                                      <td>{bed.label}</td>
                                                      <td>
                                                        <span className={`inv-availabilityTag ${bed.is_occupied ? 'is-occupied' : 'is-available'}`}>
                                                          {bed.is_occupied ? t.occupied : t.available}
                                                        </span>
                                                      </td>
                                                      <td onClick={(e) => e.stopPropagation()}>
                                                        {canManageInventory && (
                                                          <IconButton icon={Pencil} onClick={() => openEditBed(bed)} title={t.edit} />
                                                        )}
                                                        {canDeleteBed && (
                                                          <IconButton
                                                            icon={Trash2}
                                                            tone="danger"
                                                            onClick={() => openDeleteBedDialog(bed)}
                                                            title={t.deleteAction}
                                                            disabled={bed.is_occupied}
                                                          />
                                                        )}
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            )}
                                            <p className="inv-bedCapabilityNote">{t.bedNoActionsSupported}</p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit / create modal — rendered via portal directly under <body> so
          its `position: fixed` centers on the true browser viewport and its
          stacking order is independent of the app shell (sidebar/header),
          instead of being confined to wherever it happens to be nested. */}
      {editor &&
        createPortal(
          <div
            className="inv-modalOverlay"
            dir={isHe ? 'rtl' : 'ltr'}
            onClick={() => (!editor.saving ? closeEditor() : null)}
          >
            <div className="inv-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modalHeader">
              <div className="inv-modalHeaderIcon">
                <EditorIcon size={18} />
              </div>
              <div className="inv-modalHeaderText">
                <h3>{editorTitle}</h3>
                {editorContextLine && <p className="inv-modalHeaderContext">{editorContextLine}</p>}
              </div>
              <IconButton icon={X} onClick={closeEditor} title={t.cancel} disabled={editor.saving} />
            </div>

            <div className="inv-modalBody">
              {editor.error && <PageAlert>{editor.error}</PageAlert>}

              {editor.type === 'building' && (
                <>
                  <ModalSection title={t.sectionGeneralInfo}>
                    <div className="inv-modalGrid">
                      <FormField label={t.buildingNumberLabel} htmlFor="inv-b-number">
                        <input
                          id="inv-b-number"
                          type="number"
                          value={editor.data.number}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, number: e.target.value } }))}
                        />
                      </FormField>
                      <FormField label={t.dormTypeLabel} htmlFor="inv-b-dormtype">
                        <select
                          id="inv-b-dormtype"
                          value={editor.data.dorm_type}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, dorm_type: e.target.value } }))}
                        >
                          <option value="">—</option>
                          {dormTypesInRegion.map((dt) => (
                            <option key={dt.id} value={dt.id}>
                              {dormTypeLabelText(dt)}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>
                  </ModalSection>

                  <ModalSection title={t.sectionAllocationConfig}>
                    <div className="inv-modalGrid is-single">
                      <FormField label={t.genderRestrictionLabel} htmlFor="inv-b-restriction" hint={t.genderRestrictionHint}>
                        <select
                          id="inv-b-restriction"
                          value={editor.data.gender_restriction}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, gender_restriction: e.target.value } }))}
                        >
                          <option value="">{t.noRestriction}</option>
                          <option value="male">{genderRestrictionLabels.male}</option>
                          <option value="female">{genderRestrictionLabels.female}</option>
                        </select>
                      </FormField>
                    </div>
                  </ModalSection>

                  {editor.mode === 'edit' && (
                    <ModalSection title={t.sectionStatus}>
                      <div className="inv-statusRow">
                        <StatusBadge active={editorBuildingCtx?.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                      </div>
                      <div className="inv-infoCallout">
                        <Info size={14} />
                        <span>{t.availabilityManagedSeparately}</span>
                      </div>
                    </ModalSection>
                  )}
                </>
              )}

              {editor.type === 'apartment' && (
                <>
                  <ModalSection title={t.sectionGeneralInfo}>
                    <div className="inv-modalGrid">
                      <FormField label={t.apartmentNumberLabel} htmlFor="inv-a-number">
                        <input
                          id="inv-a-number"
                          value={editor.data.number}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, number: e.target.value } }))}
                        />
                      </FormField>
                      <ReadOnlyField
                        label={t.parentBuildingLabel}
                        value={editorApartmentBuildingCtx ? `${t.buildingNumberLabel} ${editorApartmentBuildingCtx.number}` : '—'}
                      />
                      <ReadOnlyField label={t.dormTypeLabel} value={editorApartmentBuildingCtx?.dorm_type_name || '—'} />
                    </div>
                  </ModalSection>

                  <ModalSection title={t.sectionApartmentClassification}>
                    <div className="inv-modalGrid">
                      <FormField label={t.genderCategoryLabel} htmlFor="inv-a-category">
                        <select
                          id="inv-a-category"
                          value={editor.data.category}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, category: e.target.value } }))}
                        >
                          <option value="male">{categoryLabels.male}</option>
                          <option value="female">{categoryLabels.female}</option>
                          <option value="mixed">{categoryLabels.mixed}</option>
                        </select>
                      </FormField>
                      <FormField label={t.housingTypeLabel} htmlFor="inv-a-type">
                        <select
                          id="inv-a-type"
                          value={editor.data.apartment_type}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, apartment_type: e.target.value } }))}
                        >
                          <option value="single">{apartmentTypeLabels.single}</option>
                          <option value="couple">{apartmentTypeLabels.couple}</option>
                          <option value="family">{apartmentTypeLabels.family}</option>
                        </select>
                      </FormField>
                    </div>
                  </ModalSection>

                  <ModalSection title={t.sectionCapacityConfig}>
                    <div className="inv-modalGrid">
                      <FormField label={t.plannedRoomCountLabel} htmlFor="inv-a-roomcount">
                        <input
                          id="inv-a-roomcount"
                          type="number"
                          value={editor.data.room_count}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, room_count: e.target.value } }))}
                        />
                      </FormField>
                      <FormField label={t.apartmentCapacityLabel} htmlFor="inv-a-capacity">
                        <input
                          id="inv-a-capacity"
                          type="number"
                          value={editor.data.apartment_capacity}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, apartment_capacity: e.target.value } }))}
                        />
                      </FormField>
                    </div>
                    {editorApartmentRecord && (
                      <div className="inv-summaryRow">
                        <div className="inv-summaryItem">
                          <span>{t.actualRoomCountLabel}</span>
                          <strong>{editorApartmentRecord.actual_room_count}</strong>
                        </div>
                        <div className="inv-summaryItem">
                          <span>{t.totalBedsLabel}</span>
                          <strong>{editorApartmentRecord.bed_count}</strong>
                        </div>
                        <div className="inv-summaryItem">
                          <span>{t.occupiedBedsLabel}</span>
                          <strong>{editorApartmentRecord.occupied_beds}</strong>
                        </div>
                        <div className="inv-summaryItem">
                          <span>{t.freeBedsLabel}</span>
                          <strong>{editorApartmentRecord.free_beds}</strong>
                        </div>
                      </div>
                    )}
                  </ModalSection>

                  {editor.mode === 'edit' && (
                    <ModalSection title={t.sectionAvailabilityInfo}>
                      <div className="inv-statusRow">
                        <StatusBadge active={editorApartmentRecord?.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                      </div>
                      {editorApartmentRecord && !editorApartmentRecord.is_active && (
                        <ReadOnlyField label={t.inactiveReasonLabel} value={editorApartmentRecord.inactive_reason_display || t.none} />
                      )}
                      <div className="inv-infoCallout">
                        <Info size={14} />
                        <span>{t.availabilityManagedSeparately}</span>
                      </div>
                    </ModalSection>
                  )}
                </>
              )}

              {editor.type === 'room' && (
                <>
                  <ModalSection title={t.sectionGeneralInfo}>
                    <div className="inv-modalGrid">
                      <FormField label={t.roomNameLabel} htmlFor="inv-r-name">
                        <input
                          id="inv-r-name"
                          value={editor.data.name}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, name: e.target.value } }))}
                        />
                      </FormField>
                      <FormField label={t.capacityLabel} htmlFor="inv-r-capacity">
                        <input
                          id="inv-r-capacity"
                          type="number"
                          value={editor.data.capacity}
                          onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, capacity: e.target.value } }))}
                        />
                      </FormField>
                    </div>
                    {editorRoomRecord && (
                      <div className="inv-summaryRow">
                        <div className="inv-summaryItem">
                          <span>{t.occupancyLabel}</span>
                          <strong>{editorRoomRecord.current_occupancy}</strong>
                        </div>
                        <div className="inv-summaryItem">
                          <span>{t.availableBedsLabel}</span>
                          <strong>{editorRoomRecord.available_beds}</strong>
                        </div>
                        <div className="inv-summaryItem">
                          <span>{t.bedCountLabel}</span>
                          <strong>{editorRoomRecord.bed_count}</strong>
                        </div>
                      </div>
                    )}
                  </ModalSection>

                  {editor.mode === 'edit' && (
                    <ModalSection title={t.sectionAvailabilityInfo}>
                      <div className="inv-statusRow">
                        <StatusBadge active={editorRoomRecord?.is_active} activeText={t.statusActive} inactiveText={t.statusInactive} />
                      </div>
                      <div className="inv-infoCallout">
                        <Info size={14} />
                        <span>{t.availabilityManagedSeparately}</span>
                      </div>
                    </ModalSection>
                  )}
                </>
              )}

              {editor.type === 'bed' && (
                <ModalSection title={t.sectionGeneralInfo}>
                  <div className="inv-modalGrid is-single">
                    <FormField label={t.bedLabelField} htmlFor="inv-bed-label">
                      <input
                        id="inv-bed-label"
                        value={editor.data.label}
                        onChange={(e) => setEditor((prev) => ({ ...prev, data: { ...prev.data, label: e.target.value } }))}
                      />
                    </FormField>
                  </div>
                  <div className="inv-modalGrid">
                    <ReadOnlyField label={t.parentRoomLabel} value={editorBedRoomCtx?.name} />
                    <ReadOnlyField label={t.parentApartmentLabel} value={editorBedApartmentCtx?.number} />
                    <ReadOnlyField label={t.buildingNumberLabel} value={editorBedBuildingCtx?.number} />
                    <ReadOnlyField label={t.availabilityLabel} value={editorBedRecord?.is_occupied ? t.occupied : t.available} />
                  </div>
                </ModalSection>
              )}
            </div>

            <div className="inv-modalFooter">
              <button type="button" className="inv-secondaryBtn" onClick={closeEditor} disabled={editor.saving}>
                {t.cancel}
              </button>
              <button type="button" className="inv-primaryBtn" onClick={saveEditor} disabled={editor.saving}>
                {editor.saving ? <Spinner size={14} /> : editor.mode === 'create' ? t.create : t.save}
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}

      {/* Availability (activate/deactivate) dialog */}
      {availabilityDialog && (
        <div className="inv-overlay" onClick={() => (!availabilityDialog.saving ? setAvailabilityDialog(null) : null)}>
          <div className="inv-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{availabilityDialog.action === 'inactivate' ? t.deactivateTitle(availabilityDialog.label) : t.activateTitle(availabilityDialog.label)}</h3>

            {availabilityDialog.action === 'inactivate' ? (
              <>
                <div className="inv-impactBox">
                  <div className="inv-impactTitle">
                    <AlertTriangle size={14} /> {t.impactTitle}
                  </div>
                  {availabilityDialog.loadingImpact ? (
                    <div className="inv-centerInline">
                      <Spinner size={16} /> {t.loadingImpact}
                    </div>
                  ) : availabilityDialog.impact ? (
                    <>
                      <div className="inv-impactGrid">
                        <div>
                          <span>{t.impactApartments}</span>
                          <strong>{availabilityDialog.impact.lost_apartments}</strong>
                        </div>
                        <div>
                          <span>{t.impactRooms}</span>
                          <strong>{availabilityDialog.impact.lost_rooms}</strong>
                        </div>
                        <div>
                          <span>{t.impactBeds}</span>
                          <strong>{availabilityDialog.impact.lost_beds}</strong>
                        </div>
                        <div>
                          <span>{t.impactAssignments}</span>
                          <strong>{availabilityDialog.impact.affected_students_count}</strong>
                        </div>
                      </div>
                      <p className="inv-impactNote">
                        {availabilityDialog.impact.affected_students_count > 0 ? t.impactNote : t.impactNoAssignments}
                      </p>
                    </>
                  ) : null}
                </div>

                <FormField label={t.reasonLabel} htmlFor="inv-avail-reason">
                  <select
                    id="inv-avail-reason"
                    value={availabilityDialog.reason}
                    onChange={(e) => setAvailabilityDialog((prev) => ({ ...prev, reason: e.target.value, error: '' }))}
                  >
                    <option value="">{t.chooseReason}</option>
                    {reasonOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t.noteLabel} htmlFor="inv-avail-note">
                  <textarea
                    id="inv-avail-note"
                    rows={2}
                    value={availabilityDialog.note}
                    onChange={(e) => setAvailabilityDialog((prev) => ({ ...prev, note: e.target.value }))}
                  />
                </FormField>
              </>
            ) : (
              <p>{t.confirmActivateShort}</p>
            )}

            {availabilityDialog.error && <PageAlert>{availabilityDialog.error}</PageAlert>}

            <div className="inv-drawerFooter">
              <button type="button" className="inv-secondaryBtn" onClick={() => setAvailabilityDialog(null)} disabled={availabilityDialog.saving}>
                {t.cancel}
              </button>
              <button
                type="button"
                className={availabilityDialog.action === 'inactivate' ? 'inv-dangerBtn' : 'inv-successBtn'}
                onClick={confirmAvailabilityChange}
                disabled={availabilityDialog.saving || availabilityDialog.loadingImpact}
              >
                {availabilityDialog.saving ? <Spinner size={14} /> : t.confirmProceed}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bed deletion dialog (only ever opened when canDeleteBed is true) */}
      {deleteDialog && (
        <div className="inv-overlay" onClick={() => (!deleteDialog.saving ? setDeleteDialog(null) : null)}>
          <div className="inv-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t.deleteBedTitle(deleteDialog.label)}</h3>
            {deleteDialog.occupied && (
              <PageAlert tone="warning">{t.deleteBedOccupiedWarning}</PageAlert>
            )}
            {deleteDialog.error && <PageAlert>{deleteDialog.error}</PageAlert>}
            <div className="inv-drawerFooter">
              <button type="button" className="inv-secondaryBtn" onClick={() => setDeleteDialog(null)} disabled={deleteDialog.saving}>
                {t.cancel}
              </button>
              <button type="button" className="inv-dangerBtn" onClick={confirmDeleteBed} disabled={deleteDialog.saving || deleteDialog.occupied}>
                {deleteDialog.saving ? <Spinner size={14} /> : t.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {}
      {wizardOpen && (
        <BuildingSetupWizard
          language={language}
          dormTypesInRegion={dormTypesInRegion}
          defaultDormTypeId={selectedDormTypeId !== 'all' ? selectedDormTypeId : ''}
          regionName={selectedRegion?.name}
          categoryLabels={categoryLabels}
          apartmentTypeLabels={apartmentTypeLabels}
          genderRestrictionLabels={genderRestrictionLabels}
          onClose={(building) => {
            setWizardOpen(false);
            if (building) handleWizardCompleted(building);
          }}
          onCompleted={handleWizardCompleted}
        />
      )}

      <style>{`
        .inv-page {
          --inv-bg: #f4f5f7;
          --inv-panel: #ffffff;
          --inv-panel-subtle: #f9fafb;
          --inv-border: #e5e7eb;
          --inv-border-strong: #d1d5db;
          --inv-text: #111827;
          --inv-muted: #6b7280;
          --inv-primary: #2563eb;
          --inv-primary-hover: #1d4ed8;
          --inv-primary-soft: #dbeafe;
          --inv-success: #059669;
          --inv-success-soft: #d1fae5;
          --inv-warning: #b45309;
          --inv-warning-soft: #fef3c7;
          --inv-danger: #dc2626;
          --inv-danger-soft: #fee2e2;
          --inv-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);

          padding: 20px 22px 32px;
          background: var(--inv-bg);
          min-height: 100vh;
          color: var(--inv-text);
          font-size: 13px;
        }

        .inv-centerFull { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .inv-centerInline { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 18px; color: var(--inv-muted); }
        .inv-spin { animation: inv-spin 0.9s linear infinite; }
        @keyframes inv-spin { to { transform: rotate(360deg); } }

        /* Header */
        .inv-pageHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
        .inv-pageHeaderLeft { display: flex; align-items: flex-start; gap: 10px; }
        .inv-pageHeaderIcon {
          width: 36px; height: 36px; border-radius: 10px; background: var(--inv-primary-soft); color: var(--inv-primary);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .inv-pageHeader h1 { font-size: 18px; margin: 0 0 2px; font-weight: 750; }
        .inv-pageHeader p { margin: 0; color: var(--inv-muted); font-size: 12px; }
        .inv-pageHeaderRight { display: flex; align-items: center; gap: 8px; }
        .inv-viewOnlyIndicator {
          display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 650; color: var(--inv-warning);
          background: var(--inv-warning-soft); border-radius: 8px; padding: 5px 9px;
        }

        /* Breadcrumb */
        .inv-breadcrumb {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--inv-muted);
          margin-bottom: 12px; padding: 6px 2px;
        }
        .inv-breadcrumbActive { color: var(--inv-text); font-weight: 650; }

        /* Alerts */
        .inv-alert {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          border-radius: 10px; padding: 9px 12px; font-size: 12px; font-weight: 600; margin-bottom: 10px;
        }
        .inv-alert-danger { background: var(--inv-danger-soft); color: var(--inv-danger); }
        .inv-alert-warning { background: var(--inv-warning-soft); color: var(--inv-warning); }
        .inv-alert button { border: none; background: transparent; cursor: pointer; display: flex; color: inherit; }

        /* Filter bar */
        .inv-filterBar {
          display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
          background: var(--inv-panel); border: 1px solid var(--inv-border); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px;
          box-shadow: var(--inv-shadow);
        }
        .inv-filterField { display: flex; flex-direction: column; gap: 3px; min-width: 140px; }
        .inv-filterField label { font-size: 10.5px; color: var(--inv-muted); font-weight: 650; text-transform: uppercase; letter-spacing: 0.02em; }
        .inv-filterField select {
          border: 1px solid var(--inv-border); border-radius: 8px; padding: 6px 8px; font-size: 12.5px; background: var(--inv-panel); color: var(--inv-text);
        }
        .inv-filterSearch {
          display: flex; align-items: center; gap: 6px; border: 1px solid var(--inv-border); border-radius: 8px; padding: 6px 9px;
          flex: 1; min-width: 200px; color: var(--inv-muted);
        }
        .inv-filterSearch input { border: none; outline: none; flex: 1; font-size: 12.5px; background: transparent; color: var(--inv-text); }
        .inv-filterSearch button { border: none; background: transparent; cursor: pointer; display: flex; color: var(--inv-muted); }

        /* Buttons */
        .inv-primaryBtn, .inv-secondaryBtn, .inv-dangerBtn, .inv-successBtn {
          display: inline-flex; align-items: center; gap: 5px; border-radius: 8px; padding: 6px 11px;
          font-size: 12px; font-weight: 650; cursor: pointer; border: 1px solid transparent; white-space: nowrap;
        }
        .inv-primaryBtn { background: var(--inv-primary); color: #fff; }
        .inv-primaryBtn:hover:not(:disabled) { background: var(--inv-primary-hover); }
        .inv-primaryBtn:disabled { opacity: 0.55; cursor: not-allowed; }
        .inv-secondaryBtn { background: var(--inv-panel); color: var(--inv-text); border-color: var(--inv-border-strong); }
        .inv-dangerBtn { background: var(--inv-danger-soft); color: var(--inv-danger); }
        .inv-dangerBtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .inv-successBtn { background: var(--inv-success-soft); color: var(--inv-success); }
        .inv-iconBtn {
          border: 1px solid var(--inv-border-strong); background: var(--inv-panel); border-radius: 7px; padding: 5px;
          cursor: pointer; display: inline-flex; color: var(--inv-muted);
        }
        .inv-iconBtn:hover:not(:disabled) { color: var(--inv-text); border-color: var(--inv-primary); }
        .inv-iconBtn:disabled { opacity: 0.45; cursor: not-allowed; }
        .inv-iconBtn-danger:hover:not(:disabled) { color: var(--inv-danger); border-color: var(--inv-danger); }

        /* Summary strip */
        .inv-summaryStrip {
          display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px;
        }
        .inv-miniMetric {
          display: flex; align-items: center; gap: 8px; background: var(--inv-panel); border: 1px solid var(--inv-border);
          border-radius: 10px; padding: 8px 10px; color: var(--inv-primary); box-shadow: var(--inv-shadow);
        }
        .inv-miniMetricValue { font-size: 15px; font-weight: 800; color: var(--inv-text); line-height: 1.1; }
        .inv-miniMetricLabel { font-size: 10.5px; color: var(--inv-muted); }

        /* Workspace grid */
        .inv-workspace {
          display: grid;
          grid-template-columns: minmax(250px, 285px) minmax(520px, 1fr);
          gap: 12px;
          align-items: start;
        }
        .inv-panel { background: var(--inv-panel); border: 1px solid var(--inv-border); border-radius: 12px; padding: 10px; box-shadow: var(--inv-shadow); }

        .inv-sectionHeader { display: flex; align-items: center; justify-content: space-between; padding: 4px 4px 8px; }
        .inv-sectionHeader h3 { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--inv-text); }

        .inv-emptyPanel {
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
          color: var(--inv-muted); padding: 20px 10px; text-align: center; font-size: 12px;
        }
        .inv-emptyPanelTitle { font-weight: 650; font-size: 12.5px; color: var(--inv-text); }
        .inv-emptyPanel p { margin: 0; font-size: 11.5px; max-width: 220px; }

        /* Navigator */
        .inv-buildingList { display: flex; flex-direction: column; gap: 6px; max-height: 64vh; overflow-y: auto; }
        .inv-buildingItem {
          text-align: start; border: 1px solid var(--inv-border); border-inline-start: 3px solid transparent;
          border-radius: 9px; padding: 8px 9px; background: var(--inv-panel); cursor: pointer;
          display: flex; flex-direction: column; gap: 3px;
        }
        .inv-buildingItem.is-selected { background: var(--inv-primary-soft); border-inline-start-color: var(--inv-primary); }
        .inv-buildingItem.is-inactive { opacity: 0.6; }
        .inv-buildingItemTop { display: flex; justify-content: space-between; align-items: center; }
        .inv-buildingItemNumber { font-weight: 700; font-size: 12.5px; }
        .inv-buildingItemMeta { font-size: 11px; color: var(--inv-muted); }
        .inv-buildingItemCounts { font-size: 10.5px; color: var(--inv-muted); }
        .inv-buildingItemBottom { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 2px; }
        .inv-genderTag { font-size: 10px; font-weight: 650; background: var(--inv-panel-subtle); border: 1px solid var(--inv-border); border-radius: 7px; padding: 2px 6px; color: var(--inv-muted); }

        /* Status / occupancy badges */
        .inv-statusBadge { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 7px; }
        .inv-statusBadge.is-active { background: var(--inv-success-soft); color: var(--inv-success); }
        .inv-statusBadge.is-inactive { background: var(--inv-danger-soft); color: var(--inv-danger); }
        .inv-statusDot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
        .inv-occupancyBadge { font-size: 11px; font-weight: 700; color: var(--inv-text); }
        .inv-occupancyBadge.is-full { color: var(--inv-warning); }

        /* Structure tables */
        .inv-tableWrap { overflow-x: auto; margin-bottom: 6px; }
        .inv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .inv-table th {
          text-align: start; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.02em; color: var(--inv-muted);
          border-bottom: 1px solid var(--inv-border); padding: 6px 8px; font-weight: 650; white-space: nowrap;
        }
        .inv-table td { padding: 7px 8px; border-bottom: 1px solid var(--inv-border); vertical-align: middle; }
        .inv-table tbody tr { cursor: pointer; }
        .inv-table tbody tr:hover { background: var(--inv-panel-subtle); }
        .inv-table tbody tr.is-selected { background: var(--inv-primary-soft); }
        .inv-table tbody tr.is-inactive { opacity: 0.55; }
        .inv-table td:last-child { display: flex; gap: 4px; }
        .inv-warnIcon { color: var(--inv-warning); margin-inline-start: 5px; display: inline-flex; vertical-align: middle; }
        .inv-availabilityTag { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 7px; }
        .inv-availabilityTag.is-available { background: var(--inv-success-soft); color: var(--inv-success); }
        .inv-availabilityTag.is-occupied { background: var(--inv-warning-soft); color: var(--inv-warning); }
        .inv-bedCapabilityNote { font-size: 10.5px; color: var(--inv-muted); margin: 6px 2px 0; }

        .inv-inspectorWarning { display: flex; align-items: center; gap: 5px; color: var(--inv-warning); font-size: 11px; margin: 0; }
        .inv-detailRow { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
        .inv-detailRow span { color: var(--inv-muted); }

        /* Progressive disclosure: building summary bar, on-demand detail
           strips, and the apartment/room accordion that replaced the old
           always-visible three-table + inspector layout. */
        .inv-summaryBar {
          display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
          padding: 8px 10px; border: 1px solid var(--inv-border); border-radius: 10px; background: var(--inv-panel-subtle); margin-bottom: 10px;
        }
        .inv-summaryBarMain { display: flex; align-items: center; gap: 9px; color: var(--inv-primary); }
        .inv-summaryBarMain > svg { flex-shrink: 0; }
        .inv-summaryBarTitle { font-size: 13.5px; font-weight: 750; color: var(--inv-text); }
        .inv-summaryBarMeta { font-size: 11px; color: var(--inv-muted); }
        .inv-summaryBarActions { display: flex; align-items: center; gap: 6px; }
        .inv-linkBtn {
          display: inline-flex; align-items: center; gap: 4px; background: none; border: none; cursor: pointer;
          color: var(--inv-primary); font-size: 11.5px; font-weight: 650; padding: 4px 2px;
        }
        .inv-chevron { transition: transform 0.15s ease; transform: rotate(-90deg); }
        [dir='rtl'] .inv-chevron { transform: rotate(90deg); }
        .inv-chevron.is-open { transform: rotate(0deg); }

        .inv-detailsStrip {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 2px 16px;
          background: var(--inv-panel-subtle); border: 1px solid var(--inv-border); border-radius: 9px;
          padding: 8px 12px; margin: 0 0 10px;
        }
        .inv-detailsStripActions { display: flex; align-items: center; grid-column: 1 / -1; margin-top: 4px; }

        .inv-accordionList { display: flex; flex-direction: column; gap: 6px; }
        .inv-accordionList-nested { margin: 8px 0 10px; padding-inline-start: 18px; border-inline-start: 2px solid var(--inv-border); }
        .inv-accordionItem { border: 1px solid var(--inv-border); border-radius: 10px; overflow: hidden; background: var(--inv-panel); }
        .inv-accordionItem.is-open { border-color: var(--inv-border-strong); }
        .inv-accordionItem.is-inactive { opacity: 0.6; }
        .inv-accordionHeader {
          width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: none; border: none;
          cursor: pointer; text-align: start; font: inherit; color: var(--inv-text); flex-wrap: wrap; row-gap: 4px;
        }
        .inv-accordionItem.is-open > .inv-accordionHeader { background: var(--inv-primary-soft); }
        .inv-accordionHeader:hover { background: var(--inv-panel-subtle); }
        .inv-accordionItem.is-open > .inv-accordionHeader:hover { background: var(--inv-primary-soft); }
        .inv-accordionTitle { font-weight: 700; font-size: 12.5px; white-space: nowrap; }
        .inv-accordionTag {
          font-size: 10px; font-weight: 650; color: var(--inv-muted); background: var(--inv-panel-subtle);
          border: 1px solid var(--inv-border); border-radius: 6px; padding: 1px 6px; white-space: nowrap;
        }
        .inv-accordionMeta { font-size: 11px; color: var(--inv-muted); white-space: nowrap; }
        .inv-accordionRowAction { margin-inline-start: auto; }
        .inv-accordionBody { padding: 0 10px 10px; border-top: 1px solid var(--inv-border); }
        .inv-accordionBody .inv-sectionHeader { padding-top: 8px; }
        .inv-accordionBody .inv-sectionHeader h3 { font-size: 11.5px; }

        /* Drawer / dialog */
        .inv-overlay {
          position: fixed; inset: 0; background: rgba(17, 24, 39, 0.4); display: flex; align-items: stretch; z-index: 60;
        }
        .inv-drawerFooter { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--inv-border); }

        .inv-dialog {
          background: var(--inv-panel); border-radius: 14px; padding: 18px; width: 100%; max-width: 420px; margin: auto;
          display: flex; flex-direction: column; gap: 12px; max-height: 88vh; overflow-y: auto;
        }
        .inv-dialog h3 { margin: 0; font-size: 14.5px; }

        .inv-formField { display: flex; flex-direction: column; gap: 4px; }
        .inv-formField label { font-size: 11px; font-weight: 650; color: var(--inv-muted); }
        .inv-formField input, .inv-formField select, .inv-formField textarea {
          border: 1px solid var(--inv-border); border-radius: 8px; padding: 7px 9px; font-size: 12.5px; background: var(--inv-panel); color: var(--inv-text);
          font-family: inherit; resize: vertical;
        }
        .inv-formField small { font-size: 10.5px; color: var(--inv-muted); }

        /* Edit / create modal — large centered dialog, replaces the old
           edge-attached side drawer. Rendered via React portal straight
           into body (see BuildingsPage render) so fixed positioning is
           anchored to the real browser viewport, not to any app-shell
           ancestor. z-index is set above the app sidebar (z-index: 100 in
           Sidebar.js) so the sidebar can never paint on top of it. Header
           and footer stay fixed while only the body scrolls, so long
           apartment forms never require the whole modal to grow.

           IMPORTANT: because this subtree is portaled directly under
           <body>, it is NOT a DOM descendant of .inv-page — so the
           --inv-* custom properties declared on .inv-page do not cascade
           into it (CSS variables inherit through the DOM tree, which a
           portal escapes). Every var(--inv-*) used below would otherwise
           resolve to nothing, leaving the modal surface, borders, and
           buttons fully transparent. Re-declaring the same token set here,
           at the root of the portaled subtree, is what actually fixes it —
           this was the real cause of the "see-through modal" bug, not
           opacity or z-index. */
        .inv-modalOverlay {
          --inv-bg: #f4f5f7;
          --inv-panel: #ffffff;
          --inv-panel-subtle: #f9fafb;
          --inv-border: #e5e7eb;
          --inv-border-strong: #d1d5db;
          --inv-text: #111827;
          --inv-muted: #6b7280;
          --inv-primary: #2563eb;
          --inv-primary-hover: #1d4ed8;
          --inv-primary-soft: #dbeafe;
          --inv-success: #059669;
          --inv-success-soft: #d1fae5;
          --inv-warning: #b45309;
          --inv-warning-soft: #fef3c7;
          --inv-danger: #dc2626;
          --inv-danger-soft: #fee2e2;

          position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); opacity: 1; display: grid; place-items: center;
          z-index: 9999; padding: 24px;
        }
        .inv-modal {
          background: #ffffff; opacity: 1; isolation: isolate;
          width: min(880px, calc(100vw - 48px)); max-height: calc(100vh - 48px); border-radius: 16px;
          border: 1px solid var(--inv-border);
          box-shadow: 0 20px 60px rgba(16, 24, 40, 0.35), 0 2px 8px rgba(16, 24, 40, 0.12);
          display: flex; flex-direction: column; overflow: hidden; margin: 0; position: relative;
        }
        .inv-modalHeader {
          display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--inv-border); flex-shrink: 0;
        }
        .inv-modalHeaderIcon {
          width: 36px; height: 36px; border-radius: 10px; background: var(--inv-primary-soft); color: var(--inv-primary);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .inv-modalHeaderText { flex: 1; min-width: 0; }
        .inv-modalHeaderText h3 { margin: 0; font-size: 15.5px; font-weight: 750; }
        .inv-modalHeaderContext { margin: 3px 0 0; font-size: 12px; color: var(--inv-muted); }
        .inv-modalBody { padding: 18px 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
        .inv-modalFooter {
          display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--inv-border); flex-shrink: 0;
        }

        .inv-modalSection {
          border: 1px solid var(--inv-border); border-radius: 12px; padding: 14px 16px; background: var(--inv-panel-subtle);
          display: flex; flex-direction: column; gap: 10px;
        }
        .inv-modalSection h4 { margin: 0; font-size: 11px; font-weight: 700; color: var(--inv-muted); text-transform: uppercase; letter-spacing: 0.03em; }
        .inv-modalGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
        .inv-modalGrid.is-single { grid-template-columns: 1fr; }

        .inv-readonlyField { display: flex; flex-direction: column; gap: 4px; }
        .inv-readonlyField label { font-size: 11px; font-weight: 650; color: var(--inv-muted); }
        .inv-readonlyValue {
          font-size: 12.5px; padding: 7px 9px; border-radius: 8px; background: var(--inv-panel); border: 1px dashed var(--inv-border-strong);
          color: var(--inv-text); min-height: 16px;
        }

        .inv-summaryRow {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px;
          padding-top: 10px; border-top: 1px dashed var(--inv-border);
        }
        .inv-summaryItem { text-align: center; }
        .inv-summaryItem span { display: block; font-size: 10px; color: var(--inv-muted); margin-bottom: 2px; }
        .inv-summaryItem strong { font-size: 14px; font-weight: 750; }

        .inv-statusRow { display: flex; align-items: center; gap: 10px; }

        .inv-infoCallout {
          display: flex; align-items: flex-start; gap: 8px; background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8;
          border-radius: 10px; padding: 10px 12px; font-size: 11.5px; line-height: 1.5;
        }
        .inv-infoCallout svg { flex-shrink: 0; margin-top: 1px; }

        .inv-impactBox { background: var(--inv-panel-subtle); border-radius: 10px; padding: 10px; }
        .inv-impactTitle { display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--inv-warning); font-size: 12px; margin-bottom: 8px; }
        .inv-impactGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; margin-bottom: 8px; }
        .inv-impactGrid div { display: flex; justify-content: space-between; font-size: 11.5px; border-bottom: 1px dashed var(--inv-border); padding-bottom: 3px; }
        .inv-impactGrid span { color: var(--inv-muted); }
        .inv-impactNote { font-size: 11px; color: var(--inv-muted); margin: 0; }

        /* Responsive */
        @media (max-width: 960px) {
          .inv-workspace { grid-template-columns: 1fr; }
          .inv-buildingList { max-height: 260px; }
        }
        @media (max-width: 640px) {
          .inv-pageHeader { flex-direction: column; align-items: stretch; }
          .inv-filterBar { flex-direction: column; align-items: stretch; }
          .inv-filterField { min-width: 0; }
          .inv-summaryStrip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .inv-dialog { max-width: calc(100vw - 24px); }
          .inv-modalOverlay { padding: 12px; }
          .inv-modal { width: calc(100vw - 24px); max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); }
          .inv-modalGrid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
