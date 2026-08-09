// ---------------------------------------------------------------------------
// All visible strings for the Analysis dashboard, in the same pattern the
// rest of this codebase already uses (a flat { he, en } object keyed by the
// active `language`, no external i18n library). Kept in its own module
// because the page has grown too large for one inline object.
// ---------------------------------------------------------------------------

export const ANALYSIS_TEXT = {
  he: {
    // Header
    pageTitle: 'ניתוח נתונים',
    pageSubtitle: 'תמונת מצב תפעולית: שיבוץ, תפוסה, קיבולת, ביקוש ובקשות מיוחדות',
    lastUpdated: 'עודכן לאחרונה',
    dataSource: 'מקור נתונים',
    noBatch: 'טרם הועלה קובץ',
    refresh: 'רענון',
    refreshing: 'מרענן...',
    exportAction: 'ייצוא לאקסל',
    exporting: 'מייצא...',
    exportError: 'שגיאה בייצוא הדוח',
    systemWide: 'תצוגה מערכתית - כלל האזורים',

    // Filter bar
    regionFilterLabel: 'אזור',
    allRegions: 'כל האזורים',
    searchLabel: 'חיפוש',
    searchPlaceholder: 'חיפוש בניין או אזור',
    resetFilters: 'איפוס סינון',
    removeFilterAria: 'הסרת סינון',

    // States
    loadingTitle: 'טוען נתוני ניתוח...',
    loadError: 'אירעה שגיאה בטעינת נתוני הניתוח',
    retry: 'נסו שוב',
    noData: 'אין נתונים להצגה',
    noMatch: 'אין תוצאות התואמות את הסינון הנוכחי',
    noMatchSub: 'נסו לשנות או לאפס את הסינון הפעיל.',

    // KPIs
    kpiTotalStudents: 'סה"כ סטודנטים',
    kpiTotalStudentsDef: 'מספר כלל הסטודנטים הרשומים במערכת (או באזור הנבחר).',
    kpiAssigned: 'סטודנטים משובצים',
    kpiAssignedDef: 'סטודנטים עם שיבוץ מיטה פעיל כרגע.',
    kpiWaiting: 'ממתינים לשיבוץ',
    kpiWaitingDef: 'סה"כ סטודנטים פחות סטודנטים משובצים.',
    kpiOccupancy: 'אחוז תפוסה',
    kpiOccupancyDef: 'אחוז תפוסה = מספר המיטות המשובצות חלקי מספר המיטות הפעילות.',
    kpiAvailableBeds: 'מיטות פנויות',
    kpiAvailableBedsDef: 'קיבולת פעילה פחות מיטות משובצות כרגע.',
    kpiPendingRequests: 'בקשות ממתינות',
    kpiPendingRequestsDef: 'מספר בקשות הסטודנט (מעבר חדר, דירה, אזור ועוד) שסטטוסן "ממתין" - כלומר טרם אושרו וטרם נדחו.',
    ofStudentsAllocated: (assigned, total, lang) =>
      `${assigned.toLocaleString(lang)} מתוך ${total.toLocaleString(lang)} סטודנטים שובצו`,
    stillWaitingCtx: (n, lang) => `${n.toLocaleString(lang)} סטודנטים עדיין ממתינים`,
    bedsOccupiedCtx: (occupied, total, lang) => `${occupied.toLocaleString(lang)} מתוך ${total.toLocaleString(lang)} מיטות תפוסות`,
    readyForAssignment: 'זמינות לשיבוץ נוסף',
    pendingReviewCtx: 'ממתינות לבדיקת צוות',

    // Issues panel
    issuesTitle: 'נושאים הדורשים טיפול',
    issuesSubtitle: 'דורג לפי חומרה - כל נושא מבוסס על כלל קבוע ונתונים אמיתיים',
    noIssuesTitle: 'אין נושאים דחופים כרגע',
    noIssuesSub: 'כל המדדים המרכזיים בטווח תקין ואין חריגות משמעותיות בנתונים.',
    severityCritical: 'קריטי',
    severityHigh: 'גבוה',
    severityMedium: 'בינוני',
    severityInfo: 'מידע',

    // Tabs
    tabsAriaLabel: 'ניווט בין תצוגות הניתוח',
    tabOverview: 'סקירה כללית',
    tabOccupancy: 'תפוסה וקיבולת',
    tabAllocation: 'שיבוץ',
    tabRequests: 'בקשות מיוחדות',
    tabGroups: 'קבוצות סטודנטים',

    // Capacity vs demand
    capacityDemandTitle: 'קיבולת מול ביקוש לפי אזור',
    capacityDemandSubtitle: 'באילו אזורים קיים הלחץ הגדול ביותר בין ביקוש לקיבולת?',
    seriesCapacity: 'קיבולת תפעולית',
    seriesAssigned: 'משובצים',
    seriesWaiting: 'ממתינים',
    unitBeds: 'מיטות',
    unitStudents: 'סטודנטים',

    // Occupancy ranking
    occupancyRankingTitle: 'דירוג תפוסת בניינים',
    occupancyRankingSubtitle: 'תצוגת המובילים לפי הקריטריון הנבחר (עד 12 בניינים)',
    viewHighest: 'התפוסה הגבוהה ביותר',
    viewLowest: 'התפוסה הנמוכה ביותר',
    viewMostAvailable: 'הקיבולת הפנויה הגבוהה ביותר',

    // Allocation status by region
    allocationStatusTitle: 'סטטוס שיבוץ לפי אזור',
    allocationStatusSubtitle: 'התפלגות משובצים מול ממתינים בכל אזור (100% מכלל הסטודנטים באזור)',

    // Capacity pressure
    pressureTitle: 'ניתוח לחץ קיבולת',
    pressureSubtitle: 'כל נקודה מייצגת אזור: קיבולת פנויה מול ביקוש ממתין, גודל הנקודה לפי סה"כ מיטות',
    axisAvailableCapacity: 'קיבולת פנויה (מיטות)',
    axisWaitingDemand: 'ביקוש ממתין (סטודנטים)',

    // Special requests
    requestsTitle: 'בקשות מיוחדות',
    requestsSubtitle: 'בקשות סטודנט הממתינות כרגע לאישור או דחייה',
    requestsByTypeTitle: 'בקשות ממתינות לפי סוג',
    requestsByTypeSubtitle: 'רק בקשות בסטטוס "ממתין" (טרם אושרו וטרם נדחו).',
    requestsByRegionTitle: 'בקשות ממתינות לפי אזור',
    requestsByRegionSubtitle: 'רק בקשות בסטטוס "ממתין". האזור המוצג הוא אזור הייחוס הטוב ביותר הידוע: אזור המוצא של הסטודנט, ואם אינו ידוע - האזור של הגורם שהגיש את הבקשה.',
    oldestPendingLabel: 'הבקשה הוותיקה ביותר ממתינה כבר',
    noRequests: 'אין בקשות ממתינות כרגע',
    noRequestsSub: 'כל הבקשות טופלו - אין פריטים הממתינים לסקירה.',
    viewAllRequestsAction: 'לצפייה בכל הבקשות',

    // Student groups (distribution)
    distributionTitle: 'התפלגות סטודנטים',
    distributionSubtitle: 'בחרו מאפיין להצגת ההתפלגות בפועל',
    dimGender: 'מגדר', dimReligion: 'דת', dimReligious: 'דתי/חילוני',
    dimCategory: 'קטגוריה', dimHousing: 'סוג מגורים', dimRegion: 'אזור',
    dimAllocation: 'סטטוס שיבוץ', dimPriority: 'בקשות מיוחדות',
    unknown: 'לא ידוע',
    noSpecialRequest: 'ללא בקשה מיוחדת',
    assigned: 'משובצים',
    waiting: 'ממתינים',

    // Building analytics table
    tableTitle: 'פירוט תפעולי לפי בניין',
    tableSubtitle: 'נתוני תפוסה מלאים - חיפוש, סינון, מיון וייצוא',
    tableSearchPlaceholder: 'חיפוש לפי שם בניין או אזור',
    filterStatusLabel: 'סטטוס',
    filterStatusAll: 'כל הסטטוסים',
    filterRegionAll: 'כל האזורים',
    colBuilding: 'בניין', colRegion: 'אזור', colCapacity: 'קיבולת',
    colAssigned: 'משובץ', colAvailable: 'פנוי', colOccupancy: 'אחוז תפוסה',
    colStatus: 'סטטוס',
    showing: 'מוצגים', of: 'מתוך',
    exportTableAction: 'ייצוא הטבלה',
    pageOf: (p, total) => `עמוד ${p} מתוך ${total}`,
    prevPage: 'הקודם', nextPage: 'הבא',
    sortAria: (col) => `מיון לפי ${col}`,

    // Freshness panel
    freshnessTitle: 'מקורות נתונים אחרונים',
    latestUpload: 'העלאה אחרונה',
    latestRun: 'הרצת שיבוץ אחרונה',
    recentRunsTitle: 'הרצות שיבוץ אחרונות',
    students: 'סטודנטים',
    assignments: 'שיבוצים',

    // Allocation run status labels (raw codes -> Hebrew)
    runStatus: {
      queued: 'בתור', running: 'רץ', cancellation_requested: 'מבוקשת עצירה',
      stopped: 'עצר', completed: 'הושלם', failed: 'נכשל', deleted: 'נמחק', approved: 'אושר',
    },

    // Request type labels (raw codes -> Hebrew)
    requestType: {
      add_student: 'הוספת סטודנט', remove_student: 'הסרת סטודנט', room: 'שינוי חדר',
      apartment: 'מעבר דירה', swap: 'חילוף בין סטודנטים', region_transfer: 'מעבר בין אזורים', other: 'בקשה אחרת',
    },
  },

  en: {
    pageTitle: 'Data Analysis',
    pageSubtitle: 'Operational overview of allocation, occupancy, capacity, demand, and special requests',
    lastUpdated: 'Last updated',
    dataSource: 'Data source',
    noBatch: 'No file uploaded yet',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    exportAction: 'Export to Excel',
    exporting: 'Exporting…',
    exportError: 'Failed to export the report',
    systemWide: 'System-wide — all regions',

    regionFilterLabel: 'Region',
    allRegions: 'All Regions',
    searchLabel: 'Search',
    searchPlaceholder: 'Search building or region',
    resetFilters: 'Reset filters',
    removeFilterAria: 'Remove filter',

    loadingTitle: 'Loading analytics…',
    loadError: 'Something went wrong while loading analytics data',
    retry: 'Retry',
    noData: 'No data to display',
    noMatch: 'No results match the current filters',
    noMatchSub: 'Try changing or resetting the active filters.',

    kpiTotalStudents: 'Total Students',
    kpiTotalStudentsDef: 'All students currently registered in the system (or in the selected region).',
    kpiAssigned: 'Assigned Students',
    kpiAssignedDef: 'Students with a currently active bed assignment.',
    kpiWaiting: 'Pending Assignment',
    kpiWaitingDef: 'Total students minus assigned students.',
    kpiOccupancy: 'Occupancy Rate',
    kpiOccupancyDef: 'Occupancy rate = allocated beds divided by operational beds.',
    kpiAvailableBeds: 'Available Beds',
    kpiAvailableBedsDef: 'Operational capacity minus beds currently assigned.',
    kpiPendingRequests: 'Pending Requests',
    kpiPendingRequestsDef: 'The number of student requests (room, apartment, region transfer, etc.) with PENDING status - not yet approved and not yet rejected.',
    ofStudentsAllocated: (assigned, total, lang) =>
      `${assigned.toLocaleString(lang)} of ${total.toLocaleString(lang)} students allocated`,
    stillWaitingCtx: (n, lang) => `${n.toLocaleString(lang)} students are still waiting`,
    bedsOccupiedCtx: (occupied, total, lang) => `${occupied.toLocaleString(lang)} of ${total.toLocaleString(lang)} beds occupied`,
    readyForAssignment: 'ready for assignment',
    pendingReviewCtx: 'awaiting office review',

    issuesTitle: 'Issues Requiring Attention',
    issuesSubtitle: 'Ranked by severity — every issue is based on a fixed rule and real data',
    noIssuesTitle: 'No urgent issues right now',
    noIssuesSub: 'All key metrics are within a healthy range — no meaningful anomalies in the data.',
    severityCritical: 'Critical',
    severityHigh: 'High',
    severityMedium: 'Medium',
    severityInfo: 'Informational',

    tabsAriaLabel: 'Analysis view navigation',
    tabOverview: 'Overview',
    tabOccupancy: 'Occupancy & Capacity',
    tabAllocation: 'Allocation',
    tabRequests: 'Special Requests',
    tabGroups: 'Student Groups',

    capacityDemandTitle: 'Capacity vs. Demand by Region',
    capacityDemandSubtitle: 'Which regions have the greatest pressure between demand and capacity?',
    seriesCapacity: 'Operational capacity',
    seriesAssigned: 'Assigned',
    seriesWaiting: 'Waiting',
    unitBeds: 'beds',
    unitStudents: 'students',

    occupancyRankingTitle: 'Building Occupancy Ranking',
    occupancyRankingSubtitle: 'Top results for the selected view (up to 12 buildings)',
    viewHighest: 'Highest occupancy',
    viewLowest: 'Lowest occupancy',
    viewMostAvailable: 'Most available capacity',

    allocationStatusTitle: 'Allocation Status by Region',
    allocationStatusSubtitle: 'Assigned vs. waiting students in each region (100% of that region’s students)',

    pressureTitle: 'Capacity Pressure Analysis',
    pressureSubtitle: 'Each point is a region: available capacity vs. waiting demand, sized by total beds',
    axisAvailableCapacity: 'Available capacity (beds)',
    axisWaitingDemand: 'Waiting demand (students)',

    requestsTitle: 'Special Requests',
    requestsSubtitle: 'Student requests currently awaiting approval or rejection',
    requestsByTypeTitle: 'Pending Requests by Type',
    requestsByTypeSubtitle: 'PENDING requests only (not yet approved or rejected).',
    requestsByRegionTitle: 'Pending Requests by Region',
    requestsByRegionSubtitle: 'PENDING requests only. Region shown is the best available attributed region: the student’s origin region, falling back to the filing office’s region when the origin is unknown.',
    oldestPendingLabel: 'Oldest pending request has been waiting',
    noRequests: 'No pending requests right now',
    noRequestsSub: 'All requests have been handled — nothing is awaiting review.',
    viewAllRequestsAction: 'View all requests',

    distributionTitle: 'Student Distribution',
    distributionSubtitle: 'Choose an attribute to see its real distribution',
    dimGender: 'Gender', dimReligion: 'Religion', dimReligious: 'Religious Preference',
    dimCategory: 'Category', dimHousing: 'Housing Type', dimRegion: 'Region',
    dimAllocation: 'Allocation Status', dimPriority: 'Special Requests',
    unknown: 'Unknown',
    noSpecialRequest: 'No special request',
    assigned: 'Assigned',
    waiting: 'Waiting',

    tableTitle: 'Building Operational Detail',
    tableSubtitle: 'Full occupancy detail — search, filter, sort, and export',
    tableSearchPlaceholder: 'Search by building name or region',
    filterStatusLabel: 'Status',
    filterStatusAll: 'All statuses',
    filterRegionAll: 'All regions',
    colBuilding: 'Building', colRegion: 'Region', colCapacity: 'Capacity',
    colAssigned: 'Assigned', colAvailable: 'Available', colOccupancy: 'Occupancy',
    colStatus: 'Status',
    showing: 'Showing', of: 'of',
    exportTableAction: 'Export table',
    pageOf: (p, total) => `Page ${p} of ${total}`,
    prevPage: 'Previous', nextPage: 'Next',
    sortAria: (col) => `Sort by ${col}`,

    freshnessTitle: 'Recent Data Sources',
    latestUpload: 'Latest upload',
    latestRun: 'Latest allocation run',
    recentRunsTitle: 'Recent allocation runs',
    students: 'students',
    assignments: 'assignments',

    runStatus: {
      queued: 'Queued', running: 'Running', cancellation_requested: 'Stop requested',
      stopped: 'Stopped', completed: 'Completed', failed: 'Failed', deleted: 'Deleted', approved: 'Approved',
    },

    requestType: {
      add_student: 'Add student', remove_student: 'Remove student', room: 'Room change',
      apartment: 'Apartment change', swap: 'Student swap', region_transfer: 'Region transfer', other: 'Other request',
    },
  },
};

export function getAnalysisText(language) {
  return ANALYSIS_TEXT[language] || ANALYSIS_TEXT.en;
}
