
export const dormOffices = [
  {
    id: 'upper-block-office',
    name: 'משרד גוש עליון',
    nameEn: 'Upper Block Office',
    dormIds: [
      'neve-america',
      'neve-america-couples',
      'senate',
      'senate-renovated',
      'ha-amim',
      'kfar-hasmaha',
      'kfar-hasmaha-couples',
    ],
  },
  {
    id: 'segal-zutar-office',
    name: 'משרד סגל זוטר',
    nameEn: 'Segal Zutar Office',
    dormIds: ['segal-zutar', 'segal-zutar-family', 'segal-zutar-couples'],
  },
  {
    id: 'mizrach-office',
    name: 'משרד מזרח',
    nameEn: 'Mizrach Office',
    dormIds: [
      'mizrach-yashan',
      'mizrach-yashan-couples',
      'mizrach-hadash',
      'mizrach-hadash-family',
      'mizrach-hadash-couples',
    ],
  },
  {
    id: 'broshim-office',
    name: 'משרד ברושים',
    nameEn: 'Broshim Office',
    dormIds: ['broshim', 'broshim-family', 'broshim-couples'],
  },
  {
    id: 'canada-office',
    name: 'משרד קנדה',
    nameEn: 'Canada Office',
    dormIds: ['canada', 'canada-family', 'canada-couples'],
  },
  {
    id: 'lower-office',
    name: 'משרד תחתון',
    nameEn: 'Lower Office',
    dormIds: ['rifkin1', 'rifkin2'],
  },
];

// ============================================
// DORMS (מעונות)
// dorm.officeId tells which office is responsible
// ============================================
export const dorms = [
  // Canada
  { id: 'canada', name: 'מעונות קנדה', nameEn: 'Canada Dorms', officeId: 'canada-office' },
  { id: 'canada-family', name: 'מעונות קנדה משפחות', nameEn: 'Canada Family Dorms', officeId: 'canada-office' },
  { id: 'canada-couples', name: 'מעונות קנדה זוגות', nameEn: 'Canada Couples Dorms', officeId: 'canada-office' },

  // Mizrach
  { id: 'mizrach-yashan', name: 'מעונות מזרח ישן', nameEn: 'Mizrach Yashan Dorms', officeId: 'mizrach-office' },
  { id: 'mizrach-yashan-couples', name: 'מעונות מזרח ישן זוגות', nameEn: 'Mizrach Yashan Couples Dorms', officeId: 'mizrach-office' },

  { id: 'mizrach-hadash', name: 'מעונות מזרח חדש', nameEn: 'Mizrach Hadash Dorms', officeId: 'mizrach-office' },
  { id: 'mizrach-hadash-family', name: 'מעונות מזרח חדש משפחות', nameEn: 'Mizrach Hadash Family Dorms', officeId: 'mizrach-office' },
  { id: 'mizrach-hadash-couples', name: 'מעונות מזרח חדש זוגות', nameEn: 'Mizrach Hadash Couples Dorms', officeId: 'mizrach-office' },

  // Lower (Rifkin split)
  { id: 'rifkin1', name: 'מעונות ריפקין 1', nameEn: 'Rifkin 1 Dorms', officeId: 'lower-office' },
  { id: 'rifkin2', name: 'מעונות ריפקין 2', nameEn: 'Rifkin 2 Dorms', officeId: 'lower-office' },

  // Upper block
  { id: 'neve-america', name: 'מעונות נווה אמריקה', nameEn: 'Neve America Dorms', officeId: 'upper-block-office' },
  { id: 'neve-america-couples', name: 'מעונות נווה אמריקה זוגות', nameEn: 'Neve America Couples Dorms', officeId: 'upper-block-office' },

  { id: 'senate', name: 'מעונות סנאט', nameEn: 'Senate Dorms', officeId: 'upper-block-office' },
  { id: 'senate-renovated', name: 'מעונות סנאט מחודש', nameEn: 'Senate Renovated Complex Dorms', officeId: 'upper-block-office' },
  { id: 'ha-amim', name: 'מעונות העמים', nameEn: 'HaAmim Dorms', officeId: 'upper-block-office' },

  { id: 'kfar-hasmaha', name: 'מעונות כפר השמכה', nameEn: 'Kfar Hasmaha Dorms', officeId: 'upper-block-office' },
  { id: 'kfar-hasmaha-couples', name: 'מעונות כפר השמכה זוגות', nameEn: 'Kfar Hasmaha Couples Dorms', officeId: 'upper-block-office' },

  // Segal Zutar
  { id: 'segal-zutar', name: 'מעונות סגל זוטר', nameEn: 'Segal Zutar Dorms', officeId: 'segal-zutar-office' },
  { id: 'segal-zutar-family', name: 'מעונות סגל זוטר משפחות', nameEn: 'Segal Zutar Family Dorms', officeId: 'segal-zutar-office' },
  { id: 'segal-zutar-couples', name: 'מעונות סגל זוטר זוגות', nameEn: 'Segal Zutar Couples Dorms', officeId: 'segal-zutar-office' },

  // Broshim
  { id: 'broshim', name: 'מעונות ברושים', nameEn: 'Broshim Dorms', officeId: 'broshim-office' },
  { id: 'broshim-family', name: 'מעונות ברושים משפחות', nameEn: 'Broshim Family Dorms', officeId: 'broshim-office' },
  { id: 'broshim-couples', name: 'מעונות ברושים זוגות', nameEn: 'Broshim Couples Dorms', officeId: 'broshim-office' },
];


