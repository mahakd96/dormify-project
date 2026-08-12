import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, whatIfAPI } from "../services/api";
import { localizeById, localizeLocationText } from "../utils/locationNames";
import { localizeGender } from "../utils/genderLabels";
import {
  Search,
  Building2,
  AlertTriangle,
  CheckCircle,
  Users,
  Home,
  BedDouble,
  RefreshCw,
  DoorOpen,
  Layers,
  X,
} from "lucide-react";

const WhatIfPage = ({ language = "he" }) => {
  const t = {
    he: {
      eyebrow: "תכנון תרחישים",
      title: 'ניתוח "מה אם" וניהול זמינות',
      subtitle:
        "הדמיה ויישום שינויי זמינות עבור בניינים, דירות או חדרים בודדים לפני הרצת אלגוריתם השיבוץ.",
      refreshData: "רענון נתונים",

      targetLabels: { building: "בניינים", apartment: "דירות", room: "חדרים" },
      buildingLabel: "בניין",
      apartmentLabel: "דירה",
      roomLabel: "חדר",
      noDormType: "ללא סוג מעונות",
      noRegion: "ללא אזור",
      capacity: "קיבולת",
      availableBeds: "מיטות פנויות",

      selectTargetType: "בחירת סוג היעד",
      selectTargetTypeDesc:
        "בחרו האם שינוי הזמינות משפיע על בניינים שלמים, דירות או חדרים נבחרים.",
      searchPlaceholder: {
        building: "חיפוש בניין, סוג מעונות או אזור...",
        apartment: "חיפוש מספר דירה, בניין או אזור...",
        room: "חיפוש חדר, דירה, בניין או אזור...",
      },
      showing: "מוצגים",
      of: "מתוך",
      selectAllVisible: "בחירת כל המוצגים",
      clearSelection: "ניקוי הבחירה",
      loadingData: "טוען נתונים...",
      noItemsFound: "לא נמצאו פריטים.",
      statusActive: "פעיל",
      statusInactive: "לא פעיל",

      scenarioSettings: "הגדרות תרחיש",
      action: "פעולה",
      actionInactivate: "השבתה",
      actionReactivate: "הפעלה מחדש",
      reason: "סיבה",
      reasonRenovation: "שיפוץ",
      reasonMaintenance: "תחזוקה",
      reasonSafety: "בעיית בטיחות",
      reasonAdmin: "שמור לשימוש מנהלי",
      reasonOther: "אחר",
      selectedPrefix: (label) => `${label} שנבחרו`,
      noItemsSelected: "טרם נבחרו פריטים.",
      runImpactAnalysis: "הרצת ניתוח השפעה",
      runningAnalysis: "מריץ ניתוח...",
      simulationNote: "הדמיה אינה משנה את מסד הנתונים. יישום הוא פעולה נפרדת.",
      applying: "מיישם...",
      applyInactivation: "יישום השבתה במסד הנתונים",
      applyReactivation: "יישום הפעלה מחדש במסד הנתונים",

      impactSummary: "סיכום השפעה",
      impactSummaryDesc: "תצוגה זו מציגה את ההשלכות הצפויות של שינוי הזמינות שנבחר.",
      affectedStudents: "סטודנטים מושפעים",
      males: "גברים",
      females: "נשים",
      needTransfer: "דורשים העברה",
      lostApartments: "דירות שאבדו",
      lostRooms: "חדרים שאבדו",
      lostCapacity: "קיבולת שאבדה",
      lostBeds: "מיטות שאבדו",

      beforeAfter: "לפני מול אחרי",
      beforeAfterDesc: "השוואה בין הנתונים הנוכחיים לתוצאה המדומה.",
      metric: "מדד",
      before: "לפני",
      after: "אחרי",
      activeBuildings: "בניינים פעילים",
      totalRooms: 'סה"כ חדרים',
      totalCapacity: 'סה"כ קיבולת',
      assignedStudents: "סטודנטים משובצים",
      unassignedStudents: "סטודנטים לא משובצים",
      occupancyRate: "אחוז תפוסה",

      affectedStudentsDesc: "סטודנטים בעלי שיבוץ מיטה פעיל בתוך היעד הנבחר כרגע.",
      colStudentId: "מספר סטודנט",
      colName: "שם",
      colGender: "מגדר",
      colReligious: "דתיות",
      colRequestedReligion: "דת מבוקשת",
      colBuilding: "בניין",
      colApartment: "דירה",
      colRoom: "חדר",
      colBed: "מיטה",
      colStatus: "סטטוס",
      noAffectedStudents: "לא נמצאו סטודנטים מושפעים.",
      statusNeedsTransfer: "דורש העברה",

      confirmTitle: "אישור שינוי אמיתי במסד הנתונים",
      confirmDangerText: "זו אינה הדמיה. פעולה זו תעדכן את מסד הנתונים האמיתי.",
      confirmTargetType: "סוג יעד",
      confirmSelectedItems: "פריטים נבחרים",
      inactivationNoun: "השבתה",
      reactivationNoun: "הפעלה מחדש",
      warningInactivate:
        "הבניינים, הדירות או החדרים שנבחרו יסומנו כלא פעילים. שיבוץ עתידי יתעלם מהם. סטודנטים המשובצים כיום עשויים לדרוש העברה או שיבוץ מחדש ידני.",
      warningReactivate:
        "הבניינים, הדירות או החדרים שנבחרו יופעלו מחדש ועשויים להיות זמינים שוב לשיבוץ עתידי.",
      confirmLabelPrefix: "הקלידו",
      confirmLabelSuffix: "לאישור:",
      confirmPlaceholder: "הקלידו APPLY",
      cancel: "ביטול",
      confirmApply: "אישור יישום",

      selectAtLeastOne: "נא לבחור לפחות פריט אחד.",
      pleaseRunImpactFirst: "נא להריץ ניתוח השפעה לפני יישום שינוי אמיתי במסד הנתונים.",
      pleaseTypeApply: "נא להקליד APPLY לאישור השינוי האמיתי במסד הנתונים.",
      simulationFailed: "הדמיה נכשלה",
      confirmFailed: "האישור נכשל",
      failedToLoadBuildings: "טעינת נתוני הבניינים נכשלה",
      failedToLoadType: (label) => `טעינת נתוני ${label} נכשלה`,
      doneMessage: (actionLabel, count, created, skipped) =>
        `בוצע. פעולה: ${actionLabel}. סטודנטים מושפעים: ${count}. בקשות שנוצרו: ${created}. בקשות קיימות שדולגו: ${skipped}.`,
    },
    en: {
      eyebrow: "Scenario Planning",
      title: "What-If & Availability Control",
      subtitle:
        "Simulate and apply availability changes for buildings, apartments, or individual rooms before running the allocation algorithm.",
      refreshData: "Refresh Data",

      targetLabels: { building: "Buildings", apartment: "Apartments", room: "Rooms" },
      buildingLabel: "Building",
      apartmentLabel: "Apartment",
      roomLabel: "Room",
      noDormType: "No dorm type",
      noRegion: "No region",
      capacity: "Capacity",
      availableBeds: "Available beds",

      selectTargetType: "Select Target Type",
      selectTargetTypeDesc:
        "Choose whether the availability change affects full buildings, apartments, or selected rooms.",
      searchPlaceholder: {
        building: "Search building, dorm type, or region...",
        apartment: "Search apartment number, building, or region...",
        room: "Search room, apartment number, building, or region...",
      },
      showing: "Showing",
      of: "of",
      selectAllVisible: "Select all visible",
      clearSelection: "Clear selection",
      loadingData: "Loading data...",
      noItemsFound: "No items found.",
      statusActive: "Active",
      statusInactive: "Inactive",

      scenarioSettings: "Scenario Settings",
      action: "Action",
      actionInactivate: "Inactivate",
      actionReactivate: "Reactivate",
      reason: "Reason",
      reasonRenovation: "Renovation",
      reasonMaintenance: "Maintenance",
      reasonSafety: "Safety issue",
      reasonAdmin: "Reserved for administrative use",
      reasonOther: "Other",
      selectedPrefix: (label) => `Selected ${label}`,
      noItemsSelected: "No items selected yet.",
      runImpactAnalysis: "Run Impact Analysis",
      runningAnalysis: "Running Analysis...",
      simulationNote: "Simulation does not change the database. Apply is a separate action.",
      applying: "Applying...",
      applyInactivation: "Apply Inactivation to Database",
      applyReactivation: "Apply Reactivation to Database",

      impactSummary: "Impact Summary",
      impactSummaryDesc: "This shows the expected consequences of the selected availability change.",
      affectedStudents: "Affected Students",
      males: "Men",
      females: "Women",
      needTransfer: "Need Transfer",
      lostApartments: "Lost Apartments",
      lostRooms: "Lost Rooms",
      lostCapacity: "Lost Capacity",
      lostBeds: "Lost Beds",

      beforeAfter: "Before vs After",
      beforeAfterDesc: "Comparison between the current data and the simulated result.",
      metric: "Metric",
      before: "Before",
      after: "After",
      activeBuildings: "Active Buildings",
      totalRooms: "Total Rooms",
      totalCapacity: "Total Capacity",
      assignedStudents: "Assigned Students",
      unassignedStudents: "Unassigned Students",
      occupancyRate: "Occupancy Rate",

      affectedStudentsDesc: "Students who currently have an active bed assignment inside the selected target.",
      colStudentId: "Student ID",
      colName: "Name",
      colGender: "Gender",
      colReligious: "Religious",
      colRequestedReligion: "Requested Religion",
      colBuilding: "Building",
      colApartment: "Apartment",
      colRoom: "Room",
      colBed: "Bed",
      colStatus: "Status",
      noAffectedStudents: "No affected students found.",
      statusNeedsTransfer: "Needs transfer",

      confirmTitle: "Confirm Real Database Change",
      confirmDangerText: "This is not a simulation. This action will update the real database.",
      confirmTargetType: "Target Type",
      confirmSelectedItems: "Selected Items",
      inactivationNoun: "Inactivation",
      reactivationNoun: "Reactivation",
      warningInactivate:
        "The selected buildings, apartments, or rooms will be marked as inactive. Future allocation will ignore them. Students currently assigned there may require transfer or manual reassignment.",
      warningReactivate:
        "The selected buildings, apartments, or rooms will be reactivated and may become available again for future allocation.",
      confirmLabelPrefix: "Type",
      confirmLabelSuffix: "to confirm:",
      confirmPlaceholder: "Type APPLY",
      cancel: "Cancel",
      confirmApply: "Confirm Apply",

      selectAtLeastOne: "Please select at least one item.",
      pleaseRunImpactFirst: "Please run the impact analysis before applying a real database change.",
      pleaseTypeApply: "Please type APPLY to confirm the real database change.",
      simulationFailed: "Simulation failed",
      confirmFailed: "Confirm failed",
      failedToLoadBuildings: "Failed to load buildings data",
      failedToLoadType: (label) => `Failed to load ${label.toLowerCase()} data`,
      doneMessage: (actionLabel, count, created, skipped) =>
        `Done. Action: ${actionLabel}. Affected students: ${count}. Created requests: ${created}. Skipped existing requests: ${skipped}.`,
    },
  }[language] || {};

  const TARGET_OPTIONS = [
    { key: "building", label: t.targetLabels.building, icon: Building2 },
    { key: "apartment", label: t.targetLabels.apartment, icon: Layers },
    { key: "room", label: t.targetLabels.room, icon: DoorOpen },
  ];
  const [buildings, setBuildings] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [rooms, setRooms] = useState([]);

  const [targetType, setTargetType] = useState("building");
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [action, setAction] = useState("inactivate");
  const [reason, setReason] = useState("Renovation");

  const [result, setResult] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingSimulation, setLoadingSimulation] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [error, setError] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");

  // New safety states for the real database change
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const didLoadInitialData = useRef(false);

  useEffect(() => {
  if (didLoadInitialData.current) return;
  didLoadInitialData.current = true;

  loadAllData();
}, []);

  const getAllPages = async (firstUrl) => {
    let allItems = [];
    let nextUrl = firstUrl;

    while (nextUrl) {
      const { data } = await api.get(nextUrl);

      if (Array.isArray(data)) {
        allItems = data;
        nextUrl = null;
      } else {
        allItems = [...allItems, ...(data?.results || [])];

        if (data?.next) {
          const url = new URL(data.next);
          nextUrl = `${url.pathname}${url.search}`;
        } else {
          nextUrl = null;
        }
      }
    }

    return allItems;
  };

  const loadAllData = async () => {
  try {
    setLoadingData(true);
    setError("");

    const buildingsData = await getAllPages("/api/buildings/");
    setBuildings(Array.isArray(buildingsData) ? buildingsData : buildingsData?.results || []);
  } catch (err) {
    setError(err.message || t.failedToLoadBuildings);
  } finally {
    setLoadingData(false);
  }
};
  const loadDataForTargetType = async (type, forceReload = false) => {
  try {
    setError("");

    if (type === "building") {
      if (!forceReload && buildings.length > 0) return;

      setLoadingData(true);
      const buildingsData = await getAllPages("/api/buildings/");
      setBuildings(Array.isArray(buildingsData) ? buildingsData : buildingsData?.results || []);
      return;
    }

    if (type === "apartment") {
      if (!forceReload && apartments.length > 0) return;

      setLoadingData(true);
      const apartmentsData = await getAllPages("/api/apartments/");
      setApartments(Array.isArray(apartmentsData) ? apartmentsData : apartmentsData?.results || []);
      return;
    }

    if (type === "room") {
      if (!forceReload && rooms.length > 0) return;

      setLoadingData(true);
      const roomsData = await getAllPages("/api/rooms/");
      setRooms(Array.isArray(roomsData) ? roomsData : roomsData?.results || []);
    }
  } catch (err) {
    setError(err.message || t.failedToLoadType(t.targetLabels[type] || type));
  } finally {
    setLoadingData(false);
  }
};

  const currentItems = useMemo(() => {
    if (targetType === "building") return buildings;
    if (targetType === "apartment") return apartments;
    return rooms;
  }, [targetType, buildings, apartments, rooms]);

  const getItemTitle = (item) => {
    if (targetType === "building") {
      return `${t.buildingLabel} ${item.number}`;
    }

    if (targetType === "apartment") {
      return `${t.buildingLabel} ${item.building_number} / ${t.apartmentLabel} ${item.number}`;
    }

    return `${t.buildingLabel} ${item.building_number} / ${t.apartmentLabel} ${item.apartment_number} / ${t.roomLabel} ${item.name}`;
  };

  // dorm_type_name/region_name/dorm_type are real data coming straight from
  // the backend (Region/DormType names) - localized via the project's
  // existing location-name mechanism (src/utils/locationNames.js), the
  // same one AnalysisPage/MapPage already use, rather than being left
  // untranslated or re-translated ad hoc here.
  const getItemSubtitle = (item) => {
    if (targetType === "building") {
      const dormType = item.dorm_type_name
        ? localizeById(item.dorm_type_code, item.dorm_type_name, language)
        : t.noDormType;
      const region = item.region_name
        ? localizeById(item.region, item.region_name, language)
        : t.noRegion;
      return `${dormType} · ${region}`;
    }

    if (targetType === "apartment") {
      const dormType = item.dorm_type ? localizeLocationText(item.dorm_type, language) : t.noDormType;
      const region = item.region_name
        ? localizeById(item.region, item.region_name, language)
        : t.noRegion;
      return `${dormType} · ${region} · ${t.capacity} ${item.apartment_capacity ?? 0}`;
    }

    const region = item.region_name
      ? localizeById(item.region, item.region_name, language)
      : t.noRegion;
    return `${region} · ${t.capacity} ${item.capacity ?? 0} · ${t.availableBeds} ${item.available_beds ?? 0}`;
  };

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) return currentItems;

    return currentItems.filter((item) => {
      const searchableText = [
        item.id,
        item.number,
        item.name,
        item.building_number,
        item.apartment_number,
        item.region_name,
        item.dorm_type_name,
        item.dorm_type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(term);
    });
  }, [currentItems, searchTerm]);

  const selectedItems = useMemo(() => {
    return currentItems.filter((item) => selectedIds.includes(item.id));
  }, [currentItems, selectedIds]);

 const changeTargetType = async (newType) => {
  setTargetType(newType);
  setSelectedIds([]);
  setSearchTerm("");
  setResult(null);
  setConfirmMessage("");
  setError("");
  setShowApplyConfirm(false);
  setConfirmText("");

  await loadDataForTargetType(newType);
};

  const toggleItem = (id) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((itemId) => itemId !== id);
      }

      return [...current, id];
    });

    setResult(null);
    setConfirmMessage("");
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const selectAllVisible = () => {
    const visibleIds = filteredItems.map((item) => item.id);

    setSelectedIds((current) => {
      const merged = new Set([...current, ...visibleIds]);
      return [...merged];
    });

    setResult(null);
    setConfirmMessage("");
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setResult(null);
    setConfirmMessage("");
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const runSimulation = async () => {
    if (selectedIds.length === 0) {
      setError(t.selectAtLeastOne);
      return;
    }

    try {
      setLoadingSimulation(true);
      setError("");
      setConfirmMessage("");
      setShowApplyConfirm(false);
      setConfirmText("");

      const data = await whatIfAPI.simulateAvailabilityChange({
        targetType,
        targetIds: selectedIds,
        action,
      });

      setResult(data);
    } catch (err) {
      setError(err.message || t.simulationFailed);
    } finally {
      setLoadingSimulation(false);
    }
  };

  const openApplyConfirmation = () => {
    if (selectedIds.length === 0) {
      setError(t.selectAtLeastOne);
      return;
    }

    if (!result) {
      setError(t.pleaseRunImpactFirst);
      return;
    }

    setError("");
    setConfirmText("");
    setShowApplyConfirm(true);
  };

  const closeApplyConfirmation = () => {
    if (loadingConfirm) return;
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const confirmAvailabilityChange = async () => {
    if (selectedIds.length === 0) {
      setError(t.selectAtLeastOne);
      return;
    }

    if (confirmText !== "APPLY") {
      setError(t.pleaseTypeApply);
      return;
    }

    try {
      setLoadingConfirm(true);
      setError("");
      setConfirmMessage("");

      const data = await whatIfAPI.confirmAvailabilityChange({
        targetType,
        targetIds: selectedIds,
        action,
        reason,
        confirm_apply: true,
      });

      const appliedActionLabel = data.action === "reactivate" ? t.reactivationNoun : t.inactivationNoun;
      setConfirmMessage(
        t.doneMessage(
          appliedActionLabel,
          data.affected_students_count,
          data.created_requests,
          data.skipped_existing_requests
        )
      );

      setShowApplyConfirm(false);
      setConfirmText("");
      await loadAllData();
    } catch (err) {
      setError(err.message || t.confirmFailed);
    } finally {
      setLoadingConfirm(false);
    }
  };

  const summary = result?.summary || {};
  const before = result?.analysis_before || {};
  const after = result?.analysis_after || {};
  const affectedStudents = result?.affected_students || [];

  const selectedTargetLabel = t.targetLabels[targetType];

  const selectedActionLabel = action === "inactivate" ? t.inactivationNoun : t.reactivationNoun;

  return (
    <div className="whatif-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className="subtitle">{t.subtitle}</p>
        </div>

        <button className="refresh-btn" onClick={() => loadDataForTargetType(targetType, true)}>
          <RefreshCw size={16} />
          {t.refreshData}
        </button>
      </div>

      {error && (
        <div className="alert error-alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {confirmMessage && (
        <div className="alert success-alert">
          <CheckCircle size={18} />
          <span>{confirmMessage}</span>
        </div>
      )}

      <div className="top-cards">
        <InfoCard icon={<Building2 size={22} />} label={t.targetLabels.building} value={buildings.length} />
        <InfoCard icon={<Layers size={22} />} label={t.targetLabels.apartment} value={apartments.length} />
        <InfoCard icon={<DoorOpen size={22} />} label={t.targetLabels.room} value={rooms.length} />
        <InfoCard icon={<CheckCircle size={22} />} label={t.selectedPrefix(selectedTargetLabel)} value={selectedIds.length} />
      </div>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{t.selectTargetType}</h2>
              <p>{t.selectTargetTypeDesc}</p>
            </div>
          </div>

          <div className="target-tabs">
            {TARGET_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = targetType === option.key;

              return (
                <button
                  key={option.key}
                  className={`target-tab ${active ? "active" : ""}`}
                  onClick={() => changeTargetType(option.key)}
                >
                  <Icon size={18} />
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="search-box">
            <Search size={18} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t.searchPlaceholder[targetType]}
            />
          </div>

          <div className="buildings-meta">
            <span>
              {t.showing} <strong>{filteredItems.length}</strong> {t.of}{" "}
              <strong>{currentItems.length}</strong> {selectedTargetLabel.toLowerCase()}
            </span>

            <div className="meta-actions">
              {filteredItems.length > 0 && (
                <button className="link-btn" onClick={selectAllVisible}>
                  {t.selectAllVisible}
                </button>
              )}

              {selectedIds.length > 0 && (
                <button className="link-btn" onClick={clearSelection}>
                  {t.clearSelection}
                </button>
              )}
            </div>
          </div>

          <div className="buildings-list">
            {loadingData ? (
              <div className="empty-state">{t.loadingData}</div>
            ) : filteredItems.length === 0 ? (
              <div className="empty-state">{t.noItemsFound}</div>
            ) : (
              filteredItems.map((item) => {
                const selected = selectedIds.includes(item.id);
                const isInactive = item.is_active === false;

                return (
                  <button
                    key={`${targetType}-${item.id}`}
                    className={`building-row ${selected ? "selected" : ""}`}
                    onClick={() => toggleItem(item.id)}
                  >
                    <div className="checkbox">{selected && "✓"}</div>

                    <div className="building-icon">
                      {targetType === "building" ? (
                        <Building2 size={20} />
                      ) : targetType === "apartment" ? (
                        <Layers size={20} />
                      ) : (
                        <DoorOpen size={20} />
                      )}
                    </div>

                    <div className="building-info">
                      <strong>{getItemTitle(item)}</strong>
                      <span>{getItemSubtitle(item)}</span>
                    </div>

                    <div className={`building-status ${isInactive ? "inactive" : ""}`}>
                      {isInactive ? t.statusInactive : t.statusActive}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="panel sticky-panel">
          <h2>{t.scenarioSettings}</h2>

          <label className="field-label">{t.action}</label>
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setResult(null);
              setConfirmMessage("");
              setShowApplyConfirm(false);
              setConfirmText("");
            }}
            className="select-input"
          >
            <option value="inactivate">{t.actionInactivate}</option>
            <option value="reactivate">{t.actionReactivate}</option>
          </select>

          <label className="field-label">{t.reason}</label>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="select-input"
          >
            <option value="Renovation">{t.reasonRenovation}</option>
            <option value="Maintenance">{t.reasonMaintenance}</option>
            <option value="Safety issue">{t.reasonSafety}</option>
            <option value="Reserved for administrative use">
              {t.reasonAdmin}
            </option>
            <option value="Other">{t.reasonOther}</option>
          </select>

          <div className="selected-box">
            <h3>{t.selectedPrefix(selectedTargetLabel)}</h3>

            {selectedItems.length === 0 ? (
              <p>{t.noItemsSelected}</p>
            ) : (
              selectedItems.map((item) => (
                <div className="selected-building" key={item.id}>
                  <span>{getItemTitle(item)}</span>
                  <small>{getItemSubtitle(item)}</small>
                </div>
              ))
            )}
          </div>

          <button
            className="primary-btn"
            onClick={runSimulation}
            disabled={loadingSimulation || selectedIds.length === 0}
          >
            {loadingSimulation ? t.runningAnalysis : t.runImpactAnalysis}
          </button>

          <p className="note">{t.simulationNote}</p>

          {result && (
            <button
              className={action === "inactivate" ? "danger-btn" : "success-btn"}
              onClick={openApplyConfirmation}
              disabled={loadingConfirm}
            >
              {loadingConfirm
                ? t.applying
                : action === "inactivate"
                ? t.applyInactivation
                : t.applyReactivation}
            </button>
          )}
        </section>
      </div>

      {result && (
        <>
          <section className="results-section">
            <div className="section-title">
              <h2>{t.impactSummary}</h2>
              <p>{t.impactSummaryDesc}</p>
            </div>

            <div className="summary-grid">
              <ResultCard icon={<Users size={22} />} title={t.affectedStudents} value={summary.affected_students_count} />
              <ResultCard title={t.males} value={summary.male_count} />
              <ResultCard title={t.females} value={summary.female_count} />
              <ResultCard title={t.needTransfer} value={summary.students_without_valid_placement} />
              <ResultCard icon={<Home size={22} />} title={t.lostApartments} value={summary.lost_apartments} />
              <ResultCard title={t.lostRooms} value={summary.lost_rooms} />
              <ResultCard title={t.lostCapacity} value={summary.lost_capacity} />
              <ResultCard icon={<BedDouble size={22} />} title={t.lostBeds} value={summary.lost_beds} />
            </div>
          </section>

          <section className="results-section">
            <div className="section-title">
              <h2>{t.beforeAfter}</h2>
              <p>{t.beforeAfterDesc}</p>
            </div>

            <div className="modern-table-wrapper">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>{t.metric}</th>
                    <th>{t.before}</th>
                    <th>{t.after}</th>
                  </tr>
                </thead>
                <tbody>
                  <AnalysisRow label={t.activeBuildings} before={before.total_buildings} after={after.total_buildings} />
                  <AnalysisRow label={t.totalRooms} before={before.total_rooms} after={after.total_rooms} />
                  <AnalysisRow label={t.totalCapacity} before={before.total_capacity} after={after.total_capacity} />
                  <AnalysisRow label={t.assignedStudents} before={before.assigned_students} after={after.assigned_students} />
                  <AnalysisRow label={t.unassignedStudents} before={before.unassigned_students} after={after.unassigned_students} />
                  <AnalysisRow label={t.availableBeds} before={before.available_beds} after={after.available_beds} />
                  <AnalysisRow label={t.occupancyRate} before={`${before.occupancy_rate || 0}%`} after={`${after.occupancy_rate || 0}%`} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="results-section">
            <div className="section-title">
              <h2>{t.affectedStudents}</h2>
              <p>{t.affectedStudentsDesc}</p>
            </div>

            <div className="modern-table-wrapper">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>{t.colStudentId}</th>
                    <th>{t.colName}</th>
                    <th>{t.colGender}</th>
                    <th>{t.colReligious}</th>
                    <th>{t.colRequestedReligion}</th>
                    <th>{t.colBuilding}</th>
                    <th>{t.colApartment}</th>
                    <th>{t.colRoom}</th>
                    <th>{t.colBed}</th>
                    <th>{t.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {affectedStudents.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="empty-table-cell">
                        {t.noAffectedStudents}
                      </td>
                    </tr>
                  ) : (
                    affectedStudents.map((student) => (
                      <tr key={student.assignment_id}>
                        <td>{student.student_id}</td>
                        <td>{student.full_name}</td>
                        <td>{localizeGender(student.gender, language) || student.gender_display}</td>
                        <td>{student.religious_display || student.religious}</td>
                        <td>{student.requested_religion_display || student.requested_religion}</td>
                        <td>{student.current_building_number}</td>
                        <td>{student.current_apartment_number}</td>
                        <td>{student.current_room_name}</td>
                        <td>{student.current_bed_label}</td>
                        <td>
                          <span className="status-pill">
                            {student.status === "needs_transfer" ? t.statusNeedsTransfer : student.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {showApplyConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <button
              type="button"
              className="confirm-close"
              onClick={closeApplyConfirmation}
              disabled={loadingConfirm}
            >
              <X size={18} />
            </button>

            <div className="confirm-icon">
              <AlertTriangle size={28} />
            </div>

            <h2>{t.confirmTitle}</h2>

            <p className="danger-text">{t.confirmDangerText}</p>

            <div className="confirm-summary">
              <div>
                <span>{t.action}</span>
                <strong>{selectedActionLabel}</strong>
              </div>
              <div>
                <span>{t.confirmTargetType}</span>
                <strong>{selectedTargetLabel}</strong>
              </div>
              <div>
                <span>{t.confirmSelectedItems}</span>
                <strong>{selectedIds.length}</strong>
              </div>
              <div>
                <span>{t.affectedStudents}</span>
                <strong>{summary.affected_students_count ?? 0}</strong>
              </div>
            </div>

            <div className="warning-box">
              {action === "inactivate" ? t.warningInactivate : t.warningReactivate}
            </div>

            <label className="confirm-label">
              {t.confirmLabelPrefix} <strong>APPLY</strong> {t.confirmLabelSuffix}
            </label>

            <input
              className="confirm-input"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={t.confirmPlaceholder}
              autoFocus
            />

            <div className="confirm-actions">
              <button
                type="button"
                className="cancel-confirm-btn"
                onClick={closeApplyConfirmation}
                disabled={loadingConfirm}
              >
                {t.cancel}
              </button>

              <button
                type="button"
                className="apply-confirm-btn"
                onClick={confirmAvailabilityChange}
                disabled={confirmText !== "APPLY" || loadingConfirm}
              >
                {loadingConfirm ? t.applying : t.confirmApply}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .whatif-page {
          padding: 28px;
          color: #0f172a;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-start;
          margin-bottom: 24px;
        }

        .eyebrow {
          color: #2563eb;
          font-weight: 700;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }

        .page-header h1 {
          font-size: 30px;
          margin-bottom: 8px;
          color: #0f172a;
        }

        .subtitle {
          color: #64748b;
          max-width: 900px;
          line-height: 1.6;
        }

        .refresh-btn,
        .primary-btn,
        .danger-btn,
        .success-btn {
          border: none;
          border-radius: 12px;
          padding: 11px 16px;
          font-family: inherit;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .refresh-btn {
          background: white;
          color: #2563eb;
          border: 1px solid #dbeafe;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
        }

        .refresh-btn:hover {
          background: #eff6ff;
        }

        .alert {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border-radius: 14px;
          margin-bottom: 18px;
          font-weight: 600;
        }

        .error-alert {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }

        .success-alert {
          background: #f0fdf4;
          color: #15803d;
          border: 1px solid #bbf7d0;
        }

        .top-cards {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }

        .info-card,
        .result-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
        }

        .info-card {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .info-icon,
        .result-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #eff6ff;
          color: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .info-label,
        .result-title {
          color: #64748b;
          font-size: 13px;
          margin-bottom: 4px;
        }

        .info-value,
        .result-value {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
        }

        .main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.8fr);
          gap: 20px;
          align-items: start;
        }

        .panel,
        .results-section {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 20px;
          box-shadow: 0 12px 35px rgba(15, 23, 42, 0.06);
        }

        .sticky-panel {
          position: sticky;
          top: 90px;
        }

        .panel h2,
        .results-section h2 {
          font-size: 20px;
          margin-bottom: 6px;
        }

        .panel p,
        .section-title p {
          color: #64748b;
          line-height: 1.5;
        }

        .target-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin: 18px 0;
        }

        .target-tab {
          border: 1px solid #dbe3ef;
          background: white;
          color: #334155;
          border-radius: 999px;
          padding: 10px 16px;
          font-family: inherit;
          font-weight: 800;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .target-tab.active {
          background: #2563eb;
          border-color: #2563eb;
          color: white;
          box-shadow: 0 10px 24px rgba(37, 99, 235, 0.18);
        }

        .search-box {
          margin-top: 18px;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid #dbe3ef;
          border-radius: 14px;
          padding: 12px 14px;
          background: #f8fafc;
        }

        .search-box input {
          border: none;
          outline: none;
          background: transparent;
          width: 100%;
          font-family: inherit;
          font-size: 15px;
        }

        .buildings-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 14px 0;
          color: #64748b;
          font-size: 14px;
          gap: 12px;
        }

        .meta-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .link-btn {
          background: none;
          border: none;
          color: #2563eb;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }

        .buildings-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 510px;
          overflow-y: auto;
          padding-inline-end: 4px;
        }

        .building-row {
          width: 100%;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 16px;
          padding: 14px;
          display: grid;
          grid-template-columns: 28px 44px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          cursor: pointer;
          text-align: start;
          font-family: inherit;
          transition: all 0.2s ease;
        }

        .building-row:hover {
          border-color: #93c5fd;
          background: #f8fbff;
          transform: translateY(-1px);
        }

        .building-row.selected {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 8px 20px rgba(37, 99, 235, 0.12);
        }

        .checkbox {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          border: 1px solid #cbd5e1;
          background: white;
          color: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
        }

        .building-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #f1f5f9;
          color: #475569;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .building-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .building-info strong {
          color: #0f172a;
          font-size: 15px;
        }

        .building-info span {
          color: #64748b;
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .building-status {
          background: #dcfce7;
          color: #15803d;
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 700;
        }

        .building-status.inactive {
          background: #fee2e2;
          color: #b91c1c;
        }

        .field-label {
          display: block;
          margin-top: 18px;
          margin-bottom: 8px;
          font-weight: 700;
          color: #334155;
        }

        .select-input {
          width: 100%;
          border: 1px solid #dbe3ef;
          border-radius: 14px;
          padding: 12px;
          font-family: inherit;
          background: #f8fafc;
          outline: none;
        }

        .selected-box {
          margin-top: 18px;
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          padding: 14px;
          background: #f8fafc;
          max-height: 220px;
          overflow-y: auto;
        }

        .selected-box h3 {
          font-size: 15px;
          margin-bottom: 10px;
        }

        .selected-box p {
          font-size: 14px;
        }

        .selected-building {
          display: flex;
          flex-direction: column;
          padding: 10px;
          border-radius: 12px;
          background: white;
          border: 1px solid #e2e8f0;
          margin-bottom: 8px;
        }

        .selected-building span {
          font-weight: 700;
        }

        .selected-building small {
          color: #64748b;
        }

        .primary-btn {
          width: 100%;
          margin-top: 18px;
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          box-shadow: 0 10px 22px rgba(37, 99, 235, 0.25);
        }

        .danger-btn {
          width: 100%;
          margin-top: 14px;
          background: #dc2626;
          color: white;
          box-shadow: 0 10px 22px rgba(220, 38, 38, 0.22);
        }

        .success-btn {
          width: 100%;
          margin-top: 14px;
          background: #16a34a;
          color: white;
          box-shadow: 0 10px 22px rgba(22, 163, 74, 0.22);
        }

        .primary-btn:disabled,
        .danger-btn:disabled,
        .success-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .note {
          font-size: 13px;
          margin-top: 12px;
          color: #64748b;
        }

        .empty-state,
        .empty-table-cell {
          text-align: center;
          color: #64748b;
          padding: 24px;
        }

        .results-section {
          margin-top: 22px;
        }

        .section-title {
          margin-bottom: 16px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .result-card {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .modern-table-wrapper {
          overflow-x: auto;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
        }

        .modern-table {
          width: 100%;
          border-collapse: collapse;
          background: white;
        }

        .modern-table th {
          text-align: start;
          background: #f8fafc;
          color: #475569;
          font-size: 13px;
          padding: 13px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }

        .modern-table td {
          padding: 13px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 14px;
          white-space: nowrap;
        }

        .modern-table tr:last-child td {
          border-bottom: none;
        }

        .status-pill {
          background: #fff7ed;
          color: #c2410c;
          padding: 5px 9px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 12px;
        }

        .confirm-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.62);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
          backdrop-filter: blur(4px);
        }

        .confirm-modal {
          position: relative;
          width: min(620px, 100%);
          background: white;
          border-radius: 22px;
          padding: 26px;
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.38);
          border: 1px solid #fecaca;
        }

        .confirm-close {
          position: absolute;
          top: 16px;
          inset-inline-end: 16px;
          border: none;
          background: #f1f5f9;
          color: #64748b;
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .confirm-close:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .confirm-icon {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          background: #fef2f2;
          color: #dc2626;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
        }

        .confirm-modal h2 {
          margin: 0 0 10px;
          font-size: 24px;
          font-weight: 900;
          color: #991b1b;
        }

        .danger-text {
          color: #dc2626;
          font-weight: 900;
          margin-bottom: 16px;
        }

        .confirm-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 16px 0;
        }

        .confirm-summary div {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .confirm-summary span {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .confirm-summary strong {
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
        }

        .warning-box {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          padding: 14px;
          border-radius: 14px;
          font-weight: 800;
          line-height: 1.5;
          margin: 16px 0;
        }

        .confirm-label {
          display: block;
          margin-bottom: 8px;
          color: #0f172a;
          font-weight: 800;
        }

        .confirm-input {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 14px;
          padding: 13px;
          font-size: 15px;
          font-weight: 900;
          margin-bottom: 18px;
          box-sizing: border-box;
        }

        .confirm-input:focus {
          outline: none;
          border-color: #dc2626;
          box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.14);
        }

        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .cancel-confirm-btn,
        .apply-confirm-btn {
          border: none;
          border-radius: 12px;
          padding: 11px 16px;
          font-family: inherit;
          font-weight: 900;
          cursor: pointer;
        }

        .cancel-confirm-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .apply-confirm-btn {
          background: #dc2626;
          color: white;
          box-shadow: 0 10px 22px rgba(220, 38, 38, 0.22);
        }

        .apply-confirm-btn:disabled,
        .cancel-confirm-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 1100px) {
          .top-cards,
          .summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .main-grid {
            grid-template-columns: 1fr;
          }

          .sticky-panel {
            position: static;
          }
        }

        @media (max-width: 640px) {
          .confirm-summary {
            grid-template-columns: 1fr;
          }

          .confirm-actions {
            flex-direction: column;
          }

          .cancel-confirm-btn,
          .apply-confirm-btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

const InfoCard = ({ icon, label, value }) => (
  <div className="info-card">
    <div className="info-icon">{icon}</div>
    <div>
      <div className="info-label">{label}</div>
      <div className="info-value">{value ?? 0}</div>
    </div>
  </div>
);

const ResultCard = ({ icon, title, value }) => (
  <div className="result-card">
    <div className="result-icon">{icon || <AlertTriangle size={22} />}</div>
    <div>
      <div className="result-title">{title}</div>
      <div className="result-value">{value ?? 0}</div>
    </div>
  </div>
);

const AnalysisRow = ({ label, before, after }) => (
  <tr>
    <td>{label}</td>
    <td>{before ?? 0}</td>
    <td>{after ?? 0}</td>
  </tr>
);

export default WhatIfPage;