import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Filter,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  Building2,
  Home,
  AlertCircle,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

const MAP_FILE = "dormMap.png";
const MAP_SRC = `/maps/${MAP_FILE}`;

const dormPositions = {
  canada: { top: "7.0%", left: "60.5%" },
  rifkin: { top: "32.0%", left: "28.5%" },
  senate: { top: "52.5%", left: "32.5%" },
  "kfar-hasmaha": { top: "76.5%", left: "10.5%" },
  "mizrach-yashan": { top: "86.5%", left: "66.0%" },
  "mizrach-hadash": { top: "89.0%", left: "86.0%" },
  "senate-renovated": { top: "55.5%", left: "38.0%" },
  "segal-zutar": { top: "60.0%", left: "74.0%" },
  broshim: { top: "10.0%", left: "45.0%" },
  "neve-america": { top: "40.0%", left: "12.0%" },
  "ha-amim": { top: "72.0%", left: "70.0%" },
};

const dormLabels = {
  canada: { he: "קנדה", en: "Canada" },
  "mizrach-yashan": { he: "מזרח ישן (הלל קפלן)", en: "Mizrach Yashan (Hillel Kaplan)" },
  "mizrach-hadash": { he: "מזרח חדש", en: "Mizrach Hadash" },
  rifkin: { he: "ריפקין", en: "Rifkin" },
  senate: { he: "הסנט", en: "Senate" },
  "kfar-hasmaha": { he: "כפר משתלמים", en: "Kfar Mishtalmim" },
  "senate-renovated": { he: "סנאט משופץ", en: "Senate Renovated" },
  "segal-zutar": { he: "סגל זוטר", en: "Segal Zutar" },
  broshim: { he: "ברושים", en: "Broshim" },
  "neve-america": { he: "נווה אמריקה", en: "Neve America" },
  "ha-amim": { he: "העמים", en: "Ha-Amim" },
};

const DORM_KEY_ALIASES = [
  { key: "canada", matches: ["canada", "קנדה"] },
  { key: "mizrach-yashan", matches: ["mizrach yashan", "mizrah yashan", "מזרח ישן", "הלל קפלן"] },
  { key: "mizrach-hadash", matches: ["mizrach hadash", "mizrah hadash", "מזרח חדש"] },
  { key: "rifkin", matches: ["rifkin", "ריפקין"] },
  { key: "senate", matches: ["senate", "הסנט", "סנט", "senat"] },
  { key: "kfar-hasmaha", matches: ["kfar mishtalmim", "kfar hasmaha", "כפר משתלמים", "כפר הסמכה"] },
  { key: "senate-renovated", matches: ["senate renovated", "סנאט משופץ", "סנט חדש"] },
  { key: "segal-zutar", matches: ["segal zutar", "סגל זוטר"] },
  { key: "broshim", matches: ["broshim", "ברושים"] },
  { key: "neve-america", matches: ["neve america", "נווה אמריקה"] },
  { key: "ha-amim", matches: ["ha-amim", "ha amim", "העמים"] },
];

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\//g, " ");