export const regions = dorms;


export const users = [
  { id: 'user-central', email: 'admin@technion.ac.il', password: 'admin123', name: 'אברהם אדגה', role: 'central_admin', regionId: null },

  // Canada office
  { id: 'user-canada-boss', email: 'canada@technion.ac.il', password: 'test123', name: 'שרה לוי', role: 'region_boss', regionId: 'canada' },
  { id: 'user-canada-emp1', email: 'canada.emp1@technion.ac.il', password: '123456', name: 'דוד ישראלי', role: 'employee', regionId: 'canada' },
  { id: 'user-canada-emp2', email: 'canada.emp2@technion.ac.il', password: '123456', name: 'איתי כהן', role: 'employee', regionId: 'canada' },
  { id: 'user-canada-emp3', email: 'canada.emp3@technion.ac.il', password: '123456', name: 'ליאור לוי', role: 'employee', regionId: 'canada' },

  // Mizrach office
  { id: 'user-mizrach-boss', email: 'mizrach.boss@technion.ac.il', password: '123456', name: 'יוסף חדד', role: 'region_boss', regionId: 'mizrach-hadash' },
  { id: 'user-mizrach-emp1', email: 'mizrach.emp1@technion.ac.il', password: '123456', name: 'מירי גולן', role: 'employee', regionId: 'mizrach-hadash' },
  { id: 'user-mizrach-emp2', email: 'mizrach.emp2@technion.ac.il', password: '123456', name: 'דנה כהן', role: 'employee', regionId: 'mizrach-hadash' },

  // Segal Zutar office
  { id: 'user-segal-boss', email: 'segal.boss@technion.ac.il', password: '123456', name: 'תמר רוזן', role: 'region_boss', regionId: 'segal-zutar' },

  // Rifkin / Lower office (optional, but avoids broken IDs in requests)
  { id: 'user-rifkin-admin', email: 'rifkin.boss@technion.ac.il', password: '123456', name: 'חיים פרץ', role: 'region_boss', regionId: 'rifkin1' },
  { id: 'user-rifkin-emp1', email: 'rifkin.emp1@technion.ac.il', password: '123456', name: 'יעל ביטון', role: 'employee', regionId: 'rifkin1' },
  { id: 'user-rifkin-emp2', email: 'rifkin.emp2@technion.ac.il', password: '123456', name: 'נועם מזרחי', role: 'employee', regionId: 'rifkin2' },
];

