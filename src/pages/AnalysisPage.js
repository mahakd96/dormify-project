import React, { useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts';
import { Users, Building2, ArrowLeftRight, Star, Home, Bed } from 'lucide-react';
import { analysisAPI } from '../services/api';

const COLORS = ['#3b82f6', '#f97316', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];

const GENDER_LABELS = { male: 'זכר', female: 'נקבה' };
const RELIGION_LABELS = {
    Jewish: 'יהודי', Muslims: 'מוסלמי', Christian: 'נוצרי',
    Druze: 'דרוזי', not_specified: 'לא צוין'
};
const RELIGIOUS_LABELS = {
    religious: 'דתי', no_preference: 'לא משנה', not_specified: 'לא צוין'
};
const CATEGORY_LABELS = {
    new: 'חדשים', continuing: 'ממשיכים',
    transfer: 'מעברים', leaving: 'עוזבים'
};
const STATUS_LABELS = { pending: 'ממתין', approved: 'אושר', rejected: 'נדחה' };
const MOVEMENT_LABELS = {
    internal: 'פנימי', region_change: 'בין אזורים',
    dorm_type_change: 'שינוי סוג', phase2: 'שלב 2'
};

function StatCard({ title, value, icon: Icon, color, subtitle }) {
    return (
        <div style={{
            background: 'white', borderRadius: '16px', padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #f1f5f9',
            display: 'flex', alignItems: 'center', gap: '16px'
        }}>
            <div style={{
                width: '52px', height: '52px', borderRadius: '14px',
                background: color + '20', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
                <Icon size={22} color={color} />
            </div>
            <div>
                <p style={{ color: '#64748b', fontSize: '12px', margin: 0 }}>{title}</p>
                <p style={{ fontSize: '26px', fontWeight: '700', color: '#1e293b', margin: '2px 0 0' }}>{value?.toLocaleString()}</p>
                {subtitle && <p style={{ color: '#94a3b8', fontSize: '11px', margin: '2px 0 0' }}>{subtitle}</p>}
            </div>
        </div>
    );
}

function ChartCard({ title, children, height = 260 }) {
    return (
        <div style={{
            background: 'white', borderRadius: '16px', padding: '24px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #f1f5f9'
        }}>
            <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '20px' }}>
                {title}
            </h3>
            <ResponsiveContainer width="100%" height={height}>
                {children}
            </ResponsiveContainer>
        </div>
    );
}

function SectionTitle({ title }) {
    return (
        <h2 style={{
            fontSize: '17px', fontWeight: '700', color: '#1e293b',
            margin: '32px 0 16px', borderRight: '4px solid #3b82f6',
            paddingRight: '12px', display: 'flex', alignItems: 'center', gap: '8px'
        }}>
            {title}
        </h2>
    );
}

export default function AnalysisPage({ language }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('all');

    useEffect(() => {
        const fetchData = async () => {
            try {
                const result = await analysisAPI.getData();
                setData(result);
            } catch (err) {
                setError('שגיאה בטעינת הנתונים מהשרת');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '48px' }}>📊</div>
            <p style={{ color: '#64748b', fontSize: '16px' }}>טוען נתונים מ-Neon...</p>
        </div>
    );

    if (error) return (
        <div style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
            <p style={{ color: '#ef4444', fontSize: '16px' }}>{error}</p>
        </div>
    );

    const { summary, students_by_gender, students_by_religion, students_by_religious,
            students_by_category, students_by_housing, occupancy_data,
            transfers_by_status, transfers_by_type, students_by_region } = data;

    const genderData = students_by_gender.map(d => ({
        name: GENDER_LABELS[d.gender] || d.gender, value: d.count
    }));

    const religionData = students_by_religion.map(d => ({
        name: RELIGION_LABELS[d.requested_religion] || d.requested_religion, value: d.count
    }));

    const religiousData = students_by_religious.map(d => ({
        name: RELIGIOUS_LABELS[d.religious] || d.religious, value: d.count
    }));

    const categoryData = students_by_category.map(d => ({
        name: CATEGORY_LABELS[d.category] || d.category, value: d.count
    }));

    const housingData = students_by_housing.map(d => ({
        name: d.housing_type, value: d.count
    }));

    const transferStatusData = transfers_by_status.map(d => ({
        name: STATUS_LABELS[d.status] || d.status, value: d.count
    }));

    const transferTypeData = transfers_by_type.map(d => ({
        name: MOVEMENT_LABELS[d.movement_request__movement_type] || d.movement_request__movement_type || 'לא ידוע',
        value: d.count
    }));

    const regionData = students_by_region.map(d => ({
        name: d['accepted_dorm_type__region__name'] || 'לא ידוע', value: d.count
    }));

    const bedOccupancyRate = summary.total_beds > 0
        ? Math.round((summary.assigned_beds / summary.total_beds) * 100) : 0;

    // Occupancy filter by region
    const availableRegions = [...new Set(occupancy_data.map(d => d.region).filter(Boolean))];
    const filteredOccupancy = selectedRegion === 'all'
        ? occupancy_data
        : occupancy_data.filter(d => d.region === selectedRegion);

    return (
        <div style={{ padding: '32px', direction: 'rtl', maxWidth: '1400px' }}>

            {/* Header */}
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: '800', color: '#1e293b', margin: 0 }}>
                    📊 ניתוח נתונים
                </h1>
                <p style={{ color: '#64748b', marginTop: '6px', fontSize: '14px' }}>
                    נתונים בזמן אמת מבסיס הנתונים
                </p>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
                <StatCard title="סה״כ סטודנטים" value={summary.total_students} icon={Users} color="#3b82f6" />
                <StatCard title="משובצים לחדר" value={summary.assigned_students}
                    subtitle={`${summary.total_students > 0 ? Math.round(summary.assigned_students / summary.total_students * 100) : 0}% מכלל הסטודנטים`}
                    icon={Home} color="#10b981" />
                <StatCard title="ממתינים לשיבוץ" value={summary.unassigned_students} icon={Users} color="#f97316" />
                <StatCard title="סטודנטים בעדיפות" value={summary.priority_students} icon={Star} color="#8b5cf6" />
                <StatCard title="מיטות פנויות" value={summary.available_beds}
                    subtitle={`${bedOccupancyRate}% תפוסה`}
                    icon={Bed} color="#06b6d4" />
                <StatCard title="בניינים" value={summary.total_buildings} icon={Building2} color="#f59e0b" />
                <StatCard title="בקשות העברה" value={summary.total_transfers}
                    subtitle={`${summary.pending_transfers} ממתינות`}
                    icon={ArrowLeftRight} color="#ef4444" />
            </div>

            {/* Students by Region */}
            {regionData.length > 0 && (
                <>
                    <SectionTitle title="סטודנטים לפי אזור" />
                    <ChartCard title="התפלגות סטודנטים לפי אזור מעונות" height={300}>
                        <BarChart data={regionData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="value" name="סטודנטים" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                        </BarChart>
                    </ChartCard>
                </>
            )}

            {/* Student Distribution */}
            <SectionTitle title="התפלגות סטודנטים" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                <ChartCard title="לפי מגדר" height={220}>
                    <PieChart>
                        <Pie data={genderData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                            label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                            {genderData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ChartCard>

                <ChartCard title="לפי דת" height={220}>
                    <PieChart>
                        <Pie data={religionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                            label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                            {religionData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ChartCard>

                <ChartCard title="דתי/חילוני לצורך שיבוץ" height={220}>
                    <PieChart>
                        <Pie data={religiousData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                            label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                            {religiousData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ChartCard>

                <ChartCard title="לפי קטגוריה" height={220}>
                    <PieChart>
                        <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                            label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                            {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ChartCard>

                <ChartCard title="לפי סוג מגורים" height={220}>
                    <PieChart>
                        <Pie data={housingData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                            label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                            {housingData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ChartCard>
            </div>

            {/* Occupancy per Building */}
            {occupancy_data.length > 0 && (
                <>
                    <SectionTitle title="תפוסה לפי בניין" />

                    {/* Region Dropdown */}
                    <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>בחר אזור:</label>
                        <select
                            value={selectedRegion}
                            onChange={(e) => setSelectedRegion(e.target.value)}
                            style={{
                                padding: '10px 16px',
                                borderRadius: '10px',
                                border: '2px solid #e2e8f0',
                                fontSize: '14px',
                                color: '#1e293b',
                                background: 'white',
                                cursor: 'pointer',
                                outline: 'none',
                                direction: 'rtl',
                                minWidth: '200px'
                            }}
                        >
                            <option value="all">כל האזורים</option>
                            {availableRegions.map(region => (
                                <option key={region} value={region}>{region}</option>
                            ))}
                        </select>
                        <span style={{ fontSize: '13px', color: '#64748b' }}>
                            {filteredOccupancy.length} בניינים
                        </span>
                    </div>

                    <ChartCard title={`מיטות לפי בניין - ${selectedRegion === 'all' ? 'כל האזורים' : selectedRegion}`} height={350}>
                        <BarChart data={filteredOccupancy}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="building" tick={{ fontSize: 10 }} />
                            <YAxis />
                            <Tooltip formatter={(value, name) => [
                                value,
                                name === 'total_beds' ? 'סה״כ מיטות' : 'משובץ'
                            ]} />
                            <Legend formatter={name => name === 'total_beds' ? 'סה״כ מיטות' : 'משובץ'} />
                            <Bar dataKey="total_beds" name="total_beds" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="assigned" name="assigned" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ChartCard>

                    <div style={{ marginTop: '12px' }}>
                        <ChartCard title={`אחוז תפוסה - ${selectedRegion === 'all' ? 'כל האזורים' : selectedRegion}`} height={300}>
                            <BarChart data={filteredOccupancy}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="building" tick={{ fontSize: 10 }} />
                                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                <Tooltip formatter={(v) => [`${v}%`, 'תפוסה']} />
                                <Bar dataKey="occupancy_rate" name="אחוז תפוסה" radius={[6, 6, 0, 0]}>
                                    {filteredOccupancy.map((entry, i) => (
                                        <Cell key={i} fill={
                                            entry.occupancy_rate >= 80 ? '#10b981' :
                                            entry.occupancy_rate >= 50 ? '#f59e0b' : '#ef4444'
                                        } />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ChartCard>
                        <div style={{ display: 'flex', gap: '20px', marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
                            <span>🟢 מעל 80% - תפוסה גבוהה</span>
                            <span>🟡 50-80% - תפוסה בינונית</span>
                            <span>🔴 מתחת ל-50% - תפוסה נמוכה</span>
                        </div>
                    </div>
                </>
            )}

            {/* Transfer Requests */}
            <SectionTitle title="בקשות העברה" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <ChartCard title="לפי סטטוס" height={250}>
                    <BarChart data={transferStatusData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" name="בקשות" radius={[6, 6, 0, 0]}>
                            {transferStatusData.map((entry, i) => (
                                <Cell key={i} fill={
                                    entry.name === 'אושר' ? '#10b981' :
                                    entry.name === 'נדחה' ? '#ef4444' : '#f59e0b'
                                } />
                            ))}
                        </Bar>
                    </BarChart>
                </ChartCard>

                <ChartCard title="לפי סוג העברה" height={250}>
                    <BarChart data={transferTypeData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" name="בקשות" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                </ChartCard>
            </div>

        </div>
    );
}