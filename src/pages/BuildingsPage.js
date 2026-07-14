import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Bed,
  Building2,
  ChevronDown,
  ChevronUp,
  Home,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Users,
  X,
} from 'lucide-react';

import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * BuildingsPage.jsx
 *
 * Real connected version:
 * - No mockData.
 * - Region -> Dorm Type selector.
 * - Fetches buildings, apartments, rooms, students from Django API.
 * - Shows assigned students by matching Student.assigned_room / assigned_room_id to Room.id.
 * - Uses backend manual assignment endpoints:
 *   POST /api/room-assignments/assign/
 *   POST /api/room-assignments/move/
 *   POST /api/room-assignments/unassign/
 *   POST /api/room-assignments/swap/
 */

const ENDPOINTS = {
  regions: '/api/regions/',
  dormTypes: '/api/dorm-types/',
  buildings: '/api/buildings/',
  students: '/api/students/',
  apartmentsForBuilding: (buildingId) => `/api/buildings/${buildingId}/apartments/`,
  roomsForBuilding: (buildingId) => `/api/buildings/${buildingId}/rooms/`,
  assign: '/api/room-assignments/assign/',
  move: '/api/room-assignments/move/',
  unassign: '/api/room-assignments/unassign/',
  swap: '/api/room-assignments/swap/',
};

function asArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (key && Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function idOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(value.id ?? value.pk ?? '');
  return String(value);
}

function getStudentAssignedRoomId(student) {
  return idOf(student.assigned_room_id ?? student.assigned_room);
}

function getStudentLabel(student) {
  return (
    student.full_name ||
    [student.first_name, student.last_name].filter(Boolean).join(' ') ||
    student.student_id ||
    `#${student.id}`
  );
}

function getBuildingLabel(building, t) {
  return building.name || `${t.building} ${building.number ?? building.id}`;
}

function getDormTypeIdFromBuilding(building) {
  return idOf(building.dorm_type_id ?? building.dorm_type);
}

function getRegionIdFromBuilding(building) {
  return idOf(building.region_id ?? building.region);
}

function getRegionIdFromDormType(dormType) {
  return idOf(dormType.region_id ?? dormType.region);
}

function getApartmentIdFromRoom(room) {
  return idOf(room.apartment_id ?? room.apartment);
}

function getBuildingIdFromRoom(room) {
  return idOf(room.building_id ?? room.building);
}

function getRoomCapacity(room) {
  return Number(room.capacity ?? 0) || 0;
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().trim();
}



function buildDormTypesFromBuildings(buildings) {
  const map = new Map();

  buildings.forEach((building) => {
    const id = getDormTypeIdFromBuilding(building);
    if (!id || map.has(id)) return;

    map.set(id, {
      id,
      code: building.dorm_type_code ?? '',
      name: building.dorm_type_name || `Dorm type ${id}`,
      region: getRegionIdFromBuilding(building),
      region_name: building.region_name || '',
      _fallback: true,
    });
  });

  return Array.from(map.values());
}

