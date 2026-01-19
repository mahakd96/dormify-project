import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Filter, X, ZoomIn, ZoomOut, RotateCcw, Move, Building2, Home, Users } from 'lucide-react';

const MAP_FILE = 'dormMap.png';
const MAP_SRC = `/maps/${MAP_FILE}`;

// -------------------------
// Mock data structures
// -------------------------
const regions = [
  { id: 'canada', name: 'קנדה', nameEn: 'Canada' },
  { id: 'mizrach-yashan', name: 'מזרח ישן (הלל קפלן)', nameEn: 'Mizrach Yashan (Hillel Kaplan)' },
  { id: 'mizrach-hadash', name: 'מזרח חדש', nameEn: 'Mizrach Hadash' },
  { id: 'rifkin', name: 'ריפקין', nameEn: 'Rifkin' },
  { id: 'senate', name: 'הסנט', nameEn: 'Senate' },
  { id: 'kfar-hasmaha', name: 'כפר משתלמים', nameEn: 'Kfar Mishtalmim' },
  { id: 'senate-renovated', name: 'סנאט משופץ', nameEn: 'Senate Renovated' },
  { id: 'segal-zutar', name: 'סגל זוטר', nameEn: 'Segal Zutar' },
  { id: 'broshim', name: 'ברושים', nameEn: 'Broshim' },
  { id: 'neve-america', name: 'נווה אמריקה', nameEn: 'Neve America' },
  { id: 'ha-amim', name: 'העמים', nameEn: 'Ha-Amim' },
];

const buildings = [
  { id: 'b1', regionId: 'canada', name: 'Building 1' },
  { id: 'b2', regionId: 'canada', name: 'Building 2' },
  { id: 'b3', regionId: 'mizrach-yashan', name: 'Building 3' },
  { id: 'b4', regionId: 'rifkin', name: 'Building 4' },
  { id: 'b5', regionId: 'broshim', name: 'Building 5' }
];

const rooms = [
  { id: 'r1', regionId: 'canada', buildingId: 'b1' },
  { id: 'r2', regionId: 'canada', buildingId: 'b1' },
  { id: 'r3', regionId: 'canada', buildingId: 'b2' },
  { id: 'r4', regionId: 'mizrach-yashan', buildingId: 'b3' },
  { id: 'r5', regionId: 'mizrach-yashan', buildingId: 'b3' },
  { id: 'r6', regionId: 'rifkin', buildingId: 'b4' },
  { id: 'r7', regionId: 'broshim', buildingId: 'b5' },
  { id: 'r8', regionId: 'broshim', buildingId: 'b5' }
];

const students = [
  { id: 's1', regionId: 'canada', isAssigned: true },
  { id: 's2', regionId: 'canada', isAssigned: true },
  { id: 's3', regionId: 'canada', isAssigned: false },
  { id: 's4', regionId: 'mizrach-yashan', isAssigned: true },
  { id: 's5', regionId: 'rifkin', isAssigned: true },
  { id: 's6', regionId: 'rifkin', isAssigned: true },
  { id: 's7', regionId: 'broshim', isAssigned: false }
];

// Mock auth context
const useAuth = () => ({
  canAccessRegion: () => true
});

