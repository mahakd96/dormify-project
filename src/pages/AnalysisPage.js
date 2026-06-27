import React, { useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts';
import {
    Users,
    Building2,
    ArrowLeftRight,
    Home,
    Bed,
    AlertCircle,
    CheckCircle2,
    Search
} from 'lucide-react';
import { analysisAPI } from '../services/api';




const COLORS = ['#3b82f6', '#f97316', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];

const GENDER_LABELS = { male: 'זכר', female: 'נקבה' };

const RELIGION_LABELS = {
    Jewish: 'יהודי',
    Muslims: 'מוסלמי',
    Muslim: 'מוסלמי',
    Christian: 'נוצרי',
    Druze: 'דרוזי',
    not_specified: 'לא צוין',
    null: 'לא צוין'
};

const RELIGIOUS_LABELS = {
    religious: 'דתי',
    no_preference: 'לא משנה',
    not_specified: 'לא צוין',
    null: 'לא צוין'
};

const CATEGORY_LABELS = {
    new: 'חדשים',
    continuing: 'ממשיכים',
    transfer: 'מעברים',
    leaving: 'עוזבים'
};

const STATUS_LABELS = {
    pending: 'ממתין',
    approved: 'אושר',
    rejected: 'נדחה',
    completed: 'הושלם'
};

const MOVEMENT_LABELS = {
    internal: 'פנימי',
    region_change: 'בין אזורים',
    dorm_type_change: 'שינוי סוג מעונות',
    phase2: 'שלב 2'
};


function formatNumber(value) {
    return Number(value || 0).toLocaleString();
}

function StatCard({ title, value, icon: Icon, color, subtitle }) {
    return (
        <div style={{
            background: 'white',
            borderRadius: '18px',
            padding: '20px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            border: '1px solid #e5edf6',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            minHeight: '112px'
        }}>
            <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '16px',
                background: `${color}18`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
            }}>
                <Icon size={23} color={color} />
            </div>

            <div>
                <p style={{
                    color: '#64748b',
                    fontSize: '13px',
                    margin: 0,
                    fontWeight: 600
                }}>
                    {title}
                </p>

                <p style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: '4px 0 0'
                }}>
                    {formatNumber(value)}
                </p>

                {subtitle && (
                    <p style={{
                        color: '#94a3b8',
                        fontSize: '12px',
                        margin: '4px 0 0'
                    }}>
                        {subtitle}
                    </p>
                )}
            </div>
        </div>
    );
}

function ChartCard({ title, subtitle, children, height = 300 }) {
    return (
        <div style={{
            background: 'white',
            borderRadius: '18px',
            padding: '22px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            border: '1px solid #e5edf6',
            minHeight: height + 90
        }}>
            <div style={{ marginBottom: '18px' }}>
                <h3 style={{
                    fontSize: '16px',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: 0
                }}>
                    {title}
                </h3>

                {subtitle && (
                    <p style={{
                        fontSize: '13px',
                        color: '#64748b',
                        margin: '6px 0 0'
                    }}>
                        {subtitle}
                    </p>
                )}
            </div>

            <ResponsiveContainer width="100%" height={height}>
                {children}
            </ResponsiveContainer>
        </div>
    );
}

function SectionTitle({ title, subtitle }) {
    return (
        <div style={{
            margin: '38px 0 18px',
            borderRight: '4px solid #3b82f6',
            paddingRight: '14px'
        }}>
            <h2 style={{
                fontSize: '20px',
                fontWeight: 800,
                color: '#0f172a',
                margin: 0
            }}>
                {title}
            </h2>

            {subtitle && (
                <p style={{
                    color: '#64748b',
                    margin: '6px 0 0',
                    fontSize: '14px'
                }}>
                    {subtitle}
                </p>
            )}
        </div>
    );
}

function EmptyState({ title, text }) {
    return (
        <div style={{
            background: 'white',
            borderRadius: '18px',
            padding: '34px',
            border: '1px solid #e5edf6',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            textAlign: 'center',
            color: '#64748b'
        }}>
            <CheckCircle2 size={38} color="#10b981" style={{ marginBottom: '10px' }} />
            <h3 style={{ color: '#0f172a', margin: '0 0 8px', fontSize: '18px' }}>{title}</h3>
            <p style={{ margin: 0, fontSize: '14px' }}>{text}</p>
        </div>
    );
}