// ============================================
// RELIGIONS
// ============================================
export const religions = [
  { id: 'jewish', name: 'יהודי', nameEn: 'Jewish' },
  { id: 'muslim', name: 'מוסלמי', nameEn: 'Muslim' },
  { id: 'christian', name: 'נוצרי', nameEn: 'Christian' },
  { id: 'druze', name: 'דרוזי', nameEn: 'Druze' },
  { id: 'other', name: 'אחר', nameEn: 'Other' }
];

// ============================================
// GENDERS
// ============================================
export const genders = [
  { id: 'male', name: 'זכר', nameEn: 'Male' },
  { id: 'female', name: 'נקבה', nameEn: 'Female' }
];

// ============================================
// BUILDINGS (בניינים)
// IMPORTANT: building.regionId = dormId (kept to avoid refactor now)
// ============================================
export const buildings = [
  // --------------------
  // Canada
  // --------------------
  { id: 'canada-1', regionId: 'canada', name: 'בניין 1', floors: 5, apartmentsPerFloor: 4 },
  { id: 'canada-2', regionId: 'canada', name: 'בניין 2', floors: 5, apartmentsPerFloor: 4 },
  { id: 'canada-3', regionId: 'canada', name: 'בניין 3', floors: 4, apartmentsPerFloor: 4 },

  { id: 'canada-family-1', regionId: 'canada-family', name: 'בניין משפחות 1', floors: 4, apartmentsPerFloor: 3 },
  { id: 'canada-family-2', regionId: 'canada-family', name: 'בניין משפחות 2', floors: 4, apartmentsPerFloor: 3 },

  { id: 'canada-couples-1', regionId: 'canada-couples', name: 'בניין זוגות 1', floors: 4, apartmentsPerFloor: 3 },
  { id: 'canada-couples-2', regionId: 'canada-couples', name: 'בניין זוגות 2', floors: 4, apartmentsPerFloor: 3 },

  // --------------------
  // Mizrach Yashan
  // --------------------
  { id: 'mizrach-yashan-1', regionId: 'mizrach-yashan', name: 'בניין 1', floors: 6, apartmentsPerFloor: 3 },
  { id: 'mizrach-yashan-2', regionId: 'mizrach-yashan', name: 'בניין 2', floors: 6, apartmentsPerFloor: 3 },

  { id: 'mizrach-yashan-couples-1', regionId: 'mizrach-yashan-couples', name: 'בניין זוגות 1', floors: 5, apartmentsPerFloor: 3 },

  // --------------------
  // Mizrach Hadash
  // --------------------
  { id: 'mizrach-hadash-1', regionId: 'mizrach-hadash', name: 'בניין 1', floors: 7, apartmentsPerFloor: 3 },
  { id: 'mizrach-hadash-2', regionId: 'mizrach-hadash', name: 'בניין 2', floors: 7, apartmentsPerFloor: 3 },
  { id: 'mizrach-hadash-3', regionId: 'mizrach-hadash', name: 'בניין 3', floors: 6, apartmentsPerFloor: 3 },

  { id: 'mizrach-hadash-family-1', regionId: 'mizrach-hadash-family', name: 'בניין משפחות 1', floors: 5, apartmentsPerFloor: 2 },
  { id: 'mizrach-hadash-couples-1', regionId: 'mizrach-hadash-couples', name: 'בניין זוגות 1', floors: 5, apartmentsPerFloor: 2 },

  // --------------------
  // Rifkin split (rifkin1 / rifkin2)
  // --------------------
  { id: 'rifkin1-1', regionId: 'rifkin1', name: 'בניין 1', floors: 6, apartmentsPerFloor: 4 },
  { id: 'rifkin1-2', regionId: 'rifkin1', name: 'בניין 2', floors: 6, apartmentsPerFloor: 4 },
  { id: 'rifkin2-1', regionId: 'rifkin2', name: 'בניין 1', floors: 6, apartmentsPerFloor: 4 },
  { id: 'rifkin2-2', regionId: 'rifkin2', name: 'בניין 2', floors: 6, apartmentsPerFloor: 4 },

  // --------------------
  // Senate Renovated
  // --------------------
  { id: 'senate-renovated-1', regionId: 'senate-renovated', name: 'מתחם מחודש 1', floors: 5, apartmentsPerFloor: 4 },
  { id: 'senate-renovated-2', regionId: 'senate-renovated', name: 'מתחם מחודש 2', floors: 5, apartmentsPerFloor: 4 },

  // --------------------
  // Kfar Hasmaha
  // --------------------
  { id: 'kfar-hasmaha-1', regionId: 'kfar-hasmaha', name: 'בניין 1', floors: 4, apartmentsPerFloor: 5 },
  { id: 'kfar-hasmaha-2', regionId: 'kfar-hasmaha', name: 'בניין 2', floors: 4, apartmentsPerFloor: 5 },

  { id: 'kfar-hasmaha-couples-1', regionId: 'kfar-hasmaha-couples', name: 'בניין זוגות 1', floors: 4, apartmentsPerFloor: 4 },

  // --------------------
  // Segal Zutar (REAL codes 901–906)
  // --------------------
  { id: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'בניין 901', floors: null, apartmentsPerFloor: null, code: 901 },
  { id: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'בניין 902', floors: null, apartmentsPerFloor: null, code: 902 },
  { id: 'segal-zutar-couples-903', regionId: 'segal-zutar-couples', name: 'בניין 903', floors: null, apartmentsPerFloor: null, code: 903 },
  { id: 'segal-zutar-couples-904', regionId: 'segal-zutar-couples', name: 'בניין 904', floors: null, apartmentsPerFloor: null, code: 904 },
  { id: 'segal-zutar-couples-905', regionId: 'segal-zutar-couples', name: 'בניין 905', floors: null, apartmentsPerFloor: null, code: 905 },
  { id: 'segal-zutar-couples-906', regionId: 'segal-zutar-couples', name: 'בניין 906', floors: null, apartmentsPerFloor: null, code: 906 },

  { id: 'segal-zutar-family-901', regionId: 'segal-zutar-family', name: 'בניין 901', floors: null, apartmentsPerFloor: null, code: 901 },
  { id: 'segal-zutar-family-902', regionId: 'segal-zutar-family', name: 'בניין 902', floors: null, apartmentsPerFloor: null, code: 902 },
  { id: 'segal-zutar-family-903', regionId: 'segal-zutar-family', name: 'בניין 903', floors: null, apartmentsPerFloor: null, code: 903 },
  { id: 'segal-zutar-family-904', regionId: 'segal-zutar-family', name: 'בניין 904', floors: null, apartmentsPerFloor: null, code: 904 },
  { id: 'segal-zutar-family-905', regionId: 'segal-zutar-family', name: 'בניין 905', floors: null, apartmentsPerFloor: null, code: 905 },
  { id: 'segal-zutar-family-906', regionId: 'segal-zutar-family', name: 'בניין 906', floors: null, apartmentsPerFloor: null, code: 906 },

  // --------------------
  // Broshim
  // --------------------
  { id: 'broshim-1', regionId: 'broshim', name: 'בניין 1', floors: 6, apartmentsPerFloor: 4 },
  { id: 'broshim-2', regionId: 'broshim', name: 'בניין 2', floors: 6, apartmentsPerFloor: 4 },

  { id: 'broshim-family-1', regionId: 'broshim-family', name: 'בניין משפחות 1', floors: 4, apartmentsPerFloor: 3 },
  { id: 'broshim-couples-1', regionId: 'broshim-couples', name: 'בניין זוגות 1', floors: 4, apartmentsPerFloor: 3 },

  // --------------------
  // Neve America
  // --------------------
  { id: 'neve-america-1', regionId: 'neve-america', name: 'בניין 1', floors: 5, apartmentsPerFloor: 4 },
  { id: 'neve-america-2', regionId: 'neve-america', name: 'בניין 2', floors: 5, apartmentsPerFloor: 4 },

  { id: 'neve-america-couples-1', regionId: 'neve-america-couples', name: 'בניין זוגות 1', floors: 4, apartmentsPerFloor: 3 },

  // --------------------
  // Senate / HaAmim
  // --------------------
  { id: 'senate-1', regionId: 'senate', name: 'בניין 1', floors: 5, apartmentsPerFloor: 4 },
  { id: 'ha-amim-1', regionId: 'ha-amim', name: 'בניין 1', floors: 4, apartmentsPerFloor: 5 },
];

