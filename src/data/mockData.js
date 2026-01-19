// ============================================
// MOCK DATA FOR DORMIFY SYSTEM (NORMALIZED)
// ============================================

// ============================================
// REGIONS (אזורים)
// ============================================
export const regions = [
  { id: 'canada', name: 'מעונות קנדה', nameEn: 'Canada Dorms' },
  { id: 'canada-family', name: 'מעונות קנדה משפחות', nameEn: 'Canada Family Dorms' },
  { id: 'canada-couples', name: 'מעונות קנדה זוגות', nameEn: 'Canada Couples Dorms' },

  { id: 'mizrach-yashan', name: 'מעונות מזרח ישן', nameEn: 'Mizrach Yashan Dorms' },
  { id: 'mizrach-yashan-couples', name: 'מעונות מזרח ישן זוגות', nameEn: 'Mizrach Yashan Couples Dorms' },

  { id: 'mizrach-hadash', name: 'מעונות מזרח חדש', nameEn: 'Mizrach Hadash Dorms' },
  { id: 'mizrach-hadash-family', name: 'מעונות מזרח חדש משפחות', nameEn: 'Mizrach Hadash Family Dorms' },
  { id: 'mizrach-hadash-couples', name: 'מעונות מזרח חדש זוגות', nameEn: 'Mizrach Hadash Couples Dorms' },

  { id: 'rifkin', name: 'מעונות ריפקין', nameEn: 'Rifkin Dorms' },
  { id: 'senate-renovated', name: 'מעונות סנאט מחודש', nameEn: 'Senate Renovated Complex Dorms' },

  { id: 'kfar-hasmaha', name: 'מעונות כפר השמכה', nameEn: 'Kfar Hasmaha Dorms' },
  { id: 'kfar-hasmaha-couples', name: 'מעונות כפר השמכה זוגות', nameEn: 'Kfar Hasmaha Couples Dorms' },

  { id: 'segal-zutar', name: 'מעונות סגל זוטר', nameEn: 'Segal Zutar Dorms' },
  { id: 'segal-zutar-family', name: 'מעונות סגל זוטר משפחות', nameEn: 'Segal Zutar Family Dorms' },
  { id: 'segal-zutar-couples', name: 'מעונות סגל זוטר זוגות', nameEn: 'Segal Zutar Couples Dorms' },

  { id: 'broshim', name: 'מעונות ברושים', nameEn: 'Broshim Dorms' },
  { id: 'broshim-family', name: 'מעונות ברושים משפחות', nameEn: 'Broshim Family Dorms' },
  { id: 'broshim-couples', name: 'מעונות ברושים זוגות', nameEn: 'Broshim Couples Dorms' },

  { id: 'neve-america', name: 'מעונות נווה אמריקה', nameEn: 'Neve America Dorms' },
  { id: 'neve-america-couples', name: 'מעונות נווה אמריקה זוגות', nameEn: 'Neve America Couples Dorms' },

  { id: 'senate', name: 'מעונות סנאט', nameEn: 'Senate Dorms' },
  { id: 'ha-amim', name: 'מעונות העמים', nameEn: 'HaAmim Dorms' }
];

