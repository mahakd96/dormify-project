import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  DoorOpen,
  Home,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import { dormInventoryAPI } from '../services/api';

/**
 * BuildingSetupWizard — guided "Add Building" flow.
 *
 * Building → Apartment configuration groups (bulk, with editable generated
 * numbering) → Room configuration groups per apartment group → Review →
 * Create → Success.
 *
 * Renders through the SAME .inv-modalOverlay/.inv-modal/.inv-modalHeader/
 * .inv-modalBody/.inv-modalFooter/.inv-modalSection/.inv-modalGrid/
 * .inv-formField/.inv-readonlyField/.inv-primaryBtn/.inv-secondaryBtn/
 * .inv-infoCallout classes BuildingsPage.js already defines globally (plain
 * <style> tags are not scoped to a component, so reusing them here needs no
 * duplication) — only genuinely new step-specific UI gets its own `wiz-`
 * prefixed rules below. Portaled to document.body for the same reason the
 * edit/create modal is: true-viewport centering and a z-index above the app
 * shell, independent of where this component happens to be mounted.
 */

const CATEGORY_VALUES = ['male', 'female', 'mixed'];
const APARTMENT_TYPE_VALUES = ['single', 'couple', 'family'];

function generateApartmentNumbers(firstNumber, count) {
  const trimmed = String(firstNumber ?? '').trim();
  const total = Number(count) || 0;
  if (!trimmed || total <= 0) return [];

  // Preserve a non-numeric prefix (e.g. "SF1" -> SF1..SFn) and the digit
  // width of the seed (e.g. "007" -> 007, 008, ...). Apartment.number is a
  // free-text CharField with no format constraint on the backend, so this
  // is purely a numbering convenience, never a stored format requirement.
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (match) {
    const [, prefix, digits] = match;
    const start = parseInt(digits, 10);
    const width = digits.length;
    return Array.from({ length: total }, (_, i) => `${prefix}${String(start + i).padStart(width, '0')}`);
  }
  // No trailing digits to increment (e.g. "Penthouse") - keep the first
  // number as-is and disambiguate the rest with a numeric suffix.
  return Array.from({ length: total }, (_, i) => (i === 0 ? trimmed : `${trimmed}-${i + 1}`));
}

function makeApartmentGroup(id) {
  return {
    id,
    category: 'mixed',
    apartment_type: 'single',
    apartment_capacity: '',
    firstNumber: '',
    count: 1,
    numbers: [],
  };
}

function makeRoomGroup(id) {
  return { id, capacity: 1, count: 1 };
}