export default function MapPage({ language = 'en' }) {
  const { canAccessRegion } = useAuth();

  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedDormGroup, setSelectedDormGroup] = useState(null);

  const [calibrateMode, setCalibrateMode] = useState(false);

  const canvasRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const ZOOM_MIN = 0.85;
  const ZOOM_MAX = 2.75;
  const ZOOM_STEP = 0.15;

  const resetView = () => {
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
    setPan({ x: nextPanX, y: nextPanY });
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
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
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
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const dormGroups = useMemo(
    () => [
      { baseId: 'canada', variants: ['canada', 'canada-family', 'canada-couples'] },
      { baseId: 'mizrach-yashan', variants: ['mizrach-yashan', 'mizrach-yashan-couples'] },
      { baseId: 'mizrach-hadash', variants: ['mizrach-hadash', 'mizrach-hadash-family', 'mizrach-hadash-couples'] },
      { baseId: 'rifkin', variants: ['rifkin'] },
      { baseId: 'senate', variants: ['senate'] },
      { baseId: 'kfar-hasmaha', variants: ['kfar-hasmaha', 'kfar-hasmaha-couples'] },

      { baseId: 'senate-renovated', variants: ['senate-renovated'] },
      { baseId: 'segal-zutar', variants: ['segal-zutar', 'segal-zutar-family', 'segal-zutar-couples'] },
      { baseId: 'broshim', variants: ['broshim', 'broshim-family', 'broshim-couples'] },
      { baseId: 'neve-america', variants: ['neve-america', 'neve-america-couples'] },
      { baseId: 'ha-amim', variants: ['ha-amim'] },
    ],
    []
  );

  const dormPositions = {
    canada: { top: '7.0%', left: '60.5%' },
    rifkin: { top: '32.0%', left: '28.5%' },
    senate: { top: '52.5%', left: '32.5%' },
    'kfar-hasmaha': { top: '76.5%', left: '10.5%' },
    'mizrach-yashan': { top: '86.5%', left: '66.0%' },
    'mizrach-hadash': { top: '89.0%', left: '86.0%' },

    'senate-renovated': { top: '55.5%', left: '38.0%' },
    'segal-zutar': { top: '60.0%', left: '74.0%' },
    broshim: { top: '10.0%', left: '45.0%' },
    'neve-america': { top: '40.0%', left: '12.0%' },
    'ha-amim': { top: '72.0%', left: '70.0%' },
  };

  const t = {
    he: {
      title: 'מפת המעונות',
      subtitle: 'בחר/י סוג מעונות וצפה/י בתפוסה לפי אזור',
      filterTitle: 'סינון לפי סוג',
      all: 'הכל',
      base: 'יחידים',
      couples: 'זוגות',
      family: 'משפחות',
      buildings: 'בניינים',
      rooms: 'חדרים',
      students: 'סטודנטים',
      capacity: 'קיבולת',
      occupancy: 'תפוסה',
      dormTypeLabel: 'סוג מעונות',
      zoom: 'זום',
      reset: 'איפוס',
      panHint: 'גרור/י להזזה',
      legend: 'מקרא',
      low: 'נמוכה',
      mid: 'בינונית',
      high: 'גבוהה',
      occupancyDetails: 'פרטי תפוסה',
      calibrate: 'כיול',
      calibrateOn: 'כיול פועל (קליק מציג קואורדינטות בקונסול)',
      calibrateOff: 'כיול כבוי',
    },
    en: {
      title: 'Dormitory Map',
      subtitle: 'Choose dorm type and view occupancy by area',
      filterTitle: 'Filter by type',
      all: 'All',
      base: 'Base',
      couples: 'Couples',
      family: 'Family',
      buildings: 'Buildings',
      rooms: 'Rooms',
      students: 'Students',
      capacity: 'Capacity',
      occupancy: 'Occupancy',
      dormTypeLabel: 'Dorm Type',
      zoom: 'Zoom',
      reset: 'Reset',
      panHint: 'Drag to pan',
      legend: 'Legend',
      low: 'Low',
      mid: 'Medium',
      high: 'High',
      occupancyDetails: 'Occupancy Details',
      calibrate: 'Calibrate',
      calibrateOn: 'Calibration ON (click prints coords in console)',
      calibrateOff: 'Calibration OFF',
    },
  }[language];

  const applyTypeFilter = (variantIds) => {
    if (typeFilter === 'all') return variantIds;
    const isBase = (id) => !id.includes('-family') && !id.includes('-couples');
    if (typeFilter === 'base') return variantIds.filter(isBase);
    if (typeFilter === 'family') return variantIds.filter((id) => id.includes('-family'));
    if (typeFilter === 'couples') return variantIds.filter((id) => id.includes('-couples'));
    return variantIds;
  };

  const accessibleDormGroups = useMemo(() => {
    return dormGroups.filter((g) => g.variants.some((v) => canAccessRegion(v)));
  }, [dormGroups, canAccessRegion]);

  const getStatsForDormIds = (dormIds) => {
    const b = buildings.filter((x) => dormIds.includes(x.regionId));
    const r = rooms.filter((x) => dormIds.includes(x.regionId));
    const s = students.filter((x) => dormIds.includes(x.regionId));

    const assignedCount = s.filter((st) => st.isAssigned).length;
    const capacity = r.length * 2;
    const occupancy = capacity > 0 ? Math.round((assignedCount / capacity) * 100) : 0;

    return { buildings: b.length, rooms: r.length, students: s.length, assigned: assignedCount, capacity, occupancy };
  };

  const occupancyClass = (occ) => {
    if (occ >= 90) return 'danger';
    if (occ >= 70) return 'warn';
    return 'good';
  };

  const getBaseRegion = (baseId) => regions.find((r) => r.id === baseId);

  const selectedGroupObj = selectedDormGroup
    ? accessibleDormGroups.find((g) => g.baseId === selectedDormGroup)
    : null;

  const selectedDormIds = selectedGroupObj ? applyTypeFilter(selectedGroupObj.variants) : [];
  const selectedStats = selectedGroupObj ? getStatsForDormIds(selectedDormIds) : null;

  return (
    <div className="map-page" dir={language === 'he' ? 'rtl' : 'ltr'}>
      <div className="page-header">
        <div className="titles">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
          <p className="map-path">
            <strong>Map:</strong> <code>{MAP_SRC}</code>
          </p>
        </div>

        <div className="filter">
          <div className="filter-label">
            <Filter size={16} />
            <span>{t.filterTitle}</span>
          </div>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setSelectedDormGroup(null);
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

      <div className="map-shell">
        <div className="map-canvas-wrap">
          <div className="controls">
            <div className="controls-row">
              <div className="controls-title">{t.zoom}</div>

              <div className="btnrow">
                <button className="iconbtn" onClick={zoomIn} type="button" aria-label="Zoom in">
                  <ZoomIn size={16} />
                </button>
                <button className="iconbtn" onClick={zoomOut} type="button" aria-label="Zoom out">
                  <ZoomOut size={16} />
                </button>
                <button className="iconbtn" onClick={resetView} type="button" aria-label="Reset view">
                  <RotateCcw size={16} />
                </button>

                <button
                  className={`pillbtn ${calibrateMode ? 'on' : ''}`}
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
                  <Move size={13} /> {t.panHint}
                </span>
              </div>
            </div>

            <div className="legend">
              <span className="lg good" title={t.low} />
              <span className="lg warn" title={t.mid} />
              <span className="lg danger" title={t.high} />
            </div>
          </div>

          <div
            ref={canvasRef}
            className={`map-canvas ${isDragging ? 'dragging' : ''} ${calibrateMode ? 'calibrating' : ''}`}
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
                setSelectedDormGroup(null);
                return;
              }

              const el = canvasRef.current;
              if (!el) return;

              const rect = el.getBoundingClientRect();
              const cx = e.clientX - rect.left;
              const cy = e.clientX - rect.top;

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
                transformOrigin: '0 0',
              }}
            >
              <img className="map-img" src={MAP_SRC} alt="Technion dorms indexed map" draggable={false} />

              {accessibleDormGroups.map((group) => {
                const pos = dormPositions[group.baseId];
                if (!pos) return null;

                const dormIds = applyTypeFilter(group.variants);
                if (!dormIds.length) return null;

                const stats = getStatsForDormIds(dormIds);
                const base = getBaseRegion(group.baseId);
                const occClass = occupancyClass(stats.occupancy);
                const label = language === 'he' ? base?.name : base?.nameEn;

                return (
                  <button
                    key={group.baseId}
                    className={`pin ${occClass} ${selectedDormGroup === group.baseId ? 'active' : ''}`}
                    style={{ top: pos.top, left: pos.left }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedDormGroup(group.baseId);
                    }}
                    title={`${label} — ${t.occupancy}: ${stats.occupancy}%`}
                    type="button"
                  >
                    <span className="pin-dot" />
                    <span className="pin-name">{label}</span>
                    <span className="pin-badge">{stats.occupancy}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {selectedGroupObj && selectedStats && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">
                  {language === 'he'
                    ? getBaseRegion(selectedGroupObj.baseId)?.name
                    : getBaseRegion(selectedGroupObj.baseId)?.nameEn}
                </div>
                <div className="panel-sub">
                  {t.dormTypeLabel}:{' '}
                  {typeFilter === 'all'
                    ? t.all
                    : typeFilter === 'base'
                    ? t.base
                    : typeFilter === 'couples'
                    ? t.couples
                    : t.family}
                </div>
              </div>

              <button className="close" onClick={() => setSelectedDormGroup(null)} type="button">
                <X size={18} />
              </button>
            </div>

            <div className="kpis">
              <div className="kpi">
                <Building2 size={16} />
                <span className="kpi-val">{selectedStats.buildings}</span>
                <span className="kpi-lbl">{t.buildings}</span>
              </div>
              <div className="kpi">
                <Home size={16} />
                <span className="kpi-val">{selectedStats.rooms}</span>
                <span className="kpi-lbl">{t.rooms}</span>
              </div>
              <div className="kpi">
                <Users size={16} />
                <span className="kpi-val">{selectedStats.students}</span>
                <span className="kpi-lbl">{t.students}</span>
              </div>
            </div>

            <div className="occ">
              <div className="occ-top">
                <div className="occ-title">{t.occupancyDetails}</div>
                <div className={`occ-pill ${occupancyClass(selectedStats.occupancy)}`}>{selectedStats.occupancy}%</div>
              </div>

              <div className="bar">
                <div
                  className={`fill ${occupancyClass(selectedStats.occupancy)}`}
                  style={{ width: `${selectedStats.occupancy}%` }}
                />
                <div className="bar-label">{selectedStats.occupancy}%</div>
              </div>

              <div className="occ-bottom">
                <span>
                  {t.capacity}: {selectedStats.capacity}
                </span>
                <span>
                  {t.students}: {selectedStats.assigned}/{selectedStats.capacity}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

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
          letter-spacing: -0.02em;
        }

        .titles p {
          margin: 0;
          color: #64748b;
          font-size: 14px;
          font-weight: 600;
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
          cursor: pointer;
          transition: all 0.2s;
        }

        select:hover { border-color: #94a3b8; }
        select:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
        }

        .map-shell {
          display: grid;
          grid-template-columns: 1fr 360px;
          gap: 16px;
        }

        @media (max-width: 1200px) {
          .map-shell { grid-template-columns: 1fr; }
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
          top: auto;
          bottom: 12px;
          left: 12px;
          z-index: 30;
          background: rgba(255,255,255,0.92);
          border-radius: 12px;
          padding: 8px 8px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.12);
          border: 1px solid #e2e8f0;
          min-width: 165px;
          backdrop-filter: blur(6px);
        }

        .controls-row { display: flex; flex-direction: column; gap: 6px; }

        .controls-title {
          font-size: 10px;
          font-weight: 900;
          color: #1e293b;
          text-transform: uppercase;
          letter-spacing: 0.09em;
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
          transition: all 0.15s;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .iconbtn:hover { background: #e2e8f0; transform: translateY(-1px); }
        .iconbtn:active { transform: translateY(0); }

        .pillbtn {
          border: 1px solid #e2e8f0;
          background: white;
          padding: 6px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          color: #334155;
          transition: all 0.15s;
          margin-left: 2px;
        }
        .pillbtn:hover { background: #f8fafc; }
        .pillbtn.on { border-color: #3b82f6; color: #1d4ed8; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }

        .meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 10px;
          color: #64748b;
          font-weight: 800;
        }

        .zoom-val { color: #0f172a; }

        .pan-hint {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: #475569;
        }

        .legend {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .lg {
          width: 12px;
          height: 12px;
          border-radius: 4px;
          display: inline-block;
          box-shadow: 0 1px 2px rgba(0,0,0,0.10);
        }
        .lg.good { background: #10b981; }
        .lg.warn { background: #f59e0b; }
        .lg.danger { background: #ef4444; }

        .map-canvas {
          position: relative;
          height: calc(100vh - 240px);
          min-height: 620px;
          max-height: 860px;
          overflow: hidden;
          cursor: grab;
          background: #f8fafc;
        }

        @media (max-width: 900px) {
          .map-canvas {
            height: calc(100vh - 280px);
            min-height: 560px;
          }
        }

        .map-canvas.dragging { cursor: grabbing; }
        .map-canvas.calibrating { cursor: crosshair; }

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

        /* Bulletproof color mapping (prevents “all black”) */
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
          transition: all 0.2s;
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

        /* FIXED: was "..pin-badge" in your paste; must be ".pin-badge" */
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
          height: fit-content;
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

        .close {
          border: none;
          background: #f1f5f9;
          padding: 8px;
          border-radius: 10px;
          cursor: pointer;
          color: #64748b;
          transition: all 0.15s;
        }
        .close:hover { background: #e2e8f0; color: #0f172a; }

        .kpis {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
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

        .kpi svg { color: #3b82f6; }

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
          letter-spacing: 0.06em;
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
          letter-spacing: 0.08em;
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
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.08);
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
          text-shadow: 0 1px 0 rgba(255,255,255,0.85);
          pointer-events: none;
          user-select: none;
        }

        .occ-bottom {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #64748b;
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}