export default function BuildingsPage({ language = 'he' }) {
  const auth = useAuth();

  const currentUser = auth?.user || auth?.currentUser || {};
  const isCentralAdmin =
    typeof auth?.isCentralAdmin === 'function'
      ? auth.isCentralAdmin
      : () => Boolean(currentUser.is_central_admin || currentUser.role === 'central_admin');

  const isRegionBoss =
    typeof auth?.isRegionBoss === 'function'
      ? auth.isRegionBoss
      : () => Boolean(currentUser.is_boss || currentUser.role === 'boss' || currentUser.role === 'region_boss');

  const isEmployee =
    typeof auth?.isEmployee === 'function'
      ? auth.isEmployee
      : () => Boolean(currentUser.role === 'employee');

  const getUserRegion =
    typeof auth?.getUserRegion === 'function'
      ? auth.getUserRegion
      : () => currentUser.region || currentUser.region_id || null;

  const canEditRegion =
    typeof auth?.canEditRegion === 'function'
      ? auth.canEditRegion
      : (regionId) => isCentralAdmin() || idOf(regionId) === idOf(getUserRegion());

  const userRegionId = idOf(getUserRegion());
  const canViewAllRegions = isCentralAdmin() || isRegionBoss();
  const isHe = language === 'he';

  const t = isHe
    ? {
        title: 'בניינים וחדרים',
        subtitle: 'ניהול חדרים ושיוך סטודנטים לפי הרשאות',
        chooseRegion: 'בחר אזור',
        chooseDormType: 'בחר סוג מעונות',
        allDormTypes: 'כל סוגי המעונות באזור',
        search: 'חיפוש בניין / דירה / חדר...',
        building: 'בניין',
        buildings: 'בניינים',
        apartment: 'דירה',
        apartments: 'דירות',
        room: 'חדר',
        rooms: 'חדרים',
        students: 'סטודנטים',
        capacity: 'קיבולת',
        assigned: 'משויכים',
        unassigned: 'לא משויכים',
        occupied: 'תפוס',
        free: 'פנוי',
        active: 'פעיל',
        inactive: 'לא פעיל',
        loading: 'טוען...',
        loadingRooms: 'טוען חדרים...',
        noData: 'אין נתונים להצגה',
        noRooms: 'אין חדרים בדירה הזו',
        noStudents: 'אין סטודנטים בחדר',
        noAvailableStudents: 'אין סטודנטים פנויים לשיוך',
        selectApartment: 'בחרי דירה לצפייה',
        selectApartmentHelp: 'בחרי בניין ואז דירה כדי לראות חדרים ושיוכים.',
        addStudent: 'הוסף סטודנט/ית',
        pickStudent: 'בחר סטודנט/ית לשיוך',
        moveStudent: 'העברה / עדכון חדר',
        moveTo: 'העבר אל',
        remove: 'הסר',
        swap: 'החלפה',
        swapHint: 'בחרי סטודנט/ית נוסף/ת כדי לבצע החלפה',
        cancel: 'ביטול',
        confirm: 'אישור',
        close: 'סגור',
        roomFull: 'החדר מלא',
        viewOnly: 'צפייה בלבד — אין הרשאה לערוך באזור זה',
        centralOrBoss: 'צפייה לפי אזור וסוג מעונות',
        employeeScope: 'מוצג רק האזור המשויך למשתמש',
        error: 'שגיאה בטעינת הנתונים',
        actionError: 'הפעולה נכשלה',
        searchStudent: 'חיפוש סטודנט/ית...',
        searchRoom: 'חיפוש חדר / דירה / בניין...',
        clear: 'נקה',
      }
    : {
        title: 'Buildings & Rooms',
        subtitle: 'Manage room assignments according to permissions',
        chooseRegion: 'Choose region',
        chooseDormType: 'Choose dorm type',
        allDormTypes: 'All dorm types in this region',
        search: 'Search building / apartment / room...',
        building: 'Building',
        buildings: 'Buildings',
        apartment: 'Apartment',
        apartments: 'Apartments',
        room: 'Room',
        rooms: 'Rooms',
        students: 'Students',
        capacity: 'Capacity',
        assigned: 'Assigned',
        unassigned: 'Unassigned',
        occupied: 'Occupied',
        free: 'Free',
        active: 'Active',
        inactive: 'Inactive',
        loading: 'Loading...',
        loadingRooms: 'Loading rooms...',
        noData: 'No data to display',
        noRooms: 'No rooms in this apartment',
        noStudents: 'No students in this room',
        noAvailableStudents: 'No available students',
        selectApartment: 'Select an apartment',
        selectApartmentHelp: 'Pick a building and then an apartment to see rooms and assignments.',
        addStudent: 'Add student',
        pickStudent: 'Pick a student',
        moveStudent: 'Move / update room',
        moveTo: 'Move to',
        remove: 'Remove',
        swap: 'Swap',
        swapHint: 'Pick another student to swap',
        cancel: 'Cancel',
        confirm: 'Confirm',
        close: 'Close',
        roomFull: 'Room is full',
        viewOnly: 'View-only — no edit permission for this region',
        centralOrBoss: 'Viewing by region and dorm type',
        employeeScope: 'Showing only your assigned region',
        error: 'Error loading data',
        actionError: 'Action failed',
        searchStudent: 'Search student...',
        searchRoom: 'Search room / apartment / building...',
        clear: 'Clear',
      };

  const [regions, setRegions] = useState([]);
  const [dormTypes, setDormTypes] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [students, setStudents] = useState([]);

  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedDormTypeId, setSelectedDormTypeId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [expandedBuildingId, setExpandedBuildingId] = useState(null);
  const [selectedApartmentId, setSelectedApartmentId] = useState(null);
  const [apartments, setApartments] = useState([]);
  const [buildingRooms, setBuildingRooms] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingBuilding, setLoadingBuilding] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const [draggingStudentId, setDraggingStudentId] = useState(null);

  const [addModal, setAddModal] = useState({
    open: false,
    roomId: null,
    query: '',
  });

  const [moveModal, setMoveModal] = useState({
    open: false,
    studentId: null,
    query: '',
    toRoomId: '',
  });

  const [swapMode, setSwapMode] = useState({
    active: false,
    studentId: null,
  });

  const selectedRegion = useMemo(
    () => regions.find((region) => idOf(region.id) === idOf(selectedRegionId)) || null,
    [regions, selectedRegionId]
  );

  const dormTypesInRegion = useMemo(() => {
    if (!selectedRegionId) return dormTypes;
    return dormTypes.filter((dormType) => getRegionIdFromDormType(dormType) === idOf(selectedRegionId));
  }, [dormTypes, selectedRegionId]);

  const scopeBuildings = useMemo(() => {
    let list = buildings;

    if (selectedRegionId) {
      list = list.filter((building) => getRegionIdFromBuilding(building) === idOf(selectedRegionId));
    }

    if (selectedDormTypeId && selectedDormTypeId !== 'all') {
      list = list.filter((building) => getDormTypeIdFromBuilding(building) === idOf(selectedDormTypeId));
    }

    return list;
  }, [buildings, selectedRegionId, selectedDormTypeId]);

  const filteredBuildings = useMemo(() => {
    const q = normalizeText(searchQuery);
    if (!q) return scopeBuildings;

    return scopeBuildings.filter((building) => {
      const haystack = [
        building.id,
        building.number,
        building.name,
        building.dorm_type_name,
        building.region_name,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [scopeBuildings, searchQuery]);

  const selectedBuilding = useMemo(
    () => buildings.find((building) => idOf(building.id) === idOf(expandedBuildingId)) || null,
    [buildings, expandedBuildingId]
  );

  const selectedApartment = useMemo(
    () => apartments.find((apt) => idOf(apt.id) === idOf(selectedApartmentId)) || null,
    [apartments, selectedApartmentId]
  );

  const selectedApartmentRooms = useMemo(() => {
    if (!selectedApartmentId) return [];

    return buildingRooms
      .filter((room) => getApartmentIdFromRoom(room) === idOf(selectedApartmentId))
      .sort((a, b) => String(a.name ?? a.number ?? a.id).localeCompare(String(b.name ?? b.number ?? b.id)));
  }, [buildingRooms, selectedApartmentId]);

  const assignedCount = useMemo(
    () => students.filter((student) => Boolean(getStudentAssignedRoomId(student))).length,
    [students]
  );

  const unassignedStudents = useMemo(
    () => students.filter((student) => !getStudentAssignedRoomId(student)),
    [students]
  );

  const canEditSelectedRegion = useMemo(() => {
    if (!selectedRegionId) return false;
    return Boolean(canEditRegion(selectedRegionId));
  }, [canEditRegion, selectedRegionId]);

  const viewOnly = !canEditSelectedRegion;

  const getRoomStudents = useCallback(
    (roomId) => {
      const rid = idOf(roomId);
      return students
        .filter((student) => getStudentAssignedRoomId(student) === rid)
        .sort((a, b) => getStudentLabel(a).localeCompare(getStudentLabel(b)));
    },
    [students]
  );

  const refreshStudents = useCallback(async () => {
    const res = await api.get(ENDPOINTS.students);
    setStudents(asArray(res.data));
  }, []);

  const resetBuildingSelection = useCallback(() => {
    setExpandedBuildingId(null);
    setSelectedApartmentId(null);
    setApartments([]);
    setBuildingRooms([]);
    setAddModal({ open: false, roomId: null, query: '' });
    setMoveModal({ open: false, studentId: null, query: '', toRoomId: '' });
    setSwapMode({ active: false, studentId: null });
    setDraggingStudentId(null);
    setActionError('');
  }, []);

  const fetchBuildingData = useCallback(async (buildingId) => {
    setLoadingBuilding(true);
    setActionError('');
    setSelectedApartmentId(null);
    setApartments([]);
    setBuildingRooms([]);

    try {
      const [apartmentsRes, roomsRes] = await Promise.all([
        api.get(ENDPOINTS.apartmentsForBuilding(buildingId)),
        api.get(ENDPOINTS.roomsForBuilding(buildingId)),
      ]);

      setApartments(asArray(apartmentsRes.data, 'apartments'));
      setBuildingRooms(asArray(roomsRes.data, 'rooms'));
    } catch (err) {
      console.error('ERROR LOADING BUILDING DATA:', err);
      setActionError(err?.response?.data?.error || t.error);
      setApartments([]);
      setBuildingRooms([]);
    } finally {
      setLoadingBuilding(false);
    }
  }, [t.error]);

  const refreshOpenBuilding = useCallback(async () => {
    await refreshStudents();
    if (expandedBuildingId) {
      await fetchBuildingData(expandedBuildingId);
    }
  }, [expandedBuildingId, fetchBuildingData, refreshStudents]);

  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      setError('');

      try {
        const [regionsRes, buildingsRes, studentsRes, dormTypesRes] = await Promise.all([
          api.get(ENDPOINTS.regions),
          api.get(ENDPOINTS.buildings),
          api.get(ENDPOINTS.students),
          api.get(ENDPOINTS.dormTypes).catch((err) => {
            console.warn('Dorm types endpoint failed. Falling back to buildings-derived dorm types.', err);
            return null;
          }),
        ]);

        const nextRegions = asArray(regionsRes.data);
        const nextBuildings = asArray(buildingsRes.data);
        const nextStudents = asArray(studentsRes.data);
        const nextDormTypes = dormTypesRes ? asArray(dormTypesRes.data) : buildDormTypesFromBuildings(nextBuildings);

        setRegions(nextRegions);
        setBuildings(nextBuildings);
        setStudents(nextStudents);
        setDormTypes(nextDormTypes);

        const initialRegionId = canViewAllRegions
          ? idOf(userRegionId || nextRegions[0]?.id)
          : idOf(userRegionId || nextRegions[0]?.id);

        setSelectedRegionId(initialRegionId);
        setSelectedDormTypeId('all');
      } catch (err) {
        console.error('ERROR LOADING BUILDINGS PAGE:', err);
        setError(err?.response?.data?.detail || err?.response?.data?.error || t.error);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [language]);

  useEffect(() => {
    if (!selectedRegionId) return;

    const hasSelectedDormInRegion =
      selectedDormTypeId === 'all' ||
      dormTypesInRegion.some((dormType) => idOf(dormType.id) === idOf(selectedDormTypeId));

    if (!hasSelectedDormInRegion) {
      setSelectedDormTypeId('all');
    }
  }, [selectedRegionId, selectedDormTypeId, dormTypesInRegion]);

  useEffect(() => {
    resetBuildingSelection();
  }, [selectedRegionId, selectedDormTypeId, resetBuildingSelection]);


  const handleRegionChange = (nextRegionId) => {
    setSelectedRegionId(nextRegionId);
    setSelectedDormTypeId('all');
    setSearchQuery('');
  };

  const toggleBuilding = async (buildingId) => {
    if (idOf(expandedBuildingId) === idOf(buildingId)) {
      resetBuildingSelection();
      return;
    }

    setExpandedBuildingId(buildingId);
    await fetchBuildingData(buildingId);
  };

  const filteredUnassignedStudents = useMemo(() => {
    const q = normalizeText(addModal.query);
    if (!q) return unassignedStudents;

    return unassignedStudents.filter((student) => {
      const haystack = [
        getStudentLabel(student),
        student.student_id,
        student.business_partner_id,
        student.email,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [addModal.query, unassignedStudents]);
const filteredMoveRooms = useMemo(() => {
  const q = normalizeText(moveModal.query);
  const rooms = buildingRooms;

  if (!q) return rooms;

  return rooms.filter((room) => {
    const building = buildings.find((b) => idOf(b.id) === getBuildingIdFromRoom(room));
    const aptNumber = room.apartment_number || room.apartmentNumber || '';
    const haystack = [
      room.id,
      room.name,
      room.number,
      aptNumber,
      building?.number,
      building?.name,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });
}, [moveModal.query, buildingRooms, buildings]);


  const callAction = async (callback) => {
    if (viewOnly) return;

    setActionError('');

    try {
      await callback();
      await refreshOpenBuilding();
      setAddModal({ open: false, roomId: null, query: '' });
      setMoveModal({ open: false, studentId: null, query: '', toRoomId: '' });
      setSwapMode({ active: false, studentId: null });
      setDraggingStudentId(null);
    } catch (err) {
      console.error('BUILDINGS PAGE ACTION ERROR:', err);
      setActionError(err?.response?.data?.error || err?.response?.data?.detail || t.actionError);
    }
  };

  const assignStudentToRoom = (studentId, roomId) =>
    callAction(async () => {
      await api.post(ENDPOINTS.assign, {
        student_id: studentId,
        room_id: roomId,
      });
    });

  const moveStudentToRoom = (studentId, roomId) =>
    callAction(async () => {
      await api.post(ENDPOINTS.move, {
        student_id: studentId,
        room_id: roomId,
      });
    });

  const unassignStudent = (studentId) =>
    callAction(async () => {
      await api.post(ENDPOINTS.unassign, {
        student_id: studentId,
      });
    });

  const swapStudents = (studentAId, studentBId) =>
    callAction(async () => {
      await api.post(ENDPOINTS.swap, {
        student_a_id: studentAId,
        student_b_id: studentBId,
      });
    });

  const StatCard = ({ icon: Icon, label, value }) => (
    <div className="bp-stat">
      <div className="bp-statIcon">
        <Icon size={20} />
      </div>
      <div>
        <div className="bp-statValue">{value}</div>
        <div className="bp-statLabel">{label}</div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bp-page bp-center" dir={isHe ? 'rtl' : 'ltr'}>
        <Loader2 className="bp-spin" size={28} />
        <span>{t.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bp-page bp-center" dir={isHe ? 'rtl' : 'ltr'}>
        <div className="bp-errorBox">{error}</div>
      </div>
    );
  }

  return (
    <div className="bp-page" dir={isHe ? 'rtl' : 'ltr'}>
      <div className="bp-header">
        <div>
          <h1>{t.title}</h1>
          <p>
            {t.subtitle}
            {' · '}
            {canViewAllRegions ? t.centralOrBoss : t.employeeScope}
          </p>
        </div>

        <div className={`bp-permission ${viewOnly ? 'readonly' : ''}`}>
          <Shield size={16} />
          {viewOnly ? t.viewOnly : canViewAllRegions ? t.centralOrBoss : t.employeeScope}
        </div>
      </div>

      <div className="bp-toolbar">
        <div className="bp-field">
          <label>{t.chooseRegion}</label>
          <select
            value={selectedRegionId}
            disabled={!canViewAllRegions}
            onChange={(e) => handleRegionChange(e.target.value)}
          >
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>

        <div className="bp-field">
          <label>{t.chooseDormType}</label>
          <select
            value={selectedDormTypeId}
            disabled={!canViewAllRegions && isEmployee()}
            onChange={(e) => setSelectedDormTypeId(e.target.value)}
          >
            <option value="all">{t.allDormTypes}</option>
            {dormTypesInRegion.map((dormType) => (
              <option key={dormType.id} value={dormType.id}>
                {dormType.name}
                {dormType.code ? ` (${dormType.code})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="bp-search">
          <Search size={18} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.search}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} title={t.clear}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="bp-errorBox small">
          {actionError}
          <button type="button" onClick={() => setActionError('')}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="bp-statsGrid">
        <StatCard icon={Building2} label={t.buildings} value={filteredBuildings.length} />
        <StatCard icon={Home} label={t.apartments} value={apartments.length || '—'} />
        <StatCard icon={Bed} label={t.rooms} value={buildingRooms.length || '—'} />
        <StatCard icon={Users} label={t.assigned} value={assignedCount} />
        <StatCard icon={Users} label={t.unassigned} value={unassignedStudents.length} />
      </div>

      <div className="bp-layout">
        <section className="bp-panel bp-listPanel">
          <div className="bp-panelHead">
            <div>
              <Building2 size={18} />
              <strong>{t.buildings}</strong>
            </div>
            <span>{filteredBuildings.length}</span>
          </div>

          <div className="bp-list">
            {filteredBuildings.length === 0 ? (
              <div className="bp-emptyMini">{t.noData}</div>
            ) : (
              filteredBuildings.map((building) => {
                const expanded = idOf(expandedBuildingId) === idOf(building.id);
                const buildingApartments = expanded ? apartments : [];

                return (
                  <div className="bp-buildingCard" key={building.id}>
                    <button
                      type="button"
                      className={`bp-buildingButton ${expanded ? 'selected' : ''}`}
                      onClick={() => toggleBuilding(building.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        border: '1px solid',
                        borderColor: expanded ? '#93c5fd' : '#e2e8f0',
                        borderRadius: '12px',
                        background: expanded ? '#eff6ff' : 'white',
                        cursor: 'pointer',
                        textAlign: isHe ? 'right' : 'left',
                      }}
                    >
                      <div className="bp-iconBubble">
                        <Building2 size={18} />
                      </div>

                      <div className="bp-buildingInfo">
                        <strong>{getBuildingLabel(building, t)}</strong>
                        <span>
                          {building.dorm_type_name || '—'}
                          {' · '}
                          {building.region_name || selectedRegion?.name || '—'}
                        </span>
                      </div>

                      <span className={`bp-status ${building.is_active ? 'ok' : 'bad'}`}>
                        {building.is_active ? t.active : t.inactive}
                      </span>

                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {expanded && (
                      <div className="bp-apartmentList">
                        {loadingBuilding ? (
                          <div className="bp-loadingLine">
                            <Loader2 className="bp-spin" size={15} />
                            {t.loading}
                          </div>
                        ) : buildingApartments.length === 0 ? (
                          <div className="bp-emptyMini">{t.noData}</div>
                        ) : (
                          buildingApartments.map((apt) => {
                            const selected = idOf(selectedApartmentId) === idOf(apt.id);
                            const aptRoomsCount = buildingRooms.filter((room) => getApartmentIdFromRoom(room) === idOf(apt.id)).length;

                            return (
                              <button
                                key={apt.id}
                                type="button"
                                className={`bp-apartmentButton ${selected ? 'selected' : ''}`}
                                onClick={() => setSelectedApartmentId(selected ? null : apt.id)}
                              >
                                <Home size={15} />
                                <div>
                                  <strong>
                                    {t.apartment} {apt.number}
                                  </strong>
                                  <span>
                                    {apt.category_display || apt.category || '—'} ·{' '}
                                    {apt.apartment_type_display || apt.apartment_type || '—'} ·{' '}
                                    {apt.apartment_capacity ?? apt.capacity ?? '—'} {t.capacity} ·{' '}
                                    {aptRoomsCount || apt.room_count || 0} {t.rooms}
                                  </span>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="bp-panel bp-workPanel">
          {!selectedApartmentId ? (
            <div className="bp-emptyState">
              <div className="bp-bigIcon">
                <Home size={38} />
              </div>
              <strong>{t.selectApartment}</strong>
              <span>{t.selectApartmentHelp}</span>
            </div>
          ) : (
            <>
              <div className="bp-workHead">
                <div>
                  <span className="bp-breadcrumb">
                    {selectedBuilding ? getBuildingLabel(selectedBuilding, t) : t.building}
                    {' / '}
                    {t.apartment} {selectedApartment?.number ?? selectedApartmentId}
                  </span>
                  <h2>
                    {t.apartment} {selectedApartment?.number ?? selectedApartmentId}
                  </h2>
                </div>
              </div>

              <div style={{ padding: '20px' }}>
                <h3
                  style={{
                    fontSize: '14px',
                    fontWeight: '700',
                    color: '#1e293b',
                    marginBottom: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <Bed size={16} color="#3b82f6" /> {t.rooms}
                </h3>

                {swapMode.active && !viewOnly && (
                  <div className="bp-swapBanner">
                    <ArrowRightLeft size={16} />
                    <span>{t.swapHint}</span>
                    <button type="button" onClick={() => setSwapMode({ active: false, studentId: null })}>
                      {t.cancel}
                    </button>
                  </div>
                )}
              </div>

              <div className="bp-roomGrid">
                {loadingBuilding ? (
                  <div className="bp-loadingBlock">
                    <Loader2 className="bp-spin" size={24} />
                    {t.loadingRooms}
                  </div>
                ) : selectedApartmentRooms.length === 0 ? (
                  <div className="bp-emptyState small">{t.noRooms}</div>
                ) : (
                  selectedApartmentRooms.map((room) => {
                    const roomStudents = getRoomStudents(room.id);
                    const capacity = getRoomCapacity(room);
                    const occupied = roomStudents.length || Number(room.current_occupancy ?? 0) || 0;
                    const full = capacity > 0 && occupied >= capacity;
                    const percent = capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;

                    return (
                      <article
                        key={room.id}
                        className={`bp-roomCard ${full ? 'full' : ''} ${viewOnly ? 'readonly' : ''}`}
                        onDragOver={(e) => {
                          if (!viewOnly && !full) e.preventDefault();
                        }}
                        onDrop={() => {
                          if (viewOnly || full || !draggingStudentId) return;
                          assignStudentToRoom(draggingStudentId, room.id);
                        }}
                      >
                        <div className="bp-roomTop">
                          <div>
                            <h3>
                              {t.room} {room.name || room.number || room.id}
                            </h3>
                            <span>
                              {t.capacity}: {occupied}/{capacity || '—'}
                              {full ? ` · ${t.roomFull}` : ''}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="bp-primarySmall"
                            disabled={viewOnly || full}
                            onClick={() => setAddModal({ open: true, roomId: room.id, query: '' })}
                          >
                            <Plus size={15} />
                            {t.addStudent}
                          </button>
                        </div>

                        <div className="bp-meter">
                          <div style={{ width: `${percent}%` }} />
                        </div>

                        <div className="bp-studentList">
                          {roomStudents.length === 0 ? (
                            <div className="bp-emptyRoom">
                              <Bed size={18} />
                              <span>{t.noStudents}</span>
                            </div>
                          ) : (
                            roomStudents.map((student) => {
                              const selectedForSwap = idOf(swapMode.studentId) === idOf(student.id);

                              return (
                                <div
                                  key={student.id}
                                  className={`bp-studentRow ${selectedForSwap ? 'swapSelected' : ''}`}
                                  draggable={!viewOnly}
                                  onDragStart={() => {
                                    if (!viewOnly) setDraggingStudentId(student.id);
                                  }}
                                  onDragEnd={() => setDraggingStudentId(null)}
                                  onClick={() => {
                                    if (viewOnly || !swapMode.active) return;
                                    if (!swapMode.studentId) {
                                      setSwapMode({ active: true, studentId: student.id });
                                      return;
                                    }
                                    if (idOf(swapMode.studentId) !== idOf(student.id)) {
                                      swapStudents(swapMode.studentId, student.id);
                                    }
                                  }}
                                >
                                  <div className="bp-studentMain">
                                    <div className="bp-avatar">
                                      <Users size={14} />
                                    </div>
                                    <div>
                                      <strong>{getStudentLabel(student)}</strong>
                                      <span>{student.student_id || student.business_partner_id || ''}</span>
                                    </div>
                                  </div>

                                  <div className="bp-actions">
                                    <button
                                      type="button"
                                      disabled={viewOnly}
                                      title={t.moveStudent}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMoveModal({
                                          open: true,
                                          studentId: student.id,
                                          query: '',
                                          toRoomId: '',
                                        });
                                      }}
                                    >
                                      <Pencil size={15} />
                                    </button>

                                    <button
                                      type="button"
                                      disabled={viewOnly}
                                      title={t.swap}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSwapMode((prev) =>
                                          prev.active && idOf(prev.studentId) === idOf(student.id)
                                            ? { active: false, studentId: null }
                                            : { active: true, studentId: student.id }
                                        );
                                      }}
                                    >
                                      <ArrowRightLeft size={15} />
                                    </button>

                                    <button
                                      type="button"
                                      disabled={viewOnly}
                                      className="danger"
                                      title={t.remove}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        unassignStudent(student.id);
                                      }}
                                    >
                                      <X size={15} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {addModal.open && (
        <div className="bp-modalBackdrop" onMouseDown={() => setAddModal({ open: false, roomId: null, query: '' })}>
          <div className="bp-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bp-modalHead">
              <strong>{t.pickStudent}</strong>
              <button type="button" onClick={() => setAddModal({ open: false, roomId: null, query: '' })}>
                <X size={18} />
              </button>
            </div>

            <div className="bp-search modalSearch">
              <Search size={16} />
              <input
                value={addModal.query}
                onChange={(e) => setAddModal((prev) => ({ ...prev, query: e.target.value }))}
                placeholder={t.searchStudent}
                autoFocus
              />
            </div>

            <div className="bp-modalList">
              {filteredUnassignedStudents.length === 0 ? (
                <div className="bp-emptyMini">{t.noAvailableStudents}</div>
              ) : (
                filteredUnassignedStudents.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    className="bp-modalItem"
                    onClick={() => assignStudentToRoom(student.id, addModal.roomId)}
                  >
                    <div className="bp-avatar">
                      <Users size={14} />
                    </div>
                    <div>
                      <strong>{getStudentLabel(student)}</strong>
                      <span>{student.student_id || student.business_partner_id || ''}</span>
                    </div>
                    <Plus size={16} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {moveModal.open && (
        <div className="bp-modalBackdrop" onMouseDown={() => setMoveModal({ open: false, studentId: null, query: '', toRoomId: '' })}>
          <div className="bp-modal large" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bp-modalHead">
              <strong>{t.moveStudent}</strong>
              <button type="button" onClick={() => setMoveModal({ open: false, studentId: null, query: '', toRoomId: '' })}>
                <X size={18} />
              </button>
            </div>

            <div className="bp-search modalSearch">
              <Search size={16} />
              <input
                value={moveModal.query}
                onChange={(e) => setMoveModal((prev) => ({ ...prev, query: e.target.value }))}
                placeholder={t.searchRoom}
                autoFocus
              />
            </div>

            <div className="bp-modalList rooms">
              {filteredMoveRooms.length === 0 ? (
                <div className="bp-emptyMini">{t.noData}</div>
              ) : (
                filteredMoveRooms.map((room) => {
                  const roomStudents = getRoomStudents(room.id);
                  const capacity = getRoomCapacity(room);
                  const full = capacity > 0 && roomStudents.length >= capacity;
                  const selected = idOf(moveModal.toRoomId) === idOf(room.id);
                  const building = buildings.find((b) => idOf(b.id) === getBuildingIdFromRoom(room));

                  return (
                    <button
                      key={room.id}
                      type="button"
                      className={`bp-modalItem room ${selected ? 'selected' : ''} ${full ? 'disabled' : ''}`}
                      disabled={full}
                      onClick={() => setMoveModal((prev) => ({ ...prev, toRoomId: room.id }))}
                    >
                      <Home size={15} />
                      <div>
                        <strong>
                          {building ? getBuildingLabel(building, t) : t.building} · {t.room}{' '}
                          {room.name || room.number || room.id}
                        </strong>
                        <span>
                          {t.apartment} {room.apartment_number || getApartmentIdFromRoom(room)} ·{' '}
                          {roomStudents.length}/{capacity || '—'}
                          {full ? ` · ${t.roomFull}` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="bp-modalFooter">
              <button type="button" className="bp-secondary" onClick={() => setMoveModal({ open: false, studentId: null, query: '', toRoomId: '' })}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="bp-primary"
                disabled={!moveModal.toRoomId}
                onClick={() => moveStudentToRoom(moveModal.studentId, moveModal.toRoomId)}
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        :root {
          --bp-bg: #f5f8fc;
          --bp-card: #ffffff;
          --bp-text: #0f172a;
          --bp-muted: #64748b;
          --bp-border: rgba(15, 23, 42, 0.10);
          --bp-blue: #2563eb;
          --bp-blue-soft: #dbeafe;
          --bp-green: #059669;
          --bp-green-soft: #d1fae5;
          --bp-red: #dc2626;
          --bp-red-soft: #fee2e2;
          --bp-orange: #f97316;
          --bp-shadow: 0 10px 25px rgba(15, 23, 42, 0.07);
          --bp-radius: 18px;
        }

        .bp-page {
          min-height: 100vh;
          background: var(--bp-bg);
          padding: 24px;
          color: var(--bp-text);
        }

        .bp-center {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--bp-muted);
          font-weight: 700;
        }

        .bp-spin {
          animation: bp-spin 0.9s linear infinite;
        }

        @keyframes bp-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .bp-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          margin-bottom: 18px;
        }

        .bp-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .bp-header p {
          margin: 6px 0 0;
          color: var(--bp-muted);
          font-size: 14px;
          font-weight: 650;
        }

        .bp-permission {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--bp-blue-soft);
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
          border-radius: 999px;
          padding: 9px 13px;
          font-weight: 800;
          font-size: 13px;
        }

        .bp-permission.readonly {
          color: #92400e;
          background: #fef3c7;
          border-color: #fde68a;
        }

        .bp-toolbar {
          display: grid;
          grid-template-columns: 1fr 1fr 1.5fr;
          gap: 14px;
          margin-bottom: 14px;
        }

        .bp-field,
        .bp-search {
          background: var(--bp-card);
          border: 1px solid var(--bp-border);
          border-radius: 15px;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .bp-field {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .bp-field label {
          color: var(--bp-muted);
          font-size: 12px;
          font-weight: 800;
        }

        .bp-field select {
          border: none;
          background: transparent;
          outline: none;
          font: inherit;
          font-weight: 750;
          color: var(--bp-text);
        }

        .bp-search {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          min-height: 58px;
        }

        .bp-search input {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font: inherit;
          color: var(--bp-text);
        }

        .bp-search button {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--bp-muted);
          display: flex;
        }

        .bp-errorBox {
          background: var(--bp-red-soft);
          border: 1px solid #fecaca;
          color: #991b1b;
          border-radius: 14px;
          padding: 12px 14px;
          font-weight: 750;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .bp-errorBox.small button {
          border: none;
          background: transparent;
          cursor: pointer;
          color: #991b1b;
          display: flex;
        }

        .bp-statsGrid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 16px;
        }

        .bp-stat {
          background: var(--bp-card);
          border: 1px solid var(--bp-border);
          border-radius: var(--bp-radius);
          box-shadow: var(--bp-shadow);
          padding: 15px;
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .bp-statIcon {
          width: 44px;
          height: 44px;
          border-radius: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bp-blue-soft);
          color: var(--bp-blue);
          flex: 0 0 auto;
        }

        .bp-statValue {
          font-size: 24px;
          font-weight: 950;
          line-height: 1;
        }

        .bp-statLabel {
          margin-top: 5px;
          color: var(--bp-muted);
          font-size: 12px;
          font-weight: 750;
        }

        .bp-layout {
          display: grid;
          grid-template-columns: minmax(360px, 42%) 1fr;
          gap: 16px;
          align-items: start;
        }

        .bp-panel {
          background: var(--bp-card);
          border: 1px solid var(--bp-border);
          border-radius: var(--bp-radius);
          box-shadow: var(--bp-shadow);
          overflow: hidden;
        }

        .bp-panelHead {
          padding: 14px 16px;
          background: #f8fafc;
          border-bottom: 1px solid var(--bp-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 14px;
        }

        .bp-panelHead > div {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .bp-panelHead span {
          background: #e2e8f0;
          color: #475569;
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 12px;
          font-weight: 850;
        }

        .bp-list {
          padding: 10px;
          max-height: calc(100vh - 340px);
          overflow: auto;
        }

        .bp-buildingCard {
          margin-bottom: 8px;
        }

        .bp-buildingButton,
        .bp-apartmentButton {
          width: 100%;
          border: 1px solid var(--bp-border);
          background: white;
          border-radius: 15px;
          padding: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          color: var(--bp-text);
          text-align: start;
        }

        .bp-buildingButton:hover,
        .bp-apartmentButton:hover {
          border-color: #93c5fd;
          background: #f8fbff;
        }

        .bp-buildingButton.selected,
        .bp-apartmentButton.selected {
          background: #eff6ff;
          border-color: #93c5fd;
        }

        .bp-iconBubble {
          width: 40px;
          height: 40px;
          border-radius: 14px;
          background: var(--bp-blue-soft);
          color: var(--bp-blue);
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }

        .bp-buildingInfo {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }

        .bp-buildingInfo strong,
        .bp-apartmentButton strong {
          font-size: 14px;
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bp-buildingInfo span,
        .bp-apartmentButton span {
          color: var(--bp-muted);
          font-size: 12px;
          font-weight: 650;
          margin-top: 2px;
        }

        .bp-status {
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .bp-status.ok {
          background: var(--bp-green-soft);
          color: #047857;
        }

        .bp-status.bad {
          background: var(--bp-red-soft);
          color: #991b1b;
        }

        .bp-apartmentList {
          padding: 8px 0 0 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        [dir="rtl"] .bp-apartmentList {
          padding: 8px 16px 0 0;
        }

        .bp-apartmentButton {
          border-radius: 13px;
          background: #f8fafc;
        }

        .bp-apartmentButton > div {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .bp-workPanel {
          min-height: 560px;
        }

        .bp-workHead {
          padding: 18px 20px;
          border-bottom: 1px solid var(--bp-border);
          background: linear-gradient(135deg, #f8fafc, #eff6ff);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .bp-workHead h2 {
          margin: 4px 0 0;
          font-size: 22px;
          font-weight: 950;
        }

        .bp-breadcrumb {
          color: var(--bp-muted);
          font-size: 12px;
          font-weight: 800;
        }

        .bp-swapBanner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          border-radius: 999px;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 850;
        }

        .bp-swapBanner button {
          border: none;
          background: #fed7aa;
          color: #9a3412;
          border-radius: 999px;
          padding: 5px 8px;
          cursor: pointer;
          font-weight: 900;
        }

        .bp-roomGrid {
          padding: 16px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
          gap: 14px;
        }

        .bp-roomCard {
          border: 1px solid var(--bp-border);
          border-radius: 18px;
          background: white;
          padding: 14px;
          box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
        }

        .bp-roomCard.full {
          border-color: #fca5a5;
          background: #fffafa;
        }

        .bp-roomCard.readonly {
          opacity: 0.88;
        }

        .bp-roomTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }

        .bp-roomTop h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
        }

        .bp-roomTop span {
          display: block;
          margin-top: 3px;
          color: var(--bp-muted);
          font-size: 12px;
          font-weight: 750;
        }

        .bp-primarySmall,
        .bp-primary,
        .bp-secondary {
          border: none;
          border-radius: 13px;
          padding: 9px 11px;
          cursor: pointer;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .bp-primarySmall,
        .bp-primary {
          background: var(--bp-blue);
          color: white;
        }

        .bp-secondary {
          background: #f1f5f9;
          color: #334155;
        }

        .bp-primarySmall:disabled,
        .bp-primary:disabled,
        .bp-secondary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .bp-meter {
          height: 8px;
          background: #e2e8f0;
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 12px;
        }

        .bp-meter > div {
          height: 100%;
          background: linear-gradient(90deg, #60a5fa, #2563eb);
          border-radius: 999px;
        }

        .bp-studentList {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bp-studentRow {
          border: 1px solid var(--bp-border);
          background: #f8fafc;
          border-radius: 14px;
          padding: 9px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: grab;
        }

        .bp-studentRow.swapSelected {
          background: #fff7ed;
          border-color: #fb923c;
        }

        .bp-studentMain,
        .bp-modalItem {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .bp-studentMain > div:last-child,
        .bp-modalItem > div:not(.bp-avatar) {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .bp-studentMain strong,
        .bp-modalItem strong {
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bp-studentMain span,
        .bp-modalItem span {
          color: var(--bp-muted);
          font-size: 11px;
          font-weight: 700;
          margin-top: 2px;
        }

        .bp-avatar {
          width: 30px;
          height: 30px;
          border-radius: 11px;
          background: var(--bp-blue-soft);
          color: var(--bp-blue);
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }

        .bp-actions {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .bp-actions button,
        .bp-modalHead button {
          border: 1px solid var(--bp-border);
          background: white;
          border-radius: 10px;
          width: 31px;
          height: 31px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #475569;
        }

        .bp-actions button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .bp-actions button.danger {
          color: var(--bp-red);
        }

        .bp-emptyState {
          min-height: 520px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--bp-muted);
          text-align: center;
          padding: 28px;
        }

        .bp-emptyState strong {
          color: var(--bp-text);
          font-size: 18px;
          font-weight: 950;
        }

        .bp-emptyState.small {
          min-height: 260px;
          grid-column: 1 / -1;
        }

        .bp-bigIcon {
          width: 78px;
          height: 78px;
          border-radius: 24px;
          background: var(--bp-blue-soft);
          color: var(--bp-blue);
          border: 1px solid #bfdbfe;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bp-emptyMini,
        .bp-emptyRoom,
        .bp-loadingLine,
        .bp-loadingBlock {
          color: var(--bp-muted);
          font-weight: 750;
          font-size: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px;
        }

        .bp-emptyRoom {
          border: 1px dashed #cbd5e1;
          border-radius: 14px;
          background: #f8fafc;
        }

        .bp-loadingBlock {
          min-height: 260px;
          grid-column: 1 / -1;
        }

        .bp-modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .bp-modal {
          width: min(520px, 100%);
          max-height: 82vh;
          background: white;
          border-radius: 20px;
          border: 1px solid var(--bp-border);
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .bp-modal.large {
          width: min(760px, 100%);
        }

        .bp-modalHead {
          padding: 14px 16px;
          border-bottom: 1px solid var(--bp-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .bp-modalHead strong {
          font-size: 16px;
          font-weight: 950;
        }

        .modalSearch {
          margin: 12px;
          min-height: 46px;
          box-shadow: none;
        }

        .bp-modalList {
          padding: 0 12px 12px;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bp-modalList.rooms {
          max-height: 430px;
        }

        .bp-modalItem {
          width: 100%;
          border: 1px solid var(--bp-border);
          background: #f8fafc;
          border-radius: 14px;
          padding: 10px;
          cursor: pointer;
          color: var(--bp-text);
          text-align: start;
        }

        .bp-modalItem:hover {
          border-color: #93c5fd;
          background: #eff6ff;
        }

        .bp-modalItem.selected {
          background: var(--bp-blue-soft);
          border-color: #60a5fa;
        }

        .bp-modalItem.disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .bp-modalItem.room {
          display: grid;
          grid-template-columns: auto 1fr;
        }

        .bp-modalFooter {
          padding: 12px 16px;
          border-top: 1px solid var(--bp-border);
          background: #f8fafc;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        @media (max-width: 1120px) {
          .bp-toolbar {
            grid-template-columns: 1fr;
          }

          .bp-statsGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .bp-layout {
            grid-template-columns: 1fr;
          }

          .bp-list {
            max-height: none;
          }
        }

        @media (max-width: 640px) {
          .bp-page {
            padding: 14px;
          }

          .bp-header {
            flex-direction: column;
            align-items: stretch;
          }

          .bp-statsGrid {
            grid-template-columns: 1fr;
          }

          .bp-roomGrid {
            grid-template-columns: 1fr;
          }

          .bp-workHead {
            flex-direction: column;
            align-items: stretch;
          }
        }
      `}</style>
    </div>
  );
}