// ============================================
// SPECIAL REQUESTS (סטודנטים עם בקשות מיוחדות)
// (Kept as-is, but fixed user IDs typos to match users list)
// ============================================
export const specialRequests = [
  {
    id: 'sr-1',
    type: 'transfer',
    studentId: 'student-0',
    current: { regionId: 'canada', buildingId: 'canada-1', apartmentId: 'canada-1-apt-1', roomId: 'canada-1-apt-1-room-A' },
    requested: { regionId: 'canada' },
    needs: { floorPreference: 1, requiresElevator: true, accessibleRoom: false, nearEntrance: false },
    note: 'בעיה עם שותף חדר + צורך בקומה נמוכה',
    status: 'pending',
    requestedBy: 'user-canada-emp1',
    requestedAt: '2026-01-10T10:30:00',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
  },
  {
    id: 'sr-2',
    type: 'accessibility',
    studentId: 'student-5',
    current: { regionId: 'mizrach-hadash', buildingId: 'mizrach-hadash-2', apartmentId: 'mizrach-hadash-2-apt-3', roomId: 'mizrach-hadash-2-apt-3-room-B' },
    requested: { regionId: 'mizrach-hadash', buildingId: null, apartmentId: null, roomId: null },
    needs: { floorPreference: 1, requiresElevator: true, accessibleRoom: true, nearEntrance: true },
    note: 'נגישות מלאה (כיסא גלגלים)',
    status: 'approved',
    requestedBy: 'user-mizrach-emp1',
    requestedAt: '2026-01-08T14:15:00',
    reviewedBy: 'user-mizrach-boss',
    reviewedAt: '2026-01-09T09:00:00',
    rejectionReason: null,
  },
  {
    id: 'sr-3',
    type: 'medical',
    studentId: 'student-12',
    current: { regionId: 'rifkin1', buildingId: 'rifkin1-1', apartmentId: 'rifkin1-1-apt-2', roomId: 'rifkin1-1-apt-2-room-A' },
    requested: { regionId: 'rifkin2', buildingId: 'rifkin2-1', apartmentId: null, roomId: null },
    needs: { floorPreference: null, requiresElevator: false, accessibleRoom: false, nearEntrance: true },
    note: 'קרבה לכניסה + קרבה לתחבורה',
    status: 'rejected',
    requestedBy: 'user-rifkin-emp1',
    requestedAt: '2026-01-07T11:00:00',
    reviewedBy: 'user-central',
    reviewedAt: '2026-01-07T16:30:00',
    rejectionReason: 'אין זמינות מתאימה כרגע',
  },
];

