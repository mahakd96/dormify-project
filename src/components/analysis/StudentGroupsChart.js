import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { ChartCard, AnalysisEmptyState } from './AnalysisPrimitives';
import { formatNumber, num } from './analysisUtils';

const GENDER_LABELS = {
  he: { male: 'זכר', female: 'נקבה' },
  en: { male: 'Male', female: 'Female' },
};
const RELIGION_LABELS = {
  he: { Jewish: 'יהודי', Muslims: 'מוסלמי', Christian: 'נוצרי', Druze: 'דרוזי', not_specified: 'לא צוין' },
  en: { Jewish: 'Jewish', Muslims: 'Muslim', Christian: 'Christian', Druze: 'Druze', not_specified: 'Not specified' },
};
const RELIGIOUS_LABELS = {
  he: { religious: 'דתי', no_preference: 'לא משנה', not_specified: 'לא צוין' },
  en: { religious: 'Religious', no_preference: 'No preference', not_specified: 'Not specified' },
};
const CATEGORY_LABELS = {
  he: { new: 'חדשים', continuing: 'ממשיכים', transfer: 'מעברים', leaving: 'עוזבים' },
  en: { new: 'New', continuing: 'Continuing', transfer: 'Transfer', leaving: 'Leaving' },
};
const HOUSING_LABELS = {
  he: {
    'רווקים': 'רווקים', 'רווקות': 'רווקות', 'זוגות': 'זוגות',
    'משפחות עד 2 ילדים (כולל)': 'משפחות', 'רווקים/ות בדירה': 'רווקים/ות בדירה',
  },
  en: {
    'רווקים': 'Single (men)', 'רווקות': 'Single (women)', 'זוגות': 'Couples',
    'משפחות עד 2 ילדים (כולל)': 'Families', 'רווקים/ות בדירה': 'Single in apartment',
  },
};

function ChartLTRBox({ height, children }) {
  return <div className="an-chart-ltr" dir="ltr" style={{ height }}>{children}</div>;
}

// One categorical dimension at a time, single-series horizontal bar - each
// view answers exactly one question (counts by gender / religion / etc.),
// deliberately never combining dimensions into one chart.
function StudentGroupsChart({ data, summary, language, t }) {
  const [dimension, setDimension] = useState('gender');

  const assignedStudents = num(summary.assigned_students);
  const unassignedStudents = num(summary.unassigned_students);
  const priorityStudents = num(summary.priority_students);
  const totalStudents = num(summary.total_students);

  const distinctRegionsInData = useMemo(
    () => [...new Set((data?.students_by_region || []).map((r) => r.region).filter(Boolean))],
    [data]
  );

  const distributionOptions = [
    { key: 'gender', label: t.dimGender },
    { key: 'religion', label: t.dimReligion },
    { key: 'religious', label: t.dimReligious },
    { key: 'category', label: t.dimCategory },
    { key: 'housing', label: t.dimHousing },
    { key: 'allocation', label: t.dimAllocation },
    { key: 'priority', label: t.dimPriority },
    ...(distinctRegionsInData.length > 1 ? [{ key: 'region', label: t.dimRegion }] : []),
  ];

  const distributionData = useMemo(() => {
    const mapWithLabels = (rows, key, labels) => (rows || [])
      .map((row) => {
        const raw = row[key];
        const name = raw ? (labels?.[language]?.[raw] || raw) : t.unknown;
        return { name, value: num(row.count) };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

    switch (dimension) {
      case 'gender': return mapWithLabels(data?.students_by_gender, 'gender', GENDER_LABELS);
      case 'religion': return mapWithLabels(data?.students_by_religion, 'requested_religion', RELIGION_LABELS);
      case 'religious': return mapWithLabels(data?.students_by_religious, 'religious', RELIGIOUS_LABELS);
      case 'category': return mapWithLabels(data?.students_by_category, 'category', CATEGORY_LABELS);
      case 'housing': return mapWithLabels(data?.students_by_housing, 'housing_type', HOUSING_LABELS);
      case 'region': return (data?.students_by_region || [])
        .map((r) => ({ name: r.region || t.unknown, value: num(r.count) }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value);
      case 'allocation': return [
        { name: t.assigned, value: assignedStudents },
        { name: t.waiting, value: unassignedStudents },
      ].filter((d) => d.value > 0);
      case 'priority': return [
        { name: t.dimPriority, value: priorityStudents },
        { name: t.noSpecialRequest, value: Math.max(totalStudents - priorityStudents, 0) },
      ].filter((d) => d.value > 0);
      default: return [];
    }
  }, [dimension, data, language, assignedStudents, unassignedStudents, priorityStudents, totalStudents, t]);

  return (
    <ChartCard
      title={t.distributionTitle}
      subtitle={t.distributionSubtitle}
      actions={(
        <div className="an-dim-buttons">
          {distributionOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`an-dim-btn ${dimension === opt.key ? 'active' : ''}`}
              onClick={() => setDimension(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    >
      {distributionData.length === 0 ? (
        <AnalysisEmptyState title={t.noData} />
      ) : (
        <ChartLTRBox height={Math.max(distributionData.length * 38, 140)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distributionData} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [formatNumber(value, language), t.students]} />
              <Bar dataKey="value" fill="#2563eb" radius={[0, 8, 8, 0]} maxBarSize={22}>
                <LabelList dataKey="value" position="right" formatter={(v) => formatNumber(v, language)} style={{ fontSize: 11, fill: '#334155', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartLTRBox>
      )}
    </ChartCard>
  );
}

export default StudentGroupsChart;
