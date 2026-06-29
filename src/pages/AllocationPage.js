import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { allocationAPI, inboxAPI } from '../services/api';
import {
  Play,
  Settings,
  Check,
  AlertTriangle,
  Users,
  Home,
  RefreshCw,
  Lock,
  Bell,
  Mail,
  Calendar,
  Loader,
  XCircle,
  BarChart3,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react';

function AllocationPage({ language = 'he' }) {
  const navigate = useNavigate();
  const { isCentralAdmin, getUserRegion, canRunAllocation } = useAuth();

  const central = typeof isCentralAdmin === 'function' ? isCentralAdmin() === true : false;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [summary, setSummary] = useState(null);
  const [inboxItem, setInboxItem] = useState(null);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const [runId, setRunId] = useState(null);
  const [runStatus, setRunStatus] = useState(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [toast, setToast] = useState(null);

  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  const [constraints, setConstraints] = useState({
    sameGender: { enabled: true, strict: true, critical: true, weight: 0 },
    sameReligion: { enabled: true, strict: false, critical: false, weight: 6 },
    roommateMatch: { enabled: true, strict: false, critical: false, weight: 8 },
    priorityFirst: { enabled: true, strict: true, critical: true, weight: 0 },
    roommatePositiveOnly: { enabled: true, strict: true, critical: true, weight: 0 },
    ReligiousTogether: { enabled: true, strict: true, critical: true, weight: 0 },
    sectorMatching: { enabled: true, strict: false, critical: false, weight: 7 },
    avoidYearMix_1_with_3_4: { enabled: true, strict: false, critical: false, weight: 4 },
    avoidAtudaimWithHasmaha: { enabled: true, strict: false, critical: false, weight: 4 },
  });

  const t = useMemo(
    () =>
      ({
        he: {
          title: 'שיבוץ סטודנטים',
          subtitle: 'הפעלת אלגוריתם השיבוץ החכם',
          runAllocation: 'הפעל שיבוץ',
          running: 'מריץ שיבוץ...',
          constraints: 'כללי והעדפות השיבוץ',
          constraintsIntro: '',
          hardConstraints: 'אילוצים קשיחים',
          hardConstraintsHint: 'כללים קבועים של האלגוריתם. הם מופעלים תמיד, אינם ניתנים לשינוי ואינם מקבלים משקל.',
          hardConstraint: 'אילוץ קשיח',
          alwaysApplied: 'מופעל תמיד',
          noWeight: 'ללא משקל',
          optimizationPreferences: 'העדפות לאופטימיזציה',
          preferencesHint: 'אפשר לבחור אילו העדפות יילקחו בחשבון ולקבוע את רמת החשיבות שלהן.',
          importance: 'רמת חשיבות',
          included: 'נכלל בשיבוץ',
          excluded: 'לא נכלל בשיבוץ',
          studentsToAssign: 'סטודנטים לשיבוץ',
          availableBeds: 'מיטות פנויות',
          results: 'תוצאות השיבוץ',
          assigned: 'שובצו בהצלחה',
          roommateMatches: 'התאמות שותפים',
          conflicts: 'התנגשויות',
          viewResults: 'צפה בתוצאות',
          noStudents: 'אין סטודנטים לשיבוץ',
          loading: 'טוען נתונים...',
          error: 'שגיאה בטעינת הנתונים',
          retry: 'נסה שוב',
          notification: 'הודעה מלשכת המעונות המרכזית',
          receivedStudents: 'התקבלו סטודנטים לשיבוץ',
          batchId: 'מספר קובץ',
          receivedAt: 'התקבל בתאריך',
          studentsBreakdown: 'פירוט סטודנטים לפי סטטוס',
          housingDemand: 'סטודנטים לשיבוץ לפי סוג דיור',
          inventoryBreakdown: 'מלאי דיור פנוי לפי סוג',
          singleHousing: 'דירות רווקים/ות',
          coupleHousing: 'דירות זוגות',
          familyHousing: 'דירות משפחה',
          singleMaleStudents: 'רווקים',
          singleFemaleStudents: 'רווקות',
          singleMixedStudents: 'רווקים/ות בדירת זוגות',
          coupleStudents: 'זוגות',
          familyStudents: 'משפחות',
          unknownHousing: 'סוג דיור לא ידוע',
          apartmentsLabel: 'דירות',
          roomsLabel: 'חדרים/יחידות',
          freeBedsLabel: 'מיטות פנויות',
          totalBedsLabel: 'סה״כ מיטות',
          newStudents: 'חדשים',
          continuing: 'ממשיכים',
          transfers: 'מעברים',
          leaving: 'עוזבים',
          priorityStudents: 'סטודנטים בעדיפות',
          sameGender: 'אותו מגדר בדירה',
          sameReligion: 'אותה דת בדירה',
          roommateMatch: 'התאמת שותפים מבוקשים',
          priorityFirst: 'סטודנטים בעדיפות קודם',
          roommatePositiveOnly: '100% תשובות חיוביות למבקשים להיות יחד',
          ReligiousTogether: '100% התאמות חיוביות דירת דתיים/ות',
          sectorMatching: 'התאמה לפי שייכות',
          avoidYearMix_1_with_3_4: 'לא לשבץ שנה א׳ עם שנה ג׳/ד׳',
          avoidAtudaimWithHasmaha: 'לא לשבץ הסמכה עם עתודאים',
          noRegion: 'לא נמצא אזור למשתמש.',
          malformedSummary: 'התקבלו נתוני שיבוץ לא תקינים.',
          noPermission: 'אין הרשאה להריץ שיבוץ בחשבון זה.',
          pending: 'ממתין לטיפול',
          viewed: 'נצפה',
          unknownError: 'שגיאה לא ידועה',
          noResultsYet: 'עדיין אין תוצאות זמינות. הריצי שיבוץ כדי להפיק תוצאות.',
          resultsHint: 'כפתור התוצאות יופעל לאחר הרצת שיבוץ מוצלחת.',
          currentStatus: 'סטטוס נוכחי',
          stopAllocation: 'עצור שיבוץ',
          stoppingStopping: 'עוצר ומנקה...',
          stopConfirmTitle: 'עצור שיבוץ',
          stopConfirmMsg: 'האם אתה בטוח שברצונך לעצור את השיבוץ הפעיל? כל ההקצאות החלקיות יימחקו.',
          stopSuccess: 'השיבוץ עוצר. ניקוי נתונים בתהליך...',
          stopError: 'שגיאה בעצירת השיבוץ',
          deleteResults: 'מחק תוצאות',
          deletingResults: 'מוחק תוצאות...',
          deleteConfirmTitle: 'מחיקת תוצאות שיבוץ',
          deleteConfirmMsg: 'האם אתה בטוח שברצונך למחוק את תוצאות השיבוץ הנוכחיות? פעולה זו תבטל את כל ההקצאות שנוצרו בהרצה זו.',
          deleteSuccess: 'תוצאות השיבוץ נמחקו בהצלחה',
          deleteError: 'שגיאה במחיקת תוצאות השיבוץ',
          approvedCannotDelete: 'לא ניתן למחוק הקצאה שאושרה סופית',
          missingRunId: 'לא נמצא מזהה הרצה פעילה',
          cancel: 'ביטול',
          confirm: 'אישור',
          stoppedStatus: 'השיבוץ עוצר',
        },
        en: {
          title: 'Student Allocation',
          subtitle: 'Run the smart allocation algorithm',
          runAllocation: 'Run Allocation',
          running: 'Running allocation...',
          constraints: 'Allocation Rules and Preferences',
          constraintsIntro: 'Review the fixed rules and configure the optimization preferences before running the allocation.',
          hardConstraints: 'Hard Constraints',
          hardConstraintsHint: 'Fixed algorithm rules. They are always applied, cannot be changed, and do not receive a weight.',
          hardConstraint: 'Hard constraint',
          alwaysApplied: 'Always applied',
          noWeight: 'No weight',
          optimizationPreferences: 'Optimization Preferences',
          preferencesHint: 'Choose which preferences should be considered and set their importance level.',
          importance: 'Importance level',
          included: 'Included in allocation',
          excluded: 'Not included in allocation',
          studentsToAssign: 'Students to assign',
          availableBeds: 'Available beds',
          results: 'Allocation Results',
          assigned: 'Successfully assigned',
          roommateMatches: 'Roommate matches',
          conflicts: 'Conflicts',
          viewResults: 'View Results',
          noStudents: 'No students to assign',
          loading: 'Loading data...',
          error: 'Error loading data',
          retry: 'Try again',
          notification: 'Notification from Central Housing Office',
          receivedStudents: 'Students received for allocation',
          batchId: 'Batch ID',
          receivedAt: 'Received on',
          studentsBreakdown: 'Students by status',
          housingDemand: 'Students to allocate by housing type',
          inventoryBreakdown: 'Available inventory by housing type',
          singleHousing: 'Single housing',
          coupleHousing: 'Couple housing',
          familyHousing: 'Family housing',
          singleMaleStudents: 'Single men',
          singleFemaleStudents: 'Single women',
          singleMixedStudents: 'Singles in couple apartments',
          coupleStudents: 'Couples',
          familyStudents: 'Families',
          unknownHousing: 'Unknown housing type',
          apartmentsLabel: 'Apartments',
          roomsLabel: 'Rooms/units',
          freeBedsLabel: 'Available beds',
          totalBedsLabel: 'Total beds',
          newStudents: 'New',
          continuing: 'Continuing',
          transfers: 'Transfers',
          leaving: 'Leaving',
          priorityStudents: 'Priority students',
          sameGender: 'Same gender in apartment',
          sameReligion: 'Same religion in apartment',
          roommateMatch: 'Match roommate requests',
          priorityFirst: 'Priority students first',
          roommatePositiveOnly: '100% positive roommate matches',
          ReligiousTogether: '100% positive religious apartment matches',
          sectorMatching: 'Sector matching',
          avoidYearMix_1_with_3_4: 'Avoid mixing 1st year with 3rd/4th',
          avoidAtudaimWithHasmaha: 'Avoid mixing graduate with atudaim',
          noRegion: 'User region was not found.',
          malformedSummary: 'Malformed allocation summary response.',
          noPermission: 'You do not have permission to run allocation on this account.',
          pending: 'Pending',
          viewed: 'Viewed',
          unknownError: 'Unknown error',
          noResultsYet: 'No results are available yet. Run allocation to generate results.',
          resultsHint: 'The results button will be enabled after a successful run.',
          currentStatus: 'Current status',
          stopAllocation: 'Stop Allocation',
          stoppingStopping: 'Stopping and cleaning...',
          stopConfirmTitle: 'Stop Allocation',
          stopConfirmMsg: 'Are you sure you want to stop the active allocation? All partial assignments will be deleted.',
          stopSuccess: 'Allocation stopping. Cleanup in progress...',
          stopError: 'Failed to stop allocation',
          deleteResults: 'Delete Results',
          deletingResults: 'Deleting Results...',
          deleteConfirmTitle: 'Delete Allocation Results',
          deleteConfirmMsg: 'Are you sure you want to delete the current allocation results? This will cancel all assignments created in this run.',
          deleteSuccess: 'Allocation results deleted successfully',
          deleteError: 'Failed to delete allocation results',
          approvedCannotDelete: 'Approved allocations cannot be deleted',
          missingRunId: 'No active run identifier found',
          cancel: 'Cancel',
          confirm: 'Confirm',
          stoppedStatus: 'Allocation stopped',
        },
      }[language] || {
        title: 'Student Allocation',
        subtitle: 'Run the smart allocation algorithm',
        runAllocation: 'Run Allocation',
        running: 'Running allocation...',
        constraints: 'Allocation Rules and Preferences',
        constraintsIntro: 'Review the fixed rules and configure the optimization preferences before running the allocation.',
        hardConstraints: 'Hard Constraints',
        hardConstraintsHint: 'Fixed algorithm rules. They are always applied, cannot be changed, and do not receive a weight.',
        hardConstraint: 'Hard constraint',
        alwaysApplied: 'Always applied',
        noWeight: 'No weight',
        optimizationPreferences: 'Optimization Preferences',
        preferencesHint: 'Choose which preferences should be considered and set their importance level.',
        importance: 'Importance level',
        included: 'Included in allocation',
        excluded: 'Not included in allocation',
        studentsToAssign: 'Students to assign',
        availableBeds: 'Available beds',
        results: 'Allocation Results',
        assigned: 'Successfully assigned',
        roommateMatches: 'Roommate matches',
        conflicts: 'Conflicts',
        viewResults: 'View Results',
        noStudents: 'No students to assign',
        loading: 'Loading data...',
        error: 'Error loading data',
        retry: 'Try again',
        notification: 'Notification from Central Housing Office',
        receivedStudents: 'Students received for allocation',
        batchId: 'Batch ID',
        receivedAt: 'Received on',
        studentsBreakdown: 'Students by status',
        housingDemand: 'Students to allocate by housing type',
        inventoryBreakdown: 'Available inventory by housing type',
        singleHousing: 'Single housing',
        coupleHousing: 'Couple housing',
        familyHousing: 'Family housing',
        singleMaleStudents: 'Single men',
        singleFemaleStudents: 'Single women',
        singleMixedStudents: 'Singles in couple apartments',
        coupleStudents: 'Couples',
        familyStudents: 'Families',
        unknownHousing: 'Unknown housing type',
        apartmentsLabel: 'Apartments',
        roomsLabel: 'Rooms/units',
        freeBedsLabel: 'Available beds',
        totalBedsLabel: 'Total beds',
        newStudents: 'New',
        continuing: 'Continuing',
        transfers: 'Transfers',
        leaving: 'Leaving',
        priorityStudents: 'Priority students',
        sameGender: 'Same gender in apartment',
        sameReligion: 'Same religion in apartment',
        roommateMatch: 'Match roommate requests',
        priorityFirst: 'Priority students first',
        roommatePositiveOnly: '100% positive roommate matches',
        ReligiousTogether: '100% positive religious apartment matches',
        sectorMatching: 'Sector matching',
        avoidYearMix_1_with_3_4: 'Avoid mixing 1st year with 3rd/4th',
        avoidAtudaimWithHasmaha: 'Avoid mixing graduate with atudaim',
        noRegion: 'User region was not found.',
        malformedSummary: 'Malformed allocation summary response.',
        noPermission: 'You do not have permission to run allocation on this account.',
        pending: 'Pending',
        viewed: 'Viewed',
        unknownError: 'Unknown error',
        noResultsYet: 'No results are available yet. Run allocation to generate results.',
        resultsHint: 'The results button will be enabled after a successful run.',
        currentStatus: 'Current status',
        stopAllocation: 'Stop Allocation',
        stoppingStopping: 'Stopping and cleaning...',
        stopConfirmTitle: 'Stop Allocation',
        stopConfirmMsg: 'Are you sure you want to stop the active allocation? All partial assignments will be deleted.',
        stopSuccess: 'Allocation stopping. Cleanup in progress...',
        stopError: 'Failed to stop allocation',
        deleteResults: 'Delete Results',
        deletingResults: 'Deleting Results...',
        deleteConfirmTitle: 'Delete Allocation Results',
        deleteConfirmMsg: 'Are you sure you want to delete the current allocation results? This will cancel all assignments created in this run.',
        deleteSuccess: 'Allocation results deleted successfully',
        deleteError: 'Failed to delete allocation results',
        approvedCannotDelete: 'Approved allocations cannot be deleted',
        missingRunId: 'No active run identifier found',
        cancel: 'Cancel',
        confirm: 'Confirm',
        stoppedStatus: 'Allocation stopped',
      }),
    [language]
  );

  const unwrapResponse = useCallback((res) => {
    if (res && typeof res === 'object' && 'data' in res) return res.data;
    return res;
  }, []);

  const getErrorMessage = useCallback(
    (err) => {
      if (!err) return t.unknownError;
      if (typeof err === 'string') return err;

      const data = err?.response?.data;
      if (typeof data === 'string') return data;
      if (data?.error) return data.error;
      if (data?.message) return data.message;
      if (err?.message) return err.message;

      return t.unknownError;
    },
    [t.unknownError]
  );

  const normalizeInboxStatus = useCallback((statusValue) => {
    const s = String(statusValue || '').trim().toLowerCase();
    if (s === 'pending') return 'pending';
    if (s === 'viewed') return 'viewed';
    if (s === 'processed') return 'processed';
    return s;
  }, []);

  const safeSummary = useCallback(
    (raw) => {
      const data = unwrapResponse(raw);

      if (!data || typeof data !== 'object') {
        throw new Error(t.malformedSummary);
      }

      return {
        total_students: Number(data.total_students) || 0,
        unassigned_students: Number(data.unassigned_students) || 0,
        assigned_students: Number(data.assigned_students) || 0,
        available_beds: Number(data.available_beds) || 0,
        priority_students: Number(data.priority_students) || 0,
        total_capacity: Number(data.total_capacity) || 0,
        occupancy_rate: Number(data.occupancy_rate) || 0,
        latest_inbox: data.latest_inbox && typeof data.latest_inbox === 'object' ? data.latest_inbox : null,
        students_by_category:
          data.students_by_category && typeof data.students_by_category === 'object'
            ? {
                new: Number(data.students_by_category.new) || 0,
                continuing: Number(data.students_by_category.continuing) || 0,
                transfer: Number(data.students_by_category.transfer) || 0,
                leaving: Number(data.students_by_category.leaving) || 0,
              }
            : null,
        students_by_housing_type:
          data.students_by_housing_type && typeof data.students_by_housing_type === 'object'
            ? {
                single_male: Number(data.students_by_housing_type.single_male) || 0,
                single_female: Number(data.students_by_housing_type.single_female) || 0,
                single_mixed: Number(data.students_by_housing_type.single_mixed) || 0,
                couple: Number(data.students_by_housing_type.couple) || 0,
                family: Number(data.students_by_housing_type.family) || 0,
                unknown: Number(data.students_by_housing_type.unknown) || 0,
              }
            : null,
        inventory_by_type:
          data.inventory_by_type && typeof data.inventory_by_type === 'object'
            ? Object.fromEntries(
                ['single', 'couple', 'family'].map((key) => {
                  const item = data.inventory_by_type[key] || {};
                  return [
                    key,
                    {
                      apartments: Number(item.apartments) || 0,
                      rooms: Number(item.rooms) || 0,
                      total_beds: Number(item.total_beds) || 0,
                      occupied_beds: Number(item.occupied_beds) || 0,
                      available_beds: Number(item.available_beds) || 0,
                    },
                  ];
                })
              )
            : null,
        region: data.region && typeof data.region === 'object' ? data.region : null,
        ...data,
      };
    },
    [t.malformedSummary, unwrapResponse]
  );

  const safeInbox = useCallback(
    (raw) => {
      const data = unwrapResponse(raw);

      if (!data || typeof data !== 'object') return null;
      if (!data.inbox || typeof data.inbox !== 'object') return null;

      return {
        ...data.inbox,
        status: normalizeInboxStatus(data.inbox.status),
      };
    },
    [normalizeInboxStatus, unwrapResponse]
  );

  const resolveRegionId = useCallback(() => {
    const regionValue = typeof getUserRegion === 'function' ? getUserRegion() : null;

    if (!regionValue) {
      return summary?.region?.id || summary?.region?.name || null;
    }

    if (typeof regionValue === 'string' || typeof regionValue === 'number') {
      return regionValue;
    }

    if (typeof regionValue === 'object') {
      return regionValue.id || regionValue.name || regionValue.region || null;
    }

    return summary?.region?.id || summary?.region?.name || null;
  }, [getUserRegion, summary]);

  const toggleConstraintEnabled = (key) => {
    setConstraints((prev) => {
      const current = prev[key];
      if (!current || current.critical) return prev;
      return { ...prev, [key]: { ...current, enabled: !current.enabled } };
    });
  };

  const setConstraintWeight = (key, nextWeight) => {
    const parsed = Number(nextWeight);
    const w = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;

    setConstraints((prev) => {
      const current = prev[key];
      if (!current || current.critical) return prev;
      return { ...prev, [key]: { ...current, weight: w } };
    });
  };

  const hardConstraints = useMemo(
    () => Object.entries(constraints).filter(([, value]) => value.critical),
    [constraints]
  );

  const optimizationPreferences = useMemo(
    () => Object.entries(constraints).filter(([, value]) => !value.critical),
    [constraints]
  );

  const effectiveConfig = useMemo(() => {
    const out = {};
    Object.entries(constraints).forEach(([k, v]) => {
      const isHardConstraint = !!v.critical;

      out[k] = {
        // Hard constraints are always active and never participate in weighting.
        enabled: isHardConstraint ? true : !!v.enabled,
        strict: !!v.strict,
        critical: isHardConstraint,
        weight: isHardConstraint ? 0 : Number(v.weight) || 0,
      };
    });
    return out;
  }, [constraints]);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 4000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    let normalizedSummary = null;

    try {
      const summaryRaw = await allocationAPI.getSummary();
      normalizedSummary = safeSummary(summaryRaw);
      setSummary(normalizedSummary);

      if (!central) {
        try {
          const inboxRaw = await inboxAPI.getLatest();
          const inbox = safeInbox(inboxRaw);

          if (inbox) {
            setInboxItem(inbox);

            if (inbox.status === 'pending' && inbox.id) {
              Promise.resolve(inboxAPI.markViewed(inbox.id)).catch((err) => {
                console.warn('markViewed failed:', err);
              });
            }
          } else {
            setInboxItem(null);
          }
        } catch (inboxErr) {
          console.warn('inbox getLatest failed:', inboxErr);
          setInboxItem(null);
        }
      } else {
        setInboxItem(null);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }

    return normalizedSummary;
  }, [central, getErrorMessage, safeInbox, safeSummary]);

  const startPolling = useCallback((id) => {
    stopPolling();

    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        stopPolling();
        return;
      }

      try {
        const data = await allocationAPI.getRunStatus(id);
        const runData = data?.run;
        const st = runData?.status;

        if (!mountedRef.current) return;
        setRunStatus(st);

        if (st === 'completed') {
          stopPolling();
          setIsRunning(false);
          setIsStopping(false);
          setProgress(100);
          setResult({
            successful_assignments: data.successful_assignments ?? runData?.successful_assignments ?? 0,
            roommate_matches: data.roommate_matches ?? runData?.roommate_matches ?? 0,
            conflicts: data.conflicts ?? runData?.conflicts ?? 0,
            assignments: data.assignments ?? [],
            run: runData,
          });
          loadPage().catch(() => {});
        } else if (st === 'stopped' || st === 'failed' || st === 'deleted') {
          stopPolling();
          setIsRunning(false);
          setIsStopping(false);
          setProgress(0);
          setResult(null);
          setRunId(null);
          setRunStatus(null);
          loadPage().catch(() => {});

          if (st === 'stopped') {
            showToast(t.stoppedStatus, 'info');
          } else if (st === 'failed') {
            showToast(runData?.error_message || t.unknownError, 'error');
          }
        } else if (st === 'cancellation_requested') {
          setIsStopping(true);
          setProgress((prev) => Math.min(prev + 2, 95));
        } else if (st === 'running' || st === 'queued') {
          setProgress((prev) => Math.min(prev + 3, 92));
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, 3000);
  }, [stopPolling, loadPage, showToast, t.stoppedStatus, t.unknownError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const recoverActiveRun = useCallback(async (regionId) => {
    try {
      const data = await allocationAPI.getActiveRun(regionId || undefined);
      const run = data?.run;

      if (!run || !mountedRef.current) return;

      setRunId(run.id);
      setRunStatus(run.status);

      if (['queued', 'running', 'cancellation_requested'].includes(run.status)) {
        setIsRunning(true);
        if (run.status === 'cancellation_requested') setIsStopping(true);
        startPolling(run.id);
      } else if (run.status === 'completed') {
        try {
          const detail = await allocationAPI.getRunStatus(run.id);
          if (mountedRef.current && detail?.run?.status === 'completed') {
            setResult({
              successful_assignments: detail.successful_assignments ?? detail.run?.successful_assignments ?? 0,
              roommate_matches: detail.roommate_matches ?? detail.run?.roommate_matches ?? 0,
              conflicts: detail.conflicts ?? detail.run?.conflicts ?? 0,
              assignments: detail.assignments ?? [],
              run: detail.run,
            });
          }
        } catch (e) {
          console.warn('Failed to load completed run detail:', e);
        }
      }
    } catch (err) {
      console.warn('Failed to recover active run:', err);
    }
  }, [startPolling]);

  const loadPageRef = useRef(loadPage);
  const recoverActiveRunRef = useRef(recoverActiveRun);
  useEffect(() => { loadPageRef.current = loadPage; }, [loadPage]);
  useEffect(() => { recoverActiveRunRef.current = recoverActiveRun; }, [recoverActiveRun]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const loadedSummary = await loadPageRef.current();
      if (cancelled || !mountedRef.current) return;
      const regionId = loadedSummary?.region?.id || null;
      await recoverActiveRunRef.current(regionId);
    };

    init().catch(console.warn);

    return () => { cancelled = true; };
  }, []);

  const handleViewResults = useCallback(() => {
    if (!result) return;

    navigate('/allocation/results', {
      state: {
        result,
        summary,
        constraints: effectiveConfig,
        region: summary?.region || null,
        generatedAt: new Date().toISOString(),
      },
    });
  }, [navigate, result, summary, effectiveConfig]);

  const runAllocation = async () => {
    if (isRunning || isStopping || isDeleting) return;

    setIsRunning(true);
    setProgress(0);
    setResult(null);
    setError(null);
    setRunId(null);
    setRunStatus(null);

    const regionId = resolveRegionId();

    if (!regionId) {
      setIsRunning(false);
      setError(t.noRegion);
      return;
    }

    try {
      const responseRaw = await allocationAPI.startRun(regionId, { constraints: effectiveConfig });
      const response = unwrapResponse(responseRaw);

      const id = response?.run_id || response?.run?.id;

      if (!id) {
        throw new Error(t.missingRunId);
      }

      setRunId(id);
      setRunStatus('queued');
      startPolling(id);

      if (inboxItem?.id) {
        inboxAPI.markProcessed(inboxItem.id).catch(() => {});
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setIsRunning(false);
      setRunId(null);
      setRunStatus(null);
    }
  };

  const requestStopAllocation = () => {
    if (!runId) {
      showToast(t.missingRunId, 'error');
      return;
    }

    setConfirmModal({
      title: t.stopConfirmTitle,
      message: t.stopConfirmMsg,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsStopping(true);
        try {
          await allocationAPI.stopRun(runId);
          showToast(t.stopSuccess, 'info');
          setRunStatus('cancellation_requested');
        } catch (err) {
          showToast(getErrorMessage(err) || t.stopError, 'error');
          setIsStopping(false);
        }
      },
    });
  };

  const requestDeleteResults = () => {
    if (!runId) {
      showToast(t.missingRunId, 'error');
      return;
    }

    setConfirmModal({
      title: t.deleteConfirmTitle,
      message: t.deleteConfirmMsg,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsDeleting(true);
        try {
          await allocationAPI.deleteResults(runId);
          setResult(null);
          setRunId(null);
          setRunStatus(null);
          showToast(t.deleteSuccess, 'success');
          loadPage().catch(() => {});
        } catch (err) {
          const msg = getErrorMessage(err);
          const isApproved = err?.response?.status === 409
            || (typeof msg === 'string' && msg.toLowerCase().includes('approved'));
          showToast(isApproved ? t.approvedCannotDelete : (msg || t.deleteError), 'error');
        } finally {
          if (mountedRef.current) setIsDeleting(false);
        }
      },
    });
  };

  const canRun = typeof canRunAllocation === 'function' ? canRunAllocation() : false;
  const hasStudents = (summary?.unassigned_students || 0) > 0;
  const showStopButton = isRunning && !isStopping && !!runId && canRun;
  const showDeleteButton = runStatus === 'completed' && !isRunning && !!result && !!runId && canRun;

  if (loading) {
    return (
      <div className="allocation-page">
        <div className="loading-state">
          <Loader size={40} className="spin" />
          <p>{t.loading}</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="allocation-page">
        <div className="error-state">
          <XCircle size={40} />
          <p>{t.error}</p>
          <p className="error-message">{error}</p>
          <button onClick={loadPage}>{t.retry}</button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="allocation-page">
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' && <Check size={16} />}
          {toast.type === 'error' && <XCircle size={16} />}
          {toast.type === 'info' && <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {confirmModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-box">
            <h3 className="modal-title">{confirmModal.title}</h3>
            <p className="modal-msg">{confirmModal.message}</p>
            <div className="modal-actions">
              <button
                className="modal-cancel"
                onClick={() => setConfirmModal(null)}
              >
                {t.cancel}
              </button>
              <button
                className="modal-confirm"
                onClick={confirmModal.onConfirm}
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="shell">
        <div className="topbar">
          <div className="titleBlock">
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>

          <div className="topbarRight">
            {summary?.region && (
              <span className="region-badge">
                {language === 'he'
                  ? summary.region.name || summary.region.name_en || ''
                  : summary.region.name_en || summary.region.name || ''}
              </span>
            )}

            <button
              className="run-btn"
              onClick={runAllocation}
              disabled={isRunning || !canRun || !hasStudents || isDeleting}
              title={!hasStudents ? t.noStudents : ''}
            >
              {isRunning ? (
                <>
                  <RefreshCw size={18} className="spin" />
                  {isStopping ? t.stoppingStopping : t.running}
                </>
              ) : (
                <>
                  <Play size={18} />
                  {t.runAllocation}
                </>
              )}
            </button>

            {showStopButton && (
              <button
                className="stop-btn"
                onClick={requestStopAllocation}
                disabled={isStopping}
              >
                <Square size={16} />
                {t.stopAllocation}
              </button>
            )}

            {isStopping && (
              <span className="status-chip warn">
                <Loader size={14} className="spin" />
                {t.stoppingStopping}
              </span>
            )}

            {showDeleteButton && (
              <button
                className="delete-btn"
                onClick={requestDeleteResults}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader size={16} className="spin" />
                    {t.deletingResults}
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    {t.deleteResults}
                  </>
                )}
              </button>
            )}

            {!hasStudents && !isRunning && (
              <span className="status-chip ok">
                <Check size={16} />
                {t.noStudents}
              </span>
            )}
          </div>
        </div>

        {isRunning && (
          <div className="progressWrap">
            <div className="progressBar">
              <div className="progressFill" style={{ width: `${progress}%` }} />
            </div>
            <span className="progressPct">{progress}%</span>
          </div>
        )}

        {inboxItem && (
          <div className="banner">
            <div className="bannerLeft">
              <div className="bannerIcon">
                <Bell size={20} />
              </div>
              <div className="bannerText">
                <div className="bannerTitle">
                  <span className="bannerHeading">{t.notification}</span>
                  <span className="chip">
                    {t.batchId}: #{inboxItem.batch || inboxItem.batch_id || '-'}
                  </span>
                </div>
                <div className="bannerMain">
                  <Mail size={16} />
                  <span>
                    <strong>{Number(inboxItem.students_count) || 0}</strong> {t.receivedStudents}
                  </span>
                </div>
                <div className="bannerMeta">
                  <Calendar size={14} />
                  <span>
                    {t.receivedAt}:{' '}
                    {inboxItem.created_at
                      ? new Date(inboxItem.created_at).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US')
                      : '-'}
                  </span>
                </div>
              </div>
            </div>

            <div className="bannerRight">
              <span className={`status-chip ${inboxItem.status === 'pending' ? 'warn' : 'neutral'}`}>
                {inboxItem.status === 'pending' ? (
                  <>
                    <AlertTriangle size={16} /> {t.pending}
                  </>
                ) : (
                  <>
                    <Check size={16} /> {t.viewed}
                  </>
                )}
              </span>
            </div>
          </div>
        )}

        <div className="grid">
          <div className="leftCol">
            <div className="card">
              <div className="cardHeader constraintsHeader">
                <div>
                  <div className="cardTitle">
                    <Settings size={17} />
                    <span>{t.constraints}</span>
                  </div>
                  <p className="cardDescription">{t.constraintsIntro}</p>
                </div>
              </div>

              <div className="constraintSections">
                <section className="constraintSection hardSection">
                  <div className="sectionHeader">
                    <div className="sectionTitleWrap">
                      <span className="sectionIcon hard">
                        <ShieldCheck size={17} />
                      </span>
                      <div>
                        <div className="sectionTitleLine">
                          <h3>{t.hardConstraints}</h3>
                          <span className="countBadge">{hardConstraints.length}</span>
                        </div>
                        <p>{t.hardConstraintsHint}</p>
                      </div>
                    </div>
                  </div>

                  <div className="hardRulesGrid">
                    {hardConstraints.map(([key]) => (
                      <div key={key} className="hardRuleCard">
                        <span className="hardRuleIcon">
                          <Lock size={15} />
                        </span>
                        <div className="hardRuleContent">
                          <div className="hardRuleName">{t[key] || key}</div>
                          <div className="hardRuleMeta">
                            <span className="hardBadge">
                              <ShieldCheck size={12} /> {t.hardConstraint}
                            </span>
                            <span>{t.alwaysApplied}</span>
                            <span className="metaDivider" aria-hidden="true">•</span>
                            <span>{t.noWeight}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="constraintSection preferencesSection">
                  <div className="sectionHeader">
                    <div className="sectionTitleWrap">
                      <span className="sectionIcon preferences">
                        <SlidersHorizontal size={17} />
                      </span>
                      <div>
                        <div className="sectionTitleLine">
                          <h3>{t.optimizationPreferences}</h3>
                          <span className="countBadge">{optimizationPreferences.length}</span>
                        </div>
                        <p>{t.preferencesHint}</p>
                      </div>
                    </div>
                  </div>

                  <div className="preferencesList">
                    {optimizationPreferences.map(([key, value]) => (
                      <div key={key} className={`preferenceCard ${!value.enabled ? 'disabled' : ''}`}>
                        <div className="preferenceTop">
                          <div className="preferenceIdentity">
                            <div className="preferenceName">{t[key] || key}</div>
                            <div className={`preferenceStatus ${value.enabled ? 'active' : ''}`}>
                              {value.enabled ? t.included : t.excluded}
                            </div>
                          </div>

                          <button
                            type="button"
                            className={`switchControl ${value.enabled ? 'on' : ''}`}
                            role="switch"
                            aria-checked={value.enabled}
                            aria-label={`${t[key] || key}: ${value.enabled ? t.included : t.excluded}`}
                            onClick={() => toggleConstraintEnabled(key)}
                          >
                            <span className="switchThumb" />
                          </button>
                        </div>

                        <div className="importanceControl">
                          <div className="importanceHeader">
                            <span>{t.importance}</span>
                            <strong>{value.weight}/10</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="10"
                            step="1"
                            value={value.weight}
                            disabled={!value.enabled}
                            aria-label={`${t.importance}: ${t[key] || key}`}
                            onChange={(e) => setConstraintWeight(key, e.target.value)}
                          />
                          <div className="rangeScale" aria-hidden="true">
                            <span>0</span>
                            <span>10</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {!canRun && (
                <div className="lockNote">
                  <Lock size={16} />
                  <span>{t.noPermission}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rightCol">
            <div className="statsRow">
              <div className="stat">
                <div className="statIcon">
                  <Users size={18} />
                </div>
                <div>
                  <div className="statNum">{summary?.unassigned_students || 0}</div>
                  <div className="statLbl">{t.studentsToAssign}</div>
                </div>
              </div>

              <div className="stat">
                <div className="statIcon">
                  <Home size={18} />
                </div>
                <div>
                  <div className="statNum">{summary?.available_beds || 0}</div>
                  <div className="statLbl">{t.availableBeds}</div>
                </div>
              </div>
            </div>

            {summary?.inventory_by_type && (
              <div className="card">
                <div className="cardHeader compact">
                  <div className="cardTitle">
                    <Home size={16} />
                    <span>{t.inventoryBreakdown}</span>
                  </div>
                </div>

                <div className="inventoryGrid">
                  {[
                    ['single', t.singleHousing],
                    ['couple', t.coupleHousing],
                    ['family', t.familyHousing],
                  ].map(([key, label]) => {
                    const item = summary.inventory_by_type[key] || {};
                    return (
                      <div className="inventoryItem" key={key}>
                        <div className="inventoryTitle">{label}</div>
                        <div className="inventoryMetrics">
                          <div className="metricRow">
                            <span>{t.apartmentsLabel}</span>
                            <strong>{item.apartments || 0}</strong>
                          </div>
                          <div className="metricRow">
                            <span>{t.roomsLabel}</span>
                            <strong>{item.rooms || 0}</strong>
                          </div>
                          <div className="metricRow highlight">
                            <span>{t.freeBedsLabel}</span>
                            <strong>{item.available_beds || 0}</strong>
                          </div>
                          <div className="metricRow">
                            <span>{t.totalBedsLabel}</span>
                            <strong>{item.total_beds || 0}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {summary?.students_by_housing_type && (
              <div className="card">
                <div className="cardHeader compact">
                  <div className="cardTitle">
                    <Users size={16} />
                    <span>{t.housingDemand}</span>
                  </div>
                </div>

                <div className="housingBreakdown">
                  {[
                    ['single_male', t.singleMaleStudents],
                    ['single_female', t.singleFemaleStudents],
                    ['single_mixed', t.singleMixedStudents],
                    ['couple', t.coupleStudents],
                    ['family', t.familyStudents],
                    ['unknown', t.unknownHousing],
                  ].map(([key, label]) => (
                    <div className={`housingItem ${key === 'unknown' ? 'unknown' : ''}`} key={key}>
                      <div className="housingNum">{summary.students_by_housing_type[key] || 0}</div>
                      <div className="housingLbl">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary?.students_by_category && (
              <div className="card">
                <div className="cardHeader compact">
                  <div className="cardTitle">
                    <Users size={16} />
                    <span>{t.studentsBreakdown}</span>
                  </div>
                </div>

                <div className="breakdown">
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.new || 0}</div>
                    <div className="bLbl">{t.newStudents}</div>
                  </div>
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.continuing || 0}</div>
                    <div className="bLbl">{t.continuing}</div>
                  </div>
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.transfer || 0}</div>
                    <div className="bLbl">{t.transfers}</div>
                  </div>
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.leaving || 0}</div>
                    <div className="bLbl">{t.leaving}</div>
                  </div>
                  <div className="bItem priority">
                    <div className="bNum">{summary.priority_students || 0}</div>
                    <div className="bLbl">{t.priorityStudents}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="cardHeader compact">
                <div className="cardTitle">
                  <BarChart3 size={16} />
                  <span>{t.results}</span>
                </div>
                <span className="hint">{t.currentStatus}</span>
              </div>

              {result ? (
                <div className="results">
                  <div className="kpi ok">
                    <div className="kpiIcon">
                      <Check size={18} />
                    </div>
                    <div>
                      <div className="kpiNum">{result.successful_assignments || 0}</div>
                      <div className="kpiLbl">{t.assigned}</div>
                    </div>
                  </div>

                  <div className="kpi info">
                    <div className="kpiIcon">
                      <Users size={18} />
                    </div>
                    <div>
                      <div className="kpiNum">{result.roommate_matches || 0}</div>
                      <div className="kpiLbl">{t.roommateMatches}</div>
                    </div>
                  </div>

                  <div className="kpi warn">
                    <div className="kpiIcon">
                      <AlertTriangle size={18} />
                    </div>
                    <div>
                      <div className="kpiNum">{result.conflicts || 0}</div>
                      <div className="kpiLbl">{t.conflicts}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-results-state">
                  <div className="empty-results-title">{t.noResultsYet}</div>
                  <div className="empty-results-subtitle">{t.resultsHint}</div>
                </div>
              )}

              <div className="resultActions">
                <button className="ghostBtn" onClick={handleViewResults} disabled={!result || runStatus !== 'completed'}>
                  {t.viewResults}
                </button>

                {showDeleteButton && (
                  <button
                    className="ghostBtnDanger"
                    onClick={requestDeleteResults}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <>
                        <Loader size={14} className="spin" />
                        {t.deletingResults}
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} />
                        {t.deleteResults}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  :root{
    --bg: #f6f8fc;
    --card: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --border: rgba(15,23,42,0.10);
    --shadow: 0 10px 30px rgba(15,23,42,0.08);
    --shadow2: 0 6px 18px rgba(15,23,42,0.08);
    --primary: #2563eb;
    --primarySoft: rgba(37,99,235,0.10);
    --ok: #047857;
    --okSoft: rgba(4,120,87,0.12);
    --warn: #b45309;
    --warnSoft: rgba(180,83,9,0.14);
    --danger: #b91c1c;
    --dangerSoft: rgba(185,28,28,0.12);
    --radius: 18px;
    --radius2: 14px;
  }

  .allocation-page{
    padding: 18px;
    background: var(--bg);
    min-height: calc(100vh - 40px);
  }

  .shell{
    max-width: 1180px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .topbar{
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(to bottom, rgba(246,248,252,1), rgba(246,248,252,0.88));
    backdrop-filter: blur(8px);
    border-radius: var(--radius);
    padding: 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  .titleBlock h1{
    margin: 0;
    font-size: 24px;
    font-weight: 900;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .titleBlock p{
    margin: 6px 0 0;
    color: var(--muted);
    font-weight: 700;
    font-size: 13px;
  }

  .topbarRight{
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .region-badge{
    background: var(--primarySoft);
    border: 1px solid rgba(37,99,235,0.25);
    color: #1d4ed8;
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 900;
    white-space: nowrap;
  }

  .run-btn{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(4,120,87,0.25);
    background: linear-gradient(135deg, #059669, #047857);
    color: white;
    font-weight: 950;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 10px 20px rgba(4,120,87,0.25);
    transition: transform 0.18s, filter 0.18s;
    font-family: inherit;
    white-space: nowrap;
  }

  .run-btn:hover{
    transform: translateY(-1px);
    filter: brightness(0.98);
  }

  .run-btn:disabled{
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .stop-btn{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(185,28,28,0.30);
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    color: white;
    font-weight: 950;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(185,28,28,0.28);
    transition: transform 0.18s, filter 0.18s;
    font-family: inherit;
    white-space: nowrap;
  }

  .stop-btn:hover{
    transform: translateY(-1px);
    filter: brightness(0.95);
  }

  .stop-btn:disabled{
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
  }

  .delete-btn{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(185,28,28,0.30);
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    color: white;
    font-weight: 950;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(185,28,28,0.28);
    transition: transform 0.18s, filter 0.18s;
    font-family: inherit;
    white-space: nowrap;
  }

  .delete-btn:hover{
    transform: translateY(-1px);
    filter: brightness(0.95);
  }

  .delete-btn:disabled{
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
  }

  .resultActions{
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 12px;
  }

  .resultActions .ghostBtn{
    flex: 1;
    margin-top: 0;
  }

  .resultActions .ghostBtnDanger{
    flex: 1;
    margin-top: 0;
  }

  .ghostBtnDanger{
    margin-top: 12px;
    width: 100%;
    padding: 12px;
    border-radius: 14px;
    border: 1px solid rgba(185,28,28,0.22);
    background: rgba(185,28,28,0.06);
    color: var(--danger);
    font-weight: 950;
    cursor: pointer;
    font-family: inherit;
    transition: 0.18s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .ghostBtnDanger:hover:not(:disabled){
    background: rgba(185,28,28,0.12);
    border-color: rgba(185,28,28,0.35);
  }

  .ghostBtnDanger:disabled{
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Confirmation modal */
  .modal-overlay{
    position: fixed;
    inset: 0;
    background: rgba(15,23,42,0.55);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .modal-box{
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 24px 60px rgba(15,23,42,0.22);
    padding: 28px;
    max-width: 420px;
    width: 100%;
  }

  .modal-title{
    margin: 0 0 10px;
    font-size: 18px;
    font-weight: 950;
    color: var(--text);
  }

  .modal-msg{
    margin: 0 0 20px;
    color: var(--muted);
    font-size: 14px;
    font-weight: 800;
    line-height: 1.55;
  }

  .modal-actions{
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .modal-cancel{
    padding: 10px 18px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.04);
    color: var(--text);
    font-weight: 950;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
  }

  .modal-cancel:hover{
    background: rgba(15,23,42,0.08);
  }

  .modal-confirm{
    padding: 10px 18px;
    border-radius: 12px;
    border: 1px solid rgba(185,28,28,0.28);
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    color: white;
    font-weight: 950;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(185,28,28,0.28);
  }

  .modal-confirm:hover{
    filter: brightness(0.95);
  }

  /* Toast notification */
  .toast{
    position: fixed;
    top: 18px;
    inset-inline-end: 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 18px;
    border-radius: 14px;
    font-size: 14px;
    font-weight: 900;
    box-shadow: 0 8px 24px rgba(15,23,42,0.18);
    z-index: 200;
    max-width: 380px;
    animation: slideIn 0.2s ease;
  }

  @keyframes slideIn{
    from{ transform: translateY(-12px); opacity: 0; }
    to{ transform: translateY(0); opacity: 1; }
  }

  .toast-success{
    background: linear-gradient(135deg, #059669, #047857);
    color: white;
  }

  .toast-error{
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    color: white;
  }

  .toast-info{
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: white;
  }

  .status-chip{
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 900;
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.03);
    color: var(--text);
    white-space: nowrap;
  }

  .status-chip.ok{
    background: var(--okSoft);
    border-color: rgba(4,120,87,0.25);
    color: var(--ok);
  }

  .status-chip.warn{
    background: var(--warnSoft);
    border-color: rgba(180,83,9,0.25);
    color: var(--warn);
  }

  .status-chip.neutral{
    background: rgba(15,23,42,0.03);
    border-color: var(--border);
    color: var(--text);
  }

  .progressWrap{
    display:flex;
    align-items:center;
    gap: 10px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius2);
    padding: 10px 12px;
    box-shadow: var(--shadow2);
  }

  .progressBar{
    height: 10px;
    border-radius: 999px;
    background: rgba(15,23,42,0.08);
    overflow:hidden;
    flex: 1;
  }

  .progressFill{
    height: 100%;
    background: linear-gradient(90deg, rgba(37,99,235,0.75), rgba(5,150,105,0.75));
    transition: width 0.25s ease;
    border-radius: 999px;
  }

  .progressPct{
    width: 52px;
    text-align:right;
    font-size: 13px;
    font-weight: 950;
    color: var(--muted);
  }

  .banner{
    display:flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: linear-gradient(135deg, rgba(37,99,235,0.10), rgba(99,102,241,0.10));
    border: 1px solid rgba(37,99,235,0.18);
    border-radius: var(--radius);
    padding: 14px;
  }

  .bannerLeft{
    display:flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }

  .bannerIcon{
    width: 40px;
    height: 40px;
    border-radius: 14px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(255,255,255,0.85);
    border: 1px solid rgba(255,255,255,0.6);
    color: #1d4ed8;
    flex-shrink: 0;
  }

  .bannerText{
    min-width: 0;
  }

  .bannerTitle{
    display:flex;
    align-items:center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .bannerHeading{
    font-weight: 950;
    color: #1e3a8a;
    font-size: 13px;
  }

  .chip{
    font-size: 12px;
    font-weight: 950;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.85);
    border: 1px solid rgba(15,23,42,0.10);
    color: var(--text);
  }

  .bannerMain{
    display:flex;
    align-items:center;
    gap: 8px;
    margin-top: 8px;
    font-weight: 800;
    color: var(--text);
  }

  .bannerMeta{
    display:flex;
    align-items:center;
    gap: 8px;
    margin-top: 6px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .grid{
    display:grid;
    grid-template-columns: 1.2fr 0.95fr;
    gap: 14px;
    align-items:start;
  }

  .card{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px;
  }

  .cardHeader{
    display:flex;
    align-items:flex-start;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }

  .cardHeader.compact{
    padding-bottom: 10px;
    margin-bottom: 12px;
  }

  .cardTitle{
    display:flex;
    align-items:center;
    gap: 10px;
    font-weight: 950;
    color: var(--text);
  }

  .hint{
    font-size: 12px;
    color: var(--muted);
    font-weight: 800;
    text-align: right;
  }

  .constraintsHeader{
    align-items: flex-start;
  }

  .cardDescription{
    margin: 7px 0 0;
    max-width: 650px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
    line-height: 1.55;
  }

  .constraintSections{
    display:flex;
    flex-direction:column;
    gap: 16px;
  }

  .constraintSection{
    border-radius: 16px;
    padding: 14px;
    border: 1px solid var(--border);
  }

  .hardSection{
    background: linear-gradient(145deg, rgba(15,118,110,0.07), rgba(37,99,235,0.04));
    border-color: rgba(15,118,110,0.18);
  }

  .preferencesSection{
    background: rgba(15,23,42,0.018);
  }

  .sectionHeader{
    margin-bottom: 12px;
  }

  .sectionTitleWrap{
    display:flex;
    align-items:flex-start;
    gap: 10px;
  }

  .sectionIcon{
    width: 36px;
    height: 36px;
    border-radius: 12px;
    display:flex;
    align-items:center;
    justify-content:center;
    flex-shrink: 0;
  }

  .sectionIcon.hard{
    color: #0f766e;
    background: rgba(15,118,110,0.10);
    border: 1px solid rgba(15,118,110,0.18);
  }

  .sectionIcon.preferences{
    color: #1d4ed8;
    background: var(--primarySoft);
    border: 1px solid rgba(37,99,235,0.16);
  }

  .sectionTitleLine{
    display:flex;
    align-items:center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sectionTitleLine h3{
    margin: 0;
    font-size: 14px;
    font-weight: 950;
    color: var(--text);
  }

  .sectionHeader p{
    margin: 5px 0 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
    line-height: 1.5;
  }

  .countBadge{
    min-width: 24px;
    height: 24px;
    padding: 0 7px;
    border-radius: 999px;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    background: rgba(255,255,255,0.82);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    font-weight: 950;
  }

  .hardRulesGrid{
    display:grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }

  .hardRuleCard{
    display:flex;
    align-items:flex-start;
    gap: 10px;
    min-width: 0;
    padding: 11px;
    border-radius: 14px;
    background: rgba(255,255,255,0.82);
    border: 1px solid rgba(15,118,110,0.13);
  }

  .hardRuleIcon{
    width: 30px;
    height: 30px;
    border-radius: 10px;
    display:flex;
    align-items:center;
    justify-content:center;
    flex-shrink: 0;
    color: #0f766e;
    background: rgba(15,118,110,0.09);
  }

  .hardRuleContent{
    min-width: 0;
  }

  .hardRuleName{
    color: var(--text);
    font-size: 12.5px;
    font-weight: 900;
    line-height: 1.45;
  }

  .hardRuleMeta{
    display:flex;
    align-items:center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 7px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 800;
  }

  .hardBadge{
    display:inline-flex;
    align-items:center;
    gap: 5px;
    padding: 4px 7px;
    border-radius: 999px;
    color: #0f766e;
    background: rgba(15,118,110,0.10);
    border: 1px solid rgba(15,118,110,0.14);
    font-weight: 950;
  }

  .metaDivider{
    opacity: 0.55;
  }

  .preferencesList{
    display:flex;
    flex-direction:column;
    gap: 9px;
  }

  .preferenceCard{
    padding: 12px;
    border-radius: 14px;
    background: #fff;
    border: 1px solid rgba(15,23,42,0.08);
    transition: border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
  }

  .preferenceCard:hover{
    border-color: rgba(37,99,235,0.20);
    box-shadow: 0 6px 16px rgba(15,23,42,0.05);
  }

  .preferenceCard.disabled{
    opacity: 0.62;
    background: rgba(15,23,42,0.025);
  }

  .preferenceTop{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap: 12px;
  }

  .preferenceIdentity{
    min-width: 0;
  }

  .preferenceName{
    color: var(--text);
    font-size: 13px;
    font-weight: 900;
    line-height: 1.4;
  }

  .preferenceStatus{
    margin-top: 4px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 800;
  }

  .preferenceStatus.active{
    color: var(--ok);
  }

  .switchControl{
    position: relative;
    width: 44px;
    height: 25px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: rgba(100,116,139,0.28);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.18s ease;
  }

  .switchControl.on{
    background: var(--primary);
  }

  .switchControl:focus-visible{
    outline: 3px solid rgba(37,99,235,0.22);
    outline-offset: 2px;
  }

  .switchThumb{
    position:absolute;
    top: 3px;
    left: 3px;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 6px rgba(15,23,42,0.22);
    transition: transform 0.18s ease;
  }

  .switchControl.on .switchThumb{
    transform: translateX(19px);
  }

  [dir="rtl"] .switchControl.on .switchThumb{
    transform: translateX(19px);
  }

  .importanceControl{
    margin-top: 11px;
    padding-top: 10px;
    border-top: 1px solid rgba(15,23,42,0.07);
  }

  .importanceHeader{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap: 10px;
    margin-bottom: 7px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 850;
  }

  .importanceHeader strong{
    color: var(--text);
    font-size: 11.5px;
    font-weight: 950;
    padding: 4px 8px;
    border-radius: 9px;
    background: var(--primarySoft);
    border: 1px solid rgba(37,99,235,0.12);
  }

  .importanceControl input[type="range"]{
    width: 100%;
    accent-color: var(--primary);
    cursor: pointer;
  }

  .importanceControl input[type="range"]:disabled{
    cursor: not-allowed;
    opacity: 0.45;
  }

  .rangeScale{
    display:flex;
    justify-content:space-between;
    margin-top: 2px;
    color: var(--muted);
    font-size: 9.5px;
    font-weight: 800;
  }

  .lockNote{
    margin-top: 12px;
    display:flex;
    align-items:center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius2);
    background: rgba(15,23,42,0.03);
    border: 1px solid var(--border);
    color: var(--muted);
    font-weight: 850;
    font-size: 13px;
  }

  .statsRow{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .stat{
    display:flex;
    align-items:center;
    gap: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow2);
    padding: 14px;
  }

  .statIcon{
    width: 38px;
    height: 38px;
    border-radius: 14px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(37,99,235,0.10);
    border: 1px solid rgba(37,99,235,0.16);
    color: #1d4ed8;
  }

  .statNum{
    font-size: 22px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .statLbl{
    font-size: 12px;
    font-weight: 900;
    color: var(--muted);
    margin-top: 2px;
  }

  .breakdown{
    display:grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
  }

  .inventoryGrid{
    display:grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .inventoryItem{
    border-radius: var(--radius2);
    border: 1px solid rgba(37,99,235,0.14);
    background: linear-gradient(145deg, rgba(37,99,235,0.06), rgba(255,255,255,0.95));
    padding: 12px;
    min-width: 0;
  }

  .inventoryTitle{
    color: var(--text);
    font-size: 13px;
    font-weight: 950;
    margin-bottom: 10px;
  }

  .inventoryMetrics{
    display:flex;
    flex-direction:column;
    gap: 7px;
  }

  .metricRow{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap: 8px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 850;
  }

  .metricRow strong{
    color: var(--text);
    font-size: 12px;
    font-weight: 950;
  }

  .metricRow.highlight{
    padding: 6px 8px;
    margin: 1px -2px;
    border-radius: 9px;
    color: var(--ok);
    background: var(--okSoft);
  }

  .metricRow.highlight strong{
    color: var(--ok);
  }

  .housingBreakdown{
    display:grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
  }

  .housingItem{
    border-radius: var(--radius2);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 11px;
    text-align:center;
    min-width: 0;
  }

  .housingItem.unknown{
    border-style: dashed;
    opacity: 0.78;
  }

  .housingNum{
    font-size: 19px;
    font-weight: 950;
    color: #1d4ed8;
  }

  .housingLbl{
    margin-top: 4px;
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.35;
    font-weight: 850;
  }

  .bItem{
    border-radius: var(--radius2);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 12px;
    text-align:center;
  }

  .bItem.priority{
    background: var(--warnSoft);
    border-color: rgba(180,83,9,0.20);
  }

  .bNum{
    font-size: 20px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .bItem.priority .bNum{
    color: var(--warn);
  }

  .bLbl{
    margin-top: 4px;
    font-size: 12px;
    font-weight: 900;
    color: var(--muted);
  }

  .results{
    display:grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .kpi{
    display:flex;
    align-items:center;
    gap: 12px;
    border-radius: var(--radius2);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 12px;
  }

  .kpi.ok{
    background: var(--okSoft);
    border-color: rgba(4,120,87,0.20);
  }

  .kpi.info{
    background: var(--primarySoft);
    border-color: rgba(37,99,235,0.18);
  }

  .kpi.warn{
    background: var(--warnSoft);
    border-color: rgba(180,83,9,0.20);
  }

  .kpiIcon{
    width: 36px;
    height: 36px;
    border-radius: 14px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(255,255,255,0.75);
    border: 1px solid rgba(255,255,255,0.6);
  }

  .kpi.ok .kpiIcon{ color: var(--ok); }
  .kpi.info .kpiIcon{ color: #1d4ed8; }
  .kpi.warn .kpiIcon{ color: var(--warn); }

  .kpiNum{
    font-size: 18px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .kpiLbl{
    font-size: 12px;
    font-weight: 900;
    color: rgba(15,23,42,0.70);
    margin-top: 2px;
  }

  .empty-results-state{
    padding: 14px;
    border-radius: 14px;
    border: 1px dashed rgba(15,23,42,0.12);
    background: rgba(15,23,42,0.03);
  }

  .empty-results-title{
    color: var(--text);
    font-size: 13px;
    font-weight: 900;
  }

  .empty-results-subtitle{
    margin-top: 6px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .ghostBtn{
    margin-top: 12px;
    width: 100%;
    padding: 12px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    color: var(--text);
    font-weight: 950;
    cursor: pointer;
    font-family: inherit;
    transition: 0.18s ease;
  }

  .ghostBtn:hover:not(:disabled){
    background: rgba(37,99,235,0.06);
    border-color: rgba(37,99,235,0.18);
    color: #1d4ed8;
  }

  .ghostBtn:disabled{
    opacity: 0.6;
    cursor: not-allowed;
  }

  .loading-state, .error-state{
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    height: 400px;
    gap: 14px;
    border-radius: var(--radius);
    background: var(--card);
    border: 1px solid var(--border);
    box-shadow: var(--shadow2);
    max-width: 720px;
    margin: 0 auto;
  }

  .loading-state p{
    margin: 0;
    color: var(--muted);
    font-weight: 900;
  }

  .error-state{
    color: var(--danger);
  }

  .error-message{
    font-size: 13px;
    color: var(--muted);
    max-width: 520px;
    text-align:center;
    margin: -6px 0 0;
    font-weight: 800;
  }

  .error-state button{
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(37,99,235,0.18);
    background: var(--primarySoft);
    color: #1d4ed8;
    font-weight: 950;
    cursor:pointer;
    font-family: inherit;
  }

  .error-state button:hover{
    background: rgba(37,99,235,0.14);
  }

  .spin{
    animation: spin 1s linear infinite;
  }

  @keyframes spin{
    from{ transform: rotate(0deg);}
    to{ transform: rotate(360deg);}
  }

  @media (max-width: 980px){
    .topbar{
      flex-direction: column;
      align-items: flex-start;
    }

    .topbarRight{
      justify-content:flex-start;
    }

    .grid{
      grid-template-columns: 1fr;
    }

    .breakdown{
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .inventoryGrid{
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px){
    .hardRulesGrid{
      grid-template-columns: 1fr;
    }

    .constraintSection{
      padding: 12px;
    }

    .statsRow{
      grid-template-columns: 1fr;
    }

    .breakdown,
    .housingBreakdown{
      grid-template-columns: 1fr 1fr;
    }
  }
`;

export default AllocationPage;