// ============================================
// USERS (משתמשים)
// ============================================
export const users = [
  { id: 'user-central', email: 'admin@technion.ac.il', password: '123456', name: 'אברהם אדגה', role: 'central_admin', regionId: null },

  { id: 'user-canada-boss', email: 'canada.boss@technion.ac.il', password: '123456', name: 'שרה לוי', role: 'region_boss', regionId: 'canada' },
  { id: 'user-canada-emp1', email: 'canada.emp1@technion.ac.il', password: '123456', name: 'דוד ישראלי', role: 'employee', regionId: 'canada' },

  { id: 'user-mizrach-boss', email: 'mizrach.boss@technion.ac.il', password: '123456', name: 'יוסף חדד', role: 'region_boss', regionId: 'mizrach-hadash' },
  { id: 'user-mizrach-emp1', email: 'mizrach.emp1@technion.ac.il', password: '123456', name: 'מירי גולן', role: 'employee', regionId: 'mizrach-hadash' },

  { id: 'user-segal-boss', email: 'segal.boss@technion.ac.il', password: '123456', name: 'תמר רוזן', role: 'region_boss', regionId: 'segal-zutar' }
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
// ============================================

// We keep your “normal” building structure for most regions,
// but for Segal Zutar we use real codes 901–906 and split by regionId.
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
  // Rifkin
  // --------------------
  { id: 'rifkin-1', regionId: 'rifkin', name: 'בניין 1', floors: 6, apartmentsPerFloor: 4 },
  { id: 'rifkin-2', regionId: 'rifkin', name: 'בניין 2', floors: 6, apartmentsPerFloor: 4 },

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
  // Segal Zutar (REAL)
  // --------------------
  // Couples region includes:
  // - "זוגות"
  // - "רווק/רווקה בדירת זוגות"
  { id: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'בניין 901', floors: null, apartmentsPerFloor: null, code: 901 },
  { id: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'בניין 902', floors: null, apartmentsPerFloor: null, code: 902 },
  { id: 'segal-zutar-couples-903', regionId: 'segal-zutar-couples', name: 'בניין 903', floors: null, apartmentsPerFloor: null, code: 903 },
  { id: 'segal-zutar-couples-904', regionId: 'segal-zutar-couples', name: 'בניין 904', floors: null, apartmentsPerFloor: null, code: 904 },
  { id: 'segal-zutar-couples-905', regionId: 'segal-zutar-couples', name: 'בניין 905', floors: null, apartmentsPerFloor: null, code: 905 },
  { id: 'segal-zutar-couples-906', regionId: 'segal-zutar-couples', name: 'בניין 906', floors: null, apartmentsPerFloor: null, code: 906 },

  // Family region:
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
    requestedBy: 'user-mizrah-emp1',
    requestedAt: '2026-01-08T14:15:00',
    reviewedBy: 'user-mizrah-boss',
    reviewedAt: '2026-01-09T09:00:00',
    rejectionReason: null,
  },
  {
    id: 'sr-3',
    type: 'medical',
    studentId: 'student-12',
    current: { regionId: 'rifkin', buildingId: 'rifkin-1', apartmentId: 'rifkin-1-apt-2', roomId: 'rifkin-1-apt-2-room-A' },
    requested: { regionId: 'rifkin', buildingId: 'rifkin-2', apartmentId: null, roomId: null },
    needs: { floorPreference: null, requiresElevator: false, accessibleRoom: false, nearEntrance: true },
    note: 'קרבה לכניסה + קרבה לתחבורה',
    status: 'rejected',
    requestedBy: 'user-canada-emp2',
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
    // Skip Segal Zutar because we will inject real data
    if (SEGAL_OVERRIDE_REGION_IDS.has(building.regionId)) return;

    // If floors is null (real-code buildings), skip generator
    if (!building.floors || !building.apartmentsPerFloor) return;

    for (let floor = 1; floor <= building.floors; floor++) {
      for (let apt = 1; apt <= building.apartmentsPerFloor; apt++) {
        const aptNumber = (floor - 1) * building.apartmentsPerFloor + apt;
        const apartmentId = `${building.id}-apt-${aptNumber}`;

        apartments.push({
          id: apartmentId,
          buildingId: building.id,
          regionId: building.regionId,
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
            regionId: building.regionId,
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
// SEGAL ZUTAR — REAL ROOMS (id = מזהה חדר)
// apartmentId = "<buildingId>-apt-<דירה>"
// ============================================
//
// NOTE: I included the part you provided + the logic you requested.
// If you paste the rest of your Segal couples list, I’ll extend it 1:1.
// For now, this is a correct working pattern.
//
export const segalZutarRooms = [
  // --------------------
  // segal-zutar-couples (singles in couples apt + couples)
  // --------------------

  // 901 singles in couples apt
  { id: '901/6/1', apartmentId: 'segal-zutar-couples-901-apt-6', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/6/2', apartmentId: 'segal-zutar-couples-901-apt-6', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  { id: '901/8/1', apartmentId: 'segal-zutar-couples-901-apt-8', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/8/2', apartmentId: 'segal-zutar-couples-901-apt-8', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  { id: '901/13/1', apartmentId: 'segal-zutar-couples-901-apt-13', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/13/2', apartmentId: 'segal-zutar-couples-901-apt-13', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  { id: '901/15/1', apartmentId: 'segal-zutar-couples-901-apt-15', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '901/15/2', apartmentId: 'segal-zutar-couples-901-apt-15', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  // 902 singles in couples apt (sample)
  { id: '902/7/1', apartmentId: 'segal-zutar-couples-902-apt-7', buildingId: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'חדר 1', capacity: 1, currentOccupancy: 0, students: [] },
  { id: '902/7/2', apartmentId: 'segal-zutar-couples-902-apt-7', buildingId: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'חדר 2', capacity: 1, currentOccupancy: 0, students: [] },

  // Couples (capacity = 2) (sample)
  { id: '901/1/1', apartmentId: 'segal-zutar-couples-901-apt-1', buildingId: 'segal-zutar-couples-901', regionId: 'segal-zutar-couples', name: 'יחידת זוגות', capacity: 2, currentOccupancy: 0, students: [] },
  { id: '902/2/1', apartmentId: 'segal-zutar-couples-902-apt-2', buildingId: 'segal-zutar-couples-902', regionId: 'segal-zutar-couples', name: 'יחידת זוגות', capacity: 2, currentOccupancy: 0, students: [] },

  // --------------------
  // segal-zutar-family
  // --------------------
  // I set family capacity = 4 default (change to whatever your office defines)
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
      // apartment number is after "-apt-"
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

// Merge: remove any generated segal entries (if any) and inject real ones
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
// ============================================
const maleFirstNames = ['יוסף', 'דוד', 'משה', 'אברהם', 'יעקב', 'שמעון', 'אלי', 'עומר', 'נועם', 'איתי'];
const femaleFirstNames = ['שרה', 'רחל', 'מירי', 'נועה', 'תמר', 'יעל', 'דנה', 'מאיה', 'שירה', 'ליאור'];
const lastNames = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'חדד', 'גולן'];

export const generateStudents = (count = 200) => {
  const students = [];
  const regionIds = regions.map((r) => r.id);

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

    const regionId = regionIds[Math.floor(Math.random() * regionIds.length)];
    const hasRoommateRequest = Math.random() < 0.3;
    const roommateId = hasRoommateRequest ? `student-${Math.floor(Math.random() * count)}` : null;
    const isPriority = Math.random() < 0.03;

    students.push({
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

  return students;
};

export const students = generateStudents(200);

// ============================================
// TRANSFER REQUESTS (Mock Data Extended)
// ============================================
export const transferRequests = [
  // ---------- INTERNAL (same region) ----------
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
    toRoomId: null, // important: internal pending -> worker selects from dropdown
    reason: 'קרוב יותר ללימודים (אילוצים רפואיים)',
    status: 'pending',
    requestedBy: 'user-canada-emp2',
    requestedAt: '2026-01-11T09:15:00',
    reviewedBy: null,
    reviewedAt: null
  },
  {
    id: 'transfer-3',
    studentId: 'student-2',
    fromRoomId: 'mizrach-yashan-5-apt-1-room-C',
    toRoomId: 'mizrach-yashan-6-apt-2-room-A',
    reason: 'רעש מתמשך בשעות הלילה',
    status: 'approved',
    requestedBy: 'user-mizrach-emp1',
    requestedAt: '2026-01-08T14:05:00',
    reviewedBy: 'user-mizrach-admin',
    reviewedAt: '2026-01-09T12:10:00'
  },
  {
    id: 'transfer-4',
    studentId: 'student-3',
    fromRoomId: 'rifkin-1-apt-1-room-B',
    toRoomId: 'rifkin-1-apt-4-room-A',
    reason: 'בקשה לשיפור התאמה חברתית',
    status: 'rejected',
    requestedBy: 'user-rifkin-emp1',
    requestedAt: '2026-01-06T11:40:00',
    reviewedBy: 'user-rifkin-admin',
    reviewedAt: '2026-01-07T10:05:00'
  },

  // ---------- REGION (phase 1: region change) ----------
  // Note: for region transfers, toRegionId exists; toRoomId can be null (phase 2 happens later).
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
    fromRoomId: 'mizrach-hadash-2-apt-1-room-D',
    toRoomId: null,
    toRegionId: 'rifkin',
    reason: 'סיבות משפחתיות – צורך להיות קרוב',
    status: 'approved',
    requestedBy: 'user-mizrachhadash-emp1',
    requestedAt: '2026-01-05T08:55:00',
    reviewedBy: 'user-central-admin',
    reviewedAt: '2026-01-06T09:10:00'
  },
  {
    id: 'transfer-7',
    studentId: 'student-6',
    fromRoomId: 'rifkin-2-apt-2-room-A',
    toRoomId: null,
    toRegionId: 'canada',
    reason: 'בקשה מעבר לאזור “שקט” יותר',
    status: 'rejected',
    requestedBy: 'user-rifkin-emp2',
    requestedAt: '2026-01-03T13:25:00',
    reviewedBy: 'user-central-admin',
    reviewedAt: '2026-01-04T10:45:00'
  },

  // ---------- INTERNAL (more coverage) ----------
  {
    id: 'transfer-8',
    studentId: 'student-7',
    fromRoomId: 'mizrach-hadash-1-apt-3-room-B',
    toRoomId: null, // internal pending
    reason: 'בקשה לדירה עם פחות שותפים',
    status: 'pending',
    requestedBy: 'user-mizrachhadash-emp2',
    requestedAt: '2026-01-13T12:00:00',
    reviewedBy: null,
    reviewedAt: null
  },
  {
    id: 'transfer-9',
    studentId: 'student-8',
    fromRoomId: 'canada-4-apt-1-room-A',
    toRoomId: 'canada-4-apt-2-room-A',
    reason: 'שיפור נגישות למעלית',
    status: 'approved',
    requestedBy: 'user-canada-emp3',
    requestedAt: '2026-01-02T10:10:00',
    reviewedBy: 'user-canada-admin',
    reviewedAt: '2026-01-02T15:30:00'
  },
  {
    id: 'transfer-10',
    studentId: 'student-9',
    fromRoomId: 'mizrach-yashan-3-apt-1-room-A',
    toRoomId: null,
    reason: 'תנאי חדר לא מתאימים',
    status: 'pending',
    requestedBy: 'user-mizrach-emp2',
    requestedAt: '2026-01-14T09:40:00',
    reviewedBy: null,
    reviewedAt: null
  }
];

// ============================================
// STATISTICS
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