function DemographicButtons({ selected, onChange, t })  {
    const options = [
    { key: 'gender', label: t.gender },
    { key: 'religion', label: t.religion },
    { key: 'religious', label: t.religious },
    { key: 'category', label: t.category },
    { key: 'housing', label: t.housing }
];

    return (
        <div style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            marginBottom: '16px'
        }}>
            {options.map(option => {
                const active = selected === option.key;

                return (
                    <button
                        key={option.key}
                        onClick={() => onChange(option.key)}
                        style={{
                            border: active ? '1px solid #3b82f6' : '1px solid #dbe4ef',
                            background: active ? '#3b82f6' : 'white',
                            color: active ? 'white' : '#334155',
                            borderRadius: '999px',
                            padding: '10px 18px',
                            fontSize: '14px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            boxShadow: active ? '0 6px 16px rgba(59, 130, 246, 0.20)' : 'none'
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function BuildingsTable({ rows }) {
    return (
        <div style={{
            background: 'white',
            borderRadius: '18px',
            padding: '0',
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            border: '1px solid #e5edf6'
        }}>
            <div style={{ overflowX: 'auto' }}>
                <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: '760px'
                }}>
                    <thead>
                        <tr style={{ background: '#f8fafc' }}>
                            <th style={thStyle}>בניין</th>
                            <th style={thStyle}>אזור</th>
                            <th style={thStyle}>סה״כ מיטות</th>
                            <th style={thStyle}>משובץ</th>
                            <th style={thStyle}>פנוי</th>
                            <th style={thStyle}>אחוז תפוסה</th>
                            <th style={thStyle}>סטטוס</th>
                        </tr>
                    </thead>

                    <tbody>
                        {rows.map((row, index) => {
                            const totalBeds = Number(row.total_beds || 0);
                            const assigned = Number(row.assigned || 0);
                            const available = Number((row.available_beds ?? row.available) || Math.max(totalBeds - assigned, 0));
                            const rate = Number(row.occupancy_rate || 0);

                            const status =
                                rate >= 80 ? { text: 'תפוסה גבוהה', color: '#10b981', bg: '#dcfce7' } :
                                rate >= 50 ? { text: 'תפוסה בינונית', color: '#d97706', bg: '#fef3c7' } :
                                { text: 'תפוסה נמוכה', color: '#dc2626', bg: '#fee2e2' };

                            return (
                                <tr key={`${row.building}-${index}`} style={{
                                    borderTop: '1px solid #edf2f7'
                                }}>
                                    <td style={tdStyle}>{row.building || 'לא ידוע'}</td>
                                    <td style={tdStyle}>{row.region || 'לא ידוע'}</td>
                                    <td style={tdStyle}>{formatNumber(totalBeds)}</td>
                                    <td style={tdStyle}>{formatNumber(assigned)}</td>
                                    <td style={tdStyle}>{formatNumber(available)}</td>
                                    <td style={tdStyle}>{rate}%</td>
                                    <td style={tdStyle}>
                                        <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            borderRadius: '999px',
                                            padding: '6px 10px',
                                            fontSize: '12px',
                                            fontWeight: 800,
                                            color: status.color,
                                            background: status.bg
                                        }}>
                                            {status.text}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const thStyle = {
    padding: '14px 16px',
    textAlign: 'right',
    color: '#475569',
    fontSize: '13px',
    fontWeight: 800,
    whiteSpace: 'nowrap'
};

const tdStyle = {
    padding: '14px 16px',
    textAlign: 'right',
    color: '#1e293b',
    fontSize: '13px',
    whiteSpace: 'nowrap'
};

export default function AnalysisPage({ language = 'he' }) {
    const isHebrew = language === 'he';

    const t = {
        title: isHebrew ? '📊 ניתוח נתונים' : '📊 Data Analysis',
        subtitle: isHebrew
            ? 'תמונת מצב ניהולית של סטודנטים, שיבוצים, מיטות ותפוסת בניינים'
            : 'Management overview of students, assignments, beds, and building occupancy',

        dataSource: isHebrew ? 'מקור נתונים: בסיס הנתונים הפעיל' : 'Data source: active database',

        totalStudents: isHebrew ? 'סה״כ סטודנטים' : 'Total Students',
        assignedStudents: isHebrew ? 'משובצים לחדר' : 'Assigned to Rooms',
        waitingStudents: isHebrew ? 'ממתינים לשיבוץ' : 'Waiting for Assignment',
        totalBeds: isHebrew ? 'סה״כ מיטות' : 'Total Beds',
        availableBeds: isHebrew ? 'מיטות פנויות' : 'Available Beds',
        buildings: isHebrew ? 'בניינים' : 'Buildings',

        generalOverview: isHebrew ? 'סקירה כללית' : 'General Overview',
        generalOverviewSubtitle: isHebrew
            ? 'המדדים המרכזיים לפני ירידה לפרטים לפי בניין או מאפייני סטודנטים'
            : 'Main metrics before drilling down by building or student attributes',

        studentsByRegion: isHebrew ? 'סטודנטים לפי אזור' : 'Students by Region',
        studentsByRegionSubtitle: isHebrew
            ? 'מספר הסטודנטים בכל אזור מעונות'
            : 'Number of students in each dormitory region',

        bedStatus: isHebrew ? 'מצב מיטות' : 'Bed Status',
        bedStatusSubtitle: isHebrew
            ? 'השוואה בין כלל המיטות, תפוסות ופנויות'
            : 'Comparison between total, occupied, and available beds',

        studentDistribution: isHebrew ? 'התפלגות סטודנטים' : 'Student Distribution',
        studentDistributionSubtitle: isHebrew
            ? 'במקום להציג הרבה עוגות צפופות, בוחרים בכל פעם מאפיין אחד'
            : 'Choose one student attribute at a time instead of showing crowded charts',

        gender: isHebrew ? 'מגדר' : 'Gender',
        religion: isHebrew ? 'דת' : 'Religion',
        religious: isHebrew ? 'דתי/חילוני' : 'Religious Preference',
        category: isHebrew ? 'קטגוריה' : 'Category',
        housing: isHebrew ? 'סוג מגורים' : 'Housing Type',

        students: isHebrew ? 'סטודנטים' : 'Students',
        beds: isHebrew ? 'מיטות' : 'Beds',
        assigned: isHebrew ? 'משובץ' : 'Assigned',
        available: isHebrew ? 'פנוי' : 'Available',
    };


    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('all');
    const [studentChart, setStudentChart] = useState('gender');
    const [buildingSearch, setBuildingSearch] = useState('');

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

    if (loading) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '60vh',
                flexDirection: 'column',
                gap: '16px',
                direction: 'rtl'
            }}>
                <div style={{ fontSize: '48px' }}>📊</div>
                <p style={{ color: '#64748b', fontSize: '16px' }}>טוען נתוני ניתוח...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ padding: '32px', textAlign: 'center', direction: 'rtl' }}>
                <AlertCircle size={48} color="#ef4444" style={{ marginBottom: '16px' }} />
                <p style={{ color: '#ef4444', fontSize: '16px' }}>{error}</p>
            </div>
        );
    }

    const {
        summary = {},
        students_by_gender = [],
        students_by_religion = [],
        students_by_religious = [],
        students_by_category = [],
        students_by_housing = [],
        occupancy_data = [],
        transfers_by_status = [],
        transfers_by_type = [],
        students_by_region = []
    } = data || {};

    const totalStudents = Number(summary.total_students || 0);
    const assignedStudents = Number(summary.assigned_students || 0);
    const unassignedStudents = Number(summary.unassigned_students || Math.max(totalStudents - assignedStudents, 0));

    const totalBeds = Number(summary.total_beds || summary.total_capacity || 0);
    const assignedBeds = Number(summary.assigned_beds || summary.occupied_beds || 0);
    const availableBeds = Number(summary.available_beds || Math.max(totalBeds - assignedBeds, 0));

    const studentAssignmentRate = totalStudents > 0
        ? Math.round((assignedStudents / totalStudents) * 100)
        : 0;

    const bedOccupancyRate = totalBeds > 0
        ? Math.round((assignedBeds / totalBeds) * 100)
        : 0;

    const genderData = students_by_gender.map(d => ({
        name: GENDER_LABELS[d.gender] || d.gender || 'לא ידוע',
        value: d.count
    }));

    const religionData = students_by_religion.map(d => ({
        name: RELIGION_LABELS[d.requested_religion] || d.requested_religion || 'לא ידוע',
        value: d.count
    }));

    const religiousData = students_by_religious.map(d => ({
        name: RELIGIOUS_LABELS[d.religious] || d.religious || 'לא ידוע',
        value: d.count
    }));

    const categoryData = students_by_category.map(d => ({
        name: CATEGORY_LABELS[d.category] || d.category || 'לא ידוע',
        value: d.count
    }));

    const housingData = students_by_housing.map(d => ({
        name: d.housing_type || 'לא ידוע',
        value: d.count
    }));

    const transferStatusData = transfers_by_status.map(d => ({
        name: STATUS_LABELS[d.status] || d.status || 'לא ידוע',
        value: d.count
    }));

    const transferTypeData = transfers_by_type.map(d => ({
        name: MOVEMENT_LABELS[d.movement_request__movement_type] || d.movement_request__movement_type || 'לא ידוע',
        value: d.count
    }));

    const regionData = students_by_region
    .map(d => ({
        name:
            d.region ||
            d.region_name ||
            d.name ||
            d['accepted_dorm_type__region__name'] ||
            d['accepted_dorm_type__region'] ||
            '',
        value: Number(d.count || 0)
    }))
    .filter(d => d.name && d.value > 0)
    .sort((a, b) => b.value - a.value);

    const capacityOverviewData = [
    { name: t.totalBeds, value: totalBeds },
    { name: isHebrew ? 'מיטות תפוסות' : 'Occupied Beds', value: assignedBeds },
    { name: t.availableBeds, value: availableBeds }
];

    const selectedDemographicData = {
        gender: {
            title: 'התפלגות סטודנטים לפי מגדר',
            data: genderData,
            chartType: 'pie'
        },
        religion: {
            title: 'התפלגות סטודנטים לפי דת',
            data: religionData,
            chartType: 'bar'
        },
        religious: {
            title: 'התפלגות דתי/חילוני לצורך שיבוץ',
            data: religiousData,
            chartType: 'bar'
        },
        category: {
            title: 'התפלגות סטודנטים לפי קטגוריה',
            data: categoryData,
            chartType: 'bar'
        },
        housing: {
            title: 'התפלגות סטודנטים לפי סוג מגורים',
            data: housingData,
            chartType: 'bar'
        }
    }[studentChart];

    const availableRegions = [...new Set(occupancy_data.map(d => d.region).filter(Boolean))];

    const filteredOccupancyRaw = selectedRegion === 'all'
        ? occupancy_data
        : occupancy_data.filter(d => d.region === selectedRegion);

    const normalizedOccupancy = filteredOccupancyRaw.map(row => {
        const total = Number(row.total_beds || 0);
        const assigned = Number(row.assigned || 0);
        const available = Number((row.available_beds ?? row.available) || Math.max(total - assigned, 0));
        const occupancyRate = Number(row.occupancy_rate || (total > 0 ? Math.round((assigned / total) * 100) : 0));

        return {
            ...row,
            total_beds: total,
            assigned,
            available_beds: available,
            occupancy_rate: occupancyRate,
            building: row.building || 'לא ידוע',
            region: row.region || 'לא ידוע'
        };
    });

    const topOccupiedBuildings = [...normalizedOccupancy]
        .filter(d => d.assigned > 0)
        .sort((a, b) => b.assigned - a.assigned)
        .slice(0, 10);

    const topAvailableBuildings = [...normalizedOccupancy]
        .filter(d => d.available_beds > 0)
        .sort((a, b) => b.available_beds - a.available_beds)
        .slice(0, 10);

    const searchedBuildings = normalizedOccupancy
        .filter(row => {
            const search = buildingSearch.trim().toLowerCase();

            if (!search) {
                return true;
            }

            return (
                String(row.building || '').toLowerCase().includes(search) ||
                String(row.region || '').toLowerCase().includes(search)
            );
        })
        .sort((a, b) => b.occupancy_rate - a.occupancy_rate);

    const tableRows = searchedBuildings.slice(0, 25);

    const hasTransfers =
        transferStatusData.some(d => Number(d.value || 0) > 0) ||
        transferTypeData.some(d => Number(d.value || 0) > 0);

    return (
    <div style={{
        padding: '32px',
        direction: isHebrew ? 'rtl' : 'ltr',
        maxWidth: '1440px',
        margin: '0 auto'
    }}>

            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '20px',
                marginBottom: '28px',
                flexWrap: 'wrap'
            }}>
                <div>
                    <h1 style={{
                        fontSize: '30px',
                        fontWeight: 900,
                        color: '#0f172a',
                        margin: 0
                    }}>
                        📊{t.title}
                    </h1>

                    <p style={{
                        color: '#64748b',
                        marginTop: '8px',
                        fontSize: '15px'
                    }}>
                        {t.subtitle}
                    </p>
                </div>

                <div style={{
                    background: 'white',
                    border: '1px solid #e5edf6',
                    borderRadius: '14px',
                    padding: '12px 16px',
                    color: '#64748b',
                    fontSize: '13px',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)'
                }}>
                    {t.dataSource}
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))',
                gap: '16px'
            }}>
                <StatCard
                    title={t.totalStudents}
                    value={totalStudents}
                    icon={Users}
                    color="#3b82f6"
                />

                <StatCard
                    title={t.assignedStudents}
                    value={assignedStudents}
                    subtitle={isHebrew ? `${studentAssignmentRate}% מכלל הסטודנטים` : `${studentAssignmentRate}% of all students`}
                    icon={Home}
                    color="#10b981"
                />

                <StatCard
                    title={t.waitingStudents}
                    value={unassignedStudents}
                    icon={Users}
                    color="#f97316"
                />

                <StatCard
                    title={t.totalBeds}
                    value={totalBeds}
                    subtitle={isHebrew ? `${bedOccupancyRate}% תפוסה` : `${bedOccupancyRate}% occupancy`}
                    icon={Bed}
                    color="#06b6d4"
                />

                <StatCard
                    title={t.availableBeds}
                    value={availableBeds}
                    icon={Bed}
                    color="#8b5cf6"
                />

                <StatCard
                    title={t.buildings}
                    value={summary.total_buildings}
                    icon={Building2}
                    color="#f59e0b"
                />
            </div>

            {/* Overview */}
            <SectionTitle
    title={t.generalOverview}
    subtitle={t.generalOverviewSubtitle}
