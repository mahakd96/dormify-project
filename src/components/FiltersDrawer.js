import React, { useState, useRef, useMemo } from 'react';
import { X, Search, ChevronDown, SlidersHorizontal } from 'lucide-react';

export default function FiltersDrawer({
  isOpen,
  onClose,
  filters,
  onFiltersChange,
  filterOptions,
  totalCount,
}) {
  if (!filterOptions) return null;

  const isCentralAdmin = filterOptions.is_central_admin;

  const visibleDormTypes = useMemo(() => {
    const allDormTypes = filterOptions.dorm_types || [];
    const selectedRegions = filters.regions || [];

    if (!isCentralAdmin || selectedRegions.length === 0) {
      return allDormTypes;
    }

    return allDormTypes.filter((d) =>
      selectedRegions.map(String).includes(String(d.region_id))
    );
  }, [filterOptions.dorm_types, filters.regions, isCentralAdmin]);

  const visibleBuildings = useMemo(() => {
    const allBuildings = filterOptions.buildings || [];
    const selectedRegions = filters.regions || [];
    const selectedDormTypes = filters.dormTypes || [];

    let result = allBuildings;

    if (isCentralAdmin && selectedRegions.length > 0) {
      result = result.filter((b) =>
        selectedRegions.map(String).includes(String(b.region_id))
      );
    }

    if (selectedDormTypes.length > 0) {
      result = result.filter((b) =>
        selectedDormTypes.map(String).includes(String(b.dorm_type_id))
      );
    }

    return result;
  }, [filterOptions.buildings, filters.regions, filters.dormTypes, isCentralAdmin]);

  const visibleApartments = useMemo(() => {
    const allApartments = filterOptions.apartments || [];
    const selectedDormTypes = filters.dormTypes || [];
    const selectedBuildings = filters.buildings || [];

    let result = allApartments;

    if (selectedDormTypes.length > 0) {
      result = result.filter((a) =>
        selectedDormTypes.map(String).includes(String(a.dorm_type_id))
      );
    }

    if (selectedBuildings.length > 0) {
      result = result.filter((a) =>
        selectedBuildings.map(String).includes(String(a.building_id))
      );
    }

    return result;
  }, [filterOptions.apartments, filters.dormTypes, filters.buildings]);

  const visibleRooms = useMemo(() => {
    const allRooms = filterOptions.rooms || [];
    const selectedBuildings = filters.buildings || [];
    const selectedApartments = filters.apartments || [];

    let result = allRooms;

    if (selectedBuildings.length > 0) {
      result = result.filter((r) =>
        selectedBuildings.map(String).includes(String(r.building_id))
      );
    }

    if (selectedApartments.length > 0) {
      result = result.filter((r) =>
        selectedApartments.map(String).includes(String(r.apartment_id))
      );
    }

    return result.slice(0, 100);
  }, [filterOptions.rooms, filters.buildings, filters.apartments]);

  const toggle = (key, value) => {
    const current = filters[key] || [];

    const next = current.map(String).includes(String(value))
      ? current.filter((v) => String(v) !== String(value))
      : [...current, value];

    if (key === 'regions') {
      onFiltersChange({
        ...filters,
        regions: next,
        dormTypes: [],
        buildings: [],
        apartments: [],
        rooms: [],
      });
      return;
    }

    if (key === 'dormTypes') {
      onFiltersChange({
        ...filters,
        dormTypes: next,
        buildings: [],
        apartments: [],
        rooms: [],
      });
      return;
    }

    if (key === 'buildings') {
      onFiltersChange({
        ...filters,
        buildings: next,
        apartments: [],
        rooms: [],
      });
      return;
    }

    if (key === 'apartments') {
      onFiltersChange({
        ...filters,
        apartments: next,
        rooms: [],
      });
      return;
    }

    onFiltersChange({ ...filters, [key]: next });
  };

  const setSingle = (key, value) => {
    const current = filters[key] || [];
    const next = current.map(String).includes(String(value)) ? [] : [value];
    onFiltersChange({ ...filters, [key]: next });
  };

  const clearKey = (key) => {
    if (key === 'regions') {
      onFiltersChange({
        ...filters,
        regions: [],
        dormTypes: [],
        buildings: [],
        apartments: [],
        rooms: [],
      });
      return;
    }

    if (key === 'dormTypes') {
      onFiltersChange({
        ...filters,
        dormTypes: [],
        buildings: [],
        apartments: [],
        rooms: [],
      });
      return;
    }

    if (key === 'buildings') {
      onFiltersChange({
        ...filters,
        buildings: [],
        apartments: [],
        rooms: [],
      });
      return;
    }

    if (key === 'apartments') {
      onFiltersChange({
        ...filters,
        apartments: [],
        rooms: [],
      });
      return;
    }

    onFiltersChange({ ...filters, [key]: [] });
  };

  const clearAll = () =>
    onFiltersChange({
      genders: [],
      religions: [],
      regions: [],
      dormTypes: [],
      buildings: [],
      apartments: [],
      rooms: [],
      assignmentStatuses: [],
      hasRoommateRequest: [],
    });

  const activeCount =
    (filters.genders?.length || 0) +
    (filters.religions?.length || 0) +
    (filters.regions?.length || 0) +
    (filters.dormTypes?.length || 0) +
    (filters.buildings?.length || 0) +
    (filters.apartments?.length || 0) +
    (filters.rooms?.length || 0) +
    (filters.assignmentStatuses?.length || 0) +
    (filters.hasRoommateRequest?.length || 0);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.25)',
          zIndex: 40,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s',
          backdropFilter: 'blur(1px)',
        }}
      />

      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          width: '380px',
          maxWidth: '90vw',
          background: 'white',
          zIndex: 50,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(15,23,42,0.12)',
        }}
      >
        <div
          style={{
            padding: '22px 24px 18px',
            borderBottom: '1px solid #f1f5f9',
            background: 'linear-gradient(135deg, #f8faff 0%, #ffffff 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #3d9fe0, #2563eb)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SlidersHorizontal size={18} color="white" />
              </div>

              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
                  Filter Students
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  Find students by details, assignment, and requests
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                border: 'none',
                cursor: 'pointer',
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {activeCount > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: '6px 12px',
                background: '#eff6ff',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, color: '#2563eb', fontWeight: 600 }}>
                {activeCount} filter{activeCount > 1 ? 's' : ''} active
              </span>
              <button
                onClick={clearAll}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#64748b',
                  fontWeight: 600,
                  textDecoration: 'underline',
                }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <SectionGroup label="Basic Info">
            <FilterRow
              label="Gender"
              active={(filters.genders?.length || 0) > 0}
              onClear={() => clearKey('genders')}
            >
              <SegmentedButtons
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
                selected={filters.genders || []}
                onToggle={(v) => setSingle('genders', v)}
              />
            </FilterRow>

            <FilterRow
              label="Religion"
              active={(filters.religions?.length || 0) > 0}
              onClear={() => clearKey('religions')}
            >
              <MultiDropdown
                placeholder="Select religion"
                options={(filterOptions.religions || []).map((r) => ({
                  value: r,
                  label: r,
                }))}
                selected={filters.religions || []}
                onToggle={(v) => toggle('religions', v)}
              />
            </FilterRow>

            {isCentralAdmin && filterOptions.regions?.length > 0 && (
              <FilterRow
                label="Region"
                active={(filters.regions?.length || 0) > 0}
                onClear={() => clearKey('regions')}
              >
                <MultiDropdown
                  placeholder="Select region"
                  options={(filterOptions.regions || []).map((r) => ({
                    value: r.id,
                    label: r.name,
                  }))}
                  selected={filters.regions || []}
                  onToggle={(v) => toggle('regions', v)}
                />
              </FilterRow>
            )}

            <FilterRow
              label="Dorm Type"
              active={(filters.dormTypes?.length || 0) > 0}
              onClear={() => clearKey('dormTypes')}
            >
              <SearchableSelect
                placeholder="Search or select dorm type..."
                options={visibleDormTypes.map((d) => ({
                  value: d.id,
                  label: d.name,
                  subLabel: isCentralAdmin && d.region_name ? d.region_name : '',
                }))}
                selected={filters.dormTypes || []}
                onToggle={(v) => toggle('dormTypes', v)}
              />
            </FilterRow>
          </SectionGroup>

          <SectionGroup label="Assignment">
            <FilterRow
              label="Assignment Status"
              active={(filters.assignmentStatuses?.length || 0) > 0}
              onClear={() => clearKey('assignmentStatuses')}
            >
              <SegmentedButtons
                options={[
                  { value: 'assigned', label: 'Assigned' },
                  { value: 'unassigned', label: 'Unassigned' },
                ]}
                selected={filters.assignmentStatuses || []}
                onToggle={(v) => setSingle('assignmentStatuses', v)}
              />
            </FilterRow>

            <FilterRow
              label="Building"
              active={(filters.buildings?.length || 0) > 0}
              onClear={() => clearKey('buildings')}
            >
              <BuildingSearch
                buildings={visibleBuildings}
                selected={filters.buildings || []}
                onToggle={(v) => toggle('buildings', v)}
                showRegion={isCentralAdmin}
              />
            </FilterRow>

            <FilterRow
              label="Apartment"
              active={(filters.apartments?.length || 0) > 0}
              onClear={() => clearKey('apartments')}
            >
              <SearchableSelect
                placeholder="Search or select apartment..."
                options={visibleApartments.map((a) => ({
                  value: a.id,
                  label: `Apartment ${a.number}`,
                  subLabel: filters.buildings?.length ? '' : `Building ${a.building_number}`,
                }))}
                selected={filters.apartments || []}
                onToggle={(v) => toggle('apartments', v)}
              />
            </FilterRow>

            <FilterRow
              label="Room"
              active={(filters.rooms?.length || 0) > 0}
              onClear={() => clearKey('rooms')}
            >
              <SearchableSelect
                placeholder="Search or select room..."
                options={visibleRooms.map((r) => ({
                  value: r.id,
                  label: `Room ${r.name}`,
                  subLabel: filters.apartments?.length
                    ? ''
                    : `Apartment ${r.apartment_number} · Building ${r.building_number}`,
                }))}
                selected={filters.rooms || []}
                onToggle={(v) => toggle('rooms', v)}
              />
            </FilterRow>
          </SectionGroup>

          <SectionGroup label="Requests">
            <FilterRow
              label="Has Roommate Request"
              active={(filters.hasRoommateRequest?.length || 0) > 0}
              onClear={() => clearKey('hasRoommateRequest')}
            >
              <SegmentedButtons
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
                selected={filters.hasRoommateRequest || []}
                onToggle={(v) => setSingle('hasRoommateRequest', v)}
              />
            </FilterRow>
          </SectionGroup>
        </div>

        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            gap: 10,
            background: 'white',
          }}
        >
          <button
            onClick={clearAll}
            style={{
              flex: 1,
              padding: '12px 0',
              background: 'white',
              border: '1.5px solid #e2e8f0',
              borderRadius: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: 14,
              color: '#64748b',
            }}
          >
            Clear all
          </button>

          <button
            onClick={onClose}
            style={{
              flex: 2,
              padding: '12px 0',
              background: 'linear-gradient(135deg, #3d9fe0, #2563eb)',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: 14,
              color: 'white',
            }}
          >
            Show {totalCount ?? ''} students
          </button>
        </div>
      </div>
    </>
  );
}

function SectionGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function FilterRow({ label, active, onClear, children }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <label style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>
          {label}
        </label>

        {active && (
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontFamily: 'inherit',
            }}
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SegmentedButtons({ options, selected, onToggle }) {
  const selectedStrings = (selected || []).map(String);

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map((o) => {
        const isActive = selectedStrings.includes(String(o.value));

        return (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            style={{
              flex: 1,
              padding: '9px 12px',
              border: isActive ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: 13,
              background: isActive ? '#eff6ff' : 'white',
              color: isActive ? '#2563eb' : '#64748b',
              transition: 'all 0.15s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiDropdown({ placeholder, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedStrings = (selected || []).map(String);

  React.useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectedOptions = options.filter((o) =>
    selectedStrings.includes(String(o.value))
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          border: '1.5px solid #e2e8f0',
          borderRadius: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          background: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 42,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {selectedOptions.length === 0 ? (
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{placeholder}</span>
          ) : (
            selectedOptions.map((o) => (
              <span
                key={o.value}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: '#eff6ff',
                  color: '#2563eb',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                {o.label}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(o.value);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#93c5fd',
                    padding: 0,
                    display: 'flex',
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            ))
          )}
        </div>

        <ChevronDown
          size={15}
          color="#94a3b8"
          style={{
            flexShrink: 0,
            marginLeft: 6,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'white',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15,23,42,0.1)',
            zIndex: 20,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {options.map((o) => {
            const isSelected = selectedStrings.includes(String(o.value));

            return (
              <div
                key={o.value}
                onClick={() => onToggle(o.value)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  fontSize: 14,
                  background: isSelected ? '#eff6ff' : 'white',
                  color: isSelected ? '#2563eb' : '#374151',
                  fontWeight: isSelected ? 700 : 400,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #f8fafc',
                }}
              >
                {o.label}
                {isSelected && <X size={13} color="#93c5fd" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchableSelect({ placeholder, options, selected, onToggle }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedStrings = (selected || []).map(String);

  React.useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const list = !q
      ? options
      : options.filter((o) =>
          String(o.label).toLowerCase().includes(q) ||
          String(o.subLabel || '').toLowerCase().includes(q)
        );

    return list.slice(0, 50);
  }, [query, options]);

  const selectedOptions = options.filter((o) =>
    selectedStrings.includes(String(o.value))
  );

  return (
    <div ref={ref}>
      <div style={{ position: 'relative' }}>
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#94a3b8',
          }}
        />

        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '10px 14px 10px 34px',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {open && (
        <div
          style={{
            background: 'white',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15,23,42,0.1)',
            maxHeight: 180,
            overflowY: 'auto',
            marginTop: 4,
            zIndex: 20,
            position: 'relative',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 13 }}>
              No matches found
            </div>
          ) : (
            filtered.map((o) => {
              const isSelected = selectedStrings.includes(String(o.value));

              return (
                <div
                  key={o.value}
                  onClick={() => {
                    onToggle(o.value);
                    setQuery('');
                    setOpen(false);
                  }}
                  style={{
                    padding: '9px 14px',
                    cursor: 'pointer',
                    fontSize: 13,
                    background: isSelected ? '#eff6ff' : 'white',
                    color: isSelected ? '#2563eb' : '#374151',
                    borderBottom: '1px solid #f8fafc',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{o.label}</div>
                  {o.subLabel && (
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {o.subLabel}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {selectedOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#eff6ff',
                color: '#2563eb',
                fontSize: 12,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 999,
              }}
            >
              {o.label}
              <button
                onClick={() => onToggle(o.value)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#93c5fd',
                  padding: 0,
                  display: 'flex',
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BuildingSearch({ buildings, selected, onToggle, showRegion }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedStrings = (selected || []).map(String);

  React.useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return buildings.slice(0, 20);

    return buildings
      .filter(
        (b) =>
          String(b.name).toLowerCase().includes(q) ||
          String(b.dorm_type_name || '').toLowerCase().includes(q) ||
          String(b.region_name || '').toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [query, buildings]);

  const selectedBuildings = buildings.filter((b) =>
    selectedStrings.includes(String(b.id))
  );

  return (
    <div ref={ref}>
      <div style={{ position: 'relative' }}>
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#94a3b8',
          }}
        />

        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search or select building..."
          style={{
            width: '100%',
            padding: '10px 14px 10px 34px',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {open && filtered.length > 0 && (
        <div
          style={{
            background: 'white',
            border: '1.5px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15,23,42,0.1)',
            maxHeight: 180,
            overflowY: 'auto',
            marginTop: 4,
            zIndex: 20,
            position: 'relative',
          }}
        >
          {filtered.map((b) => {
            const isSelected = selectedStrings.includes(String(b.id));

            return (
              <div
                key={b.id}
                onClick={() => {
                  onToggle(b.id);
                  setQuery('');
                  setOpen(false);
                }}
                style={{
                  padding: '9px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  background: isSelected ? '#eff6ff' : 'white',
                  color: isSelected ? '#2563eb' : '#374151',
                  borderBottom: '1px solid #f8fafc',
                }}
              >
                <div style={{ fontWeight: 600 }}>Building {b.name}</div>

                {(showRegion && b.region_name) || b.dorm_type_name ? (
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {[showRegion ? b.region_name : '', b.dorm_type_name || '']
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {selectedBuildings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {selectedBuildings.map((b) => (
            <span
              key={b.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#eff6ff',
                color: '#2563eb',
                fontSize: 12,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 999,
              }}
            >
              Building {b.name}
              <button
                onClick={() => onToggle(b.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#93c5fd',
                  padding: 0,
                  display: 'flex',
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}