// ============================================
// APARTMENTS & ROOMS GENERATOR (for NON-Segal regions)
// ============================================
const SEGAL_OVERRIDE_REGION_IDS = new Set(['segal-zutar-couples', 'segal-zutar-family']);

export const generateApartmentsAndRooms = () => {
  const apartments = [];
  const rooms = [];

  buildings.forEach((building) => {
    if (SEGAL_OVERRIDE_REGION_IDS.has(building.regionId)) return;
    if (!building.floors || !building.apartmentsPerFloor) return;

    for (let floor = 1; floor <= building.floors; floor++) {
      for (let apt = 1; apt <= building.apartmentsPerFloor; apt++) {
        const aptNumber = (floor - 1) * building.apartmentsPerFloor + apt;
        const apartmentId = `${building.id}-apt-${aptNumber}`;

        apartments.push({
          id: apartmentId,
          buildingId: building.id,
          regionId: building.regionId, // dormId (kept)
          number: aptNumber,
          floor: floor,
          roomCount: 2,
          isReserved: Math.random() < 0.05,
          reservedReason: Math.random() < 0.05 ? 'נגישות / בעיות בריאות' : null
        });

        ['A', 'B'].forEach((roomLetter) => {
          rooms.push({
            id: `${apartmentId}-room-${roomLetter}`,
            apartmentId,
            buildingId: building.id,
            regionId: building.regionId, // dormId (kept)
            name: `חדר ${roomLetter}`,
            capacity: 2,
            currentOccupancy: 0,
            students: []
          });
        });
      }
    }
  });

  return { apartments, rooms };
};

