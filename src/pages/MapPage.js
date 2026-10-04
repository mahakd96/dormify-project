import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  Filter,
  Home,
  Maximize2,
  Move,
  RefreshCcw,
  Search,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { localizeLocationText } from "../utils/locationNames";

const MAP_SRC = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900">
  <rect width="1400" height="900" fill="#eef3f7"/>
  <g fill="none" stroke="#cbd5e1" stroke-width="2">
    <path d="M120 150 H1280 M120 300 H1280 M120 450 H1280 M120 600 H1280 M120 750 H1280"/>
    <path d="M250 80 V820 M500 80 V820 M750 80 V820 M1000 80 V820 M1250 80 V820"/>
  </g>
  <text x="700" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#334155">Dormify Demo Map</text>
  <text x="700" y="470" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#64748b">Institutional map asset excluded from public repository</text>
</svg>`)}`;

const clickableDormAreas = {
  canada: { top: "15.5%", left: "29.5%", width: "12.5%", height: "7.5%" },
  broshim: { top: "10.5%", left: "45.0%", width: "10.0%", height: "7.0%" },
  senate: { top: "21.0%", left: "55.0%", width: "10.0%", height: "7.5%" },
  "neve-america": { top: "28.0%", left: "72.0%", width: "12.5%", height: "7.5%" },
  rifkin: { top: "44.5%", left: "16.0%", width: "10.0%", height: "7.0%" },
  "kfar-hasmaha": { top: "52.0%", left: "40.0%", width: "12.0%", height: "7.0%" },
  "segel-zutar": { top: "52.0%", left: "63.0%", width: "11.5%", height: "7.0%" },
  mizrah: { top: "71.0%", left: "78.5%", width: "10.0%", height: "7.0%" },
};

// English labels are no longer hardcoded here - they come from the
// centralized src/utils/locationNames.js dictionary (see that file's
// header comment), so this page stays in sync with every other screen
// that shows the same dorm/region names instead of maintaining its own
// second translation table.
const dormLabels = {
  canada: { he: "מעונות קנדה", officialBuildings: 22 },
  senate: { he: "סנאט", officialBuildings: 9 },
  "neve-america": { he: "נווה אמריקה", officialBuildings: 19 },
  rifkin: { he: "ריפקין", officialBuildings: 12 },
  broshim: { he: "ברושים", officialBuildings: 2 },
  "kfar-hasmaha": { he: "כפר הסמכה", officialBuildings: 4 },
  "segel-zutar": { he: "סגל זוטר", officialBuildings: 6 },
  mizrah: { he: "מזרח", officialBuildings: 17 },
};

