import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { dormOffices, dorms, buildings, apartments, rooms, students as studentsSeed } from '../data/mockData';
import {
  Building2,
  Home,
  Users,
  ChevronDown,
  ChevronUp,
  Search,
  Star,
  X,
  Plus,
  ArrowRightLeft,
  Pencil,
} from 'lucide-react';

function BuildingsPage({ language }) {
  const {
    isCentralAdmin,
    isRegionBoss,
    isEmployee,
    getUserRegion,
    canEditRegion,
  } = useAuth();

  const userRegionId = getUserRegion();

  const [studentsState, setStudentsState] = useState(() => [...studentsSeed]);

  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedApartment, setSelectedApartment] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBuildings, setExpandedBuildings] = useState({});

  const [addModal, setAddModal] = useState({ open: false, roomId: null, query: '' });

  const [moveModal, setMoveModal] = useState({
    open: false,
    studentId: null,
    fromRoomId: null,
    toRoomId: '',
    query: '',
  });

  const [swapMode, setSwapMode] = useState({
    active: false,
    studentId: null,
    fromRoomId: null,
  });

  const [draggingStudentId, setDraggingStudentId] = useState(null);

  const t = {
    he: {
      title: 'בניינים וחדרים',
      subtitle: '',
      search: 'חיפוש בניין...',
      chooseOffice: 'בחר משרד לצפייה',
      chooseDorm: 'בחר מעונות לצפייה',
      floor: 'קומה',
      apartment: 'דירה',
      room: 'חדר',
      students: 'סטודנטים',
      empty: 'פנוי',
      reserved: 'שמור',
      selectBuilding: 'בחר דירה לצפייה',
      addStudent: 'הוסף סטודנט/ית',
      remove: 'הסר',
      close: 'סגור',
      pickStudent: 'בחר סטודנט/ית לשיוך',
      dropHere: 'שחרר כאן לשיוך',
      capacity: 'קיבולת',
      updateMove: 'עדכון / העברה',
      swap: 'החלפה',
      swapHint: 'בחר סטודנט נוסף להחלפה',
      moveTo: 'העבר אל',
      confirm: 'אישור',
      cancel: 'ביטול',
      roomFull: 'החדר מלא',
      searchRoom: 'חיפוש חדר/דירה/בניין...',
      statsBuildings: 'בניינים',
      statsApartments: 'דירות',
      statsRooms: 'חדרים',
      statsAssigned: 'משוייכים',
      statsUnassigned: 'לא משוייכים',
      dragTip: 'שיוך סטודנטים לחדרים',
      viewOnly: 'צפייה בלבד (אין הרשאה לעריכה באיזור זה)',
      noOffice: 'לא נמצא משרד מתאים לאזור של המשתמש',
      noDorm: 'לא נמצא אזור/מעונות מתאים למשתמש',
      buildingsList: 'רשימת בניינים',
      items: 'פריטים',
      emptyHelp: 'בחרי בניין ואז דירה — ותראי את החדרים והשיוכים.',
      noAvailableStudents: 'אין סטודנטים פנויים לשיוך',
      noResults: 'אין תוצאות',
      clear: 'נקה',
      allRegionsView: 'צפייה בכל האזורים',
    },
    en: {
      title: 'Buildings & Rooms',
      subtitle: 'Assign students to rooms',
      search: 'Search building...',
      chooseOffice: 'Choose office',
      chooseDorm: 'Choose dorm',
      floor: 'Floor',
      apartment: 'Apartment',
      room: 'Room',
      students: 'Students',
      empty: 'Empty',
      reserved: 'Reserved',
      selectBuilding: 'Select an apartment to view',
      addStudent: 'Add student',
      remove: 'Remove',
      close: 'Close',
      pickStudent: 'Pick a student to assign',
      dropHere: 'Drop here to assign',
      capacity: 'Capacity',
      updateMove: 'Update / Move',
      swap: 'Swap',
      swapHint: 'Pick another student to swap',
      moveTo: 'Move to',
      confirm: 'Confirm',
      cancel: 'Cancel',
      roomFull: 'Room is full',
      searchRoom: 'Search room/apartment/building...',
      statsBuildings: 'Buildings',
      statsApartments: 'Apartments',
      statsRooms: 'Rooms',
      statsAssigned: 'Assigned',
      statsUnassigned: 'Unassigned',
      dragTip: 'Drag students between rooms',
      viewOnly: 'View-only (no edit permission for this region)',
      noOffice: 'No office found for this user region',
      noDorm: 'No dorm/region found for this user',
      buildingsList: 'Buildings list',
      items: 'items',
      emptyHelp: 'Pick a building and then an apartment to manage rooms.',
      noAvailableStudents: 'No available students',
      noResults: 'No results',
      clear: 'Clear',
      allRegionsView: 'Viewing all regions',
    },
  }[language];

  const canViewAllRegions = isCentralAdmin() || isRegionBoss();
  const isOwnRegionOnly = isEmployee();

  const userDormObj = useMemo(() => {
    return dorms.find((d) => String(d.id) === String(userRegionId)) || null;
  }, [userRegionId]);

  const userOfficeId = userDormObj?.officeId || null;

  const defaultOfficeId = useMemo(() => {
    if (canViewAllRegions) {
      return userOfficeId || dormOffices?.[0]?.id || '';
    }
    return userOfficeId || '';
  }, [canViewAllRegions, userOfficeId]);

  const [selectedOfficeId, setSelectedOfficeId] = useState(defaultOfficeId);

  useEffect(() => {
    setSelectedOfficeId(defaultOfficeId);
  }, [defaultOfficeId]);

  const effectiveOfficeId = canViewAllRegions ? selectedOfficeId : userOfficeId;

  const dormsInOffice = useMemo(() => {
    const office = dormOffices.find((o) => String(o.id) === String(effectiveOfficeId));
    if (!office) return [];
    const allowed = new Set((office.dormIds || []).map(String));
    return dorms.filter((d) => allowed.has(String(d.id)));
  }, [effectiveOfficeId]);

  const defaultDormId = useMemo(() => {
    if (canViewAllRegions) {
      return userRegionId || dormsInOffice[0]?.id || '';
    }
    return userRegionId || '';
  }, [canViewAllRegions, dormsInOffice, userRegionId]);

  const [selectedDormId, setSelectedDormId] = useState(defaultDormId);

  useEffect(() => {
    setSelectedDormId(defaultDormId);
  }, [defaultDormId]);

  const effectiveDormId = canViewAllRegions ? selectedDormId : userRegionId;

  const effectiveDormObj = useMemo(
    () => dorms.find((d) => String(d.id) === String(effectiveDormId)) || null,
    [effectiveDormId]
  );

  const effectiveOfficeObj = useMemo(
    () => dormOffices.find((o) => String(o.id) === String(effectiveOfficeId)) || null,
    [effectiveOfficeId]
  );

  const canEditThisDorm = useMemo(() => {
    if (!effectiveDormId) return false;
    return isCentralAdmin() || canEditRegion(effectiveDormId);
  }, [effectiveDormId, isCentralAdmin, canEditRegion]);

  const toggleBuilding = (buildingId) => {
    setExpandedBuildings((prev) => ({ ...prev, [buildingId]: !prev[buildingId] }));
    setSelectedBuilding(buildingId);
    setSelectedApartment(null);
  };

  const getBuildingApartments = (buildingId) =>
    apartments.filter((a) => String(a.buildingId) === String(buildingId));

  const getApartmentRooms = (apartmentId) =>
    rooms.filter((r) => String(r.apartmentId) === String(apartmentId));

  const getRoomStudents = (roomId) =>
    studentsState.filter((s) => String(s.assignedRoomId) === String(roomId));

  const unassignedStudents = useMemo(
    () => studentsState.filter((s) => !s.assignedRoomId),
    [studentsState]
  );

  const filteredBuildings = useMemo(() => {
    let list = buildings;

    if (isOwnRegionOnly && userRegionId) {
      list = list.filter((b) => String(b.regionId) === String(userRegionId));
    } else if (effectiveDormId) {
      list = list.filter((b) => String(b.regionId) === String(effectiveDormId));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((b) => {
        const dorm = dorms.find((d) => String(d.id) === String(b.regionId));
        return (
          (b.name || '').toLowerCase().includes(q) ||
          (dorm?.name || '').toLowerCase().includes(q) ||
          (dorm?.nameEn || '').toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [effectiveDormId, isOwnRegionOnly, userRegionId, searchQuery]);

  const canDropIntoRoom = (room) => {
    const current = getRoomStudents(room.id).length;
    return current < (Number(room.capacity) || 0);
  };

  const assignStudentToRoom = (studentId, roomId) => {
    if (!canEditThisDorm) return;
    setStudentsState((prev) =>
      prev.map((s) => (String(s.id) === String(studentId) ? { ...s, assignedRoomId: roomId } : s))
    );
  };

  const unassignStudent = (studentId) => {
    if (!canEditThisDorm) return;
    setStudentsState((prev) =>
      prev.map((s) => (String(s.id) === String(studentId) ? { ...s, assignedRoomId: null } : s))
    );
  };

  const swapStudents = (studentAId, roomAId, studentBId, roomBId) => {
    if (!canEditThisDorm) return;
    setStudentsState((prev) =>
      prev.map((s) => {
        if (String(s.id) === String(studentAId)) return { ...s, assignedRoomId: roomBId };
        if (String(s.id) === String(studentBId)) return { ...s, assignedRoomId: roomAId };
        return s;
      })
    );
  };

  const filteredUnassigned = useMemo(() => {
    const q = addModal.query.trim().toLowerCase();
    if (!q) return unassignedStudents;
    return unassignedStudents.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q)
    );
  }, [unassignedStudents, addModal.query]);

  const allRoomsInDorm = useMemo(() => {
    if (!effectiveDormId) return [];
    return rooms.filter((r) => String(r.regionId) === String(effectiveDormId));
  }, [effectiveDormId]);

  const filteredRoomsForMove = useMemo(() => {
    const q = moveModal.query.trim().toLowerCase();
    if (!q) return allRoomsInDorm;

    return allRoomsInDorm.filter((r) => {
      const apt = apartments.find((a) => String(a.id) === String(r.apartmentId));
      const bld = buildings.find((b) => String(b.id) === String(r.buildingId));

      const hay = [
        r.id,
        r.name,
        String(apt?.number ?? ''),
        String(apt?.floor ?? ''),
        bld?.name || '',
        bld?.id || '',
        r.apartmentId || '',
        r.buildingId || '',
      ]
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [allRoomsInDorm, moveModal.query]);

  const safeResetSelection = () => {
    setSelectedBuilding(null);
    setSelectedApartment(null);
    setExpandedBuildings({});
    setSearchQuery('');
    setSwapMode({ active: false, studentId: null, fromRoomId: null });
    setDraggingStudentId(null);
    setAddModal({ open: false, roomId: null, query: '' });
    setMoveModal({ open: false, studentId: null, fromRoomId: null, toRoomId: '', query: '' });
  };

  const handleOfficeChange = (nextOfficeId) => {
    setSelectedOfficeId(nextOfficeId);

    const office = dormOffices.find((o) => String(o.id) === String(nextOfficeId));
    const nextDormId =
      office?.dormIds?.find((id) => dorms.some((d) => String(d.id) === String(id))) || '';

    setSelectedDormId(nextDormId);
    safeResetSelection();
  };

  const handleDormChange = (nextDormId) => {
    setSelectedDormId(nextDormId);
    safeResetSelection();
  };

  const selectedApartmentObj = useMemo(
    () => (selectedApartment ? apartments.find((a) => String(a.id) === String(selectedApartment)) : null),
    [selectedApartment]
  );

  const selectedBuildingObj = useMemo(() => {
    if (!selectedApartmentObj) return null;
    return buildings.find((b) => String(b.id) === String(selectedApartmentObj.buildingId)) || null;
  }, [selectedApartmentObj]);

  const selectedApartmentRooms = useMemo(() => {
    if (!selectedApartment) return [];
    return getApartmentRooms(selectedApartment);
  }, [selectedApartment]);

  const assignedCount = useMemo(
    () => studentsState.filter((s) => !!s.assignedRoomId).length,
    [studentsState]
  );

  const unassignedCount = useMemo(
    () => studentsState.filter((s) => !s.assignedRoomId).length,
    [studentsState]
  );

  const apartmentsCountInFiltered = useMemo(() => {
    let total = 0;
    filteredBuildings.forEach((b) => {
      total += getBuildingApartments(b.id).length;
    });
    return total;
  }, [filteredBuildings]);

  const roomsCountInFiltered = useMemo(() => {
    let total = 0;
    filteredBuildings.forEach((b) => {
      const apts = getBuildingApartments(b.id);
      apts.forEach((a) => {
        total += getApartmentRooms(a.id).length;
      });
    });
    return total;
  }, [filteredBuildings]);

  const viewOnlyTitle = !canEditThisDorm ? t.viewOnly : '';
  const showSelectors = canViewAllRegions;
  const hasUserRegionMismatch = !isCentralAdmin() && !userDormObj;

  return (
    <div className="bp-shell">
      <div className="bp-top">
        <div className="bp-titleRow">
          <div className="bp-titleBlock">
            <h1 className="bp-title">{t.title}</h1>
            <div className="bp-sub">
              <span className="bp-subText">{t.subtitle}</span>
              <span className="bp-dot">•</span>
              <span className="bp-tip" title={viewOnlyTitle}>
                <Users size={14} />
                {t.dragTip}
              </span>
              {!canEditThisDorm && <span className="bp-viewOnly">{t.viewOnly}</span>}
              {isRegionBoss() && <span className="bp-viewOnly">{t.allRegionsView}</span>}
            </div>
          </div>

          <div className="bp-contextPills">
            <span className="bp-pill">
              {language === 'he' ? effectiveOfficeObj?.name : effectiveOfficeObj?.nameEn}
            </span>
            <span className="bp-pill bp-pillPrimary">
              {language === 'he' ? effectiveDormObj?.name : effectiveDormObj?.nameEn}
            </span>
          </div>
        </div>

        {hasUserRegionMismatch && (
          <div className="bp-warningBox">
            {t.noDorm} ({String(userRegionId ?? '')})
          </div>
        )}

        <div className="bp-controls">
          <div className="bp-selectCard">
            <div className="bp-selectGrid">
              <div className="bp-field">
                <label>{t.chooseOffice}</label>
                <select
                  value={effectiveOfficeId || ''}
                  onChange={(e) => handleOfficeChange(e.target.value)}
                  disabled={!showSelectors}
                >
                  {showSelectors
                    ? dormOffices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {language === 'he' ? o.name : o.nameEn}
                        </option>
                      ))
                    : effectiveOfficeObj && (
                        <option value={effectiveOfficeObj.id}>
                          {language === 'he' ? effectiveOfficeObj.name : effectiveOfficeObj.nameEn}
                        </option>
                      )}
                </select>
              </div>

              <div className="bp-field">
                <label>{t.chooseDorm}</label>
                <select
                  value={effectiveDormId || ''}
                  onChange={(e) => handleDormChange(e.target.value)}
                  disabled={!showSelectors}
                >
                  {showSelectors
                    ? dormsInOffice.map((d) => (
                        <option key={d.id} value={d.id}>
                          {language === 'he' ? d.name : d.nameEn}
                        </option>
                      ))
                    : effectiveDormObj && (
                        <option value={effectiveDormObj.id}>
                          {language === 'he' ? effectiveDormObj.name : effectiveDormObj.nameEn}
                        </option>
                      )}
                </select>
              </div>
            </div>
          </div>

          <div className="bp-searchCard">
            <div className="bp-search">
              <Search size={18} />
              <input
                type="text"
                placeholder={t.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery?.trim() && (
                <button className="bp-clear" onClick={() => setSearchQuery('')} title={t.clear}>
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="bp-stats">
              <div className="bp-stat">
                <span className="bp-statLabel">{t.statsBuildings}</span>
                <span className="bp-statValue">{filteredBuildings.length}</span>
              </div>
              <div className="bp-stat">
                <span className="bp-statLabel">{t.statsApartments}</span>
                <span className="bp-statValue">{apartmentsCountInFiltered}</span>
              </div>
              <div className="bp-stat">
                <span className="bp-statLabel">{t.statsRooms}</span>
                <span className="bp-statValue">{roomsCountInFiltered}</span>
              </div>
              <div className="bp-stat bp-statAccent">
                <span className="bp-statLabel">{t.statsAssigned}</span>
                <span className="bp-statValue">{assignedCount}</span>
              </div>
              <div className="bp-stat">
                <span className="bp-statLabel">{t.statsUnassigned}</span>
                <span className="bp-statValue">{unassignedCount}</span>
              </div>
            </div>
          </div>
        </div>

        {showSelectors && (
          <div className="bp-chipRow">
            {dormsInOffice.slice(0, 14).map((d) => (
              <button
                key={d.id}
                className={`bp-chip ${String(effectiveDormId) === String(d.id) ? 'active' : ''}`}
                onClick={() => handleDormChange(d.id)}
                title={language === 'he' ? d.name : d.nameEn}
              >
                {language === 'he' ? d.name : d.nameEn}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bp-grid">
        <div className="bp-left">
          <div className="bp-panel">
            <div className="bp-panelHeader">
              <div className="bp-panelHeaderLeft">
                <Building2 size={18} />
                <span className="bp-panelTitle">{t.buildingsList}</span>
              </div>
              <span className="bp-panelMeta">
                {filteredBuildings.length} {t.items}
              </span>
            </div>

            <div className="bp-panelBody">
              {filteredBuildings.map((building) => {
                const buildingApartments = getBuildingApartments(building.id);
                const isExpanded = expandedBuildings[building.id];

                return (
                  <div key={building.id} className="bp-bldCard">
                    <button
                      className={`bp-bldHead ${selectedBuilding === building.id ? 'selected' : ''}`}
                      onClick={() => toggleBuilding(building.id)}
                    >
                      <div className="bp-bldIcon">
                        <Building2 size={18} />
                      </div>
                      <div className="bp-bldInfo">
                        <div className="bp-bldName">{building.name}</div>
                        <div className="bp-bldSub">
                          <span>
                            {building.floors ?? '-'} {t.floor}
                          </span>
                          <span className="bp-dotSmall">•</span>
                          <span>
                            {buildingApartments.length} {t.apartment}
                          </span>
                        </div>
                      </div>
                      <div className="bp-bldChevron">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="bp-aptList">
                        {buildingApartments.map((apt) => (
                          <button
                            key={apt.id}
                            className={`bp-aptItem ${apt.isReserved ? 'reserved' : ''} ${
                              selectedApartment === apt.id ? 'selected' : ''
                            }`}
                            onClick={() => setSelectedApartment(apt.id)}
                          >
                            <div className="bp-aptLeft">
                              <Home size={16} />
                              <span className="bp-aptText">
                                {t.apartment} {apt.number}
                              </span>
                              {apt.isReserved && <Star size={14} className="bp-aptStar" />}
                            </div>

                            <span className="bp-floorBadge">
                              {t.floor} {apt.floor ?? '-'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bp-right">
          <div className="bp-panel bp-panelBig">
            {selectedApartment ? (
              <>
                <div className="bp-workHeader">
                  <div className="bp-workHeaderTop">
                    <div className="bp-workTitle">
                      <div className="bp-workTitleLine">
                        <span className="bp-workH">
                          {t.apartment} {selectedApartmentObj?.number}
                        </span>
                        {selectedApartmentObj?.isReserved && (
                          <span className="bp-reservedBadge">
                            <Star size={14} />
                            {t.reserved}
                          </span>
                        )}
                        {!canEditThisDorm && <span className="bp-viewPill">{t.viewOnly}</span>}
                      </div>
                      <div className="bp-breadcrumb">
                        <span className="bp-breadItem">{selectedBuildingObj?.name}</span>
                        <span className="bp-dotSmall">•</span>
                        <span className="bp-breadItem">
                          {language === 'he' ? effectiveDormObj?.name : effectiveDormObj?.nameEn}
                        </span>
                      </div>
                    </div>

                    {swapMode.active && canEditThisDorm && (
                      <div className="bp-swapBanner">
                        <div className="bp-swapLeft">
                          <ArrowRightLeft size={16} />
                          <span>{t.swapHint}</span>
                        </div>
                        <button
                          className="bp-swapCancel"
                          onClick={() =>
                            setSwapMode({ active: false, studentId: null, fromRoomId: null })
                          }
                        >
                          {t.cancel}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bp-workBody">
                  <div className="bp-roomsGrid">
                    {selectedApartmentRooms.map((room) => {
                      const roomStudents = getRoomStudents(room.id);
                      const cap = Number(room.capacity) || 0;
                      const count = roomStudents.length;
                      const full = count >= cap;
                      const pct = cap > 0 ? Math.min(100, Math.round((count / cap) * 100)) : 0;

                      return (
                        <div
                          key={room.id}
                          className={`bp-roomCard ${full ? 'full' : ''} ${!canEditThisDorm ? 'viewOnly' : ''}`}
                          onDragOver={(e) => {
                            if (!canEditThisDorm) return;
                            e.preventDefault();
                          }}
                          onDrop={() => {
                            if (!canEditThisDorm) return;
                            if (!draggingStudentId) return;
                            if (!canDropIntoRoom(room)) return;
                            assignStudentToRoom(draggingStudentId, room.id);
                            setDraggingStudentId(null);
                          }}
                          title={!canEditThisDorm ? t.viewOnly : ''}
                        >
                          <div className="bp-roomTop">
                            <div className="bp-roomTitle">
                              <span className="bp-roomName">{room.name}</span>
                              <span className="bp-roomCap">
                                {t.capacity}: {count}/{cap}
                                {full ? ` • ${t.roomFull}` : ''}
                              </span>
                            </div>

                            <button
                              className="bp-addBtn"
                              onClick={() => {
                                if (!canEditThisDorm) return;
                                setAddModal({ open: true, roomId: room.id, query: '' });
                              }}
                              title={!canEditThisDorm ? t.viewOnly : t.addStudent}
                              disabled={!canEditThisDorm}
                            >
                              <Plus size={16} />
                              <span className="bp-addBtnText">{t.addStudent}</span>
                            </button>
                          </div>

                          <div className="bp-meter">
                            <div className="bp-meterTrack">
                              <div className="bp-meterFill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="bp-meterText">{pct}%</span>
                          </div>

                          <div className="bp-roomBody">
                            {roomStudents.length > 0 ? (
                              roomStudents.map((student) => (
                                <div
                                  key={student.id}
                                  className={`bp-studentRow ${
                                    swapMode.active && swapMode.studentId === student.id ? 'swapSelected' : ''
                                  } ${!canEditThisDorm ? 'viewOnly' : ''}`}
                                  draggable={canEditThisDorm}
                                  onDragStart={() => {
                                    if (!canEditThisDorm) return;
                                    setDraggingStudentId(student.id);
                                  }}
                                  onClick={() => {
                                    if (!canEditThisDorm) return;
                                    if (!swapMode.active) return;

                                    if (!swapMode.studentId) {
                                      setSwapMode({
                                        active: true,
                                        studentId: student.id,
                                        fromRoomId: room.id,
                                      });
                                      return;
                                    }

                                    if (swapMode.studentId === student.id) return;

                                    swapStudents(swapMode.studentId, swapMode.fromRoomId, student.id, room.id);
                                    setSwapMode({ active: false, studentId: null, fromRoomId: null });
                                  }}
                                  title={!canEditThisDorm ? t.viewOnly : ''}
                                >
                                  <div className="bp-studentLeft">
                                    <div className="bp-avatar">
                                      <Users size={14} />
                                    </div>
                                    <span className="bp-studentName">
                                      {student.firstName} {student.lastName}
                                    </span>
                                  </div>

                                  <div className="bp-studentActions">
                                    <button
                                      className="bp-iconBtn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!canEditThisDorm) return;
                                        setMoveModal({
                                          open: true,
                                          studentId: student.id,
                                          fromRoomId: room.id,
                                          toRoomId: '',
                                          query: '',
                                        });
                                      }}
                                      title={!canEditThisDorm ? t.viewOnly : t.updateMove}
                                      disabled={!canEditThisDorm}
                                    >
                                      <Pencil size={16} />
                                    </button>

                                    <button
                                      className="bp-iconBtn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!canEditThisDorm) return;
                                        setSwapMode((prev) => ({
                                          active: !prev.active,
                                          studentId: !prev.active ? student.id : null,
                                          fromRoomId: !prev.active ? room.id : null,
                                        }));
                                      }}
                                      title={!canEditThisDorm ? t.viewOnly : t.swap}
                                      disabled={!canEditThisDorm}
                                    >
                                      <ArrowRightLeft size={16} />
                                    </button>

                                    <button
                                      className="bp-iconBtn danger"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!canEditThisDorm) return;
                                        unassignStudent(student.id);
                                      }}
                                      title={!canEditThisDorm ? t.viewOnly : t.remove}
                                      disabled={!canEditThisDorm}
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="bp-emptyDrop">
                                <div className="bp-emptyTop">{t.empty}</div>
                                <div className="bp-emptySub">{t.dropHere}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="bp-emptyState">
                <div className="bp-emptyIcon">
                  <Building2 size={44} />
                </div>
                <div className="bp-emptyText">{t.selectBuilding}</div>
                <div className="bp-emptySubText">{t.emptyHelp}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {addModal.open && (
        <div
          className="bp-modalBackdrop"
          onClick={() => setAddModal({ open: false, roomId: null, query: '' })}
        >
          <div className="bp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bp-modalHeader">
              <div className="bp-modalTitle">
                <Users size={18} />
                <h4>{t.pickStudent}</h4>
              </div>
              <button
                className="bp-closeBtn"
                onClick={() => setAddModal({ open: false, roomId: null, query: '' })}
                title={t.close}
              >
                <X size={18} />
              </button>
            </div>

            <div className="bp-modalSearch">
              <Search size={16} />
              <input
                value={addModal.query}
                onChange={(e) => setAddModal((prev) => ({ ...prev, query: e.target.value }))}
                placeholder={language === 'he' ? 'חיפוש סטודנט/ית...' : 'Search student...'}
              />
            </div>

            <div className="bp-modalList">
              {filteredUnassigned.length === 0 ? (
                <div className="bp-modalEmpty">
                  <span>{t.noAvailableStudents}</span>
                </div>
              ) : (
                filteredUnassigned.map((s) => (
                  <button
                    key={s.id}
                    className="bp-modalItem"
                    onClick={() => {
                      if (!canEditThisDorm) return;
                      const targetRoom = rooms.find((r) => String(r.id) === String(addModal.roomId));
                      if (!targetRoom) return;
                      if (!canDropIntoRoom(targetRoom)) return;
                      assignStudentToRoom(s.id, addModal.roomId);
                      setAddModal({ open: false, roomId: null, query: '' });
                    }}
                    disabled={!canEditThisDorm}
                    title={!canEditThisDorm ? t.viewOnly : ''}
                  >
                    <div className="bp-modalItemLeft">
                      <div className="bp-avatar">
                        <Users size={14} />
                      </div>
                      <span>
                        {s.firstName} {s.lastName}
                      </span>
                    </div>
                    <span className="bp-modalChevron">+</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {moveModal.open && (
        <div
          className="bp-modalBackdrop"
          onClick={() =>
            setMoveModal({ open: false, studentId: null, fromRoomId: null, toRoomId: '', query: '' })
          }
        >
          <div className="bp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bp-modalHeader">
              <div className="bp-modalTitle">
                <Pencil size={18} />
                <h4>{t.updateMove}</h4>
              </div>
              <button
                className="bp-closeBtn"
                onClick={() =>
                  setMoveModal({ open: false, studentId: null, fromRoomId: null, toRoomId: '', query: '' })
                }
                title={t.close}
              >
                <X size={18} />
              </button>
            </div>

            <div className="bp-modalSearch">
              <Search size={16} />
              <input
                value={moveModal.query}
                onChange={(e) => setMoveModal((prev) => ({ ...prev, query: e.target.value }))}
                placeholder={t.searchRoom}
              />
            </div>

            <div className="bp-modalList">
              {filteredRoomsForMove.length === 0 ? (
                <div className="bp-modalEmpty">
                  <span>{t.noResults}</span>
                </div>
              ) : (
                filteredRoomsForMove.map((r) => {
                  const apt = apartments.find((a) => String(a.id) === String(r.apartmentId));
                  const bld = buildings.find((b) => String(b.id) === String(r.buildingId));
                  const count = getRoomStudents(r.id).length;
                  const full = count >= (Number(r.capacity) || 0);

                  return (
                    <button
                      key={r.id}
                      className={`bp-modalItem ${full ? 'disabled' : ''} ${
                        moveModal.toRoomId === r.id ? 'active' : ''
                      }`}
                      onClick={() => {
                        if (!canEditThisDorm) return;
                        if (full) return;
                        setMoveModal((prev) => ({ ...prev, toRoomId: r.id }));
                      }}
                      disabled={full || !canEditThisDorm}
                      title={!canEditThisDorm ? t.viewOnly : full ? t.roomFull : r.id}
                    >
                      <div className="bp-modalItemLeft">
                        <Home size={14} />
                        <span className="bp-modalRoom">
                          {bld?.name || ''} • {t.apartment} {apt?.number ?? '-'} • {r.name}
                        </span>
                      </div>
                      <span className="bp-modalCap">
                        {count}/{r.capacity}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="bp-modalFooter">
              <button
                className="bp-btn secondary"
                onClick={() =>
                  setMoveModal({ open: false, studentId: null, fromRoomId: null, toRoomId: '', query: '' })
                }
              >
                {t.cancel}
              </button>
              <button
                className="bp-btn primary"
                disabled={!moveModal.toRoomId || !canEditThisDorm}
                onClick={() => {
                  if (!canEditThisDorm) return;
                  if (!moveModal.studentId || !moveModal.toRoomId) return;
                  assignStudentToRoom(moveModal.studentId, moveModal.toRoomId);
                  setMoveModal({ open: false, studentId: null, fromRoomId: null, toRoomId: '', query: '' });
                }}
                title={!canEditThisDorm ? t.viewOnly : ''}
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        :root{
          --bg: #f6f8fc;
          --card: #ffffff;
          --text: #0f172a;
          --muted: #64748b;
          --border: rgba(15, 23, 42, 0.10);
          --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          --shadow2: 0 6px 18px rgba(15, 23, 42, 0.08);
          --primary: #2563eb;
          --primary2: rgba(37, 99, 235, 0.12);
          --danger: #b91c1c;
          --dangerBg: rgba(185, 28, 28, 0.10);
          --warn: #b45309;
          --warnBg: rgba(180, 83, 9, 0.14);
          --radius: 16px;
          --radius2: 12px;
        }

        .bp-shell{
          padding: 18px;
          background: var(--bg);
          min-height: calc(100vh - 40px);
        }

        .bp-top{
          position: sticky;
          top: 0;
          z-index: 5;
          background: linear-gradient(to bottom, rgba(246,248,252,1), rgba(246,248,252,0.88));
          backdrop-filter: blur(8px);
          padding-bottom: 14px;
          margin-bottom: 14px;
        }

        .bp-warningBox{
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(180, 83, 9, 0.14);
          border: 1px solid rgba(180, 83, 9, 0.25);
          color: #92400e;
          font-weight: 800;
          font-size: 13px;
        }

        .bp-titleRow{
          display:flex;
          align-items:flex-end;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .bp-titleBlock{ display:flex; flex-direction:column; gap:6px; }
        .bp-title{
          margin:0;
          font-size: 24px;
          letter-spacing: -0.02em;
          color: var(--text);
          font-weight: 800;
        }
        .bp-sub{
          display:flex;
          align-items:center;
          gap:10px;
          color: var(--muted);
          font-size: 13px;
          flex-wrap: wrap;
        }
        .bp-subText{ font-weight: 600; }
        .bp-dot{ opacity: .6; }
        .bp-tip{
          display:inline-flex;
          align-items:center;
          gap:6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid var(--border);
        }
        .bp-viewOnly{
          display:inline-flex;
          align-items:center;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(180, 83, 9, 0.14);
          border: 1px solid rgba(180, 83, 9, 0.25);
          color: #92400e;
          font-weight: 900;
          font-size: 12px;
        }

        .bp-contextPills{
          display:flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        .bp-pill{
          display:inline-flex;
          align-items:center;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid var(--border);
          color: var(--text);
          font-weight: 700;
          font-size: 13px;
          white-space: nowrap;
        }
        .bp-pillPrimary{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
          color: #1d4ed8;
        }

        .bp-controls{
          display:grid;
          grid-template-columns: 1.1fr 1.6fr;
          gap: 14px;
          align-items: stretch;
        }

        .bp-selectCard,
        .bp-searchCard{
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow2);
          padding: 12px;
        }

        .bp-selectGrid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .bp-field{ display:flex; flex-direction:column; gap:6px; }
        .bp-field label{
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
        }
        .bp-field select{
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 12px;
          font-family: inherit;
          font-size: 14px;
          outline: none;
          background: white;
          color: var(--text);
        }

        .bp-search{
          display:flex;
          align-items:center;
          gap: 10px;
          border: 1px solid var(--border);
          background: #fff;
          border-radius: 14px;
          padding: 10px 12px;
        }
        .bp-search svg{ color: #94a3b8; }
        .bp-search input{
          border: none;
          outline: none;
          flex: 1;
          font-size: 14px;
          font-family: inherit;
          color: var(--text);
        }
        .bp-clear{
          border:none;
          background: rgba(15,23,42,0.04);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 6px;
          cursor: pointer;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .bp-clear:hover{ background: rgba(15,23,42,0.06); }

        .bp-stats{
          display:grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        .bp-stat{
          border: 1px solid var(--border);
          background: rgba(15, 23, 42, 0.02);
          border-radius: 14px;
          padding: 10px 10px;
          display:flex;
          flex-direction:column;
          gap: 4px;
        }
        .bp-statAccent{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
        }
        .bp-statLabel{
          font-size: 11px;
          color: var(--muted);
          font-weight: 700;
        }
        .bp-statValue{
          font-size: 18px;
          font-weight: 900;
          color: var(--text);
          letter-spacing: -0.02em;
        }

        .bp-chipRow{
          margin-top: 12px;
          display:flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .bp-chip{
          border: 1px solid var(--border);
          background: var(--card);
          border-radius: 999px;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
          color: var(--text);
        }
        .bp-chip:hover{
          border-color: rgba(37, 99, 235, 0.25);
          background: rgba(37, 99, 235, 0.06);
        }
        .bp-chip.active{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
          color: #1d4ed8;
        }

        .bp-grid{
          display:grid;
          grid-template-columns: 1fr 1.6fr;
          gap: 16px;
        }

        .bp-panel{
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          overflow: hidden;
        }
        .bp-panelBig{ min-height: 520px; }

        .bp-panelHeader{
          display:flex;
          align-items:center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          background: rgba(15, 23, 42, 0.02);
        }
        .bp-panelHeaderLeft{
          display:flex;
          align-items:center;
          gap: 10px;
          color: var(--text);
          font-weight: 900;
        }
        .bp-panelTitle{ font-size: 13px; }
        .bp-panelMeta{
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
        }

        .bp-panelBody{
          padding: 12px;
          max-height: calc(100vh - 320px);
          overflow: auto;
        }

        .bp-bldCard{ margin-bottom: 10px; }
        .bp-bldHead{
          width: 100%;
          display:flex;
          align-items:center;
          gap: 12px;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: #fff;
          cursor: pointer;
          text-align: left;
        }
        .bp-bldHead:hover{
          border-color: rgba(37, 99, 235, 0.25);
          background: rgba(37,99,235,0.03);
        }
        .bp-bldHead.selected{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
        }
        .bp-bldIcon{
          width: 40px;
          height: 40px;
          border-radius: 14px;
          display:flex;
          align-items:center;
          justify-content:center;
          background: rgba(37,99,235,0.10);
          color: #1d4ed8;
          flex-shrink: 0;
        }
        .bp-bldInfo{ flex: 1; min-width: 0; }
        .bp-bldName{
          font-weight: 900;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bp-bldSub{
          display:flex;
          align-items:center;
          gap: 8px;
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
          margin-top: 2px;
        }
        .bp-dotSmall{ opacity: .55; }
        .bp-bldChevron{ color: #64748b; }

        .bp-aptList{
          padding: 10px 10px 0 10px;
          display:flex;
          flex-direction:column;
          gap: 8px;
        }
        .bp-aptItem{
          width: 100%;
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
          border: 1px solid var(--border);
          background: #fff;
          border-radius: 14px;
          padding: 10px 12px;
          cursor: pointer;
          text-align: left;
        }
        .bp-aptItem:hover{
          border-color: rgba(37, 99, 235, 0.25);
          background: rgba(37,99,235,0.03);
        }
        .bp-aptItem.selected{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
        }
        .bp-aptItem.reserved{
          background: var(--warnBg);
          border-color: rgba(180, 83, 9, 0.25);
        }
        .bp-aptLeft{
          display:flex;
          align-items:center;
          gap: 10px;
          color: var(--text);
          font-weight: 800;
          min-width: 0;
        }
        .bp-aptText{
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bp-aptStar{ color: #f59e0b; }
        .bp-floorBadge{
          font-size: 11px;
          color: var(--muted);
          font-weight: 800;
          background: rgba(15,23,42,0.04);
          border: 1px solid var(--border);
          padding: 4px 10px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .bp-workHeader{
          padding: 16px 16px 0 16px;
        }
        .bp-workHeaderTop{
          display:flex;
          align-items:flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .bp-workTitleLine{
          display:flex;
          align-items:center;
          gap: 10px;
        }
        .bp-workH{
          font-size: 18px;
          font-weight: 950;
          color: var(--text);
          letter-spacing: -0.02em;
        }
        .bp-viewPill{
          display:inline-flex;
          align-items:center;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(180, 83, 9, 0.14);
          border: 1px solid rgba(180, 83, 9, 0.25);
          color: #92400e;
          font-weight: 900;
          font-size: 12px;
          white-space: nowrap;
        }
        .bp-breadcrumb{
          margin-top: 6px;
          display:flex;
          align-items:center;
          gap: 8px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        .bp-reservedBadge{
          display:inline-flex;
          align-items:center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: var(--warnBg);
          border: 1px solid rgba(180, 83, 9, 0.25);
          color: var(--warn);
          font-weight: 900;
          font-size: 12px;
        }

        .bp-swapBanner{
          display:flex;
          align-items:center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 14px;
          background: var(--primary2);
          border: 1px solid rgba(37, 99, 235, 0.25);
          color: #1d4ed8;
          font-weight: 900;
          font-size: 13px;
          white-space: nowrap;
        }
        .bp-swapLeft{
          display:flex;
          align-items:center;
          gap: 8px;
        }
        .bp-swapCancel{
          border: none;
          background: rgba(255,255,255,0.85);
          border: 1px solid rgba(37, 99, 235, 0.25);
          color: #1d4ed8;
          padding: 8px 10px;
          border-radius: 12px;
          cursor:pointer;
          font-weight: 950;
        }
        .bp-swapCancel:hover{ background: #fff; }

        .bp-workBody{ padding: 16px; }
        .bp-roomsGrid{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .bp-roomCard{
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: #fff;
          overflow:hidden;
          box-shadow: 0 2px 10px rgba(15,23,42,0.05);
        }
        .bp-roomCard.full{
          outline: 2px solid rgba(185, 28, 28, 0.15);
        }
        .bp-roomCard.viewOnly{
          opacity: 0.92;
        }

        .bp-roomTop{
          display:flex;
          align-items:flex-start;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px 10px 12px;
          border-bottom: 1px solid var(--border);
          background: rgba(15, 23, 42, 0.02);
        }
        .bp-roomTitle{ display:flex; flex-direction:column; gap: 2px; }
        .bp-roomName{
          font-weight: 950;
          color: var(--text);
          letter-spacing: -0.01em;
        }
        .bp-roomCap{
          font-size: 12px;
          color: var(--muted);
          font-weight: 800;
        }

        .bp-addBtn{
          display:inline-flex;
          align-items:center;
          gap: 8px;
          border: 1px solid rgba(37, 99, 235, 0.25);
          background: rgba(37,99,235,0.06);
          color: #1d4ed8;
          padding: 9px 10px;
          border-radius: 14px;
          cursor:pointer;
          font-weight: 900;
          white-space: nowrap;
        }
        .bp-addBtn:hover{ background: rgba(37,99,235,0.10); }
        .bp-addBtnText{ font-size: 13px; }
        .bp-addBtn:disabled{
          opacity: 0.55;
          cursor: not-allowed;
        }

        .bp-meter{
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px 0 12px;
        }
        .bp-meterTrack{
          height: 8px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.08);
          flex: 1;
          overflow:hidden;
        }
        .bp-meterFill{
          height: 100%;
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.65);
        }
        .bp-meterText{
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
          width: 44px;
          text-align: right;
        }

        .bp-roomBody{
          padding: 12px;
          min-height: 90px;
        }

        .bp-studentRow{
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 10px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(15, 23, 42, 0.02);
          margin-bottom: 10px;
          cursor: grab;
        }
        .bp-studentRow.viewOnly{
          cursor: default;
        }
        .bp-studentRow:active{ cursor: grabbing; }
        .bp-studentRow:hover{ background: rgba(37,99,235,0.04); border-color: rgba(37, 99, 235, 0.18); }
        .bp-studentRow.swapSelected{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
        }

        .bp-studentLeft{
          display:flex;
          align-items:center;
          gap: 10px;
          min-width: 0;
        }
        .bp-avatar{
          width: 28px;
          height: 28px;
          border-radius: 10px;
          display:flex;
          align-items:center;
          justify-content:center;
          background: rgba(37,99,235,0.10);
          color: #1d4ed8;
          flex-shrink: 0;
        }
        .bp-studentName{
          font-weight: 900;
          color: var(--text);
          white-space: nowrap;
          overflow:hidden;
          text-overflow: ellipsis;
        }

        .bp-studentActions{
          display:flex;
          align-items:center;
          gap: 8px;
          flex-shrink: 0;
        }
        .bp-iconBtn{
          border: 1px solid rgba(15,23,42,0.10);
          background: #fff;
          color: #334155;
          border-radius: 12px;
          padding: 7px;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .bp-iconBtn:hover{
          border-color: rgba(37, 99, 235, 0.25);
          background: rgba(37,99,235,0.06);
          color: #1d4ed8;
        }
        .bp-iconBtn.danger:hover{
          border-color: rgba(185, 28, 28, 0.25);
          background: var(--dangerBg);
          color: var(--danger);
        }
        .bp-iconBtn:disabled{
          opacity: 0.55;
          cursor: not-allowed;
        }

        .bp-emptyDrop{
          display:flex;
          flex-direction:column;
          gap: 6px;
          padding: 10px;
          border-radius: 14px;
          border: 1px dashed rgba(15,23,42,0.18);
          background: rgba(15,23,42,0.015);
        }
        .bp-emptyTop{
          font-weight: 900;
          color: #64748b;
        }
        .bp-emptySub{
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
        }

        .bp-emptyState{
          height: 100%;
          min-height: 520px;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          gap: 12px;
          padding: 24px;
          text-align:center;
        }
        .bp-emptyIcon{
          width: 78px;
          height: 78px;
          border-radius: 24px;
          background: rgba(37,99,235,0.10);
          color: #1d4ed8;
          display:flex;
          align-items:center;
          justify-content:center;
          border: 1px solid rgba(37, 99, 235, 0.20);
        }
        .bp-emptyText{
          font-size: 16px;
          font-weight: 950;
          color: var(--text);
        }
        .bp-emptySubText{
          max-width: 520px;
          color: var(--muted);
          font-weight: 700;
          font-size: 13px;
        }

        .bp-modalBackdrop{
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          display:flex;
          align-items:center;
          justify-content:center;
          z-index: 50;
          padding: 18px;
        }
        .bp-modal{
          width: 600px;
          max-width: 96vw;
          background: #fff;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 25px 80px rgba(0,0,0,0.35);
          overflow:hidden;
        }
        .bp-modalHeader{
          display:flex;
          align-items:center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          background: rgba(15, 23, 42, 0.02);
        }
        .bp-modalTitle{
          display:flex;
          align-items:center;
          gap: 10px;
          color: var(--text);
        }
        .bp-modalTitle h4{
          margin:0;
          font-size: 15px;
          font-weight: 950;
        }
        .bp-closeBtn{
          border: 1px solid var(--border);
          background: #fff;
          border-radius: 12px;
          padding: 7px;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .bp-closeBtn:hover{ background: rgba(15,23,42,0.04); }

        .bp-modalSearch{
          display:flex;
          align-items:center;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
        }
        .bp-modalSearch input{
          flex: 1;
          border:none;
          outline:none;
          font-family: inherit;
          font-size: 14px;
          color: var(--text);
        }

        .bp-modalList{
          max-height: 420px;
          overflow:auto;
          padding: 12px;
        }

        .bp-modalItem{
          width: 100%;
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px;
          border-radius: 16px;
          border: 1px solid var(--border);
          background: #fff;
          cursor:pointer;
          margin-bottom: 10px;
          text-align:left;
        }
        .bp-modalItem:hover{
          border-color: rgba(37, 99, 235, 0.25);
          background: rgba(37,99,235,0.03);
        }
        .bp-modalItem.active{
          background: var(--primary2);
          border-color: rgba(37, 99, 235, 0.25);
        }
        .bp-modalItem.disabled{
          opacity: 0.6;
          cursor:not-allowed;
        }
        .bp-modalItemLeft{
          display:flex;
          align-items:center;
          gap: 10px;
          min-width: 0;
        }
        .bp-modalRoom{
          font-size: 13px;
          font-weight: 800;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bp-modalCap{
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
          white-space: nowrap;
        }
        .bp-modalChevron{
          font-weight: 950;
          color: #1d4ed8;
          opacity: 0.9;
        }
        .bp-modalEmpty{
          padding: 18px;
          color: var(--muted);
          font-weight: 800;
        }

        .bp-modalFooter{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap: 10px;
          padding: 12px 16px;
          border-top: 1px solid var(--border);
          background: rgba(15, 23, 42, 0.02);
        }
        .bp-btn{
          border:none;
          cursor:pointer;
          border-radius: 14px;
          padding: 10px 14px;
          font-weight: 950;
          font-family: inherit;
        }
        .bp-btn.secondary{
          background: #fff;
          border: 1px solid var(--border);
          color: var(--text);
        }
        .bp-btn.secondary:hover{
          border-color: rgba(37, 99, 235, 0.25);
          background: rgba(37,99,235,0.03);
        }
        .bp-btn.primary{
          background: rgba(37, 99, 235, 0.95);
          color: #fff;
        }
        .bp-btn.primary:hover:enabled{ filter: brightness(0.95); }
        .bp-btn.primary:disabled{ opacity: 0.6; cursor:not-allowed; }

        @media (max-width: 1120px){
          .bp-controls{ grid-template-columns: 1fr; }
          .bp-selectGrid{ grid-template-columns: 1fr; }
          .bp-stats{ grid-template-columns: repeat(3, minmax(0,1fr)); }
        }
        @media (max-width: 980px){
          .bp-grid{ grid-template-columns: 1fr; }
          .bp-panelBody{ max-height: unset; }
          .bp-roomsGrid{ grid-template-columns: 1fr; }
          .bp-titleRow{ flex-direction: column; align-items:flex-start; }
          .bp-contextPills{ justify-content:flex-start; }
        }
      `}</style>
    </div>
  );
}

export default BuildingsPage;