function resolveDormKey(name) {
  const raw = normalizeText(name);
  for (const item of DORM_KEY_ALIASES) {
    if (item.matches.some((m) => raw.includes(normalizeText(m)))) {
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

  if (raw.includes("couple") || raw.includes("couples") || raw.includes("זוג") || raw.includes("זוגות")) {
    return "couples";
  }

  return "base";
}

function occupancyClass(occ) {
  if (occ >= 90) return "danger";
  if (occ >= 70) return "warn";
  return "good";
}

export default function MapPage({ language = "en" }) {
    const {canAccessRegion, isCentralAdmin} = useAuth();

    const [typeFilter, setTypeFilter] = useState("all");
    const [selectedDormKey, setSelectedDormKey] = useState(null);
    const [calibrateMode, setCalibrateMode] = useState(false);

    const [buildingsData, setBuildingsData] = useState([]);
    const [roomsByBuilding, setRoomsByBuilding] = useState({});
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    const canvasRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({x: 0, y: 0});
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({x: 0, y: 0});
    const panStart = useRef({x: 0, y: 0});

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const ZOOM_MIN = 0.85;
    const ZOOM_MAX = 2.75;
    const ZOOM_STEP = 0.15;

    const t = {
        he: {
            title: "מפת המעונות",
            subtitle: "בחירת אזור במפה מציגה נתוני תפוסה אמיתיים",
            filterTitle: "סינון לפי סוג",
            all: "הכל",
            base: "יחידים",
            couples: "זוגות",
            family: "משפחות",
            buildings: "בניינים",
            rooms: "חדרים",
            capacity: "קיבולת",
            occupancy: "תפוסה",
            availableBeds: "מיטות פנויות",
            dormTypeLabel: "סוג מעונות",
            zoom: "זום",
            panHint: "גרור/י להזזה",
            occupancyDetails: "פרטי תפוסה",
            calibrate: "כיול",
            calibrateOn: "כיול פועל (קליק מציג קואורדינטות בקונסול)",
            calibrateOff: "כיול כבוי",
            loading: "טוען נתוני מפה...",
            error: "שגיאה בטעינת נתוני המפה",
            empty: "אין נתונים זמינים עבור הבחירה הנוכחית",
            mapPath: "מפה",
            restricted: "מוצגים רק הנתונים המותרים למשתמש הנוכחי",
            selectDorm: "בחר/י אזור במפה",
            selectDormSub: "לחיצה על סיכת מעון תציג נתוני תפוסה אמיתיים.",
            refresh: "רענון נתונים",
        },
        en: {
            title: "Dormitory Map",
            subtitle: "Select an area on the map to view real occupancy data",
            filterTitle: "Filter by type",
            all: "All",
            base: "Base",
            couples: "Couples",
            family: "Family",
            buildings: "Buildings",
            rooms: "Rooms",
            capacity: "Capacity",
            occupancy: "Occupancy",
            availableBeds: "Available Beds",
            dormTypeLabel: "Dorm Type",
            zoom: "Zoom",
            panHint: "Drag to pan",
            occupancyDetails: "Occupancy Details",
            calibrate: "Calibrate",
            calibrateOn: "Calibration ON (click prints coords in console)",
            calibrateOff: "Calibration OFF",
            loading: "Loading map data...",
            error: "Failed to load map data",
            empty: "No data available for the current selection",
            mapPath: "Map",
            restricted: "Showing only data allowed for the current user",
            selectDorm: "Select an area on the map",
            selectDormSub: "Click a dorm pin to view real occupancy details.",
            refresh: "Refresh Data",
        },
    }[language];

    const resetView = () => {
        setScale(1);
        setPan({x: 0, y: 0});
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
        setPan({x: nextPanX, y: nextPanY});
    };

    const zoomIn = () => {
        const next = clamp(Number((scale + ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX);
        const el = canvasRef.current;
        if (!el) return setScale(next);
        const rect = el.getBoundingClientRect();
        zoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    const zoomOut = () => {
        const next = clamp(Number((scale - ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX);
        const el = canvasRef.current;
        if (!el) return setScale(next);
        const rect = el.getBoundingClientRect();
        zoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        setIsDragging(true);
        dragStart.current = {x: e.clientX, y: e.clientY};
        panStart.current = {...pan};
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setPan({x: panStart.current.x + dx, y: panStart.current.y + dy});
    };

    const onMouseUp = () => setIsDragging(false);

    const onWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? +ZOOM_STEP : -ZOOM_STEP;
        const next = clamp(Number((scale + delta).toFixed(2)), ZOOM_MIN, ZOOM_MAX);
        zoomAt(next, e.clientX, e.clientY);
    };

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const handler = (e) => e.preventDefault();
        el.addEventListener("wheel", handler, {passive: false});
        return () => el.removeEventListener("wheel", handler);
    }, []);

    const loadMapData = useCallback(async () => {
        setLoading(true);
        setLoadError("");

        try {
            const buildingsRes = await api.get("/api/buildings/");
            const rawBuildings = Array.isArray(buildingsRes?.data)
                ? buildingsRes.data
                : buildingsRes?.data?.results || [];

            const visibleBuildings = rawBuildings.filter((b) => {
                if (isCentralAdmin()) return true;
                return canAccessRegion(b.region);
            });

            const roomResponses = await Promise.all(
                visibleBuildings.map(async (building) => {
                    try {
                        const res = await api.get(`/api/buildings/${building.id}/rooms/`);
                        return {
                            buildingId: building.id,
                            rooms: res?.data?.rooms || [],
                        };
                    } catch {
                        return {
                            buildingId: building.id,
                            rooms: [],
                        };
                    }
                })
            );

            const nextRoomsByBuilding = {};
            roomResponses.forEach(({buildingId, rooms}) => {
                nextRoomsByBuilding[buildingId] = rooms;
            });

            setBuildingsData(visibleBuildings);
            setRoomsByBuilding(nextRoomsByBuilding);
        } catch (err) {
            setLoadError(err?.message || t.error);
        } finally {
            setLoading(false);
        }
    }, [canAccessRegion, isCentralAdmin, t.error]);

    useEffect(() => {
        loadMapData();
    }, [loadMapData]);


    const dormStats = useMemo(() => {
    const result = {};

    const ensureBucket = (key, label) => {
        if (!result[key]) {
            result[key] = {
                key,
                labelHe: dormLabels[key]?.he || label || key,
                labelEn: dormLabels[key]?.en || label || key,

                buildingsCount: 0,
                roomsCount: 0,

                // Raw capacity from Room.capacity
                totalCapacity: 0,

                // Real occupancy from active BedAssignment, through Room.current_occupancy
                occupiedBeds: 0,

                // Calculated as totalCapacity - occupiedBeds
                availableBeds: 0,

                // Extra useful counters
                occupiedRooms: 0,
                fullRooms: 0,
                emptyRooms: 0,

                variants: new Set(),
                regionIds: new Set(),

                // Debug only: buildings that entered this dorm bucket
                buildings: [],
            };
        }

        return result[key];
    };

    buildingsData.forEach((building) => {
        const dormName = building.dorm_type_name || "";
        const dormKey = resolveDormKey(dormName);

        // Important debug:
        // If this appears in the browser console, it means this building exists
        // in the API, but Map.js does not know which map pin/dorm group it belongs to.
        if (!dormKey) {
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

        const bucket = ensureBucket(dormKey, dormName);

        bucket.buildingsCount += 1;
        bucket.variants.add(inferDormTypeVariant(dormName));
        bucket.regionIds.add(String(building.region || ""));

        bucket.buildings.push({
            id: building.id,
            number: building.number,
            dormTypeName: dormName,
            region: building.region,
            regionName: building.region_name,
        });

        const rooms = roomsByBuilding[building.id] || [];
        bucket.roomsCount += rooms.length;

        rooms.forEach((room) => {
            const capacity = Number(room.capacity || 0);

            // This comes from the backend Room.current_occupancy property.
            // It is based on active BedAssignment rows.
            const occupied = Number(room.current_occupancy || 0);

            const available = Math.max(capacity - occupied, 0);

            bucket.totalCapacity += capacity;
            bucket.occupiedBeds += occupied;
            bucket.availableBeds += available;

            if (occupied === 0) {
                bucket.emptyRooms += 1;
            }

            if (occupied > 0) {
                bucket.occupiedRooms += 1;
            }

            if (capacity > 0 && occupied >= capacity) {
                bucket.fullRooms += 1;
            }
        });
    });

    Object.values(result).forEach((bucket) => {
        bucket.availableBeds = Math.max(bucket.totalCapacity - bucket.occupiedBeds, 0);

        bucket.occupancy =
            bucket.totalCapacity > 0
                ? Math.round((bucket.occupiedBeds / bucket.totalCapacity) * 100)
                : 0;

        bucket.roomOccupancy =
            bucket.roomsCount > 0
                ? Math.round((bucket.occupiedRooms / bucket.roomsCount) * 100)
                : 0;
    });

    console.log("MAP DORM STATS:", result);

    return result;
}, [buildingsData, roomsByBuilding]);


    const accessibleDorms = useMemo(() => {
        return Object.values(dormStats)
            .filter((dorm) => {
                if (isCentralAdmin()) return true;
                const regionIds = Array.from(dorm.regionIds).filter(Boolean);
                return regionIds.some((regionId) => canAccessRegion(regionId));
            })
            .sort((a, b) => a.labelEn.localeCompare(b.labelEn));
    }, [canAccessRegion, dormStats, isCentralAdmin]);

    const filteredDorms = useMemo(() => {
        return accessibleDorms.filter((dorm) => {
            if (typeFilter === "all") return true;
            return dorm.variants.has(typeFilter);
        });
    }, [accessibleDorms, typeFilter]);

    const selectedDorm = selectedDormKey ? dormStats[selectedDormKey] : null;

    return (
        <div className="map-page" dir={language === "he" ? "rtl" : "ltr"}>
            <div className="page-header">
                <div className="titles">
                    <h1>{t.title}</h1>
                    <p>{t.subtitle}</p>
                    <p className="map-path">
                        <strong>{t.mapPath}:</strong> <code>{MAP_SRC}</code>
                    </p>
                    {!isCentralAdmin() && <p className="restricted-note">{t.restricted}</p>}
                </div>

                <div className="filter">
                    <div className="filter-label">
                        <Filter size={16}/>
                        <span>{t.filterTitle}</span>
                    </div>
                    <select
                        value={typeFilter}
                        onChange={(e) => {
                            setTypeFilter(e.target.value);
                            setSelectedDormKey(null);
                            resetView();
                        }}
                    >
                        <option value="all">{t.all}</option>
                        <option value="base">{t.base}</option>
                        <option value="couples">{t.couples}</option>
                        <option value="family">{t.family}</option>
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="state-box">{t.loading}</div>
            ) : loadError ? (
                <div className="state-box error">
                    <AlertCircle size={18}/>
                    <span>{loadError}</span>
                </div>
            ) : (
                <div className="map-shell">
                    <div className="map-canvas-wrap">
                        <div className="controls">
                            <div className="controls-row">
                                <div className="controls-title">{t.zoom}</div>

                                <div className="btnrow">
                                    <button className="iconbtn" onClick={zoomIn} type="button">
                                        <ZoomIn size={16}/>
                                    </button>
                                    <button className="iconbtn" onClick={zoomOut} type="button">
                                        <ZoomOut size={16}/>
                                    </button>
                                    <button className="iconbtn" onClick={resetView} type="button">
                                        <RotateCcw size={16}/>
                                    </button>
                                    <button
                                        className={`pillbtn ${calibrateMode ? "on" : ""}`}
                                        type="button"
                                        onClick={() => setCalibrateMode((v) => !v)}
                                        title={calibrateMode ? t.calibrateOn : t.calibrateOff}
                                    >
                                        {t.calibrate}
                                    </button>
                                </div>

                                <div className="meta">
                                    <span className="zoom-val">{Math.round(scale * 100)}%</span>
                                    <span className="pan-hint">
                    <Move size={13}/> {t.panHint}
                  </span>
                                </div>
                            </div>

                            <button className="refresh-btn" type="button" onClick={loadMapData}>
                                {t.refresh}
                            </button>
                        </div>

                        <div
                            ref={canvasRef}
                            className={`map-canvas ${isDragging ? "dragging" : ""} ${calibrateMode ? "calibrating" : ""}`}
                            onMouseDown={(e) => {
                                if (calibrateMode) return;
                                onMouseDown(e);
                            }}
                            onMouseMove={onMouseMove}
                            onMouseUp={onMouseUp}
                            onMouseLeave={onMouseUp}
                            onWheel={onWheel}
                            onClick={(e) => {
                                if (!calibrateMode) {
                                    setSelectedDormKey(null);
                                    return;
                                }

                                const el = canvasRef.current;
                                if (!el) return;

                                const rect = el.getBoundingClientRect();
                                const cx = e.clientX - rect.left;
                                const cy = e.clientY - rect.top;

                                const worldX = (cx - pan.x) / scale;
                                const worldY = (cy - pan.y) / scale;

                                const leftPct = (worldX / rect.width) * 100;
                                const topPct = (worldY / rect.height) * 100;

                                console.log(`PIN => top: '${topPct.toFixed(1)}%', left: '${leftPct.toFixed(1)}%'`);
                            }}
                        >
                            <div
                                className="map-layer"
                                style={{
                                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                                    transformOrigin: "0 0",
                                }}
                            >
                                <img className="map-img" src={MAP_SRC} alt="Technion dorms indexed map"
                                     draggable={false}/>

                                {filteredDorms.map((dorm) => {
                                    const pos = dormPositions[dorm.key];
                                    if (!pos) return null;

                                    const label = language === "he" ? dorm.labelHe : dorm.labelEn;
                                    const occClass = occupancyClass(dorm.occupancy);

                                    return (
                                        <button
                                            key={dorm.key}
                                            className={`pin ${occClass} ${selectedDormKey === dorm.key ? "active" : ""}`}
                                            style={{top: pos.top, left: pos.left}}
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                setSelectedDormKey(dorm.key);
                                            }}
                                            title={`${label} — ${t.occupancy}: ${dorm.occupancy}%`}
                                            type="button"
                                        >
                                            <span className="pin-dot"/>
                                            <span className="pin-name">{label}</span>
                                            <span className="pin-badge">{dorm.occupancy}%</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="panel">
                        {selectedDorm ? (
                            <>
                                <div className="panel-head">
                                    <div>
                                        <div className="panel-title">
                                            {language === "he" ? selectedDorm.labelHe : selectedDorm.labelEn}
                                        </div>
                                        <div className="panel-sub">
                                            {t.dormTypeLabel}:{" "}
                                            {typeFilter === "all"
                                                ? t.all
                                                : typeFilter === "base"
                                                    ? t.base
                                                    : typeFilter === "couples"
                                                        ? t.couples
                                                        : t.family}
                                        </div>
                                    </div>

                                    <button className="close" onClick={() => setSelectedDormKey(null)} type="button">
                                        <X size={18}/>
                                    </button>
                                </div>

                                <div className="kpis">
                                    <div className="kpi">
                                        <Building2 size={16}/>
                                        <span className="kpi-val">{selectedDorm.buildingsCount}</span>
                                        <span className="kpi-lbl">{t.buildings}</span>
                                    </div>
                                    <div className="kpi">
                                        <Home size={16}/>
                                        <span className="kpi-val">{selectedDorm.roomsCount}</span>
                                        <span className="kpi-lbl">{t.rooms}</span>
                                    </div>
                                </div>

                                <div className="details-grid">
                                    <div className="detail-card">
                                        <span className="detail-label">{t.capacity}</span>
                                        <span className="detail-value">{selectedDorm.totalCapacity}</span>
                                    </div>
                                    <div className="detail-card">
                                        <span className="detail-label">{t.availableBeds}</span>
                                        <span className="detail-value">{selectedDorm.availableBeds}</span>
                                    </div>
                                </div>

                                <div className="occ">
                                    <div className="occ-top">
                                        <div className="occ-title">{t.occupancyDetails}</div>
                                        <div className={`occ-pill ${occupancyClass(selectedDorm.occupancy)}`}>
                                            {selectedDorm.occupancy}%
                                        </div>
                                    </div>

                                    <div className="bar">
                                        <div
                                            className={`fill ${occupancyClass(selectedDorm.occupancy)}`}
                                            style={{width: `${selectedDorm.occupancy}%`}}
                                        />
                                        <div className="bar-label">{selectedDorm.occupancy}%</div>
                                    </div>

                                    <div className="occ-bottom">
                    <span>
                      {t.capacity}: {selectedDorm.totalCapacity}
                    </span>
                                        <span>
                      {t.availableBeds}: {selectedDorm.availableBeds}
                    </span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="empty-panel">
                                <div className="panel-title">{t.selectDorm}</div>
                                <div className="panel-sub">{t.selectDormSub}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
        .map-page {
          padding: 26px;
          background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
          min-height: 100vh;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 18px;
          margin-bottom: 18px;
          background: white;
          padding: 18px 22px;
          border-radius: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .titles h1 {
          font-size: 28px;
          font-weight: 800;
          margin: 0 0 6px;
          color: #1e293b;
        }

        .titles p {
          margin: 0;
          color: #64748b;
          font-size: 14px;
          font-weight: 600;
        }

        .restricted-note {
          margin-top: 8px !important;
          color: #2563eb !important;
        }

        .map-path {
          margin-top: 8px !important;
          font-size: 12px !important;
          color: #475569 !important;
          font-weight: 800 !important;
        }

        .map-path code {
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          color: #0f172a;
        }

        .filter {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 10px 12px;
          border-radius: 10px;
        }

        .filter-label {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #475569;
          font-size: 13px;
          font-weight: 800;
        }

        select {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 7px 10px;
          font-weight: 700;
          font-size: 13px;
          background: white;
          color: #1e293b;
        }

        .state-box {
          background: white;
          border-radius: 14px;
          padding: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          color: #475569;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .state-box.error {
          color: #b91c1c;
        }

        .map-shell {
          display: grid;
          grid-template-columns: 1fr 360px;
          gap: 16px;
        }

        @media (max-width: 1200px) {
          .map-shell {
            grid-template-columns: 1fr;
          }
        }

        .map-canvas-wrap {
          position: relative;
          background: white;
          border-radius: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          overflow: hidden;
        }

        .controls {
          position: absolute;
          bottom: 12px;
          left: 12px;
          z-index: 30;
          background: rgba(255,255,255,0.92);
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.12);
          border: 1px solid #e2e8f0;
          min-width: 180px;
        }

        .controls-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .controls-title {
          font-size: 10px;
          font-weight: 900;
          color: #1e293b;
          text-transform: uppercase;
        }

        .btnrow {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }

        .iconbtn {
          border: none;
          background: #f1f5f9;
          padding: 6px;
          border-radius: 9px;
          cursor: pointer;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .pillbtn {
          border: 1px solid #e2e8f0;
          background: white;
          padding: 6px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          color: #334155;
        }

        .pillbtn.on {
          border-color: #3b82f6;
          color: #1d4ed8;
        }

        .meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 10px;
          color: #64748b;
          font-weight: 800;
        }

        .pan-hint {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: #475569;
        }

        .refresh-btn {
          margin-top: 8px;
          width: 100%;
          border: none;
          background: #eff6ff;
          color: #1d4ed8;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }

        .map-canvas {
          position: relative;
          height: calc(100vh - 240px);
          min-height: 620px;
          max-height: 860px;
          overflow: hidden;
          cursor: grab;
          background: #f8fafc;
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
          will-change: transform;
        }

        .map-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
        }

        .pin {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.16s;
          z-index: 10;
          border: none;
          background: transparent;
          padding: 0;
        }

        .pin:hover {
          z-index: 20;
          transform: translate(-50%, -50%) scale(1.05);
        }

        .pin.active {
          z-index: 25;
          transform: translate(-50%, -50%) scale(1.08);
        }

        .pin.good { color: #10b981 !important; }
        .pin.warn { color: #f59e0b !important; }
        .pin.danger { color: #ef4444 !important; }

        .pin-dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: currentColor !important;
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .pin-name {
          background: rgba(255,255,255,0.96);
          padding: 5px 10px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 900;
          color: #0f172a;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          white-space: nowrap;
          border: 1px solid #e2e8f0;
        }

        .pin-badge {
          background: rgba(255,255,255,0.96);
          color: currentColor !important;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 950;
          box-shadow: 0 2px 6px rgba(0,0,0,0.12);
          min-width: 48px;
          text-align: center;
          border: 1px solid #e2e8f0;
        }

        .panel {
          background: white;
          border-radius: 14px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          position: sticky;
          top: 16px;
          min-height: 220px;
        }

        .panel-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
          padding-bottom: 16px;
          border-bottom: 2px solid #f1f5f9;
        }

        .panel-title {
          font-weight: 900;
          font-size: 18px;
          margin-bottom: 6px;
          color: #0f172a;
        }

        .panel-sub {
          font-size: 12px;
          color: #64748b;
          font-weight: 800;
        }

        .empty-panel {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .close {
          border: none;
          background: #f1f5f9;
          padding: 8px;
          border-radius: 10px;
          cursor: pointer;
          color: #64748b;
        }

        .kpis {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 16px;
        }

        .kpi {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-radius: 12px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          border: 1px solid #e2e8f0;
        }

        .kpi svg {
          color: #3b82f6;
        }

        .kpi-val {
          font-size: 22px;
          font-weight: 950;
          color: #0f172a;
        }

        .kpi-lbl {
          font-size: 10px;
          color: #64748b;
          font-weight: 900;
          text-transform: uppercase;
          text-align: center;
        }

        .details-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 16px;
        }

        .detail-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .detail-label {
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
        }

        .detail-value {
          font-size: 20px;
          font-weight: 900;
          color: #0f172a;
        }

        .occ {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border-radius: 12px;
          padding: 16px;
          border: 1px solid #e2e8f0;
        }

        .occ-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .occ-title {
          font-size: 12px;
          font-weight: 950;
          color: #0f172a;
          text-transform: uppercase;
        }

        .occ-pill {
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 950;
          color: white;
        }

        .occ-pill.good { background: #10b981; }
        .occ-pill.warn { background: #f59e0b; }
        .occ-pill.danger { background: #ef4444; }

        .bar {
          height: 10px;
          background: #e2e8f0;
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 10px;
          position: relative;
        }

        .fill {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 999px;
        }

        .fill.good { background: linear-gradient(90deg, #10b981 0%, #059669 100%); }
        .fill.warn { background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%); }
        .fill.danger { background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%); }

        .bar-label {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 950;
          color: #0f172a;
        }

        .occ-bottom {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #64748b;
          font-weight: 800;
          gap: 10px;
          flex-wrap: wrap;
        }
      `}</style>
        </div>
    );
}