const DORM_KEY_ALIASES = [
  {
    key: "canada",
    matches: [
      "canada",
      "canada dorms",
      "קנדה",
      "מעונות קנדה",
      "קסל",
      "עליון עמים",
      "יחיד בחדר",
      "זוגות",
      "משפחות",
      "רות הכהן",
    ],
  },
  {
    key: "senate",
    matches: ["senate", "senat", "סנאט", "סנט", "סנט חדש", "הסנט"],
  },
  {
    key: "neve-america",
    matches: [
      "neve america",
      "neve",
      "america",
      "נווה אמריקה",
      "נוה אמריקה",
      "מעונות נווה אמריקה",
    ],
  },
  {
    key: "rifkin",
    matches: ["rifkin", "ריפקין"],
  },
  {
    key: "broshim",
    matches: ["broshim", "brosh", "ברושים"],
  },
  {
    key: "kfar-hasmaha",
    matches: [
      "kfar hasmaha",
      "kfar hasmacha",
      "kfar mishtalmim",
      "כפר הסמכה",
      "כפר משתלמים",
    ],
  },
  {
    key: "segel-zutar",
    matches: ["segel zutar", "segal zutar", "junior staff", "סגל זוטר"],
  },
  {
    key: "mizrah",
    matches: [
      "mizrah",
      "mizrach",
      "east",
      "מזרח",
      "מזרח ישן",
      "מזרח חדש",
      "הלל קפלן",
      "mizrach yashan",
      "mizrah yashan",
      "mizrach hadash",
      "mizrah hadash",
    ],
  },
];

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/[״"]/g, "")
    .replace(/[׳']/g, "")
    .replace(/\//g, " ")
    .replace(/\s+/g, " ");

function resolveDormKey(name) {
  const raw = normalizeText(name);

  for (const item of DORM_KEY_ALIASES) {
    if (item.matches.some((match) => raw.includes(normalizeText(match)))) {
      return item.key;
    }
  }

  return null;
}

function inferDormTypeVariant(name) {
  const raw = normalizeText(name);

  if (raw.includes("family") || raw.includes("משפחה") || raw.includes("משפחות")) {
    return "family";
  }

  if (
    raw.includes("couple") ||
    raw.includes("couples") ||
    raw.includes("זוג") ||
    raw.includes("זוגות")
  ) {
    return "couples";
  }

  return "base";
}

function occupancyClass(occupancyRate, availableBeds, totalCapacity) {
  if (Number(totalCapacity || 0) <= 0) return "neutral";
  if (Number(availableBeds || 0) <= 0 || Number(occupancyRate || 0) >= 100) return "full";
  if (Number(occupancyRate || 0) >= 90) return "danger";
  if (Number(occupancyRate || 0) >= 70) return "warn";
  return "good";
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function formatPercent(value) {
  const n = safeNumber(value, 0);
  return `${Math.round(n)}%`;
}

// Keep the map from being dragged entirely out of the viewport.
// At scale=1 the range is ±margin px; at higher scales it grows proportionally.
function clampPan(newPan, newScale, cW, cH, margin = 80) {
  return {
    x: Math.min(Math.max(newPan.x, -(cW * (newScale - 1) + margin)), margin),
    y: Math.min(Math.max(newPan.y, -(cH * (newScale - 1) + margin)), margin),
  };
}

export default function MapPage({ language = "he" }) {
  const { canAccessRegion, isCentralAdmin } = useAuth();

  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedDormKey, setSelectedDormKey] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [calibrateMode, setCalibrateMode] = useState(false);

  const [buildingRows, setBuildingRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imgRenderedBounds, setImgRenderedBounds] = useState(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [layerAnimated, setLayerAnimated] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const isPotentialDrag = useRef(false);
  const wheelEndTimer = useRef(null);

  const ZOOM_MIN = 0.8;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.15;

  const t =
    {
      he: {
        title: "מפת המעונות",
        subtitle: "לחיצה על שם מעון במפה מציגה תפוסה אמיתית לפי שיבוצי מיטות פעילים",
        all: "הכל",
        base: "יחידים",
        couples: "זוגות",
        family: "משפחות",
        searchPlaceholder: "חיפוש מעון...",
        loading: "טוען נתוני מפה...",
        error: "שגיאה בטעינת נתוני המפה",
        restricted: "מוצגים רק הנתונים המותרים למשתמש הנוכחי",
        refresh: "רענון נתונים",
        zoom: "זום",
        panHint: "גרירה להזזת המפה",
        calibrate: "כיול",
        calibrateOn: "כיול פעיל",
        selectDorm: "בחרי מעון במפה",
        selectDormSub: "לחצי על שם המעון שמופיע בתמונה כדי לראות קיבולת, תפוסה ומיטות פנויות.",
        occupancyDetails: "פרטי תפוסה",
        officialBuildings: "מספר בניינים לפי משרד המעונות",
        databaseBuildings: "בניינים במערכת",
        activeBuildings: "בניינים פעילים",
        inactiveBuildings: "בניינים לא פעילים",
        rooms: "חדרים",
        capacity: "קיבולת מיטות",
        occupiedBeds: "מיטות תפוסות",
        availableBeds: "מיטות פנויות",
        occupancy: "תפוסה",
        status: "סטטוס",
        full: "מלא",
        almostFull: "כמעט מלא",
        available: "זמין",
        noCapacity: "אין נתוני קיבולת",
        noData: "אין נתונים להצגה עבור המעון הזה",
        buildingsList: "רשימת בניינים",
        building: "בניין",
        sourceNote: "התפוסה מחושבת לפי שיבוצי מיטה פעילים",
      },
      en: {
        title: "Dormitory Map",
        subtitle: "Click a dorm name on the map to view real occupancy from active bed assignments",
        all: "All",
        base: "Base",
        couples: "Couples",
        family: "Family",
        searchPlaceholder: "Search dorm...",
        loading: "Loading map data...",
        error: "Failed to load map data",
        restricted: "Showing only data allowed for the current user",
        refresh: "Refresh Data",
        zoom: "Zoom",
        panHint: "Drag to move the map",
        calibrate: "Calibrate",
        calibrateOn: "Calibration ON",
        selectDorm: "Select a dorm on the map",
        selectDormSub: "Click the dorm name shown inside the image to see capacity, occupancy, and available beds.",
        occupancyDetails: "Occupancy Details",
        officialBuildings: "Dorm office building count",
        databaseBuildings: "Buildings in system",
        activeBuildings: "Active Buildings",
        inactiveBuildings: "Inactive Buildings",
        rooms: "Rooms",
        capacity: "Bed Capacity",
        occupiedBeds: "Occupied Beds",
        availableBeds: "Available Beds",
        occupancy: "Occupancy",
        status: "Status",
        full: "Full",
        almostFull: "Almost Full",
        available: "Available",
        noCapacity: "No capacity data",
        noData: "No data to display for this dorm",
        buildingsList: "Buildings List",
        building: "Building",
        sourceNote: "Occupancy is calculated from active bed assignments",
      },
    }[language] || {};

  const canSeeRegion = useCallback(
    (regionValue) => {
      if (isCentralAdmin()) return true;

      try {
        return canAccessRegion(regionValue);
      } catch {
        return false;
      }
    },
    [canAccessRegion, isCentralAdmin]
  );

  const resetView = () => {
    setLayerAnimated(true);
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomAt = (nextScale, clientX, clientY) => {
    const el = canvasRef.current;

    if (!el) {
      setScale(nextScale);
      return;
    }

    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;

    const worldX = (cx - pan.x) / scale;
    const worldY = (cy - pan.y) / scale;

    const nextPanX = cx - worldX * nextScale;
    const nextPanY = cy - worldY * nextScale;

    setScale(nextScale);
    setPan(clampPan({ x: nextPanX, y: nextPanY }, nextScale, rect.width, rect.height));
  };

  const zoomIn = () => {
    const next = Math.min(ZOOM_MAX, Number((scale + ZOOM_STEP).toFixed(2)));
    const el = canvasRef.current;

    if (!el) { setScale(next); return; }

    const rect = el.getBoundingClientRect();
    zoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const zoomOut = () => {
    const next = Math.max(ZOOM_MIN, Number((scale - ZOOM_STEP).toFixed(2)));
    const el = canvasRef.current;

    if (!el) { setScale(next); return; }

    const rect = el.getBoundingClientRect();
    zoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const onMouseDown = (e) => {
    if (calibrateMode || e.button !== 0) return;
    isPotentialDrag.current = true;
    setLayerAnimated(false);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  const onMouseMove = (e) => {
    if (!isPotentialDrag.current) return;

    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    // Only commit to a drag after moving 5 px — preserves clean single clicks.
    if (!isDragging && Math.hypot(dx, dy) < 5) return;
    if (!isDragging) setIsDragging(true);

    const newPan = { x: panStart.current.x + dx, y: panStart.current.y + dy };
    const canvas = canvasRef.current;

    if (canvas) {
      const { width, height } = canvas.getBoundingClientRect();
      setPan(clampPan(newPan, scale, width, height));
    } else {
      setPan(newPan);
    }
  };

  const onMouseUp = () => {
    isPotentialDrag.current = false;
    setIsDragging(false);
    setLayerAnimated(true);
  };

  const onWheel = (e) => {
    e.preventDefault();
    // Disable transition during rapid scroll; re-enable shortly after it stops.
    setLayerAnimated(false);
    clearTimeout(wheelEndTimer.current);
    wheelEndTimer.current = setTimeout(() => setLayerAnimated(true), 180);

    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    const next = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, Number((scale + delta).toFixed(2)))
    );

    zoomAt(next, e.clientX, e.clientY);
  };

  const loadMapData = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      let analysisData = null;
      let lastError = null;

      const analysisEndpoints = [
        "/api/analysis-data/",
        "/api/analysis_data/",
        "/api/analysis/",
      ];

      for (const endpoint of analysisEndpoints) {
        try {
          const res = await api.get(endpoint);
          analysisData = res?.data || {};
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!analysisData) {
        throw lastError || new Error("Could not load analysis data");
      }

      const analysisSummary = analysisData.summary || {};

      const fixedSummary = {
        total_students: safeNumber(analysisSummary.total_students, 0),
        assigned_students: safeNumber(analysisSummary.assigned_students, 0),
        unassigned_students: safeNumber(analysisSummary.unassigned_students, 0),
        priority_students: safeNumber(analysisSummary.priority_students, 0),

        total_buildings: safeNumber(
          getFirstDefined(
            analysisSummary.total_buildings,
            analysisSummary.active_buildings,
            0
          ),
          0
        ),
        active_buildings: safeNumber(analysisSummary.active_buildings, 0),
        inactive_buildings: safeNumber(analysisSummary.inactive_buildings, 0),
        total_rooms: safeNumber(analysisSummary.total_rooms, 0),

        total_capacity: safeNumber(
          getFirstDefined(
            analysisSummary.total_capacity,
            analysisSummary.total_beds,
            0
          ),
          0
        ),
        total_beds: safeNumber(
          getFirstDefined(
            analysisSummary.total_beds,
            analysisSummary.total_capacity,
            0
          ),
          0
        ),

        occupied_beds: safeNumber(
          getFirstDefined(
            analysisSummary.occupied_beds,
            analysisSummary.assigned_beds,
            0
          ),
          0
        ),
        assigned_beds: safeNumber(
          getFirstDefined(
            analysisSummary.assigned_beds,
            analysisSummary.occupied_beds,
            0
          ),
          0
        ),
        available_beds: safeNumber(analysisSummary.available_beds, 0),
        occupancy_rate: safeNumber(analysisSummary.occupancy_rate, 0),
        pending_transfers: safeNumber(analysisSummary.pending_transfers, 0),
      };

      setSummary(fixedSummary);

      const occupancyRows = Array.isArray(analysisData.occupancy_data)
        ? analysisData.occupancy_data
        : [];

      const rowsFromBackend = occupancyRows.map((row) => {
        const totalBeds = safeNumber(
          getFirstDefined(row.total_beds, row.total_capacity, 0),
          0
        );

        const assignedBeds = safeNumber(
          getFirstDefined(
            row.assigned,
            row.assigned_beds,
            row.occupied_beds,
            0
          ),
          0
        );

        const availableBeds = safeNumber(
          getFirstDefined(
            row.available_beds,
            Math.max(totalBeds - assignedBeds, 0)
          ),
          0
        );

        const occupancyRate = safeNumber(
          getFirstDefined(
            row.occupancy_rate,
            totalBeds > 0 ? (assignedBeds / totalBeds) * 100 : 0
          ),
          0
        );

        return {
          id: getFirstDefined(row.building_id, row.id),
          number: getFirstDefined(row.building_number, row.number, row.building),
          dorm_type_name: getFirstDefined(row.dorm_type, row.dorm_type_name, ""),
          dorm_type_code: getFirstDefined(row.dorm_type_code, ""),
          region: getFirstDefined(row.region_id, row.region, ""),
          region_name: getFirstDefined(row.region, row.region_name, ""),
          rooms_count: safeNumber(row.rooms_count, 0),

          total_capacity: totalBeds,
          total_beds: totalBeds,

          occupied_beds: assignedBeds,
          assigned_beds: assignedBeds,

          available_beds: availableBeds,
          occupancy_rate: occupancyRate,

          is_active: row.is_active !== false,
        };
      });

      const visibleRows = rowsFromBackend.filter((building) => {
        if (isCentralAdmin()) return true;
        return canSeeRegion(building.region) || canSeeRegion(building.region_name);
      });

      setBuildingRows(visibleRows);
    } catch (err) {
      console.error("Map data load error:", err);
      setLoadError(err?.message || t.error);
    } finally {
      setLoading(false);
    }
  }, [canSeeRegion, isCentralAdmin, t.error]);

  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  // Compute where object-fit:contain places the image inside the canvas.
  // Called on image load and whenever the canvas is resized.
  const updateImgBounds = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !img.naturalWidth || !img.naturalHeight) return;

    const cW = canvas.clientWidth;
    const cH = canvas.clientHeight;
    const s = Math.min(cW / img.naturalWidth, cH / img.naturalHeight);
    const rW = img.naturalWidth * s;
    const rH = img.naturalHeight * s;

    setImgRenderedBounds({
      left: (cW - rW) / 2,
      top: (cH - rH) / 2,
      width: rW,
      height: rH,
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(updateImgBounds);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [updateImgBounds]);

  // Smoothly pan so the selected dorm is centered in the viewport.
  const centerOnDorm = useCallback((key) => {
    const area = clickableDormAreas[key];
    const bounds = imgRenderedBounds;
    const canvas = canvasRef.current;
    if (!area || !bounds || !canvas) return;

    const { width: cW, height: cH } = canvas.getBoundingClientRect();
    const dormX = bounds.left + (parseFloat(area.left) / 100) * bounds.width;
    const dormY = bounds.top + (parseFloat(area.top) / 100) * bounds.height;

    const targetPan = {
      x: cW / 2 - dormX * scale,
      y: cH / 2 - dormY * scale,
    };

    setLayerAnimated(true);
    setPan(clampPan(targetPan, scale, cW, cH));
  }, [imgRenderedBounds, scale]);

  const dormStats = useMemo(() => {
    const result = {};

    Object.keys(dormLabels).forEach((key) => {
      result[key] = {
        key,
        labelHe: dormLabels[key].he,
        labelEn: localizeLocationText(dormLabels[key].he, 'en'),
        officialBuildings: dormLabels[key].officialBuildings,
        buildingsCount: 0,
        activeBuildings: 0,
        inactiveBuildings: 0,
        roomsCount: 0,
        totalCapacity: 0,
        occupiedBeds: 0,
        availableBeds: 0,
        occupancy: 0,
        variants: new Set(),
        regionIds: new Set(),
        buildings: [],
      };
    });

    buildingRows.forEach((building) => {
      const dormName = building.dorm_type_name || "";
      const dormKey = resolveDormKey(dormName);

      if (!dormKey || !result[dormKey]) {
        console.log("MAP SKIPPED BUILDING:", {
          buildingId: building.id,
          buildingNumber: building.number,
          dormTypeName: dormName,
          dormTypeCode: building.dorm_type_code,
          region: building.region,
          regionName: building.region_name,
        });
        return;
      }

      const bucket = result[dormKey];

      const capacity = safeNumber(
        getFirstDefined(building.total_capacity, building.total_beds, 0),
        0
      );

      const occupied = safeNumber(
        getFirstDefined(
          building.occupied_beds,
          building.assigned_beds,
          building.assigned,
          0
        ),
        0
      );

      const available = safeNumber(
        getFirstDefined(
          building.available_beds,
          Math.max(capacity - occupied, 0)
        ),
        0
      );

      const rooms = safeNumber(building.rooms_count, 0);

      bucket.buildingsCount += 1;
      bucket.roomsCount += rooms;
      bucket.totalCapacity += capacity;
      bucket.occupiedBeds += occupied;
      bucket.availableBeds += available;
      bucket.variants.add(inferDormTypeVariant(dormName));
      bucket.regionIds.add(String(building.region || building.region_name || ""));

      if (building.is_active === false) {
        bucket.inactiveBuildings += 1;
      } else {
        bucket.activeBuildings += 1;
      }

      bucket.buildings.push({
        id: building.id,
        number: building.number,
        dormTypeName: dormName,
        region: building.region,
        regionName: building.region_name,
        roomsCount: rooms,
        capacity,
        occupied,
        available,
        occupancy:
          capacity > 0
            ? Math.round((occupied / capacity) * 100)
            : safeNumber(building.occupancy_rate, 0),
        isActive: building.is_active,
      });
    });

    Object.values(result).forEach((bucket) => {
      bucket.availableBeds = Math.max(bucket.totalCapacity - bucket.occupiedBeds, 0);
      bucket.occupancy =
        bucket.totalCapacity > 0
          ? Math.round((bucket.occupiedBeds / bucket.totalCapacity) * 100)
          : 0;

      bucket.buildings.sort((a, b) =>
        String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
      );
    });

    return result;
  }, [buildingRows]);

  const filteredDormKeys = useMemo(() => {
    const search = normalizeText(searchTerm);

    return Object.keys(dormLabels).filter((key) => {
      const dorm = dormStats[key];

      if (!dorm) return false;

      const matchesType =
        typeFilter === "all" ||
        dorm.variants.has(typeFilter) ||
        dorm.buildingsCount === 0;

      const label = `${dorm.labelEn} ${dorm.labelHe}`;
      const matchesSearch = !search || normalizeText(label).includes(search);

      return matchesType && matchesSearch;
    });
  }, [dormStats, searchTerm, typeFilter]);

  const selectedDorm = selectedDormKey ? dormStats[selectedDormKey] : null;

  const systemTotals = useMemo(() => {
    const officialBuildings = Object.values(dormLabels).reduce(
      (sum, dorm) => sum + (dorm.officialBuildings || 0),
      0
    );

    return {
      officialBuildings,
      databaseBuildings: safeNumber(
        getFirstDefined(summary?.total_buildings, summary?.active_buildings, 0),
        0
      ),
      capacity: safeNumber(
        getFirstDefined(summary?.total_capacity, summary?.total_beds, 0),
        0
      ),
      occupied: safeNumber(
        getFirstDefined(summary?.occupied_beds, summary?.assigned_beds, 0),
        0
      ),
      available: safeNumber(summary?.available_beds, 0),
    };
  }, [summary]);

  const getDormStatus = (dorm) => {
    if (!dorm || dorm.totalCapacity <= 0) return t.noCapacity;

    const cls = occupancyClass(dorm.occupancy, dorm.availableBeds, dorm.totalCapacity);

    if (cls === "full") return t.full;
    if (cls === "danger" || cls === "warn") return t.almostFull;
    return t.available;
  };

  const handleCanvasClick = (e) => {
    if (!calibrateMode) return;

    const el = canvasRef.current;

    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const worldX = (cx - pan.x) / scale;
    const worldY = (cy - pan.y) / scale;

    // Coordinates relative to the rendered image area (not the full canvas).
    const b = imgRenderedBounds;
    const imgX = worldX - (b ? b.left : 0);
    const imgY = worldY - (b ? b.top : 0);
    const imgW = b ? b.width : rect.width;
    const imgH = b ? b.height : rect.height;

    const leftPct = (imgX / imgW) * 100;
    const topPct = (imgY / imgH) * 100;

    console.log(
      `CLICK AREA POSITION => top: "${topPct.toFixed(1)}%", left: "${leftPct.toFixed(1)}%"`
    );
  };

  return (
    <div className="map-page" dir={language === "he" ? "rtl" : "ltr"}>
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
          {!isCentralAdmin() && <p className="restricted-note">{t.restricted}</p>}
        </div>

        <div className="header-actions">
          <div className="search-box">
            <Search size={16} />
            <input
              value={searchTerm}
              placeholder={t.searchPlaceholder}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-box">
            <Filter size={16} />
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setSelectedDormKey(null);
              }}
            >
              <option value="all">{t.all}</option>
              <option value="base">{t.base}</option>
              <option value="couples">{t.couples}</option>
              <option value="family">{t.family}</option>
            </select>
          </div>

          <button className="primary-btn" type="button" onClick={loadMapData}>
            <RefreshCcw size={16} />
            {t.refresh}
          </button>
        </div>
      </div>

      <div className="summary-strip">
        <div className="summary-card">
          <Building2 size={18} />
          <span>{t.officialBuildings}</span>
          <strong>{systemTotals.officialBuildings}</strong>
        </div>

        <div className="summary-card">
          <Building2 size={18} />
          <span>{t.databaseBuildings}</span>
          <strong>{systemTotals.databaseBuildings}</strong>
        </div>

        <div className="summary-card">
          <Home size={18} />
          <span>{t.capacity}</span>
          <strong>{systemTotals.capacity}</strong>
        </div>

        <div className="summary-card">
          <Users size={18} />
          <span>{t.occupiedBeds}</span>
          <strong>{systemTotals.occupied}</strong>
        </div>

        <div className="summary-card success">
          <CheckCircle size={18} />
          <span>{t.availableBeds}</span>
          <strong>{systemTotals.available}</strong>
        </div>
      </div>

      {loading ? (
        <div className="state-box">{t.loading}</div>
      ) : loadError ? (
        <div className="state-box error">
          <AlertCircle size={18} />
          <span>{loadError}</span>
        </div>
      ) : (
        <div className="map-shell">
          <div className="map-card">
            <div className="map-toolbar">
              <div className="toolbar-left">
                <span className="toolbar-title">{t.zoom}</span>

                <button className="icon-btn" type="button" onClick={zoomIn}>
                  <ZoomIn size={16} />
                </button>

                <button className="icon-btn" type="button" onClick={zoomOut}>
                  <ZoomOut size={16} />
                </button>

                <button className="icon-btn" type="button" onClick={resetView}>
                  <Maximize2 size={16} />
                </button>

                <button
                  className={`pill-btn ${calibrateMode ? "active" : ""}`}
                  type="button"
                  onClick={() => setCalibrateMode((v) => !v)}
                >
                  {calibrateMode ? t.calibrateOn : t.calibrate}
                </button>
              </div>

              <div className="toolbar-hint">
                <Move size={14} />
                <span>{t.panHint}</span>
                <strong>{Math.round(scale * 100)}%</strong>
              </div>
            </div>

            <div
              ref={canvasRef}
              className={`map-canvas ${isDragging ? "dragging" : ""} ${
                calibrateMode ? "calibrating" : ""
              }`}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onWheel={onWheel}
              onClick={handleCanvasClick}
            >
              <div
                className="map-layer"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  transformOrigin: "0 0",
                  transition: layerAnimated ? "transform 0.25s ease" : "none",
                }}
              >
                <img
                  ref={imgRef}
                  className="map-img"
                  src={MAP_SRC}
                  alt="Dormify demonstration housing map"
                  draggable={false}
                  onLoad={updateImgBounds}
                />

                {imgRenderedBounds && (
                  <div
                    className="map-overlay"
                    style={{
                      left: imgRenderedBounds.left,
                      top: imgRenderedBounds.top,
                      width: imgRenderedBounds.width,
                      height: imgRenderedBounds.height,
                    }}
                  >
                    {filteredDormKeys.map((key) => {
                      const area = clickableDormAreas[key];
                      const dorm = dormStats[key];

                      if (!area || !dorm) return null;

                      const cls = occupancyClass(
                        dorm.occupancy,
                        dorm.availableBeds,
                        dorm.totalCapacity
                      );

                      return (
                        <button
                          key={key}
                          type="button"
                          className={`click-area ${cls} ${
                            selectedDormKey === key ? "selected" : ""
                          }`}
                          style={{
                            top: area.top,
                            left: area.left,
                            width: area.width,
                            height: area.height,
                          }}
                          title={`${
                            language === "he" ? dorm.labelHe : dorm.labelEn
                          } — ${t.occupancy}: ${formatPercent(dorm.occupancy)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDormKey(key);
                            centerOnDorm(key);
                          }}
                        >
                          <span className="sr-only">
                            {language === "he" ? dorm.labelHe : dorm.labelEn}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="legend">
              <span className="legend-map-note">
                {language === "he"
                  ? "צבעי המפה = אזורי מגורים"
                  : "Map colors = dorm regions"}
              </span>
              <div className="legend-divider" />
              <span className="legend-map-note">
                {language === "he"
                  ? "לחצי על מעון לפרטי תפוסה"
                  : "Click a dorm for occupancy details"}
              </span>
            </div>
          </div>

          <aside className="info-panel">
            {selectedDorm ? (
              <>
                <div className="panel-head">
                  <div>
                    <h2>
                      {language === "he"
                        ? selectedDorm.labelHe
                        : selectedDorm.labelEn}
                    </h2>
                    <p>{t.sourceNote}</p>
                  </div>

                  <button
                    className="close-btn"
                    type="button"
                    onClick={() => setSelectedDormKey(null)}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div
                  className={`status-card ${occupancyClass(
                    selectedDorm.occupancy,
                    selectedDorm.availableBeds,
                    selectedDorm.totalCapacity
                  )}`}
                >
                  <span>{t.status}</span>
                  <strong>{getDormStatus(selectedDorm)}</strong>
                  <b>{formatPercent(selectedDorm.occupancy)}</b>
                </div>

                <div className="kpi-grid">
                  <div className="kpi">
                    <span>{t.officialBuildings}</span>
                    <strong>{selectedDorm.officialBuildings}</strong>
                  </div>

                  <div className="kpi">
                    <span>{t.databaseBuildings}</span>
                    <strong>{selectedDorm.buildingsCount}</strong>
                  </div>

                  <div className="kpi">
                    <span>{t.activeBuildings}</span>
                    <strong>{selectedDorm.activeBuildings}</strong>
                  </div>

                  <div className="kpi">
                    <span>{t.inactiveBuildings}</span>
                    <strong>{selectedDorm.inactiveBuildings}</strong>
                  </div>

                  <div className="kpi">
                    <span>{t.rooms}</span>
                    <strong>{selectedDorm.roomsCount}</strong>
                  </div>

                  <div className="kpi">
                    <span>{t.capacity}</span>
                    <strong>{selectedDorm.totalCapacity}</strong>
                  </div>

                  <div className="kpi">
                    <span>{t.occupiedBeds}</span>
                    <strong>{selectedDorm.occupiedBeds}</strong>
                  </div>

                  <div className="kpi available">
                    <span>{t.availableBeds}</span>
                    <strong>{selectedDorm.availableBeds}</strong>
                  </div>
                </div>

                <div className="occupancy-box">
                  <div className="occupancy-top">
                    <span>{t.occupancyDetails}</span>
                    <strong>{formatPercent(selectedDorm.occupancy)}</strong>
                  </div>

                  <div className="progress">
                    <div
                      className={`progress-fill ${occupancyClass(
                        selectedDorm.occupancy,
                        selectedDorm.availableBeds,
                        selectedDorm.totalCapacity
                      )}`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(0, selectedDorm.occupancy)
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="occupancy-bottom">
                    <span>
                      {selectedDorm.occupiedBeds}/{selectedDorm.totalCapacity}
                    </span>
                    <span>
                      {selectedDorm.availableBeds} {t.availableBeds}
                    </span>
                  </div>
                </div>

                <div className="buildings-section">
                  <h3>{t.buildingsList}</h3>

                  {selectedDorm.buildings.length > 0 ? (
                    <div className="building-list">
                      {selectedDorm.buildings.map((building) => (
                        <div
                          className="building-row"
                          key={`${building.id}-${building.number}`}
                        >
                          <div>
                            <strong>
                              {t.building} {building.number}
                            </strong>
                            <span>
                              {building.dormTypeName}
                              {building.regionName ? ` · ${building.regionName}` : ""}
                            </span>
                          </div>

                          <div className="building-mini">
                            <b>{formatPercent(building.occupancy)}</b>
                            <small>
                              {building.occupied}/{building.capacity}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="no-data">{t.noData}</p>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-panel">
                <h2>{t.selectDorm}</h2>
                <p>{t.selectDormSub}</p>
              </div>
            )}
          </aside>
        </div>
      )}

      <style>{`
        .map-page {
          min-height: 100vh;
          padding: 24px;
          background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
          color: #0f172a;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 14px;
          padding: 18px 20px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
        }

        .page-header h1 {
          margin: 0 0 6px;
          font-size: 26px;
          font-weight: 900;
          color: #0f172a;
        }

        .page-header p {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #64748b;
        }

        .restricted-note {
          margin-top: 8px !important;
          color: #2563eb !important;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .search-box,
        .filter-box {
          height: 40px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          color: #475569;
        }

        .search-box input {
          width: 160px;
          border: none;
          outline: none;
          background: transparent;
          color: #0f172a;
          font-weight: 700;
        }

        .filter-box select {
          border: none;
          outline: none;
          background: transparent;
          color: #0f172a;
          font-weight: 800;
          cursor: pointer;
        }

        .primary-btn {
          height: 40px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 14px;
          border: none;
          border-radius: 12px;
          background: #2563eb;
          color: white;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(37, 99, 235, 0.22);
        }

        .summary-strip {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }

        .summary-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 5px 16px rgba(15, 23, 42, 0.06);
        }

        .summary-card svg {
          color: #2563eb;
          flex-shrink: 0;
        }

        .summary-card.success svg {
          color: #059669;
        }

        .summary-card span {
          flex: 1;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .summary-card strong {
          color: #0f172a;
          font-size: 20px;
          font-weight: 950;
        }

        .state-box {
          background: white;
          border-radius: 18px;
          padding: 26px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: #475569;
          font-weight: 800;
          box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
        }

        .state-box.error {
          color: #b91c1c;
        }

        .map-shell {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 390px;
          gap: 16px;
          align-items: start;
        }

        .map-card {
          position: relative;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.12);
        }

        .map-toolbar {
          position: absolute;
          left: 14px;
          right: 14px;
          top: 14px;
          z-index: 40;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          pointer-events: none;
        }

        .toolbar-left,
        .toolbar-hint {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
          backdrop-filter: blur(8px);
        }

        .toolbar-title {
          font-size: 11px;
          font-weight: 950;
          color: #334155;
          text-transform: uppercase;
        }

        .icon-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 10px;
          background: #f1f5f9;
          color: #334155;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .icon-btn:hover {
          background: #e2e8f0;
        }

        .pill-btn {
          height: 32px;
          border: 1px solid #cbd5e1;
          border-radius: 999px;
          background: white;
          color: #334155;
          padding: 0 10px;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }

        .pill-btn.active {
          background: #eff6ff;
          border-color: #2563eb;
          color: #1d4ed8;
        }

        .toolbar-hint {
          color: #475569;
          font-size: 12px;
          font-weight: 800;
        }

        .toolbar-hint strong {
          color: #0f172a;
        }

        .map-canvas {
          position: relative;
          height: calc(100vh - 270px);
          min-height: 620px;
          max-height: 900px;
          overflow: hidden;
          background: #f8fafc;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
        }

        .map-canvas.dragging {
          cursor: grabbing;
        }

        .map-canvas.calibrating {
          cursor: crosshair;
        }

        .map-layer {
          position: absolute;
          inset: 0;
        }

        .map-overlay {
          position: absolute;
        }

        .map-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          user-select: none;
          pointer-events: none;
        }

        .click-area {
          position: absolute;
          transform: translate(-50%, -50%);
          border-radius: 8px;
          border: 1.5px solid transparent;
          background: transparent;
          cursor: pointer;
          z-index: 20;
          transition: background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .click-area:hover {
          background: rgba(255, 255, 255, 0.22);
          border-color: rgba(255, 255, 255, 0.6);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.14);
        }

        .click-area.selected {
          background: rgba(37, 99, 235, 0.14);
          border-color: rgba(37, 99, 235, 0.6);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }

        .click-area.selected:hover {
          background: rgba(37, 99, 235, 0.20);
        }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        .legend {
          position: absolute;
          left: 14px;
          bottom: 14px;
          z-index: 35;
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
          backdrop-filter: blur(8px);
        }

        .legend-divider {
          width: 1px;
          height: 14px;
          background: #cbd5e1;
          flex-shrink: 0;
        }

        .legend-map-note {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          white-space: nowrap;
        }

        .info-panel {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.1);
          position: sticky;
          top: 16px;
          max-height: calc(100vh - 48px);
          overflow: auto;
        }

        .panel-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          padding-bottom: 14px;
          border-bottom: 1px solid #e2e8f0;
          margin-bottom: 14px;
        }

        .panel-head h2,
        .empty-panel h2 {
          margin: 0 0 6px;
          font-size: 22px;
          font-weight: 950;
          color: #0f172a;
        }

        .panel-head p,
        .empty-panel p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.5;
        }

        .close-btn {
          border: none;
          border-radius: 10px;
          background: #f1f5f9;
          color: #64748b;
          cursor: pointer;
          padding: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .status-card {
          padding: 14px;
          border-radius: 16px;
          margin-bottom: 14px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
          align-items: center;
          color: white;
        }

        .status-card span {
          font-size: 12px;
          font-weight: 900;
          opacity: 0.9;
        }

        .status-card strong {
          font-size: 18px;
          font-weight: 950;
        }

        .status-card b {
          grid-row: span 2;
          font-size: 28px;
          font-weight: 950;
        }

        .status-card.good {
          background: linear-gradient(135deg, #10b981, #059669);
        }

        .status-card.warn {
          background: linear-gradient(135deg, #f59e0b, #d97706);
        }

        .status-card.danger {
          background: linear-gradient(135deg, #f97316, #ea580c);
        }

        .status-card.full {
          background: linear-gradient(135deg, #ef4444, #dc2626);
        }

        .status-card.neutral {
          background: linear-gradient(135deg, #64748b, #475569);
        }

        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }

        .kpi {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .kpi span {
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
        }

        .kpi strong {
          color: #0f172a;
          font-size: 22px;
          font-weight: 950;
        }

        .kpi.available strong {
          color: #059669;
        }

        .occupancy-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 14px;
          margin-bottom: 16px;
        }

        .occupancy-top,
        .occupancy-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .occupancy-top {
          margin-bottom: 10px;
        }

        .occupancy-top span {
          font-size: 12px;
          color: #475569;
          font-weight: 950;
          text-transform: uppercase;
        }

        .occupancy-top strong {
          color: #0f172a;
          font-size: 16px;
          font-weight: 950;
        }

        .progress {
          height: 12px;
          border-radius: 999px;
          background: #e2e8f0;
          overflow: hidden;
          margin-bottom: 10px;
        }

        .progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.25s ease;
        }

        .progress-fill.good {
          background: #10b981;
        }

        .progress-fill.warn {
          background: #f59e0b;
        }

        .progress-fill.danger {
          background: #f97316;
        }

        .progress-fill.full {
          background: #ef4444;
        }

        .progress-fill.neutral {
          background: #64748b;
        }

        .occupancy-bottom {
          font-size: 12px;
          color: #64748b;
          font-weight: 800;
        }

        .buildings-section h3 {
          margin: 0 0 10px;
          font-size: 15px;
          font-weight: 950;
          color: #0f172a;
        }

        .building-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .building-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 10px;
        }

        .building-row strong {
          display: block;
          margin-bottom: 3px;
          font-size: 13px;
          font-weight: 950;
          color: #0f172a;
        }

        .building-row span {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
        }

        .building-mini {
          min-width: 70px;
          text-align: end;
        }

        .building-mini b {
          display: block;
          color: #0f172a;
          font-size: 16px;
          font-weight: 950;
        }

        .building-mini small {
          color: #64748b;
          font-weight: 800;
        }

        .empty-panel {
          padding: 24px 8px;
          text-align: center;
        }

        .no-data {
          margin: 0;
          padding: 14px;
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          border-radius: 12px;
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
          text-align: center;
        }

        @media (max-width: 1200px) {
          .map-shell {
            grid-template-columns: 1fr;
          }

          .info-panel {
            position: static;
            max-height: none;
          }

          .map-canvas {
            height: 620px;
          }
        }

        @media (max-width: 900px) {
          .map-page {
            padding: 14px;
          }

          .page-header {
            flex-direction: column;
          }

          .header-actions {
            width: 100%;
            justify-content: stretch;
          }

          .search-box {
            flex: 1;
          }

          .search-box input {
            width: 100%;
          }

          .summary-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .map-toolbar {
            align-items: flex-start;
            flex-direction: column;
          }

          .toolbar-hint {
            display: none;
          }

          .map-canvas {
            min-height: 480px;
            height: 520px;
          }
        }
      `}</style>
    </div>
  );
}
