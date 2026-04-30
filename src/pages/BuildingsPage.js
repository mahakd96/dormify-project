import React, { useState, useEffect, useMemo } from 'react';
import { Building2, Home, Search, ChevronDown, ChevronUp, Users, Bed, X } from 'lucide-react';
import { api } from '../services/api';

export default function BuildingsPage({ language }) {
  const [buildings, setBuildings] = useState([]);
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('all');

  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [apartments, setApartments] = useState([]);
  const [selectedApartment, setSelectedApartment] = useState(null);
  const [loadingApts, setLoadingApts] = useState(false);

  const isHe = language === 'he';

  const t = isHe
    ? {
        title: 'בניינים וחדרים',
        search: 'חיפוש בניין...',
        allRegions: 'כל האזורים',
        buildings: 'בניינים',
        apartments: 'דירות',
        rooms: 'חדרים',
        beds: 'מיטות',
        occupied: 'תפוס',
        free: 'פנוי',
        loading: 'טוען...',
        noData: 'אין נתונים',
        error: 'שגיאה בטעינת הנתונים',
        selectApt: 'בחר דירה לצפייה',
        apt: 'דירה',
        room: 'חדר',
        building: 'בניין',
        capacity: 'קיבולת',
        male: 'בנים',
        female: 'בנות',
        active: 'פעיל',
        inactive: 'לא פעיל',
        single: 'רווקים',
        couple: 'זוגות',
        family: 'משפחות',
        region: 'אזור',
        totalBuildings: 'בניינים',
      }
    : {
        title: 'Buildings & Rooms',
        search: 'Search building...',
        allRegions: 'All Regions',
        buildings: 'Buildings',
        apartments: 'Apartments',
        rooms: 'Rooms',
        beds: 'Beds',
        occupied: 'Occupied',
        free: 'Free',
        loading: 'Loading...',
        noData: 'No data',
        error: 'Error loading data',
        selectApt: 'Select apartment',
        apt: 'Apartment',
        room: 'Room',
        building: 'Building',
        capacity: 'Capacity',
        male: 'Male',
        female: 'Female',
        active: 'Active',
        inactive: 'Inactive',
        single: 'Single',
        couple: 'Couple',
        family: 'Family',
        region: 'Region',
        totalBuildings: 'Buildings',
      };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        const [buildingsRes, regionsRes] = await Promise.all([
          api.get('/api/buildings/'),
          api.get('/api/regions/'),
        ]);

        console.log('BUILDINGS:', buildingsRes.data);
        console.log('REGIONS:', regionsRes.data);

        const bData = buildingsRes.data?.results || buildingsRes.data || [];
        const rData = regionsRes.data?.results || regionsRes.data || [];

        setBuildings(Array.isArray(bData) ? bData : []);
        setRegions(Array.isArray(rData) ? rData : []);
      } catch (err) {
        console.error('ERROR LOADING BUILDINGS/REGIONS:', err);
        setError(t.error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [language]);

  const fetchApartments = async (buildingId) => {
    setLoadingApts(true);
    setSelectedApartment(null);
    setApartments([]);

    try {
      const res = await api.get(`/api/buildings/${buildingId}/apartments/`);

      console.log('APARTMENTS:', res.data);

      const data = res.data?.apartments || res.data?.results || res.data || [];
      setApartments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('ERROR LOADING APARTMENTS:', err);
      setApartments([]);
    } finally {
      setLoadingApts(false);
    }
  };

  const toggleBuilding = (buildingId) => {
    if (expandedBuilding === buildingId) {
      setExpandedBuilding(null);
      setApartments([]);
      setSelectedApartment(null);
    } else {
      setExpandedBuilding(buildingId);
      fetchApartments(buildingId);
    }
  };

  const getBuildingRegionId = (building) => {
    return building.region_id || building.region || building.region?.id || building.regionId || null;
  };

  const filteredBuildings = useMemo(() => {
    let list = buildings;

    if (selectedRegion !== 'all') {
      list = list.filter((b) => String(getBuildingRegionId(b)) === String(selectedRegion));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();

      list = list.filter((b) => {
        return (
          String(b.number || '').toLowerCase().includes(q) ||
          String(b.id || '').toLowerCase().includes(q) ||
          String(b.dorm_type_name || b.dorm_type || '').toLowerCase().includes(q) ||
          String(b.region_name || '').toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [buildings, selectedRegion, searchQuery]);

  const selectedApt = apartments.find((a) => a.id === selectedApartment);
  const selectedBuilding = buildings.find((b) => b.id === expandedBuilding);

  const getCat = (c) => {
    if (c === 'male') return t.male;
    if (c === 'female') return t.female;
    return c || '-';
  };

  const getType = (type) => {
    if (type === 'single') return t.single;
    if (type === 'couple') return t.couple;
    if (type === 'family') return t.family;
    return type || '-';
  };

  const getOccupancyColor = (pct) => {
    if (pct >= 90) {
      return { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', bar: '#ef4444' };
    }

    if (pct >= 60) {
      return { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', bar: '#f59e0b' };
    }

    return { bg: '#d1fae5', border: '#6ee7b7', text: '#065f46', bar: '#10b981' };
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <p style={{ color: '#64748b', fontSize: '16px' }}>{t.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', direction: isHe ? 'rtl' : 'ltr', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#1e293b', margin: '0 0 4px' }}>
          {t.title}
        </h1>

        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>
          {filteredBuildings.length} {t.buildings}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
        {[
          { label: t.totalBuildings, value: filteredBuildings.length, icon: Building2, color: '#3b82f6', bg: '#dbeafe' },
          { label: t.active, value: filteredBuildings.filter((b) => b.is_active).length, icon: Home, color: '#10b981', bg: '#d1fae5' },
          { label: t.inactive, value: filteredBuildings.filter((b) => !b.is_active).length, icon: Building2, color: '#f97316', bg: '#fed7aa' },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              background: 'white',
              borderRadius: '14px',
              padding: '16px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: s.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <s.icon size={20} color={s.color} />
            </div>

            <div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#1e293b' }}>{s.value}</div>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={() => {
            setSelectedRegion('all');
            setExpandedBuilding(null);
            setSelectedApartment(null);
            setApartments([]);
          }}
          style={{
            padding: '8px 16px',
            borderRadius: '999px',
            border: '1px solid',
            borderColor: selectedRegion === 'all' ? '#3b82f6' : '#e2e8f0',
            background: selectedRegion === 'all' ? '#dbeafe' : 'white',
            color: selectedRegion === 'all' ? '#1d4ed8' : '#64748b',
            fontWeight: '700',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          {t.allRegions} ({buildings.length})
        </button>

        {regions.map((region) => {
          const count = buildings.filter((b) => String(getBuildingRegionId(b)) === String(region.id)).length;
          const isSelected = selectedRegion === region.id;

          return (
            <button
              key={region.id}
              onClick={() => {
                setSelectedRegion(region.id);
                setExpandedBuilding(null);
                setSelectedApartment(null);
                setApartments([]);
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: isSelected ? '#3b82f6' : '#e2e8f0',
                background: isSelected ? '#dbeafe' : 'white',
                color: isSelected ? '#1d4ed8' : '#64748b',
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {region.name} ({count})
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '10px 14px',
          marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <Search size={18} color="#94a3b8" />

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.search}
          style={{
            border: 'none',
            outline: 'none',
            flex: 1,
            fontSize: '14px',
            color: '#1e293b',
            background: 'transparent',
          }}
        />

        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '42% 58%', gap: '16px' }}>
        <div
          style={{
            background: 'white',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f1f5f9',
              background: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Building2 size={16} color="#3b82f6" />
            <span style={{ fontWeight: '700', fontSize: '14px', color: '#1e293b' }}>{t.buildings}</span>
            <span
              style={{
                marginRight: 'auto',
                fontSize: '12px',
                color: '#64748b',
                background: '#e2e8f0',
                padding: '2px 8px',
                borderRadius: '999px',
                fontWeight: '700',
              }}
            >
              {filteredBuildings.length}
            </span>
          </div>

          <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto', padding: '8px' }}>
            {filteredBuildings.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                <Building2 size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
                <p style={{ margin: 0, fontSize: '14px' }}>{t.noData}</p>
              </div>
            ) : (
              filteredBuildings.map((building) => {
                const isExpanded = expandedBuilding === building.id;
                const colors = building.is_active
                  ? { bg: '#d1fae5', text: '#065f46' }
                  : { bg: '#fee2e2', text: '#991b1b' };

                return (
                  <div key={building.id} style={{ marginBottom: '6px' }}>
                    <button
                      onClick={() => toggleBuilding(building.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        border: '1px solid',
                        borderColor: isExpanded ? '#93c5fd' : '#e2e8f0',
                        borderRadius: '12px',
                        background: isExpanded ? '#eff6ff' : 'white',
                        cursor: 'pointer',
                        textAlign: isHe ? 'right' : 'left',
                      }}
                    >
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '11px',
                          background: isExpanded ? '#dbeafe' : '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Building2 size={18} color={isExpanded ? '#2563eb' : '#64748b'} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '700', color: '#1e293b', fontSize: '14px' }}>
                          {t.building} {building.number}
                        </div>

                        <div
                          style={{
                            fontSize: '11px',
                            color: '#64748b',
                            marginTop: '2px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {building.dorm_type_name || building.dorm_type || '-'} · {building.region_name || building.region || '-'}
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: '700',
                          padding: '3px 8px',
                          borderRadius: '999px',
                          background: colors.bg,
                          color: colors.text,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {building.is_active ? t.active : t.inactive}
                      </span>

                      {isExpanded ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '6px 0 0 6px' }}>
                        {loadingApts ? (
                          <p style={{ padding: '10px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>{t.loading}</p>
                        ) : apartments.length === 0 ? (
                          <p style={{ padding: '10px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>{t.noData}</p>
                        ) : (
                          apartments.map((apt) => {
                            const isSelected = selectedApartment === apt.id;
                            const cap = apt.apartment_capacity || apt.capacity || 0;

                            return (
                              <button
                                key={apt.id}
                                onClick={() => setSelectedApartment(apt.id === selectedApartment ? null : apt.id)}
                                style={{
                                  width: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '9px 12px',
                                  border: '1px solid',
                                  borderColor: isSelected ? '#93c5fd' : '#e2e8f0',
                                  borderRadius: '10px',
                                  marginBottom: '5px',
                                  background: isSelected ? '#eff6ff' : '#f8fafc',
                                  cursor: 'pointer',
                                  textAlign: isHe ? 'right' : 'left',
                                }}
                              >
                                <Home size={13} color={isSelected ? '#2563eb' : '#94a3b8'} />

                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: '600', fontSize: '13px', color: '#1e293b' }}>
                                    {t.apt} {apt.number}
                                  </div>

                                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                                    {getCat(apt.category)} · {getType(apt.apartment_type)} · {cap} {t.beds}
                                  </div>
                                </div>

                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: '700',
                                    padding: '2px 7px',
                                    borderRadius: '999px',
                                    background: apt.is_active ? '#d1fae5' : '#fee2e2',
                                    color: apt.is_active ? '#065f46' : '#991b1b',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {apt.is_active ? t.active : t.inactive}
                                </span>
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
        </div>

        <div
          style={{
            background: 'white',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            minHeight: '400px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            overflow: 'hidden',
          }}
        >
          {!selectedApt ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                minHeight: '400px',
                gap: '14px',
              }}
            >
              <div
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '22px',
                  background: '#eff6ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #bfdbfe',
                }}
              >
                <Home size={32} color="#3b82f6" />
              </div>

              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '16px', fontWeight: '700', color: '#374151', margin: '0 0 6px' }}>
                  {t.selectApt}
                </p>

                <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                  {isHe ? 'בחר בניין ואחר כך דירה' : 'Pick a building then an apartment'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#94a3b8',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  <Building2 size={12} />
                  <span>
                    {t.building} {selectedBuilding?.number}
                  </span>
                  <span>›</span>
                  <span style={{ color: '#3b82f6', fontWeight: '600' }}>{selectedBuilding?.region_name}</span>
                  <span>›</span>
                  <Home size={12} color="#3b82f6" />
                  <span style={{ color: '#3b82f6', fontWeight: '700' }}>
                    {t.apt} {selectedApt.number}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '52px',
                      height: '52px',
                      borderRadius: '14px',
                      background: '#dbeafe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Home size={24} color="#2563eb" />
                  </div>

                  <div>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>
                      {t.apt} {selectedApt.number}
                    </h2>

                    <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#64748b' }}>
                      {getCat(selectedApt.category)} · {getType(selectedApt.apartment_type)}
                      {!selectedApt.is_active && <span style={{ color: '#ef4444', marginRight: '6px' }}> · {t.inactive}</span>}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {[
                    { label: t.capacity, value: selectedApt.apartment_capacity || selectedApt.capacity || '-', color: '#3b82f6', bg: '#dbeafe' },
                    { label: t.rooms, value: selectedApt.room_count || selectedApt.rooms?.length || '-', color: '#10b981', bg: '#d1fae5' },
                    { label: getCat(selectedApt.category), value: selectedApt.category === 'male' ? '♂' : '♀', color: '#f97316', bg: '#fed7aa' },
                    { label: getType(selectedApt.apartment_type), value: '🏠', color: '#8b5cf6', bg: '#ede9fe' },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: '10px', borderRadius: '12px', background: s.bg, textAlign: 'center' }}>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
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

                {selectedApt.rooms && selectedApt.rooms.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                    {selectedApt.rooms.map((room) => {
                      const occupied = room.current_occupancy || room.students_count || 0;
                      const cap = room.capacity || 1;
                      const pct = Math.round((occupied / cap) * 100);
                      const colors = getOccupancyColor(pct);

                      return (
                        <div
                          key={room.id}
                          style={{
                            padding: '14px',
                            borderRadius: '12px',
                            border: `1px solid ${colors.border}`,
                            background: colors.bg,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontWeight: '700', fontSize: '14px', color: '#1e293b' }}>
                              {t.room} {room.name}
                            </span>

                            <span style={{ fontSize: '11px', fontWeight: '700', color: colors.text }}>{pct}%</span>
                          </div>

                          <div
                            style={{
                              height: '6px',
                              borderRadius: '999px',
                              background: 'rgba(255,255,255,0.6)',
                              marginBottom: '8px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                borderRadius: '999px',
                                width: `${pct}%`,
                                background: colors.bar,
                              }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Users size={12} /> {occupied}/{cap}
                            </span>

                            <span style={{ fontSize: '11px', fontWeight: '700', color: colors.text }}>
                              {pct >= 100 ? `🔴 ${t.occupied}` : `🟢 ${t.free}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                    <Bed size={32} style={{ marginBottom: '8px', opacity: 0.3 }} />
                    <p style={{ margin: 0 }}>{t.noData}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}