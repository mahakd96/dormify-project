import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { allocationAPI } from '../services/api';
import {
  AlertTriangle,
  ArrowRight,
  BedDouble,
  Building2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  DoorOpen,
  Info,
  MapPin,
  Sparkles,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';

/* =========================================================
   General helpers
   ========================================================= */

const getValue = (item, keys) => {
  for (const key of keys) {
    const value = item?.[key];

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
};

const extractNumber = (value) => {
  if (value === undefined || value === null) {
    return 0;
  }

  const match = String(value).match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
};

const getBuilding = (item) =>
  getValue(item, [
    'building_number',
    'building_name',
    'building',
  ]);

const getApartment = (item) =>
  getValue(item, [
    'apartment_number',
    'apartment',
  ]);

const getRoom = (item) =>
  getValue(item, [
    'room_number',
    'room_name',
    'room',
  ]);

const getBed = (item) =>
  getValue(item, [
    'bed_number',
    'bed_label',
    'bed',
  ]);

const sortByLocation = (items) =>
  [...items].sort((a, b) => {
    const dormTypeComparison = String(
      a?.dorm_type || ''
    ).localeCompare(
      String(b?.dorm_type || ''),
      'he',
      { numeric: true }
    );

    if (dormTypeComparison !== 0) {
      return dormTypeComparison;
    }

    const buildingComparison =
      extractNumber(getBuilding(a)) -
      extractNumber(getBuilding(b));

    if (buildingComparison !== 0) {
      return buildingComparison;
    }

    const apartmentComparison =
      extractNumber(getApartment(a)) -
      extractNumber(getApartment(b));

    if (apartmentComparison !== 0) {
      return apartmentComparison;
    }

    const roomComparison =
      extractNumber(getRoom(a)) -
      extractNumber(getRoom(b));

    if (roomComparison !== 0) {
      return roomComparison;
    }

    return (
      extractNumber(getBed(a)) -
      extractNumber(getBed(b))
    );
  });

const sortEntries = (object, numeric = false) =>
  Object.entries(object || {}).sort(([keyA], [keyB]) => {
    if (numeric) {
      return extractNumber(keyA) - extractNumber(keyB);
    }

    return String(keyA).localeCompare(
      String(keyB),
      'he',
      { numeric: true }
    );
  });

/* =========================================================
   Hierarchy construction
   Dorm type → Building → Apartment → Room
   ========================================================= */

const createDormTypeNode = (name) => ({
  name,
  assignments: [],
  availableBeds: [],
  buildings: {},
});

const createBuildingNode = (number) => ({
  number,
  assignments: [],
  availableBeds: [],
  apartments: {},
});

const createApartmentNode = (number) => ({
  number,
  apartmentType: '',
  apartmentTypeDisplay: '',
  apartmentCategory: '',
  apartmentCategoryDisplay: '',
  assignments: [],
  availableBeds: [],
  rooms: {},
});

const createRoomNode = (name) => ({
  name,
  assignments: [],
  availableBeds: [],
});

const buildAllocationHierarchy = (
  assignments,
  availableBeds
) => {
  const hierarchy = {};

  const ensurePath = (item) => {
    const dormTypeName =
      item?.dorm_type || 'ללא סוג מעונות';

    const buildingNumber = String(
      getBuilding(item) || 'ללא בניין'
    );

    const apartmentNumber = String(
      getApartment(item) || 'ללא דירה'
    );

    const roomName = String(
      getRoom(item) || 'ללא חדר'
    );

    if (!hierarchy[dormTypeName]) {
      hierarchy[dormTypeName] =
        createDormTypeNode(dormTypeName);
    }

    const dormNode = hierarchy[dormTypeName];

    if (!dormNode.buildings[buildingNumber]) {
      dormNode.buildings[buildingNumber] =
        createBuildingNode(buildingNumber);
    }

    const buildingNode =
      dormNode.buildings[buildingNumber];

    if (!buildingNode.apartments[apartmentNumber]) {
      buildingNode.apartments[apartmentNumber] =
        createApartmentNode(apartmentNumber);
    }

    const apartmentNode =
  buildingNode.apartments[apartmentNumber];

if (!apartmentNode.apartmentType) {
  apartmentNode.apartmentType =
    item?.apartment_type || '';

  apartmentNode.apartmentTypeDisplay =
    item?.apartment_type_display ||
    item?.apartment_type ||
    '';

  apartmentNode.apartmentCategory =
    item?.apartment_category || '';

  apartmentNode.apartmentCategoryDisplay =
    item?.apartment_category_display ||
    item?.apartment_category ||
    '';
}

if (!apartmentNode.rooms[roomName]) {
      apartmentNode.rooms[roomName] =
        createRoomNode(roomName);
    }

    return {
      dormNode,
      buildingNode,
      apartmentNode,
      roomNode: apartmentNode.rooms[roomName],
    };
  };

  sortByLocation(assignments).forEach((assignment) => {
    const {
      dormNode,
      buildingNode,
      apartmentNode,
      roomNode,
    } = ensurePath(assignment);

    dormNode.assignments.push(assignment);
    buildingNode.assignments.push(assignment);
    apartmentNode.assignments.push(assignment);
    roomNode.assignments.push(assignment);
  });

  sortByLocation(availableBeds).forEach((bed) => {
    const {
      dormNode,
      buildingNode,
      apartmentNode,
      roomNode,
    } = ensurePath(bed);

    dormNode.availableBeds.push(bed);
    buildingNode.availableBeds.push(bed);
    apartmentNode.availableBeds.push(bed);
    roomNode.availableBeds.push(bed);
  });

  return hierarchy;
};

/* =========================================================
   Component
   ========================================================= */

function AllocationResultsPage({ language = 'he' }) {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    result: routeResult = null,
    summary = null,
    region = null,
    generatedAt = null,
  } = location.state || {};

  const [activeView, setActiveView] =
    useState('assigned');

  const [openDormTypes, setOpenDormTypes] =
    useState({});

  const [openBuildings, setOpenBuildings] =
    useState({});

  const [openApartments, setOpenApartments] =
    useState({});

  const [openRooms, setOpenRooms] =
    useState({});

  const [resultsLoading, setResultsLoading] =
    useState(true);

  const [resultsError, setResultsError] =
    useState(null);

  const [serverResult, setServerResult] = useState(
    routeResult || {
      assignments: [],
      unassigned_students: [],
      available_beds: [],
      counts: {
        assigned: 0,
        unassigned: 0,
        available_beds: 0,
      },
      successful_assignments: 0,
      roommate_matches: 0,
      conflicts: 0,
    }
  );

  const result = serverResult || {
    assignments: [],
    unassigned_students: [],
    available_beds: [],
    counts: {
      assigned: 0,
      unassigned: 0,
      available_beds: 0,
    },
    successful_assignments: 0,
    roommate_matches: 0,
    conflicts: 0,
  };

  /* =======================================================
     Translations
     ======================================================= */

  const t = useMemo(() => {
    const translations = {
      he: {
        title: 'תוצאות השיבוץ',
        subtitle:
          'תוצאות השיבוץ השמורות במערכת לפי אזור המשתמש',
        backToAllocation: 'חזרה לעמוד השיבוץ',
        lastAllocationAt: 'מועד השיבוץ האחרון',
        runHighlights: 'תוצאות מהמערכת',

        assignedStudentsView: 'סטודנטים משובצים',
        unassignedStudentsView: 'סטודנטים שלא שובצו',
        availableBedsView: 'מיטות פנויות',

        assignmentsTitle: 'שיבוצים מפורטים',
        unassignedTitle: 'סטודנטים שלא שובצו',
        availableBedsTitle: 'מיטות שנשארו פנויות',

        noAssignmentsTable:
          'אין תוצאות שיבוץ להצגה',
        noUnassignedStudents:
          'אין סטודנטים שלא שובצו',
        noAvailableBeds:
          'אין מיטות פנויות להצגה',

        student: 'סטודנט',
        studentId: 'מספר סטודנט',
        gender: 'מגדר',
        housingType: 'סוג דיור',
        acceptedDormType: 'סוג מעונות מאושר',
        religion: 'דת',
        religiousLevel: 'דתיות',
        sector: 'מגזר',
        priority: 'עדיפות',
        specialStatuses: 'סטטוסים מיוחדים',
        reason: 'סיבה',

        dormType: 'סוג מעונות',
        apartmentType: 'סוג דירה',
        category: 'קטגוריה',
        reserved: 'שמורה',

        building: 'בניין',
        apartment: 'דירה',
        room: 'חדר',
        bed: 'מיטה',
        status: 'סטטוס',

        buildingsCount: 'בניינים',
        apartmentsCount: 'דירות',
        roomsCount: 'חדרים',
        assignedCount: 'משובצים',
        availableBedsCount: 'מיטות פנויות',
        occupiedBedsCount: 'מיטות תפוסות',

        full: 'מלא',
        hasAvailability: 'יש מקום פנוי',
        empty: 'ריק',

        availableBed: 'מיטה פנויה',
        noStudentsInRoom:
          'אין סטודנטים משובצים בחדר זה',

        yes: 'כן',
        no: 'לא',

        loadingResults: 'טוען תוצאות...',
        errorLoadingResults:
          'שגיאה בטעינת תוצאות השיבוץ',
      },

      en: {
        title: 'Allocation Results',
        subtitle:
          'Saved allocation results according to the user region',
        backToAllocation: 'Back to Allocation',
        lastAllocationAt: 'Last Allocation',
        runHighlights: 'System Results',

        assignedStudentsView: 'Assigned Students',
        unassignedStudentsView: 'Unassigned Students',
        availableBedsView: 'Available Beds',

        assignmentsTitle: 'Detailed Assignments',
        unassignedTitle: 'Unassigned Students',
        availableBedsTitle: 'Available Beds',

        noAssignmentsTable:
          'No assignment results to display',
        noUnassignedStudents:
          'No unassigned students',
        noAvailableBeds:
          'No available beds to display',

        student: 'Student',
        studentId: 'Student ID',
        gender: 'Gender',
        housingType: 'Housing Type',
        acceptedDormType: 'Accepted Dorm Type',
        religion: 'Religion',
        religiousLevel: 'Religious Preference',
        sector: 'Sector',
        priority: 'Priority',
        specialStatuses: 'Special Statuses',
        reason: 'Reason',

        dormType: 'Dorm Type',
        apartmentType: 'Apartment Type',
        category: 'Category',
        reserved: 'Reserved',

        building: 'Building',
        apartment: 'Apartment',
        room: 'Room',
        bed: 'Bed',
        status: 'Status',

        buildingsCount: 'buildings',
        apartmentsCount: 'apartments',
        roomsCount: 'rooms',
        assignedCount: 'assigned',
        availableBedsCount: 'available beds',
        occupiedBedsCount: 'occupied beds',

        full: 'Full',
        hasAvailability: 'Available',
        empty: 'Empty',

        availableBed: 'Available bed',
        noStudentsInRoom:
          'No students assigned to this room',

        yes: 'Yes',
        no: 'No',

        loadingResults: 'Loading results...',
        errorLoadingResults:
          'Error loading allocation results',
      },
    };

    return translations[language] || translations.en;
  }, [language]);

  /* =======================================================
     Load results
     ======================================================= */

  useEffect(() => {
    let isMounted = true;

    const loadResults = async () => {
      setResultsLoading(true);
      setResultsError(null);

      try {
        const regionId =
          region?.id ||
          summary?.region?.id ||
          summary?.region_id ||
          null;

        const responseRaw = regionId
          ? await allocationAPI.getResults(regionId)
          : await allocationAPI.getResults();

        const data = responseRaw?.data || responseRaw;

        const assignmentsFromDb =
          Array.isArray(data?.assignments)
            ? data.assignments
            : [];

        const unassignedFromDb =
          Array.isArray(data?.unassigned_students)
            ? data.unassigned_students
            : [];

        const availableBedsFromDb =
          Array.isArray(data?.available_beds)
            ? data.available_beds
            : [];

        const counts = {
          assigned:
            Number(
              data?.counts?.assigned ??
                data?.count ??
                assignmentsFromDb.length
            ) || 0,

          unassigned:
            Number(
              data?.counts?.unassigned ??
                unassignedFromDb.length
            ) || 0,

          available_beds:
            Number(
              data?.counts?.available_beds ??
                availableBedsFromDb.length
            ) || 0,
        };

        if (!isMounted) {
          return;
        }

        setServerResult({
          ...(routeResult || {}),
          assignments: assignmentsFromDb,
          unassigned_students: unassignedFromDb,
          available_beds: availableBedsFromDb,
          counts,
          successful_assignments: counts.assigned,
          roommate_matches:
            Number(routeResult?.roommate_matches) || 0,
          conflicts: counts.unassigned,
        });
      } catch (error) {
        console.error(
          'Failed to load allocation results:',
          error
        );

        if (!isMounted) {
          return;
        }

        setResultsError(
          error?.response?.data?.error ||
            error?.message ||
            t.errorLoadingResults
        );
      } finally {
        if (isMounted) {
          setResultsLoading(false);
        }
      }
    };

    loadResults();

    return () => {
      isMounted = false;
    };
  }, [
    region?.id,
    summary?.region?.id,
    summary?.region_id,
    routeResult,
    t.errorLoadingResults,
  ]);

  /* =======================================================
     Derived data
     ======================================================= */

  const assignments = Array.isArray(result.assignments)
    ? result.assignments
    : [];

  const unassignedStudents = Array.isArray(
    result.unassigned_students
  )
    ? result.unassigned_students
    : [];

  const availableBeds = Array.isArray(
    result.available_beds
  )
    ? result.available_beds
    : [];

  const counts = {
    assigned:
      Number(
        result?.counts?.assigned ??
          result?.successful_assignments ??
          assignments.length
      ) || 0,

    unassigned:
      Number(
        result?.counts?.unassigned ??
          result?.conflicts ??
          unassignedStudents.length
      ) || 0,

    available_beds:
      Number(
        result?.counts?.available_beds ??
          availableBeds.length
      ) || 0,
  };

  const allocationHierarchy = useMemo(
    () =>
      buildAllocationHierarchy(
        assignments,
        availableBeds
      ),
    [assignments, availableBeds]
  );

  const latestAssignmentDate = assignments.reduce(
  (latestDate, assignment) => {
    if (!assignment?.assigned_at) {
      return latestDate;
    }

    const currentDate = new Date(
      assignment.assigned_at
    );

    if (
      Number.isNaN(currentDate.getTime())
    ) {
      return latestDate;
    }

    if (
      !latestDate ||
      currentDate > latestDate
    ) {
      return currentDate;
    }

    return latestDate;
  },
  null
);

const lastAllocationDate =
  result?.run?.completed_at ||
  summary?.latest_run?.completed_at ||
  result?.run?.started_at ||
  summary?.latest_run?.started_at ||
  latestAssignmentDate ||
  generatedAt ||
  null;

const formattedLastAllocationDate =
  lastAllocationDate
    ? new Date(
        lastAllocationDate
      ).toLocaleString(
        language === 'he'
          ? 'he-IL'
          : 'en-US'
      )
    : '-';

  /* =======================================================
     Interaction helpers
     ======================================================= */

  const toggleItem = (setter, key) => {
    setter((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  };

  const getAvailabilityStatus = (
    assignedCount,
    availableCount
  ) => {
    if (assignedCount === 0 && availableCount > 0) {
      return {
        label: t.empty,
        className: 'empty',
      };
    }

    if (availableCount > 0) {
      return {
        label: t.hasAvailability,
        className: 'available',
      };
    }

    return {
      label: t.full,
      className: 'full',
    };
  };

  const goBack = () => {
    navigate('/allocation');
  };

  /* =======================================================
     Assigned students hierarchy
     ======================================================= */

  const renderAssignedStudents = () => {
    if (assignments.length === 0) {
      return (
        <div className="empty-state">
          <Info size={18} />
          <span>{t.noAssignmentsTable}</span>
        </div>
      );
    }

    return (
      <div className="hierarchy-list">
        {sortEntries(allocationHierarchy).map(
          ([dormTypeName, dormNode]) => {
            const dormKey = dormTypeName;
            const dormIsOpen =
              Boolean(openDormTypes[dormKey]);

            return (
              <div
                className="hierarchy-card dorm-card"
                key={dormKey}
              >
                <button
                  type="button"
                  className="hierarchy-row dorm-row"
                  onClick={() =>
                    toggleItem(
                      setOpenDormTypes,
                      dormKey
                    )
                  }
                >
                  <div className="hierarchy-main">
                    <span className="chevron">
                      {dormIsOpen ? (
                        <ChevronDown size={18} />
                      ) : (
                        <ChevronLeft size={18} />
                      )}
                    </span>

                    <span className="hierarchy-icon dorm-icon">
                      <Building2 size={19} />
                    </span>

                    <div>
                      <div className="hierarchy-title dorm-title">
                        {dormTypeName}
                      </div>

                      <div className="hierarchy-subtitle">
                        {
                          Object.keys(
                            dormNode.buildings
                          ).length
                        }{' '}
                        {t.buildingsCount}
                      </div>
                    </div>
                  </div>

                  <div className="hierarchy-counts">
                    <span className="count-chip assigned">
                      {dormNode.assignments.length}{' '}
                      {t.assignedCount}
                    </span>

                    <span className="count-chip available">
                      {dormNode.availableBeds.length}{' '}
                      {t.availableBedsCount}
                    </span>
                  </div>
                </button>

                {dormIsOpen && (
                  <div className="hierarchy-children dorm-children">
                    {sortEntries(
                      dormNode.buildings,
                      true
                    ).map(
                      ([
                        buildingNumber,
                        buildingNode,
                      ]) => {
                        const buildingKey =
                          `${dormKey}::${buildingNumber}`;

                        const buildingIsOpen =
                          Boolean(
                            openBuildings[buildingKey]
                          );

                        return (
                          <div
                            className="hierarchy-card building-card"
                            key={buildingKey}
                          >
                            <button
                              type="button"
                              className="hierarchy-row building-row"
                              onClick={() =>
                                toggleItem(
                                  setOpenBuildings,
                                  buildingKey
                                )
                              }
                            >
                              <div className="hierarchy-main">
                                <span className="chevron">
                                  {buildingIsOpen ? (
                                    <ChevronDown
                                      size={17}
                                    />
                                  ) : (
                                    <ChevronLeft
                                      size={17}
                                    />
                                  )}
                                </span>

                                <span className="hierarchy-icon building-icon">
                                  <Building2 size={18} />
                                </span>

                                <div>
                                  <div className="hierarchy-title">
                                    {t.building}{' '}
                                    {buildingNumber}
                                  </div>

                                  <div className="hierarchy-subtitle">
                                    {
                                      Object.keys(
                                        buildingNode
                                          .apartments
                                      ).length
                                    }{' '}
                                    {t.apartmentsCount}
                                  </div>
                                </div>
                              </div>

                              <div className="hierarchy-counts">
                                <span className="count-chip assigned">
                                  {
                                    buildingNode
                                      .assignments.length
                                  }{' '}
                                  {t.assignedCount}
                                </span>

                                <span className="count-chip available">
                                  {
                                    buildingNode
                                      .availableBeds.length
                                  }{' '}
                                  {t.availableBedsCount}
                                </span>
                              </div>
                            </button>

                            {buildingIsOpen && (
                              <div className="hierarchy-children building-children">
                                {sortEntries(
                                  buildingNode.apartments,
                                  true
                                ).map(
                                  ([
                                    apartmentNumber,
                                    apartmentNode,
                                  ]) => {
                                    const apartmentKey =
                                      `${buildingKey}::${apartmentNumber}`;

                                    const apartmentIsOpen =
                                      Boolean(
                                        openApartments[
                                          apartmentKey
                                        ]
                                      );

                                    const apartmentStatus =
                                      getAvailabilityStatus(
                                        apartmentNode
                                          .assignments.length,
                                        apartmentNode
                                          .availableBeds
                                          .length
                                      );

                                    return (
                                      <div
                                        className="hierarchy-card apartment-card"
                                        key={apartmentKey}
                                      >
                                        <button
                                          type="button"
                                          className="hierarchy-row apartment-row"
                                          onClick={() =>
                                            toggleItem(
                                              setOpenApartments,
                                              apartmentKey
                                            )
                                          }
                                        >
                                          <div className="hierarchy-main">
                                            <span className="chevron">
                                              {apartmentIsOpen ? (
                                                  <ChevronDown
                                                      size={16}
                                                  />
                                              ) : (
                                                  <ChevronLeft
                                                      size={16}
                                                  />
                                              )}
                                            </span>

                                            <span className="hierarchy-icon apartment-icon">
  <DoorOpen size={17}/>
</span>

                                            <div>
                                              <div className="hierarchy-title apartment-title-row">
    <span>
      {t.apartment} {apartmentNumber}
    </span>

                                                {(apartmentNode.apartmentTypeDisplay ||
                                                    apartmentNode.apartmentCategoryDisplay) && (
                                                    <span className="apartment-type-chip">
        {apartmentNode.apartmentTypeDisplay ||
            apartmentNode.apartmentCategoryDisplay}
      </span>
                                                )}
                                              </div>

                                              <div className="hierarchy-subtitle">
                                                {Object.keys(apartmentNode.rooms).length}{' '}
                                                {t.roomsCount}
                                              </div>
                                            </div>
                                            <span
                                                className={`availability-state ${apartmentStatus.className}`}
                                            >
                                              {
                                                apartmentStatus.label
                                              }
                                            </span>

                                            <span className="count-chip assigned">
                                              {
                                                apartmentNode
                                                    .assignments
                                                    .length
                                              }{' '}
                                              {t.assignedCount}
                                            </span>

                                            <span className="count-chip available">
                                              {
                                                apartmentNode
                                                    .availableBeds
                                                    .length
                                              }{' '}
                                              {
                                                t.availableBedsCount
                                              }
                                            </span>
                                          </div>
                                        </button>

                                        {apartmentIsOpen && (
                                            <div className="hierarchy-children apartment-children">
                                              {sortEntries(
                                                  apartmentNode.rooms,
                                              true
                                            ).map(
                                              ([
                                                roomName,
                                                roomNode,
                                              ]) => {
                                                const roomKey =
                                                  `${apartmentKey}::${roomName}`;

                                                const roomIsOpen =
                                                  Boolean(
                                                    openRooms[
                                                      roomKey
                                                    ]
                                                  );

                                                const roomStatus =
                                                  getAvailabilityStatus(
                                                    roomNode
                                                      .assignments
                                                      .length,
                                                    roomNode
                                                      .availableBeds
                                                      .length
                                                  );

                                                return (
                                                  <div
                                                    className="room-card"
                                                    key={roomKey}
                                                  >
                                                    <button
                                                      type="button"
                                                      className="hierarchy-row room-row"
                                                      onClick={() =>
                                                        toggleItem(
                                                          setOpenRooms,
                                                          roomKey
                                                        )
                                                      }
                                                    >
                                                      <div className="hierarchy-main">
                                                        <span className="chevron">
                                                          {roomIsOpen ? (
                                                            <ChevronDown
                                                              size={
                                                                15
                                                              }
                                                            />
                                                          ) : (
                                                            <ChevronLeft
                                                              size={
                                                                15
                                                              }
                                                            />
                                                          )}
                                                        </span>

                                                        <div>
                                                          <div className="hierarchy-title room-title">
                                                            {
                                                              t.room
                                                            }{' '}
                                                            {
                                                              roomName
                                                            }
                                                          </div>

                                                          <div className="hierarchy-subtitle">
                                                            {
                                                              roomNode
                                                                .assignments
                                                                .length
                                                            }{' '}
                                                            {
                                                              t.occupiedBedsCount
                                                            }
                                                          </div>
                                                        </div>
                                                      </div>

                                                      <div className="hierarchy-counts">
                                                        <span
                                                          className={`availability-state ${roomStatus.className}`}
                                                        >
                                                          {
                                                            roomStatus.label
                                                          }
                                                        </span>

                                                        <span className="count-chip assigned">
                                                          {
                                                            roomNode
                                                              .assignments
                                                              .length
                                                          }{' '}
                                                          {
                                                            t.assignedCount
                                                          }
                                                        </span>

                                                        <span className="count-chip available">
                                                          {
                                                            roomNode
                                                              .availableBeds
                                                              .length
                                                          }{' '}
                                                          {
                                                            t.availableBedsCount
                                                          }
                                                        </span>
                                                      </div>
                                                    </button>

                                                    {roomIsOpen && (
                                                      <div className="room-details">
                                                        {roomNode
                                                          .assignments
                                                          .length >
                                                        0 ? (
                                                          <div className="student-grid">
                                                            {roomNode.assignments.map(
                                                              (
                                                                student,
                                                                index
                                                              ) => (
                                                                <div
                                                                  className="student-card"
                                                                  key={`${
                                                                    student?.student_id ||
                                                                    'student'
                                                                  }-${index}`}
                                                                >
                                                                  <div className="student-card-header">
                                                                    <div>
                                                                      <div className="student-name">
                                                                        {student?.student_name ||
                                                                          student?.full_name ||
                                                                          '-'}
                                                                      </div>

                                                                      <div className="student-number">
                                                                        {
                                                                          t.studentId
                                                                        }
                                                                        :{' '}
                                                                        {student?.student_id ||
                                                                          '-'}
                                                                      </div>
                                                                    </div>

                                                                    <span className="table-status">
                                                                      {student?.assignment_status ||
                                                                        student?.status ||
                                                                        'active'}
                                                                    </span>
                                                                  </div>

                                                                  <div className="student-fields">
                                                                    <span>
                                                                      <strong>
                                                                        {
                                                                          t.bed
                                                                        }
                                                                        :
                                                                      </strong>{' '}
                                                                      {getBed(
                                                                        student
                                                                      ) ||
                                                                        '-'}
                                                                    </span>

                                                                    <span>
                                                                      <strong>
                                                                        {
                                                                          t.gender
                                                                        }
                                                                        :
                                                                      </strong>{' '}
                                                                      {student?.gender ||
                                                                        '-'}
                                                                    </span>

                                                                    <span>
                                                                      <strong>
                                                                        {
                                                                          t.religion
                                                                        }
                                                                        :
                                                                      </strong>{' '}
                                                                      {student?.religion_display ||
                                                                        student?.religion ||
                                                                        student?.requested_religion ||
                                                                        '-'}
                                                                    </span>

                                                                    <span>
                                                                      <strong>
                                                                        {
                                                                          t.housingType
                                                                        }
                                                                        :
                                                                      </strong>{' '}
                                                                      {student?.housing_type_display ||
                                                                        student?.housing_type ||
                                                                        '-'}
                                                                    </span>
                                                                  </div>
                                                                </div>
                                                              )
                                                            )}
                                                          </div>
                                                        ) : (
                                                          <div className="room-empty-message">
                                                            <Info
                                                              size={
                                                                16
                                                              }
                                                            />
                                                            <span>
                                                              {
                                                                t.noStudentsInRoom
                                                              }
                                                            </span>
                                                          </div>
                                                        )}

                                                        {roomNode
                                                          .availableBeds
                                                          .length >
                                                          0 && (
                                                          <div className="available-bed-list">
                                                            {roomNode.availableBeds.map(
                                                              (
                                                                bed,
                                                                index
                                                              ) => (
                                                                <span
                                                                  className="available-bed-chip"
                                                                  key={`${
                                                                    bed?.bed_id ||
                                                                    'bed'
                                                                  }-${index}`}
                                                                >
                                                                  <BedDouble
                                                                    size={
                                                                      14
                                                                    }
                                                                  />

                                                                  {
                                                                    t.availableBed
                                                                  }
                                                                  :{' '}
                                                                  {getBed(
                                                                    bed
                                                                  ) ||
                                                                    '-'}
                                                                </span>
                                                              )
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              }
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>
    );
  };

  /* =======================================================
     Unassigned students table
     ======================================================= */

  const renderUnassignedStudents = () => {
    if (unassignedStudents.length === 0) {
      return (
        <div className="empty-state">
          <Info size={18} />
          <span>{t.noUnassignedStudents}</span>
        </div>
      );
    }

    return (
      <div className="table-wrap">
        <table className="results-table unassigned-table">
          <thead>
            <tr>
              <th>{t.student}</th>
              <th>{t.studentId}</th>
              <th>{t.gender}</th>
              <th>{t.housingType}</th>
              <th>{t.acceptedDormType}</th>
              <th>{t.religion}</th>
              <th>{t.religiousLevel}</th>
              <th>{t.sector}</th>
              <th>{t.priority}</th>
              <th>{t.specialStatuses}</th>
              <th>{t.reason}</th>
            </tr>
          </thead>

          <tbody>
            {unassignedStudents.map(
              (student, index) => (
                <tr
                  key={`${
                    student?.student_id ||
                    'unassigned'
                  }-${index}`}
                >
                  <td>
                    {student?.student_name ||
                      student?.full_name ||
                      '-'}
                  </td>

                  <td>
                    {student?.student_id || '-'}
                  </td>

                  <td>
                    {student?.gender_display ||
                      student?.gender ||
                      '-'}
                  </td>

                  <td>
                    {student?.housing_type_display ||
                      student?.housing_type ||
                      '-'}
                  </td>

                  <td>
                    {student?.accepted_dorm_type ||
                      '-'}
                  </td>

                  <td>
                    {student?.religion_display ||
                      student?.requested_religion ||
                      student?.religion ||
                      '-'}
                  </td>

                  <td>
                    {student?.religious || '-'}
                  </td>

                  <td>
                    {student?.placement_sector_display ||
                      student?.placement_sector ||
                      student?.sector ||
                      '-'}
                  </td>

                  <td>
                    <span
                      className={`boolean-chip ${
                        student?.is_priority
                          ? 'active'
                          : ''
                      }`}
                    >
                      {student?.is_priority
                        ? t.yes
                        : t.no}
                    </span>
                  </td>

                  <td>
                    {Array.isArray(
                      student?.special_statuses
                    ) &&
                    student.special_statuses.length > 0
                      ? student.special_statuses.join(
                          ', '
                        )
                      : '-'}
                  </td>

                  <td>
                    {student?.unassigned_reason ||
                      '-'}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    );
  };

  /* =======================================================
     Available beds table
     ======================================================= */

  const renderAvailableBeds = () => {
    if (availableBeds.length === 0) {
      return (
        <div className="empty-state">
          <Info size={18} />
          <span>{t.noAvailableBeds}</span>
        </div>
      );
    }

    return (
      <div className="table-wrap">
        <table className="results-table beds-table">
          <thead>
            <tr>
              <th>{t.region}</th>
              <th>{t.dormType}</th>
              <th>{t.building}</th>
              <th>{t.apartment}</th>
              <th>{t.room}</th>
              <th>{t.bed}</th>
              <th>{t.apartmentType}</th>
              <th>{t.category}</th>
              <th>{t.reserved}</th>
            </tr>
          </thead>

          <tbody>
            {sortByLocation(availableBeds).map(
              (bed, index) => (
                <tr
                  key={`${bed?.bed_id || 'bed'}-${index}`}
                >
                  <td>{bed?.region || '-'}</td>
                  <td>{bed?.dorm_type || '-'}</td>
                  <td>{getBuilding(bed) || '-'}</td>
                  <td>{getApartment(bed) || '-'}</td>
                  <td>{getRoom(bed) || '-'}</td>
                  <td>{getBed(bed) || '-'}</td>

                  <td>
                    {bed?.apartment_type_display ||
                      bed?.apartment_type ||
                      '-'}
                  </td>

                  <td>
                    {bed?.apartment_category_display ||
                      bed?.apartment_category ||
                      '-'}
                  </td>

                  <td>
                    <span
                      className={`boolean-chip ${
                        bed?.is_reserved
                          ? 'reserved'
                          : ''
                      }`}
                    >
                      {bed?.is_reserved
                        ? t.yes
                        : t.no}
                    </span>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const activeTitle =
    activeView === 'assigned'
      ? t.assignmentsTitle
      : activeView === 'unassigned'
        ? t.unassignedTitle
        : t.availableBedsTitle;

  /* =======================================================
     Main render
     ======================================================= */

  return (
    <div
      className="allocation-results-page"
      dir={language === 'he' ? 'rtl' : 'ltr'}
    >
      <div className="results-shell">
        <header className="results-topbar">
          <div>
            <div className="eyebrow">
              <Sparkles size={16}/>
              <span>{t.runHighlights}</span>
            </div>

            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>

          <button
              type="button"
              className="back-button"
              onClick={goBack}
          >
            <ArrowRight size={18}/>
            <span>{t.backToAllocation}</span>
          </button>
        </header>

        <section className="meta-grid single-meta">
          <div className="meta-card">
    <span className="meta-icon purple">
      <Clock3 size={19}/>
    </span>

            <div>
              <div className="meta-label">
                {t.lastAllocationAt}
              </div>

              <div className="meta-value">
                {formattedLastAllocationDate}
              </div>
            </div>
          </div>
        </section>

        <main className="results-panel">
          <div
              className="view-tabs"
              role="tablist"
              aria-label={t.title}
          >
            <button
                type="button"
                className={`view-tab ${
                    activeView === 'assigned'
                        ? 'active assigned'
                        : ''
                }`}
                onClick={() =>
                    setActiveView('assigned')
                }
            >
              <UserCheck size={18}/>
              <span>
                {t.assignedStudentsView}
              </span>
              <strong>{counts.assigned}</strong>
            </button>

            <button
                type="button"
                className={`view-tab ${
                    activeView === 'unassigned'
                        ? 'active unassigned'
                        : ''
                }`}
                onClick={() =>
                    setActiveView('unassigned')
                }
            >
              <UserX size={18}/>
              <span>
                {t.unassignedStudentsView}
              </span>
              <strong>{counts.unassigned}</strong>
            </button>

            <button
                type="button"
                className={`view-tab ${
                    activeView === 'beds'
                        ? 'active beds'
                        : ''
                }`}
                onClick={() =>
                    setActiveView('beds')
                }
            >
              <BedDouble size={18}/>
              <span>{t.availableBedsView}</span>
              <strong>
                {counts.available_beds}
              </strong>
            </button>
          </div>

          <div className="panel-heading">
            <div className="panel-title">
              {activeView === 'assigned' ? (
                  <Users size={19}/>
              ) : activeView === 'unassigned' ? (
                  <UserX size={19}/>
              ) : (
                  <BedDouble size={19}/>
              )}

              <span>{activeTitle}</span>
            </div>
          </div>

          {resultsLoading ? (
              <div className="empty-state">
                <Info size={18}/>
                <span>{t.loadingResults}</span>
              </div>
          ) : resultsError ? (
              <div className="empty-state error">
                <AlertTriangle size={18}/>
                <span>{resultsError}</span>
              </div>
          ) : activeView === 'assigned' ? (
              renderAssignedStudents()
          ) : activeView === 'unassigned' ? (
              renderUnassignedStudents()
          ) : (
              renderAvailableBeds()
          )}
        </main>
      </div>

      <style>{styles}</style>
    </div>
  );
}

/* =========================================================
   Styles
   ========================================================= */

const styles = `
  :root {
    --page-bg: #f5f7fb;
    --card-bg: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --border: rgba(15, 23, 42, 0.09);

    --blue: #2563eb;
    --blue-soft: rgba(37, 99, 235, 0.10);

    --green: #059669;
    --green-soft: rgba(5, 150, 105, 0.10);

    --amber: #d97706;
    --amber-soft: rgba(217, 119, 6, 0.10);

    --purple: #7c3aed;
    --purple-soft: rgba(124, 58, 237, 0.10);

    --red: #dc2626;
    --red-soft: rgba(220, 38, 38, 0.10);

    --shadow:
      0 14px 38px rgba(15, 23, 42, 0.08);

    --shadow-soft:
      0 7px 20px rgba(15, 23, 42, 0.06);
  }

  * {
    box-sizing: border-box;
  }

  .allocation-results-page {
    min-height: 100vh;
    padding: 24px;
    background:
      radial-gradient(
        circle at top right,
        rgba(37, 99, 235, 0.06),
        transparent 28%
      ),
      var(--page-bg);
  }

  .results-shell {
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .results-topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding: 22px;
    border: 1px solid var(--border);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.90);
    box-shadow: var(--shadow-soft);
  }

  .results-topbar h1 {
    margin: 0;
    color: var(--text);
    font-size: 31px;
    font-weight: 950;
  }

  .results-topbar p {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 14px;
    font-weight: 700;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 11px;
    padding: 7px 11px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: white;
    color: var(--blue);
    font-size: 12px;
    font-weight: 900;
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: white;
    color: var(--text);
    box-shadow: var(--shadow-soft);
    font-family: inherit;
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
  }

  .back-button:hover {
    transform: translateY(-1px);
  }

  .meta-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.single-meta .meta-card {
  width: 100%;
}

  .meta-card {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: white;
    box-shadow: var(--shadow-soft);
  }

  .meta-icon {
    width: 43px;
    height: 43px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 14px;
  }

  .meta-icon.blue {
    background: var(--blue-soft);
    color: var(--blue);
  }

  .meta-icon.purple {
    background: var(--purple-soft);
    color: var(--purple);
  }

  .meta-label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .meta-value {
    margin-top: 4px;
    color: var(--text);
    font-size: 15px;
    font-weight: 950;
  }

  .results-panel {
    min-height: 430px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 24px;
    background: white;
    box-shadow: var(--shadow);
  }

  .view-tabs {
    display: grid;
    grid-template-columns:
      repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }

  .view-tab {
    min-height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 15px;
    background: #f8fafc;
    color: var(--muted);
    font-family: inherit;
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
    transition: 0.16s ease;
  }

  .view-tab:hover {
    transform: translateY(-1px);
    background: white;
    color: var(--text);
  }

  .view-tab strong {
    min-width: 29px;
    height: 29px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: rgba(100, 116, 139, 0.12);
    color: #475569;
    font-size: 12px;
  }

  .view-tab.active.assigned {
    border-color: rgba(37, 99, 235, 0.28);
    background: var(--blue-soft);
    color: var(--blue);
  }

  .view-tab.active.unassigned {
    border-color: rgba(217, 119, 6, 0.28);
    background: var(--amber-soft);
    color: var(--amber);
  }

  .view-tab.active.beds {
    border-color: rgba(5, 150, 105, 0.28);
    background: var(--green-soft);
    color: var(--green);
  }

  .panel-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    padding-bottom: 13px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: var(--text);
    font-size: 15px;
    font-weight: 950;
  }

  /* Hierarchy */

  .hierarchy-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .hierarchy-card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: white;
  }

  .dorm-card {
    box-shadow: var(--shadow-soft);
  }

  .building-card {
    border-radius: 16px;
  }

  .apartment-card {
    border-radius: 14px;
  }

  .room-card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: white;
  }

  .hierarchy-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 15px 17px;
    border: none;
    font-family: inherit;
    text-align: start;
    cursor: pointer;
  }

  .dorm-row {
    border-right: 6px solid var(--blue);
    background:
      linear-gradient(
        135deg,
        #eaf2ff,
        #f8fbff
      );
  }

  [dir="ltr"] .dorm-row {
    border-right: none;
    border-left: 6px solid var(--blue);
  }

  .building-row {
    background: #f8fbff;
  }

  .apartment-row {
    background: #fbfcfe;
  }

  .room-row {
    padding: 13px 15px;
    background: white;
  }

  .hierarchy-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .chevron {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.80);
    color: #475569;
  }

  [dir="ltr"] .chevron svg {
    transform: rotate(180deg);
  }

  .hierarchy-icon {
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 12px;
  }

  .dorm-icon {
    background: var(--blue-soft);
    color: var(--blue);
  }

  .building-icon {
    background: var(--purple-soft);
    color: var(--purple);
  }

  .apartment-icon {
    background: var(--green-soft);
    color: var(--green);
  }

  .hierarchy-title {
    color: var(--text);
    font-size: 15px;
    font-weight: 950;
  }

  .hierarchy-counts {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 7px;
  }

  .count-chip,
  .availability-state {
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
  }

  .count-chip.assigned {
    border-color:
      rgba(37, 99, 235, 0.15);
    background: var(--blue-soft);
    color: var(--blue);
  }

  .count-chip.available {
    border-color:
      rgba(5, 150, 105, 0.15);
    background: var(--green-soft);
    color: var(--green);
  }

  .availability-state.full {
    border-color:
      rgba(100, 116, 139, 0.16);
    background:
      rgba(100, 116, 139, 0.10);
    color: #475569;
  }

  .availability-state.available {
    border-color:
      rgba(5, 150, 105, 0.17);
    background: var(--green-soft);
    color: var(--green);
  }

  .availability-state.empty {
    border-color:
      rgba(217, 119, 6, 0.17);
    background: var(--amber-soft);
    color: var(--amber);
  }

  .hierarchy-children {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    padding-inline-start: 24px;
    border-top: 1px solid var(--border);
  }

  .dorm-children {
    background: #f8fafc;
  }

  .building-children {
    background: #fbfcfe;
  }

  .apartment-children {
    background: white;
  }

  /* Room details */

  .room-details {
    padding: 14px;
    border-top: 1px solid var(--border);
    background: #f8fafc;
  }

  .student-grid {
    display: grid;
    grid-template-columns:
      repeat(
        auto-fit,
        minmax(245px, 1fr)
      );
    gap: 10px;
  }

  .student-card {
    padding: 13px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: white;
    box-shadow:
      0 5px 14px
      rgba(15, 23, 42, 0.04);
  }

  .student-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .student-name {
    color: var(--text);
    font-size: 14px;
    font-weight: 950;
  }

  .student-number {
    margin-top: 4px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
  }

  .student-fields {
    display: grid;
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 12px;
    color: #475569;
    font-size: 11px;
    font-weight: 700;
  }

  .student-fields strong {
    color: #334155;
  }

  .table-status {
    display: inline-flex;
    align-items: center;
    padding: 6px 9px;
    border: 1px solid
      rgba(5, 150, 105, 0.16);
    border-radius: 999px;
    background: var(--green-soft);
    color: var(--green);
    font-size: 11px;
    font-weight: 900;
  }

  .available-bed-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .available-bed-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border: 1px solid
      rgba(5, 150, 105, 0.16);
    border-radius: 999px;
    background: var(--green-soft);
    color: var(--green);
    font-size: 11px;
    font-weight: 900;
  }

  .room-empty-message {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  /* Tables */

  .table-wrap {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 16px;
  }

  .results-table {
    width: 100%;
    border-collapse: collapse;
    background: white;
  }

  .unassigned-table {
    min-width: 1450px;
  }

  .beds-table {
    min-width: 1050px;
  }

  .results-table th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 14px 12px;
    border-bottom:
      1px solid var(--border);
    background: #f8fafc;
    color: #334155;
    text-align: start;
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .results-table td {
    padding: 14px 12px;
    border-bottom:
      1px solid rgba(15, 23, 42, 0.06);
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
    vertical-align: middle;
  }

  .results-table tbody tr:hover {
    background:
      rgba(37, 99, 235, 0.03);
  }

  .boolean-chip {
    min-width: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px 9px;
    border: 1px solid
      rgba(100, 116, 139, 0.16);
    border-radius: 999px;
    background:
      rgba(100, 116, 139, 0.10);
    color: #475569;
    font-size: 11px;
    font-weight: 900;
  }

  .boolean-chip.active {
    border-color:
      rgba(124, 58, 237, 0.20);
    background: var(--purple-soft);
    color: var(--purple);
  }

  .boolean-chip.reserved {
    border-color:
      rgba(220, 38, 38, 0.18);
    background: var(--red-soft);
    color: var(--red);
  }

  .empty-state {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 15px;
    border: 1px dashed
      rgba(15, 23, 42, 0.14);
    border-radius: 16px;
    background:
      rgba(15, 23, 42, 0.03);
    color: var(--muted);
    font-size: 13px;
    font-weight: 800;
  }

  .empty-state.error {
    border-color:
      rgba(220, 38, 38, 0.20);
    background: var(--red-soft);
    color: var(--red);
  }

  @media (max-width: 900px) {
    .results-topbar {
      flex-direction: column;
      align-items: stretch;
    }

    .meta-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .view-tabs {
      grid-template-columns: 1fr;
    }

    .hierarchy-row {
      flex-direction: column;
      align-items: flex-start;
    }

    .hierarchy-counts {
      width: 100%;
      justify-content: flex-start;
      padding-inline-start: 38px;
    }

    .hierarchy-children {
      padding-inline-start: 12px;
    }

    .student-fields {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .allocation-results-page {
      padding: 13px;
    }

    .results-topbar h1 {
      font-size: 25px;
    }

    .results-panel {
      padding: 13px;
    }
  }
  .apartment-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  }

  .apartment-type-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 9px;
    border: 1px solid rgba(124, 58, 237, 0.18);
    border-radius: 999px;
    background: var(--purple-soft);
    color: var(--purple);
    font-size: 10px;
    font-weight: 900;
  }
`;

export default AllocationResultsPage;