// ============================================
// SEGAL ZUTAR — REAL ROOMS
// ============================================
export const segalZutarRooms = [
  // segal-zutar-couples (singles in couples apt)
  { id: '901/6/1', apartmentId: 'segal-zutar-couples-901-apt-6', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/6/2', apartmentId: 'segal-zutar-couples-901-apt-6', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  { id: '901/8/1', apartmentId: 'segal-zutar-couples-901-apt-8', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/8/2', apartmentId: 'segal-zutar-couples-901-apt-8', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  { id: '901/13/1', apartmentId: 'segal-zutar-couples-901-apt-13', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/13/2', apartmentId: 'segal-zutar-couples-901-apt-13', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  { id: '901/15/1', apartmentId: 'segal-zutar-couples-901-apt-15', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/15/2', apartmentId: 'segal-zutar-couples-901-apt-15', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  // sample 902 singles
  { id: '902/7/1', apartmentId: 'segal-zutar-couples-902-apt-7', buildingId: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '902/7/2', apartmentId: 'segal-zutar-couples-902-apt-7', buildingId: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  // Couples (capacity=2) sample
  { id: '901/1/1', apartmentId: 'segal-zutar-couples-901-apt-1', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'יחידת זוגות', capacity: 2, currentOccupancy: 0, students: [] },
  { id: '902/2/1', apartmentId: 'segal-zutar-couples-902-apt-2', buildingId: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'יחידת זוגות', capacity: 2, currentOccupancy: 0, students: [] },

  // segal-zutar-family (capacity=4 default)
  { id: '901/2/2', apartmentId: 'segal-zutar-family-901-apt-2', buildingId: 'segal-zutar-family-901', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },
  { id: '901/4/2', apartmentId: 'segal-zutar-family-901-apt-4', buildingId: 'segal-zutar-family-901', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },

  { id: '902/1/1', apartmentId: 'segal-zutar-family-902-apt-1', buildingId: 'segal-zutar-family-902', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },
  { id: '903/2/1', apartmentId: 'segal-zutar-family-903-apt-2', buildingId: 'segal-zutar-family-903', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },
  { id: '904/1/1', apartmentId: 'segal-zutar-family-904-apt-1', buildingId: 'segal-zutar-family-904', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },
  { id: '905/1/1', apartmentId: 'segal-zutar-family-905-apt-1', buildingId: 'segal-zutar-family-905', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },
  { id: '906/1/1', apartmentId: 'segal-zutar-family-906-apt-1', buildingId: 'segal-zutar-family-906', regionId: 'segal-zutar-family', name: 'יחידת משפחה', capacity: 4, currentOccupancy: 0, students: [] },
];

// Build Segal apartments automatically from segalZutarRooms
const buildApartmentsFromRooms = (roomsList) => {
  const map = new Map();

  roomsList.forEach((r) => {
    const key = r.apartmentId;
    if (!map.has(key)) {
      const aptPart = key.split('-apt-')[1];
      const aptNum = aptPart ? parseInt(aptPart, 10) : null;

      map.set(key, {
        id: key,
        buildingId: r.buildingId,
        regionId: r.regionId,
        number: aptNum,
        floor: null,
        roomCount: 0,
        isReserved: false,
        reservedReason: null
      });
    }
    map.get(key).roomCount += 1;
  });

  return Array.from(map.values());
};

// ============================================
// FINAL apartments + rooms exports
// ============================================
const generated = generateApartmentsAndRooms();
const segalApartments = buildApartmentsFromRooms(segalZutarRooms);

export const apartments = [
  ...generated.apartments.filter((a) => !SEGAL_OVERRIDE_REGION_IDS.has(a.regionId)),
  ...segalApartments
];

export const rooms = [
  ...generated.rooms.filter((r) => !SEGAL_OVERRIDE_REGION_IDS.has(r.regionId)),
  ...segalZutarRooms
];

// ============================================
// STUDENT GENERATOR
// regionId = dormId (kept to avoid refactor now)
// ============================================
const maleFirstNames = ['יוסף', 'דוד', 'משה', 'אברהם', 'יעקב', 'שמעון', 'אלי', 'עומר', 'נועם', 'איתי'];
const femaleFirstNames = ['שרה', 'רחל', 'מירי', 'נועה', 'תמר', 'יעל', 'דנה', 'מאיה', 'שירה', 'ליאור'];
const lastNames = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'חדד', 'גולן'];

export const generateStudents = (count = 200) => {
  const list = [];
  const dormIds = dorms.map((d) => d.id);

  for (let i = 0; i < count; i++) {
    const gender = Math.random() < 0.5 ? 'male' : 'female';
    const firstName = gender === 'male'
      ? maleFirstNames[Math.floor(Math.random() * maleFirstNames.length)]
      : femaleFirstNames[Math.floor(Math.random() * femaleFirstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

    let religion;
    const rand = Math.random();
    if (rand < 0.7) religion = 'jewish';
    else if (rand < 0.85) religion = 'muslim';
    else if (rand < 0.95) religion = 'christian';
    else religion = 'druze';

    const regionId = dormIds[Math.floor(Math.random() * dormIds.length)];
    const hasRoommateRequest = Math.random() < 0.3;
    const roommateId = hasRoommateRequest ? `student-${Math.floor(Math.random() * count)}` : null;
    const isPriority = Math.random() < 0.03;

    list.push({
      id: `student-${i}`,
      studentId: `${300000000 + i}`,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@campus.technion.ac.il`,
      phone: `05${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`,
      gender,
      religion,
      regionId,
      roommateRequestId: roommateId,
      isPriority,
      priorityReason: isPriority ? 'בעיות בריאות / נגישות' : null,
      isAssigned: false,
      assignedRoomId: null,
      assignedApartmentId: null,
      assignedBuildingId: null
    });
  }

  return list;
};

export const students = generateStudents(200);

export const transferRequests = [
  // INTERNAL
  {
    id: 'transfer-1',
    studentId: 'student-0',
    fromRoomId: 'canada-1-apt-1-room-A',
    toRoomId: 'canada-1-apt-2-room-B',
    reason: 'בעיית שותף חדר',
    status: 'pending',
    requestedBy: 'user-canada-emp1',
    requestedAt: '2026-01-10T10:30:00',
    reviewedBy: null,
    reviewedAt: null
  },
  {
    id: 'transfer-2',
    studentId: 'student-1',
    fromRoomId: 'canada-2-apt-3-room-A',
    toRoomId: null,
    reason: 'קרוב יותר ללימודים (אילוצים רפואיים)',
    status: 'pending',
    requestedBy: 'user-canada-emp2',
    requestedAt: '2026-01-11T09:15:00',
    reviewedBy: null,
    reviewedAt: null
  },

  // REGION (phase 1: dorm change)
  {
    id: 'transfer-5',
    studentId: 'student-4',
    fromRoomId: 'canada-3-apt-2-room-A',
    toRoomId: null,
    toRegionId: 'mizrach-hadash',
    reason: 'מעבר לאזור נגיש יותר (בקשה רפואית)',
    status: 'pending',
    requestedBy: 'user-canada-emp1',
    requestedAt: '2026-01-12T16:20:00',
    reviewedBy: null,
    reviewedAt: null
  },
  {
    id: 'transfer-6',
    studentId: 'student-5',
    fromRoomId: 'mizrach-hadash-2-apt-1-room-A',
    toRoomId: null,
    toRegionId: 'rifkin1',
    reason: 'סיבות משפחתיות – צורך להיות קרוב',
    status: 'approved',
    requestedBy: 'user-mizrach-emp1',
    requestedAt: '2026-01-05T08:55:00',
    reviewedBy: 'user-central',
    reviewedAt: '2026-01-06T09:10:00'
  },

  // more coverage
  {
    id: 'transfer-8',
    studentId: 'student-7',
    fromRoomId: 'mizrach-hadash-1-apt-3-room-B',
    toRoomId: null,
    reason: 'בקשה לדירה עם פחות שותפים',
    status: 'pending',
    requestedBy: 'user-mizrach-emp2',
    requestedAt: '2026-01-13T12:00:00',
    reviewedBy: null,
    reviewedAt: null
  },
  {
    id: 'transfer-9',
    studentId: 'student-8',
    fromRoomId: 'canada-1-apt-1-room-A',
    toRoomId: 'canada-1-apt-2-room-A',
    reason: 'שיפור נגישות למעלית',
    status: 'approved',
    requestedBy: 'user-canada-emp3',
    requestedAt: '2026-01-02T10:10:00',
    reviewedBy: 'user-canada-boss',
    reviewedAt: '2026-01-02T15:30:00'
  }
];

// ============================================
// STATISTICS (regionId = dormId)
// ============================================
const sumCapacity = (roomsList) => roomsList.reduce((acc, r) => acc + (Number(r.capacity) || 0), 0);

export const getRegionStats = (regionId) => {
  const regionStudents = students.filter((s) => s.regionId === regionId);
  const regionBuildings = buildings.filter((b) => b.regionId === regionId);
  const regionApartments = apartments.filter((a) => a.regionId === regionId);
  const regionRooms = rooms.filter((r) => r.regionId === regionId);

  const assignedStudents = regionStudents.filter((s) => s.isAssigned);
  const priorityStudents = regionStudents.filter((s) => s.isPriority);
  const reservedApartments = regionApartments.filter((a) => a.isReserved);

  const totalCapacity = sumCapacity(regionRooms);
  const occupancyRate = totalCapacity > 0
    ? Math.round((assignedStudents.length / totalCapacity) * 100)
    : 0;

  return {
    totalStudents: regionStudents.length,
    assignedStudents: assignedStudents.length,
    unassignedStudents: regionStudents.length - assignedStudents.length,
    priorityStudents: priorityStudents.length,
    totalBuildings: regionBuildings.length,
    totalApartments: regionApartments.length,
    reservedApartments: reservedApartments.length,
    totalRooms: regionRooms.length,
    totalCapacity,
    occupancyRate
  };
};

export const getAllStats = () => {
  const assignedStudents = students.filter((s) => s.isAssigned);
  const priorityStudents = students.filter((s) => s.isPriority);
  const reservedApartments = apartments.filter((a) => a.isReserved);

  const totalCapacity = sumCapacity(rooms);
  const occupancyRate = totalCapacity > 0
    ? Math.round((assignedStudents.length / totalCapacity) * 100)
    : 0;

  return {
    totalStudents: students.length,
    assignedStudents: assignedStudents.length,
    unassignedStudents: students.length - assignedStudents.length,
    priorityStudents: priorityStudents.length,
    totalRegions: regions.length,
    totalBuildings: buildings.length,
    totalApartments: apartments.length,
    reservedApartments: reservedApartments.length,
    totalRooms: rooms.length,
    totalCapacity,
    occupancyRate,
    pendingTransfers: transferRequests.filter((t) => t.status === 'pending').length
  };
};

// ============================================
// OPTIONAL HELPERS (will be useful for BuildingsPage update)
// ============================================
export const getDormById = (dormId) => dorms.find((d) => d.id === dormId) || null;
export const getOfficeById = (officeId) => dormOffices.find((o) => o.id === officeId) || null;
export const getOfficeByDormId = (dormId) => {
  const d = getDormById(dormId);
  return d ? getOfficeById(d.officeId) : null;
};
export const getDormsForOffice = (officeId) => dorms.filter((d) => d.officeId === officeId);