/>

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '18px'
            }}>
                {regionData.length > 0 && (
                    <ChartCard
                        title={t.studentsByRegion}
                        subtitle={t.studentsByRegionSubtitle}
                        height={310}
                    >
                        <BarChart data={regionData} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                            <XAxis type="number" tick={{ fontSize: 12 }} />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={120}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip />
                            <Bar dataKey="value" name={t.students} fill="#3b82f6" radius={[8, 8, 8, 8]} />
                        </BarChart>
                    </ChartCard>
                )}

                <ChartCard
                    title={t.bedStatus}
                    subtitle={t.bedStatusSubtitle}
                    height={310}
                >
                    <BarChart data={capacityOverviewData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="value" name="מיטות" fill="#10b981" radius={[8, 8, 0, 0]} />
                    </BarChart>
                </ChartCard>
            </div>

            {/* Student Distribution */}
            <SectionTitle
    title={t.studentDistribution}
    subtitle={t.studentDistributionSubtitle}
/>

            <DemographicButtons selected={studentChart} onChange={setStudentChart} t={t} />

            <ChartCard
                title={selectedDemographicData.title}
                subtitle="הצגה ממוקדת של מאפיין אחד מתוך נתוני הסטודנטים"
                height={330}
            >
                {selectedDemographicData.chartType === 'pie' ? (
                    <PieChart>
                        <Pie
                            data={selectedDemographicData.data}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={105}
                            label={({ name, value }) => `${name}: ${value}`}
                            labelLine={false}
                        >
                            {selectedDemographicData.data.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                    </PieChart>
                ) : (
                    <BarChart
                        data={selectedDemographicData.data}
                        layout="vertical"
                        margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis
                            dataKey="name"
                            type="category"
                            width={130}
                            tick={{ fontSize: 12 }}
                        />
                        <Tooltip />
                        <Bar dataKey="value" name="סטודנטים" fill="#3b82f6" radius={[8, 8, 8, 8]} />
                    </BarChart>
                )}
            </ChartCard>

            {/* Building Analysis */}
            {occupancy_data.length > 0 && (
                <>
                    <SectionTitle
                        title="ניתוח בניינים"
                        subtitle="הצגת תמונה ממוקדת: Top 10 בגרפים, והרשימה המלאה בטבלה"
                    />

                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '14px',
                        marginBottom: '16px'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            flexWrap: 'wrap'
                        }}>
                            <label style={{
                                fontSize: '14px',
                                fontWeight: 800,
                                color: '#334155'
                            }}>
                                בחר אזור:
                            </label>

                            <select
                                value={selectedRegion}
                                onChange={(e) => setSelectedRegion(e.target.value)}
                                style={{
                                    padding: '11px 16px',
                                    borderRadius: '12px',
                                    border: '1px solid #dbe4ef',
                                    fontSize: '14px',
                                    color: '#0f172a',
                                    background: 'white',
                                    cursor: 'pointer',
                                    outline: 'none',
                                    direction: 'rtl',
                                    minWidth: '220px'
                                }}
                            >
                                <option value="all">כל האזורים</option>
                                {availableRegions.map(region => (
                                    <option key={region} value={region}>{region}</option>
                                ))}
                            </select>

                            <span style={{
                                fontSize: '13px',
                                color: '#64748b'
                            }}>
                                {normalizedOccupancy.length} בניינים באזור הנבחר
                            </span>
                        </div>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'white',
                            border: '1px solid #dbe4ef',
                            borderRadius: '12px',
                            padding: '0 12px',
                            minWidth: '260px'
                        }}>
                            <Search size={17} color="#94a3b8" />
                            <input
                                value={buildingSearch}
                                onChange={(e) => setBuildingSearch(e.target.value)}
                                placeholder="חיפוש בניין או אזור..."
                                style={{
                                    border: 'none',
                                    outline: 'none',
                                    padding: '12px 4px',
                                    fontSize: '14px',
                                    width: '100%',
                                    direction: 'rtl',
                                    color: '#0f172a'
                                }}
                            />
                        </div>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '18px',
                        marginBottom: '18px'
                    }}>
                        <ChartCard
                            title="Top 10 בניינים לפי מיטות משובצות"
                            subtitle="הבניינים עם מספר השיבוצים הגבוה ביותר"
                            height={350}
                        >
                            <BarChart data={topOccupiedBuildings} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                                <XAxis type="number" tick={{ fontSize: 12 }} />
                                <YAxis
                                    dataKey="building"
                                    type="category"
                                    width={145}
                                    tick={{ fontSize: 11 }}
                                />
                                <Tooltip />
                                <Bar dataKey="assigned" name="משובץ" fill="#3b82f6" radius={[8, 8, 8, 8]} />
                            </BarChart>
                        </ChartCard>

                        <ChartCard
                            title="Top 10 בניינים לפי מיטות פנויות"
                            subtitle="הבניינים עם פוטנציאל הקליטה הגבוה ביותר"
                            height={350}
                        >
                            <BarChart data={topAvailableBuildings} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                                <XAxis type="number" tick={{ fontSize: 12 }} />
                                <YAxis
                                    dataKey="building"
                                    type="category"
                                    width={145}
                                    tick={{ fontSize: 11 }}
                                />
                                <Tooltip />
                                <Bar dataKey="available_beds" name="מיטות פנויות" fill="#10b981" radius={[8, 8, 8, 8]} />
                            </BarChart>
                        </ChartCard>
                    </div>

                    <div style={{
                        marginBottom: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        flexWrap: 'wrap'
                    }}>
                        <h3 style={{
                            fontSize: '17px',
                            fontWeight: 800,
                            color: '#0f172a',
                            margin: 0
                        }}>
                            טבלת בניינים
                        </h3>

                        <span style={{
                            color: '#64748b',
                            fontSize: '13px'
                        }}>
                            מוצגים {tableRows.length} מתוך {searchedBuildings.length} בניינים
                        </span>
                    </div>

                    <BuildingsTable rows={tableRows} />
                </>
            )}

            {/* Transfer Requests */}
            <SectionTitle
                title="בקשות העברה"
                subtitle="מעקב אחר בקשות מעבר פעילות במערכת"
            />

            {!hasTransfers ? (
                <EmptyState
                    title="אין בקשות העברה פעילות כרגע"
                    text="כאשר יופיעו בקשות חדשות, הן יוצגו כאן לפי סטטוס וסוג מעבר."
                />
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '18px'
                }}>
                    <ChartCard title="בקשות לפי סטטוס" height={280}>
                        <BarChart data={transferStatusData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Bar dataKey="value" name="בקשות" radius={[8, 8, 0, 0]}>
                                {transferStatusData.map((entry, i) => (
                                    <Cell
                                        key={i}
                                        fill={
                                            entry.name === 'אושר' ? '#10b981' :
                                            entry.name === 'נדחה' ? '#ef4444' :
                                            '#f59e0b'
                                        }
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ChartCard>

                    <ChartCard title="בקשות לפי סוג העברה" height={280}>
                        <BarChart data={transferTypeData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Bar dataKey="value" name="בקשות" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                        </BarChart>
                    </ChartCard>
                </div>
            )}
        </div>
    );
}