export default function BuildingSetupWizard({
  language = 'he',
  dormTypesInRegion = [],
  defaultDormTypeId = '',
  regionName = '',
  categoryLabels,
  apartmentTypeLabels,
  genderRestrictionLabels,
  onClose,
  onCompleted,
}) {
  const isHe = language === 'he';
  const nextId = useRef(1);
  const makeId = () => {
    nextId.current += 1;
    return nextId.current;
  };

  const t = isHe
    ? {
        titleBuilding: 'הוספת בניין',
        titleApartments: 'תצורת דירות',
        titleRooms: 'תצורת חדרים',
        titleReview: 'סקירה לפני יצירה',
        titleSuccess: 'הבניין נוצר בהצלחה',
        stepBuilding: 'בניין',
        stepApartments: 'דירות',
        stepRooms: 'חדרים',
        stepReview: 'סקירה',
        buildingContext: (region) => (region ? `אזור ${region}` : ''),
        buildingNumberLabel: 'מספר בניין',
        dormTypeLabel: 'סוג מעונות',
        genderRestrictionLabel: 'הגבלת מגדר',
        noRestriction: 'ללא הגבלה',
        maleOnly: 'בנים בלבד',
        femaleOnly: 'בנות בלבד',
        back: 'הקודם',
        next: 'הבא',
        cancel: 'ביטול',
        create: 'צור מלאי',
        close: 'סגור',
        viewBuilding: 'צפה בבניין',
        buildingCreated: 'הבניין נוצר',
        apartmentsIntro: 'הגדירו קבוצת תצורה אחת עבור כל סוג דירה זהה בבניין (למשל 10 דירות יחיד, ואז 2 דירות זוגיות).',
        configurationLabel: (n) => `תצורה ${n}`,
        categoryLabel: 'קטגוריה (מגדר)',
        typeLabel: 'סוג דיור',
        apartmentCapacityLabel: 'קיבולת דירה',
        firstApartmentNumberLabel: 'מספר הדירה הראשונה',
        apartmentCountLabel: 'כמה דירות יש בתצורה זו?',
        numbersPreviewLabel: 'הדירות שייווצרו',
        addAnotherApartmentConfig: '+ הוסף תצורת דירה נוספת',
        removeConfig: 'הסר תצורה',
        roomsIntro: 'עבור כל תצורת דירה, הגדירו את החדרים שייווצרו בכל דירה מסוג זה.',
        forApartmentConfig: (label, count) => `${label} — ${count} דירות`,
        roomCapacityLabel: 'קיבולת לחדר',
        roomCountLabel: 'מספר חדרים זהים',
        addAnotherRoomConfig: '+ הוסף תצורת חדרים נוספת',
        roomsPreviewLabel: 'תצוגה מקדימה — דירה לדוגמה',
        roomWord: 'חדר',
        reviewIntro: 'בדקו את המלאי שייווצר לפני האישור הסופי.',
        reviewApartmentsIn: (label) => `${label}:`,
        apartmentsWord: 'דירות',
        roomsPerApartmentWord: 'חדרים לדירה',
        totalRoomsWord: 'סה"כ חדרים',
        totalBedsWord: 'סה"כ מיטות',
        reviewTotalsTitle: 'סה"כ מלאי שייווצר',
        totalApartmentsWord: 'דירות',
        successApartments: (n) => `${n} דירות נוצרו`,
        successRooms: (n) => `${n} חדרים נוצרו`,
        successBeds: (n) => `${n} מיטות נוצרו`,
        errGeneric: 'הפעולה נכשלה',
        errBuildingNumber: 'יש להזין מספר בניין',
        errDormType: 'יש לבחור סוג מעונות',
        errNoGroups: 'יש להגדיר לפחות תצורת דירה אחת',
        errCategory: 'יש לבחור קטגוריה עבור כל תצורה',
        errApartmentNumbering: 'יש להזין מספר דירה ראשון וכמות תקינה עבור כל תצורה',
        errDuplicateNumbers: 'קיימים מספרי דירה כפולים בין התצורות',
        errNoRoomGroups: 'יש להגדיר לפחות תצורת חדרים אחת לכל תצורת דירה',
        errRoomCapacity: 'יש להזין קיבולת חדר תקינה',
        errRoomCount: 'יש להזין מספר חדרים תקין',
      }
    : {
        titleBuilding: 'Add Building',
        titleApartments: 'Apartment configuration',
        titleRooms: 'Room configuration',
        titleReview: 'Review before creating',
        titleSuccess: 'Building created',
        stepBuilding: 'Building',
        stepApartments: 'Apartments',
        stepRooms: 'Rooms',
        stepReview: 'Review',
        buildingContext: (region) => (region ? `Region ${region}` : ''),
        buildingNumberLabel: 'Building number',
        dormTypeLabel: 'Dormitory type',
        genderRestrictionLabel: 'Gender restriction',
        noRestriction: 'No restriction',
        maleOnly: 'Male only',
        femaleOnly: 'Female only',
        back: 'Back',
        next: 'Next',
        cancel: 'Cancel',
        create: 'Create inventory',
        close: 'Close',
        viewBuilding: 'View building',
        buildingCreated: 'Building created',
        apartmentsIntro:
          'Define one configuration group for each identical apartment type in this building (e.g. 10 single apartments, then 2 couple apartments).',
        configurationLabel: (n) => `Configuration ${n}`,
        categoryLabel: 'Category (gender)',
        typeLabel: 'Housing type',
        apartmentCapacityLabel: 'Apartment capacity',
        firstApartmentNumberLabel: 'First apartment number',
        apartmentCountLabel: 'How many apartments have this configuration?',
        numbersPreviewLabel: 'Apartments that will be created',
        addAnotherApartmentConfig: '+ Add another apartment configuration',
        removeConfig: 'Remove configuration',
        roomsIntro: 'For each apartment configuration, define the rooms that will exist in every apartment of that type.',
        forApartmentConfig: (label, count) => `${label} — ${count} apartments`,
        roomCapacityLabel: 'Capacity per room',
        roomCountLabel: 'Number of identical rooms',
        addAnotherRoomConfig: '+ Add another room configuration',
        roomsPreviewLabel: 'Preview — one apartment',
        roomWord: 'Room',
        reviewIntro: 'Review the inventory that will be created before final confirmation.',
        reviewApartmentsIn: (label) => `${label}:`,
        apartmentsWord: 'apartments',
        roomsPerApartmentWord: 'rooms/apartment',
        totalRoomsWord: 'total rooms',
        totalBedsWord: 'total beds',
        reviewTotalsTitle: 'Total inventory to create',
        totalApartmentsWord: 'apartments',
        successApartments: (n) => `${n} apartments created`,
        successRooms: (n) => `${n} rooms created`,
        successBeds: (n) => `${n} beds created`,
        errGeneric: 'The action failed',
        errBuildingNumber: 'Building number is required',
        errDormType: 'Dormitory type is required',
        errNoGroups: 'Define at least one apartment configuration',
        errCategory: 'Choose a category for every configuration',
        errApartmentNumbering: 'Enter a first apartment number and a valid count for every configuration',
        errDuplicateNumbers: 'There are duplicate apartment numbers across configurations',
        errNoRoomGroups: 'Define at least one room configuration for every apartment configuration',
        errRoomCapacity: 'Enter a valid room capacity',
        errRoomCount: 'Enter a valid room count',
      };

  const dormTypeLabelText = (dt) => (dt ? `${dt.name}${dt.code ? ` (${dt.code})` : ''}` : '');

  const [step, setStep] = useState('building');

  const [buildingForm, setBuildingForm] = useState({ number: '', dorm_type: defaultDormTypeId || '', gender_restriction: '' });
  const [buildingSaving, setBuildingSaving] = useState(false);
  const [buildingError, setBuildingError] = useState('');
  const [createdBuilding, setCreatedBuilding] = useState(null);

  const [apartmentGroups, setApartmentGroups] = useState([makeApartmentGroup(1)]);
  const [apartmentsError, setApartmentsError] = useState('');

  const [roomGroupsByGroup, setRoomGroupsByGroup] = useState({});
  const [roomsError, setRoomsError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successCounts, setSuccessCounts] = useState(null);

  const handleClose = () => {
    if (buildingSaving || submitting) return;
    onClose(createdBuilding);
  };

  // ---------------------------------------------------------------------
  // Step 1 — Building
  // ---------------------------------------------------------------------
  const handleCreateBuilding = async () => {
    if (!buildingForm.number) {
      setBuildingError(t.errBuildingNumber);
      return;
    }
    if (!buildingForm.dorm_type) {
      setBuildingError(t.errDormType);
      return;
    }
    setBuildingSaving(true);
    setBuildingError('');
    try {
      const building = await dormInventoryAPI.createBuilding({
        number: Number(buildingForm.number),
        dorm_type: buildingForm.dorm_type,
        gender_restriction: buildingForm.gender_restriction || '',
      });
      setCreatedBuilding(building);
      setStep('apartments');
    } catch (err) {
      setBuildingError(err?.fieldErrors?.message || err?.message || t.errGeneric);
    } finally {
      setBuildingSaving(false);
    }
  };

  // ---------------------------------------------------------------------
  // Step 2 — Apartment configuration groups (bulk, editable numbering)
  // ---------------------------------------------------------------------
  const updateApartmentGroup = (id, patch) => {
    setApartmentGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const regenerateNumbers = (id, firstNumber, count) => {
    updateApartmentGroup(id, { firstNumber, count, numbers: generateApartmentNumbers(firstNumber, count) });
  };

  const updateApartmentNumberAt = (id, index, value) => {
    setApartmentGroups((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const numbers = [...g.numbers];
        numbers[index] = value;
        return { ...g, numbers };
      })
    );
  };

  const addApartmentGroup = () => setApartmentGroups((prev) => [...prev, makeApartmentGroup(makeId())]);

  const removeApartmentGroup = (id) => {
    setApartmentGroups((prev) => prev.filter((g) => g.id !== id));
    setRoomGroupsByGroup((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const validateApartmentsStep = () => {
    if (apartmentGroups.length === 0) return t.errNoGroups;
    const allNumbers = [];
    for (const g of apartmentGroups) {
      if (!g.category) return t.errCategory;
      const count = Number(g.count);
      if (!g.firstNumber || !count || count < 1 || g.numbers.length !== count) return t.errApartmentNumbering;
      allNumbers.push(...g.numbers.map((n) => String(n).trim()));
    }
    if (allNumbers.some((n) => !n)) return t.errApartmentNumbering;
    if (new Set(allNumbers).size !== allNumbers.length) return t.errDuplicateNumbers;
    return '';
  };

  const handleApartmentsNext = () => {
    const err = validateApartmentsStep();
    if (err) {
      setApartmentsError(err);
      return;
    }
    setApartmentsError('');
    setRoomGroupsByGroup((prev) => {
      const next = { ...prev };
      apartmentGroups.forEach((g) => {
        if (!next[g.id] || next[g.id].length === 0) {
          next[g.id] = [makeRoomGroup(makeId())];
        }
      });
      return next;
    });
    setStep('rooms');
  };

  // ---------------------------------------------------------------------
  // Step 3 — Room configuration groups (per apartment group)
  // ---------------------------------------------------------------------
  const updateRoomGroup = (apartmentGroupId, roomGroupId, patch) => {
    setRoomGroupsByGroup((prev) => ({
      ...prev,
      [apartmentGroupId]: (prev[apartmentGroupId] || []).map((rg) => (rg.id === roomGroupId ? { ...rg, ...patch } : rg)),
    }));
  };

  const addRoomGroup = (apartmentGroupId) => {
    setRoomGroupsByGroup((prev) => ({
      ...prev,
      [apartmentGroupId]: [...(prev[apartmentGroupId] || []), makeRoomGroup(makeId())],
    }));
  };

  const removeRoomGroup = (apartmentGroupId, roomGroupId) => {
    setRoomGroupsByGroup((prev) => ({
      ...prev,
      [apartmentGroupId]: (prev[apartmentGroupId] || []).filter((rg) => rg.id !== roomGroupId),
    }));
  };

  const validateRoomsStep = () => {
    for (const g of apartmentGroups) {
      const roomGroups = roomGroupsByGroup[g.id] || [];
      if (roomGroups.length === 0) return t.errNoRoomGroups;
      for (const rg of roomGroups) {
        if (!rg.capacity || Number(rg.capacity) < 1) return t.errRoomCapacity;
        if (!rg.count || Number(rg.count) < 1) return t.errRoomCount;
      }
    }
    return '';
  };

  const handleRoomsNext = () => {
    const err = validateRoomsStep();
    if (err) {
      setRoomsError(err);
      return;
    }
    setRoomsError('');
    setStep('review');
  };

  // ---------------------------------------------------------------------
  // Review totals + final submission
  // ---------------------------------------------------------------------
  const reviewGroups = apartmentGroups.map((g) => {
    const roomGroups = roomGroupsByGroup[g.id] || [];
    const roomsPerApartment = roomGroups.reduce((sum, rg) => sum + (Number(rg.count) || 0), 0);
    const bedsPerApartment = roomGroups.reduce((sum, rg) => sum + (Number(rg.count) || 0) * (Number(rg.capacity) || 0), 0);
    const apartmentCount = g.numbers.length;
    return {
      group: g,
      roomGroups,
      apartmentCount,
      roomsPerApartment,
      totalRooms: apartmentCount * roomsPerApartment,
      totalBeds: apartmentCount * bedsPerApartment,
    };
  });
  const grandTotals = reviewGroups.reduce(
    (acc, r) => ({
      apartments: acc.apartments + r.apartmentCount,
      rooms: acc.rooms + r.totalRooms,
      beds: acc.beds + r.totalBeds,
    }),
    { apartments: 0, rooms: 0, beds: 0 }
  );

  const handleCreateInventory = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = {
        apartment_groups: apartmentGroups.map((g) => ({
          category: g.category,
          apartment_type: g.apartment_type,
          apartment_capacity: g.apartment_capacity === '' ? null : Number(g.apartment_capacity),
          numbers: g.numbers,
          room_groups: (roomGroupsByGroup[g.id] || []).map((rg) => ({
            capacity: Number(rg.capacity),
            count: Number(rg.count),
          })),
        })),
      };
      const result = await dormInventoryAPI.bulkCreateInventory(createdBuilding.id, payload);
      setSuccessCounts({
        apartments: result.created_apartments,
        rooms: result.created_rooms,
        beds: result.created_beds,
      });
      setStep('success');
    } catch (err) {
      setSubmitError(err?.fieldErrors?.message || err?.message || t.errGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  const BackIcon = isHe ? ArrowRight : ArrowLeft;
  const steps = ['building', 'apartments', 'rooms', 'review'];
  const stepLabels = { building: t.stepBuilding, apartments: t.stepApartments, rooms: t.stepRooms, review: t.stepReview };
  const stepIndex = steps.indexOf(step);

  return createPortal(
    <div className="inv-modalOverlay" dir={isHe ? 'rtl' : 'ltr'} onClick={handleClose}>
      <div className="inv-modal wiz-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modalHeader">
          <div className="inv-modalHeaderIcon">
            <Building2 size={18} />
          </div>
          <div className="inv-modalHeaderText">
            <h3>
              {step === 'building' && t.titleBuilding}
              {step === 'apartments' && t.titleApartments}
              {step === 'rooms' && t.titleRooms}
              {step === 'review' && t.titleReview}
              {step === 'success' && t.titleSuccess}
            </h3>
            {step !== 'success' && t.buildingContext(regionName) && (
              <p className="inv-modalHeaderContext">{t.buildingContext(regionName)}</p>
            )}
          </div>
          {step !== 'success' && (
            <button type="button" className="inv-iconBtn" onClick={handleClose} title={t.close} aria-label={t.close}>
              <X size={14} />
            </button>
          )}
        </div>

        {step !== 'success' && (
          <div className="wiz-stepBar">
            {steps.map((s, i) => (
              <div key={s} className={`wiz-stepDot ${i === stepIndex ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`}>
                <span className="wiz-stepDotCircle">{i < stepIndex ? <Check size={11} /> : i + 1}</span>
                <span className="wiz-stepDotLabel">{stepLabels[s]}</span>
              </div>
            ))}
          </div>
        )}

        <div className="inv-modalBody">
          {step === 'building' && (
            <>
              {buildingError && <div className="inv-alert inv-alert-danger">{buildingError}</div>}
              <div className="inv-modalSection">
                <div className="inv-modalGrid">
                  <div className="inv-formField">
                    <label htmlFor="wiz-b-number">{t.buildingNumberLabel}</label>
                    <input
                      id="wiz-b-number"
                      type="number"
                      value={buildingForm.number}
                      onChange={(e) => setBuildingForm((p) => ({ ...p, number: e.target.value }))}
                    />
                  </div>
                  <div className="inv-formField">
                    <label htmlFor="wiz-b-dormtype">{t.dormTypeLabel}</label>
                    <select
                      id="wiz-b-dormtype"
                      value={buildingForm.dorm_type}
                      onChange={(e) => setBuildingForm((p) => ({ ...p, dorm_type: e.target.value }))}
                    >
                      <option value="">—</option>
                      {dormTypesInRegion.map((dt) => (
                        <option key={dt.id} value={dt.id}>
                          {dormTypeLabelText(dt)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="inv-formField inv-modalGrid-span2">
                    <label htmlFor="wiz-b-restriction">{t.genderRestrictionLabel}</label>
                    <select
                      id="wiz-b-restriction"
                      value={buildingForm.gender_restriction}
                      onChange={(e) => setBuildingForm((p) => ({ ...p, gender_restriction: e.target.value }))}
                    >
                      <option value="">{t.noRestriction}</option>
                      <option value="male">{genderRestrictionLabels?.male || t.maleOnly}</option>
                      <option value="female">{genderRestrictionLabels?.female || t.femaleOnly}</option>
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'apartments' && (
            <>
              <div className="inv-infoCallout">
                <Home size={14} />
                <span>{t.apartmentsIntro}</span>
              </div>
              {apartmentsError && <div className="inv-alert inv-alert-danger">{apartmentsError}</div>}

              {apartmentGroups.map((g, groupIndex) => (
                <div key={g.id} className="inv-modalSection wiz-groupCard">
                  <div className="wiz-groupCardHeader">
                    <h4>{t.configurationLabel(groupIndex + 1)}</h4>
                    {apartmentGroups.length > 1 && (
                      <button type="button" className="inv-iconBtn inv-iconBtn-danger" title={t.removeConfig} onClick={() => removeApartmentGroup(g.id)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div className="inv-modalGrid">
                    <div className="inv-formField">
                      <label>{t.categoryLabel}</label>
                      <select value={g.category} onChange={(e) => updateApartmentGroup(g.id, { category: e.target.value })}>
                        {CATEGORY_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {categoryLabels?.[v] || v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="inv-formField">
                      <label>{t.typeLabel}</label>
                      <select value={g.apartment_type} onChange={(e) => updateApartmentGroup(g.id, { apartment_type: e.target.value })}>
                        {APARTMENT_TYPE_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {apartmentTypeLabels?.[v] || v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="inv-formField">
                      <label>{t.apartmentCapacityLabel}</label>
                      <input
                        type="number"
                        value={g.apartment_capacity}
                        onChange={(e) => updateApartmentGroup(g.id, { apartment_capacity: e.target.value })}
                      />
                    </div>
                    <div />
                    <div className="inv-formField">
                      <label>{t.firstApartmentNumberLabel}</label>
                      <input
                        value={g.firstNumber}
                        onChange={(e) => regenerateNumbers(g.id, e.target.value, g.count)}
                      />
                    </div>
                    <div className="inv-formField">
                      <label>{t.apartmentCountLabel}</label>
                      <input
                        type="number"
                        min="1"
                        value={g.count}
                        onChange={(e) => regenerateNumbers(g.id, g.firstNumber, e.target.value)}
                      />
                    </div>
                  </div>

                  {g.numbers.length > 0 && (
                    <div className="wiz-numberPreview">
                      <span className="wiz-numberPreviewLabel">{t.numbersPreviewLabel}</span>
                      <div className="wiz-numberGrid">
                        {g.numbers.map((num, i) => (
                          <input
                            key={i}
                            className="wiz-numberInput"
                            value={num}
                            onChange={(e) => updateApartmentNumberAt(g.id, i, e.target.value)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <button type="button" className="inv-secondaryBtn wiz-addGroupBtn" onClick={addApartmentGroup}>
                <Plus size={13} /> {t.addAnotherApartmentConfig}
              </button>
            </>
          )}

          {step === 'rooms' && (
            <>
              <div className="inv-infoCallout">
                <DoorOpen size={14} />
                <span>{t.roomsIntro}</span>
              </div>
              {roomsError && <div className="inv-alert inv-alert-danger">{roomsError}</div>}

              {apartmentGroups.map((g, groupIndex) => {
                const roomGroups = roomGroupsByGroup[g.id] || [];
                const roomsPerApartment = roomGroups.reduce((sum, rg) => sum + (Number(rg.count) || 0), 0);
                let roomCounter = 0;
                return (
                  <div key={g.id} className="inv-modalSection wiz-groupCard">
                    <h4>{t.forApartmentConfig(t.configurationLabel(groupIndex + 1), g.numbers.length)}</h4>

                    {roomGroups.map((rg) => (
                      <div key={rg.id} className="wiz-roomGroupRow">
                        <div className="inv-formField">
                          <label>{t.roomCountLabel}</label>
                          <input
                            type="number"
                            min="1"
                            value={rg.count}
                            onChange={(e) => updateRoomGroup(g.id, rg.id, { count: e.target.value })}
                          />
                        </div>
                        <div className="inv-formField">
                          <label>{t.roomCapacityLabel}</label>
                          <input
                            type="number"
                            min="1"
                            value={rg.capacity}
                            onChange={(e) => updateRoomGroup(g.id, rg.id, { capacity: e.target.value })}
                          />
                        </div>
                        {roomGroups.length > 1 && (
                          <button
                            type="button"
                            className="inv-iconBtn inv-iconBtn-danger"
                            title={t.removeConfig}
                            onClick={() => removeRoomGroup(g.id, rg.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}

                    <button type="button" className="inv-secondaryBtn wiz-addGroupBtn" onClick={() => addRoomGroup(g.id)}>
                      <Plus size={13} /> {t.addAnotherRoomConfig}
                    </button>

                    {roomsPerApartment > 0 && (
                      <div className="wiz-roomsPreview">
                        <span className="wiz-numberPreviewLabel">
                          {t.roomsPreviewLabel} ({t.configurationLabel(groupIndex + 1)})
                        </span>
                        <ul className="wiz-roomsPreviewList">
                          {roomGroups.map((rg) =>
                            Array.from({ length: Number(rg.count) || 0 }).map(() => {
                              roomCounter += 1;
                              return (
                                <li key={roomCounter}>
                                  {t.roomWord} {roomCounter} — {t.roomCapacityLabel.toLowerCase()}: {rg.capacity}
                                </li>
                              );
                            })
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {step === 'review' && (
            <>
              <div className="inv-infoCallout">
                <Check size={14} />
                <span>{t.reviewIntro}</span>
              </div>
              {submitError && <div className="inv-alert inv-alert-danger">{submitError}</div>}

              {reviewGroups.map((r, i) => (
                <div key={r.group.id} className="inv-modalSection">
                  <h4>{t.reviewApartmentsIn(t.configurationLabel(i + 1))}</h4>
                  <div className="inv-summaryRow">
                    <div className="inv-summaryItem">
                      <span>{t.apartmentsWord}</span>
                      <strong>{r.apartmentCount}</strong>
                    </div>
                    <div className="inv-summaryItem">
                      <span>{t.roomsPerApartmentWord}</span>
                      <strong>{r.roomsPerApartment}</strong>
                    </div>
                    <div className="inv-summaryItem">
                      <span>{t.totalRoomsWord}</span>
                      <strong>{r.totalRooms}</strong>
                    </div>
                    <div className="inv-summaryItem">
                      <span>{t.totalBedsWord}</span>
                      <strong>{r.totalBeds}</strong>
                    </div>
                  </div>
                </div>
              ))}

              <div className="inv-modalSection wiz-reviewTotals">
                <h4>{t.reviewTotalsTitle}</h4>
                <div className="inv-summaryRow">
                  <div className="inv-summaryItem">
                    <span>{t.totalApartmentsWord}</span>
                    <strong>{grandTotals.apartments}</strong>
                  </div>
                  <div className="inv-summaryItem">
                    <span>{t.totalRoomsWord}</span>
                    <strong>{grandTotals.rooms}</strong>
                  </div>
                  <div className="inv-summaryItem">
                    <span>{t.totalBedsWord}</span>
                    <strong>{grandTotals.beds}</strong>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'success' && (
            <div className="wiz-successBody">
              <ul className="wiz-successList">
                <li>
                  <Check size={15} /> {t.buildingCreated} — {t.buildingNumberLabel} {createdBuilding?.number}
                </li>
                <li>
                  <Check size={15} /> {t.successApartments(successCounts?.apartments ?? 0)}
                </li>
                <li>
                  <Check size={15} /> {t.successRooms(successCounts?.rooms ?? 0)}
                </li>
                <li>
                  <Check size={15} /> {t.successBeds(successCounts?.beds ?? 0)}
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="inv-modalFooter">
          {step === 'success' ? (
            <button type="button" className="inv-primaryBtn" onClick={() => onCompleted(createdBuilding)}>
              {t.viewBuilding}
            </button>
          ) : (
            <>
              {step !== 'building' && (
                <button
                  type="button"
                  className="inv-secondaryBtn"
                  onClick={() => setStep(steps[Math.max(stepIndex - 1, 0)])}
                  disabled={submitting}
                >
                  <BackIcon size={13} /> {t.back}
                </button>
              )}
              <button type="button" className="inv-secondaryBtn" onClick={handleClose} disabled={buildingSaving || submitting}>
                {t.cancel}
              </button>
              {step === 'building' && (
                <button type="button" className="inv-primaryBtn" onClick={handleCreateBuilding} disabled={buildingSaving}>
                  {buildingSaving ? <Loader2 className="inv-spin" size={14} /> : t.next}
                </button>
              )}
              {step === 'apartments' && (
                <button type="button" className="inv-primaryBtn" onClick={handleApartmentsNext}>
                  {t.next}
                </button>
              )}
              {step === 'rooms' && (
                <button type="button" className="inv-primaryBtn" onClick={handleRoomsNext}>
                  {t.next}
                </button>
              )}
              {step === 'review' && (
                <button type="button" className="inv-primaryBtn" onClick={handleCreateInventory} disabled={submitting}>
                  {submitting ? <Loader2 className="inv-spin" size={14} /> : t.create}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        .wiz-modal { width: min(760px, calc(100vw - 48px)); }

        .wiz-stepBar {
          display: flex; align-items: center; gap: 6px; padding: 10px 20px; border-bottom: 1px solid var(--inv-border);
          overflow-x: auto;
        }
        .wiz-stepDot { display: flex; align-items: center; gap: 6px; color: var(--inv-muted); flex-shrink: 0; }
        .wiz-stepDot:not(:last-child)::after { content: ''; width: 18px; height: 1px; background: var(--inv-border); margin-inline-start: 6px; }
        .wiz-stepDotCircle {
          width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--inv-border-strong); display: flex;
          align-items: center; justify-content: center; font-size: 10.5px; font-weight: 700; flex-shrink: 0;
        }
        .wiz-stepDot.is-current { color: var(--inv-primary); }
        .wiz-stepDot.is-current .wiz-stepDotCircle { border-color: var(--inv-primary); background: var(--inv-primary-soft); color: var(--inv-primary); }
        .wiz-stepDot.is-done .wiz-stepDotCircle { border-color: var(--inv-success); background: var(--inv-success-soft); color: var(--inv-success); }
        .wiz-stepDotLabel { font-size: 11px; font-weight: 650; white-space: nowrap; }

        .inv-modalGrid-span2 { grid-column: 1 / -1; }

        .wiz-groupCard { position: relative; }
        .wiz-groupCardHeader { display: flex; align-items: center; justify-content: space-between; }
        .wiz-groupCardHeader h4 { margin: 0; }

        .wiz-numberPreview { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--inv-border); }
        .wiz-numberPreviewLabel { display: block; font-size: 10.5px; font-weight: 650; color: var(--inv-muted); margin-bottom: 6px; }
        .wiz-numberGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
        .wiz-numberInput {
          border: 1px solid var(--inv-border); border-radius: 7px; padding: 5px 6px; font-size: 11.5px; text-align: center;
          background: var(--inv-panel); color: var(--inv-text); font-family: inherit;
        }

        .wiz-addGroupBtn { align-self: flex-start; }

        .wiz-roomGroupRow { display: flex; align-items: flex-end; gap: 10px; }
        .wiz-roomGroupRow .inv-formField { flex: 1; }

        .wiz-roomsPreview { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--inv-border); }
        .wiz-roomsPreviewList { margin: 0; padding-inline-start: 18px; font-size: 12px; color: var(--inv-text); display: flex; flex-direction: column; gap: 2px; }

        .wiz-reviewTotals { background: var(--inv-primary-soft); border-color: var(--inv-primary); }

        .wiz-successBody { display: flex; flex-direction: column; align-items: center; padding: 12px 0 4px; }
        .wiz-successList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 360px; }
        .wiz-successList li {
          display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--inv-text);
          background: var(--inv-success-soft); color: var(--inv-success); border-radius: 9px; padding: 9px 12px;
        }

        @media (max-width: 640px) {
          .wiz-modal { width: calc(100vw - 24px); }
          .wiz-roomGroupRow { flex-wrap: wrap; }
        }
      `}</style>
    </div>,
    document.body
  );
}
