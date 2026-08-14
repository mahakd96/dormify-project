import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { uploadAPI } from '../services/api';
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  X,
  Loader,
  Clock3,
  Database,
  UserPlus,
  ChevronDown,
  ChevronUp,
  StopCircle,
  Trash2,
  XOctagon,
} from 'lucide-react';

// Batch statuses during which processing is still (or may still be) active -
// the frontend keeps polling and the timer keeps ticking for any of these.
const ACTIVE_BATCH_STATUSES = [
  'pending',
  'processing',
  'cancellation_requested',
  'stop_and_delete_requested',
];
const TERMINAL_BATCH_STATUSES = ['completed', 'stopped', 'failed'];

// Per-tab-only memory of "which batch is this card currently tracking" -
// used solely to restore the status poll/timer after a refresh. Never used
// to decide which batch an action targets (every action call always sends
// an explicit batch_id already held in state).
const PRIMARY_BATCH_STORAGE_KEY = 'dormify_upload_batch_main';
const ADDITIONS_BATCH_STORAGE_KEY = 'dormify_upload_batch_additions';
const BATCH_POLL_INTERVAL_MS = 1500;

function UploadPage({ language = 'he' }) {
  const { canUploadExcel } = useAuth();
  const isHebrew = language === 'he';

  const [file, setFile] = useState(null);
  const [batchId, setBatchId] = useState(null);
  const [batchStatus, setBatchStatus] = useState(null);
  const [startedAtMs, setStartedAtMs] = useState(null);
  const [finishedAtMs, setFinishedAtMs] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [additionsFile, setAdditionsFile] = useState(null);
  const [additionsBatchId, setAdditionsBatchId] = useState(null);
  const [additionsBatchStatus, setAdditionsBatchStatus] = useState(null);
  const [additionsStartedAtMs, setAdditionsStartedAtMs] = useState(null);
  const [additionsFinishedAtMs, setAdditionsFinishedAtMs] = useState(null);
  const [additionsResult, setAdditionsResult] = useState(null);
  const [additionsError, setAdditionsError] = useState(null);
  const [additionsDragOver, setAdditionsDragOver] = useState(false);
  const [additionsDisplayElapsed, setAdditionsDisplayElapsed] = useState(0);
  const [additionsActionBusy, setAdditionsActionBusy] = useState(false);

  const uploading = ACTIVE_BATCH_STATUSES.includes(batchStatus);
  const uploadingAdditions = ACTIVE_BATCH_STATUSES.includes(additionsBatchStatus);

  const t = {
    he: {
      title: 'העלאת קבצים',
      subtitle: 'קובץ שיבוץ ראשי וקובץ מתווספים',
      primaryTitle: 'קובץ שיבוץ ראשי',
      primaryHint: 'ייבוא הנתונים וחלוקה לפי אזורים',
      additionsTitle: 'קובץ מתווספים',
      additionsHint: 'הוספת סטודנטים ועדכון נתונים קיימים',
      chooseFile: 'גררו קובץ או לחצו לבחירה',
      excelOnly: 'Excel · xlsx / xls',
      selectedFile: 'קובץ נבחר',
      removeFile: 'הסר קובץ',
      upload: 'העלה קובץ',
      uploading: 'מעבד את הקובץ',
      ready: 'מוכן להעלאה',
      waiting: 'טרם נבחר קובץ',
      completed: 'הושלם',
      failed: 'נכשל',
      stopped: 'נעצר',
      noAccess: 'אין הרשאה להעלות קבצים',
      accessHint: 'הפעולה זמינה למנהל/ת מרכזי/ת בלבד.',
      invalidFile: 'יש לבחור קובץ Excel מסוג xlsx או xls.',
      uploadError: 'העלאת הקובץ נכשלה',
      primarySuccess: 'קובץ השיבוץ נקלט בהצלחה',
      additionsSuccess: 'קובץ המתווספים נקלט בהצלחה',
      stoppedMessage: 'העיבוד נעצר לבקשתכם באמצע התהליך',
      batchId: 'אצווה',
      totalStudents: 'נקלטו',
      created: 'נוצרו',
      updated: 'עודכנו',
      skipped: 'דולגו',
      details: 'פרטים',
      splitByRegion: 'לפי אזור',
      sheetSummary: 'לפי גיליון',
      skippedReasons: 'סיבות דילוג',
      technicalErrors: 'שגיאות',
      uploadAnother: 'העלה קובץ אחר',
      rows: 'שורות',
      preserved: 'סטטוס קיים נשמר עבור',
      students: 'סטודנטים',

      dormTypeAcceptanceSummary: 'סיכום מתקבלים לפי סוג מעון',
      totalAccepted: 'סה״כ התקבלו',
      singlesAccepted: 'רווקים/רווקות',
      sharedApartmentSingles: 'רווקים/ות בדירת זוגות',
      couplesApartments: 'דירות זוגות',
      familiesApartments: 'דירות משפחות',

      stopButton: 'עצור',
      stopAndDeleteButton: 'עצור ומחק',
      deleteCreatedButton: 'מחק סטודנטים שנוספו בהעלאה זו',
      stopError: 'עצירת ההעלאה נכשלה',
      deleteError: 'מחיקת הסטודנטים נכשלה',
      confirmStopAndDelete:
        'לעצור את ההעלאה ולמחוק את הסטודנטים שכבר נוספו בה? הפעולה בלתי הפיכה. סטודנטים קיימים שעודכנו על ידי הקובץ לא ישוחזרו.',
      confirmDelete:
        'למחוק את הסטודנטים שנוספו בהעלאה זו? הפעולה בלתי הפיכה. סטודנטים קיימים שהקובץ רק עדכן לא יימחקו ולא ישוחזרו לערכים הקודמים.',
      deletionOutcome: 'תוצאת המחיקה',
      deletedCount: 'נמחקו',
      protectedCount: 'לא ניתן למחוק (משובצים)',
      deleteNote:
        'המחיקה מסירה רק סטודנטים שנוצרו על ידי העלאה זו. סטודנטים קיימים שהקובץ עדכן אינם מושפעים ולא ישוחזרו.',
      processedProgress: 'שורות שעובדו',
    },
    en: {
      title: 'Upload Files',
      subtitle: 'Main allocation file and additions file',
      primaryTitle: 'Main Allocation File',
      primaryHint: 'Import records and split them by region',
      additionsTitle: 'Additions File',
      additionsHint: 'Add students and update existing records',
      chooseFile: 'Drag a file or click to browse',
      excelOnly: 'Excel · xlsx / xls',
      selectedFile: 'Selected file',
      removeFile: 'Remove file',
      upload: 'Upload file',
      uploading: 'Processing file',
      ready: 'Ready to upload',
      waiting: 'No file selected',
      completed: 'Completed',
      failed: 'Failed',
      stopped: 'Stopped',
      noAccess: 'You do not have permission to upload files',
      accessHint: 'This action is available only to central administrators.',
      invalidFile: 'Choose an Excel file in xlsx or xls format.',
      uploadError: 'File upload failed',
      primarySuccess: 'Allocation file imported successfully',
      additionsSuccess: 'Additions file imported successfully',
      stoppedMessage: 'Processing was stopped by request, partway through',
      batchId: 'Batch',
      totalStudents: 'Imported',
      created: 'Created',
      updated: 'Updated',
      skipped: 'Skipped',
      details: 'Details',
      splitByRegion: 'By region',
      sheetSummary: 'By sheet',
      skippedReasons: 'Skipped reasons',
      technicalErrors: 'Errors',
      uploadAnother: 'Upload another file',
      rows: 'Rows',
      preserved: 'Existing status preserved for',
      students: 'students',

      dormTypeAcceptanceSummary: 'Accepted students by dorm type',
      totalAccepted: 'Total accepted',
      singlesAccepted: 'Single students',
      sharedApartmentSingles: 'Singles in shared/couple apartments',
      couplesApartments: 'Couple apartments',
      familiesApartments: 'Family apartments',

      stopButton: 'Stop',
      stopAndDeleteButton: 'Stop & Delete',
      deleteCreatedButton: 'Delete students added by this upload',
      stopError: 'Failed to stop the upload',
      deleteError: 'Failed to delete students',
      confirmStopAndDelete:
        'Stop this upload and delete the students it already added? This cannot be undone. Existing students it updated will not be reverted.',
      confirmDelete:
        'Delete the students added by this upload? This cannot be undone. Existing students this file only updated will not be deleted or reverted.',
      deletionOutcome: 'Deletion outcome',
      deletedCount: 'Deleted',
      protectedCount: 'Could not delete (already housed)',
      deleteNote:
        'Deletion removes only students created by this upload. Existing students it updated are not affected and are not reverted.',
      processedProgress: 'Rows processed',
    },
  }[isHebrew ? 'he' : 'en'];

  // Timer: authoritative backend timestamps, not a client-side counter -
  // survives refresh/navigation. Same single-timer visual appearance as
  // before, just re-anchored on every tick instead of incrementing blindly.
  useEffect(() => {
    if (!startedAtMs) {
      setDisplayElapsed(0);
      return undefined;
    }

    const recompute = () => {
      const end = finishedAtMs || Date.now();
      setDisplayElapsed(Math.max(0, Math.floor((end - startedAtMs) / 1000)));
    };

    recompute();
    if (finishedAtMs) return undefined;

    const intervalId = window.setInterval(recompute, 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAtMs, finishedAtMs]);

  useEffect(() => {
    if (!additionsStartedAtMs) {
      setAdditionsDisplayElapsed(0);
      return undefined;
    }

    const recompute = () => {
      const end = additionsFinishedAtMs || Date.now();
      setAdditionsDisplayElapsed(Math.max(0, Math.floor((end - additionsStartedAtMs) / 1000)));
    };

    recompute();
    if (additionsFinishedAtMs) return undefined;

    const intervalId = window.setInterval(recompute, 1000);
    return () => window.clearInterval(intervalId);
  }, [additionsStartedAtMs, additionsFinishedAtMs]);

  const formatElapsed = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  };

  const formattedElapsed = useMemo(
    () => formatElapsed(displayElapsed),
    [displayElapsed]
  );

  const formattedAdditionsElapsed = useMemo(
    () => formatElapsed(additionsDisplayElapsed),
    [additionsDisplayElapsed]
  );

  // Applies a batch's serialized state (from status/stop/stop-and-delete/
  // delete - they all return the same ImportBatchSerializer shape) to the
  // primary card. Single choke point so every source (polling, the upload
  // request's own resolution, refresh recovery, action buttons) stays
  // consistent.
  const applyBatchStatus = (data) => {
    if (!data) return;
    setBatchStatus(data.status);
    setStartedAtMs(data.started_at ? new Date(data.started_at).getTime() : null);
    setFinishedAtMs(data.finished_at ? new Date(data.finished_at).getTime() : null);

    if (TERMINAL_BATCH_STATUSES.includes(data.status)) {
      if (data.result) {
        setUploadResult(data.result);
      } else if (data.status === 'failed') {
        setError(data.error_message || t.uploadError);
      }
    }
  };

  const applyAdditionsBatchStatus = (data) => {
    if (!data) return;
    setAdditionsBatchStatus(data.status);
    setAdditionsStartedAtMs(data.started_at ? new Date(data.started_at).getTime() : null);
    setAdditionsFinishedAtMs(data.finished_at ? new Date(data.finished_at).getTime() : null);

    if (TERMINAL_BATCH_STATUSES.includes(data.status)) {
      if (data.result) {
        setAdditionsResult(data.result);
      } else if (data.status === 'failed') {
        setAdditionsError(data.error_message || t.uploadError);
      }
    }
  };

  // Refresh/navigation recovery: restore this tab's own last batch_id (not
  // "latest batch by admin" - purely local memory of our own prior action)
  // and re-poll it once.
  useEffect(() => {
    const saved = sessionStorage.getItem(PRIMARY_BATCH_STORAGE_KEY);
    const savedId = Number(saved);
    if (!saved || !Number.isFinite(savedId)) return;

    setBatchId(savedId);
    uploadAPI
      .getBatchStatus(savedId)
      .then(applyBatchStatus)
      .catch(() => sessionStorage.removeItem(PRIMARY_BATCH_STORAGE_KEY));
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(ADDITIONS_BATCH_STORAGE_KEY);
    const savedId = Number(saved);
    if (!saved || !Number.isFinite(savedId)) return;

    setAdditionsBatchId(savedId);
    uploadAPI
      .getBatchStatus(savedId)
      .then(applyAdditionsBatchStatus)
      .catch(() => sessionStorage.removeItem(ADDITIONS_BATCH_STORAGE_KEY));
  }, []);

  // Live progress polling - independent of whichever request actually
  // started the upload, so it also works after a refresh.
  useEffect(() => {
    if (!batchId || !uploading) return undefined;
    let cancelled = false;

    const poll = () => {
      uploadAPI
        .getBatchStatus(batchId)
        .then((data) => {
          if (!cancelled) applyBatchStatus(data);
        })
        .catch(() => {});
    };

    const intervalId = window.setInterval(poll, BATCH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [batchId, uploading]);

  useEffect(() => {
    if (!additionsBatchId || !uploadingAdditions) return undefined;
    let cancelled = false;

    const poll = () => {
      uploadAPI
        .getBatchStatus(additionsBatchId)
        .then((data) => {
          if (!cancelled) applyAdditionsBatchStatus(data);
        })
        .catch(() => {});
    };

    const intervalId = window.setInterval(poll, BATCH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [additionsBatchId, uploadingAdditions]);

  const isValidExcelFile = (candidateFile) => {
    if (!candidateFile) return false;
    const lowerName = candidateFile.name.toLowerCase();
    return lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
  };

  const selectPrimaryFile = (selectedFile) => {
    if (!selectedFile) return;

    if (!isValidExcelFile(selectedFile)) {
      setFile(null);
      setUploadResult(null);
      setError(t.invalidFile);
      return;
    }

    setFile(selectedFile);
    setUploadResult(null);
    setError(null);
    setBatchId(null);
    setBatchStatus(null);
    setStartedAtMs(null);
    setFinishedAtMs(null);
    setShowDetails(false);
    sessionStorage.removeItem(PRIMARY_BATCH_STORAGE_KEY);
  };

  const selectAdditionsFile = (selectedFile) => {
    if (!selectedFile) return;

    if (!isValidExcelFile(selectedFile)) {
      setAdditionsFile(null);
      setAdditionsResult(null);
      setAdditionsError(t.invalidFile);
      return;
    }

    setAdditionsFile(selectedFile);
    setAdditionsResult(null);
    setAdditionsError(null);
    setAdditionsBatchId(null);
    setAdditionsBatchStatus(null);
    setAdditionsStartedAtMs(null);
    setAdditionsFinishedAtMs(null);
    sessionStorage.removeItem(ADDITIONS_BATCH_STORAGE_KEY);
  };

  const resetPrimary = (event) => {
    event?.stopPropagation();
    setFile(null);
    setUploadResult(null);
    setError(null);
    setBatchId(null);
    setBatchStatus(null);
    setStartedAtMs(null);
    setFinishedAtMs(null);
    setShowDetails(false);
    sessionStorage.removeItem(PRIMARY_BATCH_STORAGE_KEY);

    const input = document.getElementById('primary-file-input');
    if (input) input.value = '';
  };

  const resetAdditions = (event) => {
    event?.stopPropagation();
    setAdditionsFile(null);
    setAdditionsResult(null);
    setAdditionsError(null);
    setAdditionsBatchId(null);
    setAdditionsBatchStatus(null);
    setAdditionsStartedAtMs(null);
    setAdditionsFinishedAtMs(null);
    sessionStorage.removeItem(ADDITIONS_BATCH_STORAGE_KEY);

    const input = document.getElementById('additions-file-input');
    if (input) input.value = '';
  };

  const handleUpload = async () => {
    if (!file || uploading) return;

    setError(null);
    setUploadResult(null);
    setShowDetails(false);

    let newBatchId = null;
    try {
      const initData = await uploadAPI.initBatch('main');
      newBatchId = initData.batch_id;
      setBatchId(newBatchId);
      setBatchStatus(initData.status);
      setStartedAtMs(null);
      setFinishedAtMs(null);
      sessionStorage.setItem(PRIMARY_BATCH_STORAGE_KEY, String(newBatchId));

      await uploadAPI.uploadExcel(file, newBatchId);

      const finalStatus = await uploadAPI.getBatchStatus(newBatchId);
      applyBatchStatus(finalStatus);
    } catch (err) {
      setError(err?.message || t.uploadError);
      if (newBatchId) {
        uploadAPI.getBatchStatus(newBatchId).then(applyBatchStatus).catch(() => {});
      }
    }
  };

  const handleUploadAdditions = async () => {
    if (!additionsFile || uploadingAdditions) return;

    setAdditionsError(null);
    setAdditionsResult(null);

    let newBatchId = null;
    try {
      const initData = await uploadAPI.initBatch('additions');
      newBatchId = initData.batch_id;
      setAdditionsBatchId(newBatchId);
      setAdditionsBatchStatus(initData.status);
      setAdditionsStartedAtMs(null);
      setAdditionsFinishedAtMs(null);
      sessionStorage.setItem(ADDITIONS_BATCH_STORAGE_KEY, String(newBatchId));

      await uploadAPI.uploadAdditionsExcel(additionsFile, newBatchId);

      const finalStatus = await uploadAPI.getBatchStatus(newBatchId);
      applyAdditionsBatchStatus(finalStatus);
    } catch (err) {
      setAdditionsError(err?.message || t.uploadError);
      if (newBatchId) {
        uploadAPI.getBatchStatus(newBatchId).then(applyAdditionsBatchStatus).catch(() => {});
      }
    }
  };

  const handleStop = async () => {
    if (!batchId || actionBusy) return;
    setActionBusy(true);
    try {
      applyBatchStatus(await uploadAPI.stopBatch(batchId));
    } catch (err) {
      setError(err?.message || t.stopError);
    } finally {
      setActionBusy(false);
    }
  };

  const handleStopAndDelete = async () => {
    if (!batchId || actionBusy) return;
    if (!window.confirm(t.confirmStopAndDelete)) return;
    setActionBusy(true);
    try {
      applyBatchStatus(await uploadAPI.stopAndDeleteBatch(batchId));
    } catch (err) {
      setError(err?.message || t.stopError);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteCreated = async () => {
    if (!batchId || actionBusy) return;
    if (!window.confirm(t.confirmDelete)) return;
    setActionBusy(true);
    try {
      applyBatchStatus(await uploadAPI.deleteBatch(batchId));
    } catch (err) {
      setError(err?.message || t.deleteError);
    } finally {
      setActionBusy(false);
    }
  };

  const handleStopAdditions = async () => {
    if (!additionsBatchId || additionsActionBusy) return;
    setAdditionsActionBusy(true);
    try {
      applyAdditionsBatchStatus(await uploadAPI.stopBatch(additionsBatchId));
    } catch (err) {
      setAdditionsError(err?.message || t.stopError);
    } finally {
      setAdditionsActionBusy(false);
    }
  };

  const handleStopAndDeleteAdditions = async () => {
    if (!additionsBatchId || additionsActionBusy) return;
    if (!window.confirm(t.confirmStopAndDelete)) return;
    setAdditionsActionBusy(true);
    try {
      applyAdditionsBatchStatus(await uploadAPI.stopAndDeleteBatch(additionsBatchId));
    } catch (err) {
      setAdditionsError(err?.message || t.stopError);
    } finally {
      setAdditionsActionBusy(false);
    }
  };

  const handleDeleteCreatedAdditions = async () => {
    if (!additionsBatchId || additionsActionBusy) return;
    if (!window.confirm(t.confirmDelete)) return;
    setAdditionsActionBusy(true);
    try {
      applyAdditionsBatchStatus(await uploadAPI.deleteBatch(additionsBatchId));
    } catch (err) {
      setAdditionsError(err?.message || t.deleteError);
    } finally {
      setAdditionsActionBusy(false);
    }
  };

  const getStatus = ({ isUploading, batchStatus: rawStatus, result, currentError, selectedFile }) => {
    if (isUploading) return { label: t.uploading, className: 'processing' };
    if (rawStatus === 'stopped') return { label: t.stopped, className: 'error' };
    if (result?.success) return { label: t.completed, className: 'success' };
    if (currentError) return { label: t.failed, className: 'error' };
    if (selectedFile) return { label: t.ready, className: 'ready' };
    return { label: t.waiting, className: 'idle' };
  };

  const primaryStatus = getStatus({
    isUploading: uploading,
    batchStatus,
    result: uploadResult,
    currentError: error,
    selectedFile: file,
  });

  const additionsStatus = getStatus({
    isUploading: uploadingAdditions,
    batchStatus: additionsBatchStatus,
    result: additionsResult,
    currentError: additionsError,
    selectedFile: additionsFile,
  });

  const renderMiniStat = (label, value, className = '') => (
    <div className={`mini-stat ${className}`}>
      <strong>{value ?? 0}</strong>
      <span>{label}</span>
    </div>
  );

  const toNumber = (value) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  };

  const getDirectCount = (source, keys) => {
    if (!source || typeof source !== 'object') return 0;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return toNumber(source[key]);
      }
    }

    return 0;
  };

  const includesAnyKeyword = (textValue, keywords) => {
    const normalized = String(textValue || '').toLowerCase();
    return keywords.some((keyword) =>
      normalized.includes(String(keyword).toLowerCase())
    );
  };

  const countByKeywords = (source, keywords) => {
    if (!source || typeof source !== 'object') return 0;

    return Object.entries(source).reduce((sum, [key, value]) => {
      if (typeof value === 'object' && value !== null) {
        const nestedName =
          value.name ||
          value.label ||
          value.housing_type ||
          value.description ||
          key;

        if (includesAnyKeyword(nestedName, keywords)) {
          return sum + toNumber(
            value.count ??
            value.total ??
            value.students ??
            value.accepted ??
            0
          );
        }

        return sum;
      }

      if (includesAnyKeyword(key, keywords)) {
        return sum + toNumber(value);
      }

      return sum;
    }, 0);
  };

  const dormTypeSummaryRows = useMemo(() => {
    const summarySource =
      additionsResult?.dorm_type_acceptance_summary ||
      additionsResult?.dorm_type_summary ||
      additionsResult?.accepted_by_dorm_type ||
      additionsResult?.housing_type_summary ||
      additionsResult?.dorm_type_breakdown ||
      additionsResult?.additions_by_dorm_type ||
      null;

    if (!summarySource) return [];

    const rows = Array.isArray(summarySource)
      ? summarySource
      : Object.entries(summarySource).map(([dormTypeName, value]) => ({
          dorm_type_name: dormTypeName,
          ...(typeof value === 'object' && value !== null
            ? value
            : { total: value }),
        }));

    return rows
      .map((item, index) => {
        const housingSource =
          item.housing_types ||
          item.housing_type_counts ||
          item.residence_type_counts ||
          item.accepted_by_housing_type ||
          item.counts ||
          item;

        const singles = Math.max(
          getDirectCount(item, [
            'singles',
            'single_students',
            'single_count',
            'accepted_singles',
            'bachelors',
            'רווקים',
            'רווקות',
            'רווקים_רווקות',
          ]),
          countByKeywords(housingSource, [
            'רווקים',
            'רווקות',
            'single',
            'bachelor',
          ])
        );

        const sharedSingles = Math.max(
          getDirectCount(item, [
            'shared_singles',
            'singles_in_couple_apartments',
            'single_in_couple_apartment',
            'singles_in_shared_apartments',
            'רווקים_בדירת_זוגות',
          ]),
          countByKeywords(housingSource, [
            'רווקים/ות בדירה',
            'רווקים בדירה',
            'רווקות בדירה',
            'shared',
            'couple apartment',
          ])
        );

        const couples = Math.max(
          getDirectCount(item, [
            'couples',
            'couple_students',
            'couple_count',
            'accepted_couples',
            'זוגות',
          ]),
          countByKeywords(housingSource, ['זוגות', 'couple'])
        );

        const families = Math.max(
          getDirectCount(item, [
            'families',
            'family_students',
            'family_count',
            'accepted_families',
            'משפחות',
          ]),
          countByKeywords(housingSource, ['משפחות', 'family'])
        );

        const total = toNumber(
          item.total_accepted ??
          item.total_students ??
          item.total ??
          item.count ??
          item.accepted ??
          singles + sharedSingles + couples + families
        );

        return {
          id:
            item.dorm_type_id ??
            item.id ??
            `${item.dorm_type_name || item.name || 'dorm'}-${index}`,
          name:
            item.dorm_type_name ||
            item.dorm_type ||
            item.name ||
            item.label ||
            item.region_name ||
            `#${index + 1}`,
          total,
          singles,
          sharedSingles,
          couples,
          families,
        };
      })
      .filter(
        (row) =>
          row.name &&
          (
            row.total ||
            row.singles ||
            row.sharedSingles ||
            row.couples ||
            row.families
          )
      );
  }, [additionsResult]);

  const hasRegions =
    Array.isArray(uploadResult?.region_breakdown) &&
    uploadResult.region_breakdown.length > 0;

  const hasSheetCounts =
    uploadResult?.sheet_counts &&
    Object.keys(uploadResult.sheet_counts).length > 0;

  const hasSkippedReasons =
    uploadResult?.skipped_by_reason &&
    Object.keys(uploadResult.skipped_by_reason).length > 0;

  const hasErrors =
    Array.isArray(uploadResult?.errors) &&
    uploadResult.errors.length > 0;

  const hasPrimaryDetails =
    hasRegions || hasSheetCounts || hasSkippedReasons || hasErrors;

  if (!canUploadExcel()) {
    return (
      <div className={`upload-page ${isHebrew ? 'rtl' : 'ltr'}`}>
        <section className="access-card">
          <AlertCircle size={36} />
          <h1>{t.noAccess}</h1>
          <p>{t.accessHint}</p>
        </section>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className={`upload-page ${isHebrew ? 'rtl' : 'ltr'}`}>
      <header className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </header>

      <main className="files-grid">
        <section className="file-card primary-card">
          <div className="card-heading">
            <div className="card-title-wrap">
              <span className="type-icon primary-icon">
                <Database size={22} />
              </span>
              <div>
                <h2>{t.primaryTitle}</h2>
                <p>{t.primaryHint}</p>
              </div>
            </div>

            <span className={`status-badge ${primaryStatus.className}`}>
              <span className="status-dot" />
              {primaryStatus.label}
            </span>
          </div>

          <div
            className={`drop-zone primary-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!uploading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              if (!uploading) selectPrimaryFile(event.dataTransfer.files[0]);
            }}
            onClick={() => {
              if (!uploading) {
                document.getElementById('primary-file-input')?.click();
              }
            }}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && !uploading) {
                event.preventDefault();
                document.getElementById('primary-file-input')?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <input
              id="primary-file-input"
              type="file"
              accept=".xlsx,.xls"
              hidden
              onChange={(event) => selectPrimaryFile(event.target.files[0])}
            />

            {file ? (
              <div className="selected-file">
                <span className="file-icon primary-file-icon">
                  <FileSpreadsheet size={28} />
                </span>
                <div className="file-meta">
                  <span>{t.selectedFile}</span>
                  <strong>{file.name}</strong>
                  <small>{(file.size / 1024).toFixed(1)} KB</small>
                </div>
                {!uploading && (
                  <button
                    className="remove-button"
                    type="button"
                    onClick={resetPrimary}
                    aria-label={t.removeFile}
                    title={t.removeFile}
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-drop">
                <Upload size={30} />
                <strong>{t.chooseFile}</strong>
                <span>{t.excelOnly}</span>
              </div>
            )}
          </div>

          {file && !uploadResult?.success && (
            <button
              className="upload-button primary-button"
              type="button"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? <Loader size={19} className="spin" /> : <Upload size={19} />}
              {uploading ? t.uploading : t.upload}
            </button>
          )}

          {(uploading || displayElapsed > 0) && (
            <div className={`timer-row ${uploading ? 'active' : ''}`}>
              <Clock3 size={17} />
              <strong dir="ltr">{formattedElapsed}</strong>
              {uploading && (
                <div className="activity-line">
                  <span />
                </div>
              )}
            </div>
          )}

          {uploading && (
            <div className="batch-controls">
              {batchStatus === 'processing' && (
                <button
                  type="button"
                  className="control-button stop-button"
                  onClick={handleStop}
                  disabled={actionBusy}
                >
                  <StopCircle size={16} />
                  {t.stopButton}
                </button>
              )}
              {(batchStatus === 'processing' || batchStatus === 'cancellation_requested') && (
                <button
                  type="button"
                  className="control-button stop-delete-button"
                  onClick={handleStopAndDelete}
                  disabled={actionBusy}
                >
                  <XOctagon size={16} />
                  {t.stopAndDeleteButton}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="message error-message">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {uploadResult?.success && (
            <div className={`result-box success-result ${uploadResult.stopped ? 'stopped-result' : ''}`}>
              <div className="result-title">
                {uploadResult.stopped ? <StopCircle size={20} /> : <Check size={20} />}
                <div>
                  <strong>{uploadResult.stopped ? t.stoppedMessage : t.primarySuccess}</strong>
                  {uploadResult.batch_id && (
                    <span>{t.batchId}: #{uploadResult.batch_id}</span>
                  )}
                </div>
              </div>

              <div className="stats-grid">
                {renderMiniStat(t.totalStudents, uploadResult.total_students, 'highlight')}
                {renderMiniStat(t.created, uploadResult.created)}
                {renderMiniStat(t.updated, uploadResult.updated)}
                {renderMiniStat(
                  t.skipped,
                  uploadResult.skipped,
                  uploadResult.skipped > 0 ? 'warning' : ''
                )}
              </div>

              {uploadResult.deletion && (
                <div className="deletion-outcome">
                  <h3>{t.deletionOutcome}</h3>
                  <div className="detail-row">
                    <span>{t.deletedCount}</span>
                    <strong>{uploadResult.deletion.deleted_count}</strong>
                  </div>
                  {uploadResult.deletion.protected_count > 0 && (
                    <div className="detail-row">
                      <span>{t.protectedCount}</span>
                      <strong>{uploadResult.deletion.protected_count}</strong>
                    </div>
                  )}
                </div>
              )}

              {!uploadResult.deletion && (uploadResult.created > 0) && (
                <button
                  type="button"
                  className="control-button delete-created-button"
                  onClick={handleDeleteCreated}
                  disabled={actionBusy}
                >
                  <Trash2 size={16} />
                  {t.deleteCreatedButton}
                </button>
              )}
              <p className="delete-note">{t.deleteNote}</p>

              {hasPrimaryDetails && (
                <>
                  <button
                    className="details-button"
                    type="button"
                    onClick={() => setShowDetails((current) => !current)}
                  >
                    {t.details}
                    {showDetails ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                  </button>

                  {showDetails && (
                    <div className="details-panel">
                      {hasRegions && (
                        <div className="detail-group">
                          <h3>{t.splitByRegion}</h3>
                          {uploadResult.region_breakdown.map((item) => (
                            <div
                              className="detail-row"
                              key={`${item.region_id}-${item.region_name}`}
                            >
                              <span>{item.region_name}</span>
                              <strong>{item.count}</strong>
                            </div>
                          ))}
                        </div>
                      )}

                      {hasSheetCounts && (
                        <div className="detail-group">
                          <h3>{t.sheetSummary}</h3>
                          {Object.entries(uploadResult.sheet_counts).map(
                            ([sheetName, info]) => (
                              <div className="sheet-item" key={sheetName}>
                                <strong>{sheetName}</strong>
                                {typeof info === 'object' && info !== null ? (
                                  <div className="sheet-values">
                                    <span>{t.rows}: {info.rows ?? 0}</span>
                                    <span>{t.created}: {info.created ?? 0}</span>
                                    <span>{t.updated}: {info.updated ?? 0}</span>
                                    <span>{t.skipped}: {info.skipped ?? 0}</span>
                                  </div>
                                ) : (
                                  <span>{String(info)}</span>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {hasSkippedReasons && (
                        <div className="detail-group">
                          <h3>{t.skippedReasons}</h3>
                          {Object.entries(uploadResult.skipped_by_reason).map(
                            ([reason, count]) => (
                              <div className="detail-row" key={reason}>
                                <span>{reason}</span>
                                <strong>{count}</strong>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {hasErrors && (
                        <div className="detail-group error-group">
                          <h3>{t.technicalErrors}</h3>
                          <ul>
                            {uploadResult.errors.slice(0, 8).map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <button className="reset-button" type="button" onClick={resetPrimary}>
                {t.uploadAnother}
              </button>
            </div>
          )}
        </section>

        <section className="file-card additions-card">
          <div className="card-heading">
            <div className="card-title-wrap">
              <span className="type-icon additions-icon">
                <UserPlus size={22} />
              </span>
              <div>
                <h2>{t.additionsTitle}</h2>
                <p>{t.additionsHint}</p>
              </div>
            </div>

            <span className={`status-badge ${additionsStatus.className}`}>
              <span className="status-dot" />
              {additionsStatus.label}
            </span>
          </div>

          <div
            className={`drop-zone additions-zone ${additionsDragOver ? 'drag-over' : ''} ${additionsFile ? 'has-file' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!uploadingAdditions) setAdditionsDragOver(true);
            }}
            onDragLeave={() => setAdditionsDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setAdditionsDragOver(false);
              if (!uploadingAdditions) {
                selectAdditionsFile(event.dataTransfer.files[0]);
              }
            }}
            onClick={() => {
              if (!uploadingAdditions) {
                document.getElementById('additions-file-input')?.click();
              }
            }}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && !uploadingAdditions) {
                event.preventDefault();
                document.getElementById('additions-file-input')?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <input
              id="additions-file-input"
              type="file"
              accept=".xlsx,.xls"
              hidden
              onChange={(event) => selectAdditionsFile(event.target.files[0])}
            />

            {additionsFile ? (
              <div className="selected-file">
                <span className="file-icon additions-file-icon">
                  <FileSpreadsheet size={28} />
                </span>
                <div className="file-meta">
                  <span>{t.selectedFile}</span>
                  <strong>{additionsFile.name}</strong>
                  <small>{(additionsFile.size / 1024).toFixed(1)} KB</small>
                </div>
                {!uploadingAdditions && (
                  <button
                    className="remove-button"
                    type="button"
                    onClick={resetAdditions}
                    aria-label={t.removeFile}
                    title={t.removeFile}
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-drop">
                <Upload size={30} />
                <strong>{t.chooseFile}</strong>
                <span>{t.excelOnly}</span>
              </div>
            )}
          </div>

          {additionsFile && !additionsResult?.success && (
            <button
              className="upload-button additions-button"
              type="button"
              onClick={handleUploadAdditions}
              disabled={uploadingAdditions}
            >
              {uploadingAdditions ? <Loader size={19} className="spin" /> : <Upload size={19} />}
              {uploadingAdditions ? t.uploading : t.upload}
            </button>
          )}

          {(uploadingAdditions || additionsDisplayElapsed > 0) && (
            <div className={`timer-row additions-timer ${uploadingAdditions ? 'active' : ''}`}>
              <Clock3 size={17} />
              <strong dir="ltr">{formattedAdditionsElapsed}</strong>
              {uploadingAdditions && (
                <div className="activity-line">
                  <span />
                </div>
              )}
            </div>
          )}

          {uploadingAdditions && (
            <div className="batch-controls">
              {additionsBatchStatus === 'processing' && (
                <button
                  type="button"
                  className="control-button stop-button"
                  onClick={handleStopAdditions}
                  disabled={additionsActionBusy}
                >
                  <StopCircle size={16} />
                  {t.stopButton}
                </button>
              )}
              {(additionsBatchStatus === 'processing' || additionsBatchStatus === 'cancellation_requested') && (
                <button
                  type="button"
                  className="control-button stop-delete-button"
                  onClick={handleStopAndDeleteAdditions}
                  disabled={additionsActionBusy}
                >
                  <XOctagon size={16} />
                  {t.stopAndDeleteButton}
                </button>
              )}
            </div>
          )}

          {additionsError && (
            <div className="message error-message">
              <AlertCircle size={20} />
              <span>{additionsError}</span>
            </div>
          )}

          {additionsResult?.success && (
            <div className={`result-box success-result ${additionsResult.stopped ? 'stopped-result' : ''}`}>
              <div className="result-title">
                {additionsResult.stopped ? <StopCircle size={20} /> : <Check size={20} />}
                <div>
                  <strong>{additionsResult.stopped ? t.stoppedMessage : t.additionsSuccess}</strong>
                  {additionsResult.batch_id && (
                    <span>{t.batchId}: #{additionsResult.batch_id}</span>
                  )}
                </div>
              </div>

              <div className="stats-grid">
                {renderMiniStat(
                  t.totalStudents,
                  additionsResult.total_students,
                  'highlight additions-highlight'
                )}
                {renderMiniStat(t.created, additionsResult.created)}
                {renderMiniStat(t.updated, additionsResult.updated)}
                {renderMiniStat(
                  t.skipped,
                  additionsResult.skipped,
                  additionsResult.skipped > 0 ? 'warning' : ''
                )}
              </div>

              {additionsResult.deletion && (
                <div className="deletion-outcome">
                  <h3>{t.deletionOutcome}</h3>
                  <div className="detail-row">
                    <span>{t.deletedCount}</span>
                    <strong>{additionsResult.deletion.deleted_count}</strong>
                  </div>
                  {additionsResult.deletion.protected_count > 0 && (
                    <div className="detail-row">
                      <span>{t.protectedCount}</span>
                      <strong>{additionsResult.deletion.protected_count}</strong>
                    </div>
                  )}
                </div>
              )}

              {!additionsResult.deletion && (additionsResult.created > 0) && (
                <button
                  type="button"
                  className="control-button delete-created-button"
                  onClick={handleDeleteCreatedAdditions}
                  disabled={additionsActionBusy}
                >
                  <Trash2 size={16} />
                  {t.deleteCreatedButton}
                </button>
              )}
              <p className="delete-note">{t.deleteNote}</p>

              {additionsResult.existing_category_preserved !== undefined && (
                <div className="preserved-note">
                  <Check size={16} />
                  <span>
                    {t.preserved} {additionsResult.existing_category_preserved} {t.students}
                  </span>
                </div>
              )}

              {dormTypeSummaryRows.length > 0 && (
                <div className="dorm-type-summary">
                  <h3>{t.dormTypeAcceptanceSummary}</h3>

                  <div className="dorm-summary-list">
                    {dormTypeSummaryRows.map((row) => (
                      <div className="dorm-summary-card" key={row.id}>
                        <div className="dorm-summary-header">
                          <strong>{row.name}</strong>
                          <span>
                            {t.totalAccepted}: <b>{row.total}</b>
                          </span>
                        </div>

                        <div className="dorm-summary-grid">
                          {renderMiniStat(t.singlesAccepted, row.singles)}
                          {renderMiniStat(t.sharedApartmentSingles, row.sharedSingles)}
                          {renderMiniStat(t.couplesApartments, row.couples)}
                          {renderMiniStat(t.familiesApartments, row.families)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button className="reset-button" type="button" onClick={resetAdditions}>
                {t.uploadAnother}
              </button>
            </div>
          )}
        </section>
      </main>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  :root {
    --page-bg: #f5f7fb;
    --surface: #ffffff;
    --text: #122033;
    --muted: #64748b;
    --border: #e2e8f0;
    --primary: #2563eb;
    --primary-soft: #eff6ff;
    --teal: #0f766e;
    --teal-soft: #f0fdfa;
    --success: #15803d;
    --success-soft: #f0fdf4;
    --danger: #b91c1c;
    --danger-soft: #fff1f2;
    --warning: #a16207;
    --warning-soft: #fffbeb;
  }

  * {
    box-sizing: border-box;
  }

  .upload-page {
    min-height: 100%;
    padding: 24px;
    color: var(--text);
    background:
      radial-gradient(circle at 8% 0%, rgba(37, 99, 235, 0.08), transparent 28%),
      radial-gradient(circle at 100% 90%, rgba(15, 118, 110, 0.07), transparent 25%),
      var(--page-bg);
  }

  .upload-page.rtl {
    direction: rtl;
  }

  .upload-page.ltr {
    direction: ltr;
  }

  .page-header {
    max-width: 1240px;
    margin: 0 auto 18px;
    padding: 4px 2px;
  }

  .page-header h1 {
    margin: 0;
    color: #0f172a;
    font-size: clamp(26px, 3vw, 34px);
    font-weight: 900;
    letter-spacing: -0.035em;
  }

  .page-header p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 14px;
    font-weight: 650;
  }

  .files-grid {
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    align-items: start;
  }

  .file-card {
    min-width: 0;
    padding: 20px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07);
  }

  .primary-card {
    border-top: 4px solid #60a5fa;
  }

  .additions-card {
    border-top: 4px solid #2dd4bf;
  }

  .card-heading {
    min-height: 58px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .card-title-wrap {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .type-icon {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .primary-icon {
    color: #1d4ed8;
    background: #dbeafe;
  }

  .additions-icon {
    color: var(--teal);
    background: #ccfbf1;
  }

  .card-heading h2 {
    margin: 0;
    color: #0f172a;
    font-size: 19px;
    font-weight: 900;
  }

  .card-heading p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 999px;
    color: #64748b;
    background: #f1f5f9;
    font-size: 11px;
    font-weight: 850;
    white-space: nowrap;
  }

  .status-badge .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  .status-badge.ready {
    color: #1d4ed8;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .status-badge.processing {
    color: #7c3aed;
    background: #f5f3ff;
    border-color: #ddd6fe;
  }

  .status-badge.success {
    color: var(--success);
    background: #f0fdf4;
    border-color: #bbf7d0;
  }

  .status-badge.error {
    color: var(--danger);
    background: #fff1f2;
    border-color: #fecdd3;
  }

  .drop-zone {
    min-height: 172px;
    padding: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed #cbd5e1;
    border-radius: 20px;
    background: #f8fafc;
    outline: none;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .drop-zone:hover,
  .drop-zone:focus-visible,
  .drop-zone.drag-over {
    transform: translateY(-1px);
  }

  .primary-zone:hover,
  .primary-zone:focus-visible,
  .primary-zone.drag-over {
    border-color: #60a5fa;
    background: var(--primary-soft);
  }

  .additions-zone:hover,
  .additions-zone:focus-visible,
  .additions-zone.drag-over {
    border-color: #2dd4bf;
    background: var(--teal-soft);
  }

  .drop-zone.has-file {
    min-height: 100px;
    padding: 17px;
    border-style: solid;
    background: #ffffff;
  }

  .primary-zone.has-file {
    border-color: #bfdbfe;
  }

  .additions-zone.has-file {
    border-color: #99f6e4;
  }

  .empty-drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    text-align: center;
    color: #64748b;
  }

  .primary-zone .empty-drop svg {
    color: var(--primary);
  }

  .additions-zone .empty-drop svg {
    color: var(--teal);
  }

  .empty-drop strong {
    color: #334155;
    font-size: 14px;
    font-weight: 850;
  }

  .empty-drop span {
    color: #94a3b8;
    font-size: 12px;
    font-weight: 700;
  }

  .selected-file {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .file-icon {
    width: 48px;
    height: 48px;
    border-radius: 15px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .primary-file-icon {
    color: #1d4ed8;
    background: #dbeafe;
  }

  .additions-file-icon {
    color: var(--teal);
    background: #ccfbf1;
  }

  .file-meta {
    min-width: 0;
    flex: 1;
  }

  .file-meta > span {
    display: block;
    margin-bottom: 3px;
    color: #94a3b8;
    font-size: 10px;
    font-weight: 800;
  }

  .file-meta strong {
    display: block;
    overflow: hidden;
    color: #0f172a;
    font-size: 13px;
    font-weight: 850;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta small {
    color: #94a3b8;
    font-size: 11px;
    font-weight: 700;
  }

  .remove-button {
    width: 34px;
    height: 34px;
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    border: 0;
    border-radius: 11px;
    color: #64748b;
    background: #f1f5f9;
    cursor: pointer;
  }

  .remove-button:hover {
    color: var(--danger);
    background: #fee2e2;
  }

  .upload-button {
    width: 100%;
    min-height: 46px;
    margin-top: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 0;
    border-radius: 15px;
    color: #ffffff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
    transition: transform 0.18s ease, filter 0.18s ease;
  }

  .upload-button:hover:not(:disabled) {
    transform: translateY(-1px);
    filter: brightness(0.98);
  }

  .upload-button:disabled {
    opacity: 0.75;
    cursor: wait;
  }

  .primary-button {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    box-shadow: 0 12px 24px rgba(37, 99, 235, 0.18);
  }

  .additions-button {
    background: linear-gradient(135deg, #14b8a6, #0f766e);
    box-shadow: 0 12px 24px rgba(15, 118, 110, 0.18);
  }

  .timer-row {
    margin-top: 10px;
    min-height: 42px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 8px;
    border: 1px solid #dbeafe;
    border-radius: 13px;
    color: #1d4ed8;
    background: #eff6ff;
  }

  .additions-timer {
    color: var(--teal);
    border-color: #99f6e4;
    background: var(--teal-soft);
  }

  .timer-row strong {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .activity-line {
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.12);
  }

  .additions-timer .activity-line {
    background: rgba(15, 118, 110, 0.12);
  }

  .activity-line span {
    width: 38%;
    height: 100%;
    display: block;
    border-radius: inherit;
    background: currentColor;
    animation: activity 1.25s ease-in-out infinite;
  }

  @keyframes activity {
    from { transform: translateX(-120%); }
    to { transform: translateX(320%); }
  }

  .message,
  .result-box {
    margin-top: 12px;
    border-radius: 16px;
  }

  .message {
    padding: 12px;
    display: flex;
    align-items: flex-start;
    gap: 9px;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.5;
  }

  .error-message {
    color: var(--danger);
    border: 1px solid #fecdd3;
    background: var(--danger-soft);
  }

  .batch-controls {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .control-button {
    min-height: 38px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid transparent;
    border-radius: 12px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
    transition: filter 0.18s ease;
  }

  .control-button:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .control-button:hover:not(:disabled) {
    filter: brightness(0.97);
  }

  .stop-button {
    color: var(--warning);
    border-color: #fde68a;
    background: var(--warning-soft);
  }

  .stop-delete-button,
  .delete-created-button {
    color: var(--danger);
    border-color: #fecdd3;
    background: var(--danger-soft);
  }

  .delete-created-button {
    width: 100%;
    justify-content: center;
    margin-top: 12px;
  }

  .delete-note {
    margin: 8px 0 0;
    color: #64748b;
    font-size: 10px;
    line-height: 1.5;
  }

  .deletion-outcome {
    margin-top: 12px;
    padding: 11px;
    border: 1px solid #fecdd3;
    border-radius: 12px;
    background: #fff7f8;
  }

  .deletion-outcome h3 {
    margin: 0 0 8px;
    color: var(--danger);
    font-size: 11px;
    font-weight: 900;
  }

  .result-box {
    padding: 14px;
    border: 1px solid #bbf7d0;
    background: var(--success-soft);
  }

  .result-box.stopped-result {
    border-color: #fde68a;
    background: var(--warning-soft);
  }

  .stopped-result .result-title {
    color: var(--warning);
  }

  .stopped-result .result-title strong {
    color: #92400e;
  }

  .result-title {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    color: var(--success);
  }

  .result-title strong {
    display: block;
    color: #166534;
    font-size: 13px;
    font-weight: 900;
  }

  .result-title span {
    display: block;
    margin-top: 2px;
    color: #4d7c5a;
    font-size: 11px;
    font-weight: 750;
  }

  .stats-grid {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }

  .mini-stat {
    min-width: 0;
    padding: 10px 6px;
    border: 1px solid #dcfce7;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.9);
    text-align: center;
  }

  .mini-stat.highlight {
    border-color: #bfdbfe;
    background: #eff6ff;
  }

  .mini-stat.additions-highlight {
    border-color: #99f6e4;
    background: var(--teal-soft);
  }

  .mini-stat.warning {
    border-color: #fde68a;
    background: var(--warning-soft);
  }

  .mini-stat strong {
    display: block;
    overflow: hidden;
    color: #0f172a;
    font-size: 19px;
    font-weight: 900;
    text-overflow: ellipsis;
  }

  .mini-stat span {
    display: block;
    margin-top: 3px;
    color: #64748b;
    font-size: 10px;
    font-weight: 800;
  }

  .details-button,
  .reset-button {
    min-height: 38px;
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    color: #334155;
    background: #ffffff;
    font-family: inherit;
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
  }

  .details-button {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }

  .reset-button {
    width: 100%;
  }

  .details-button:hover,
  .reset-button:hover {
    color: #1d4ed8;
    border-color: #bfdbfe;
    background: #eff6ff;
  }

  .details-panel {
    margin-top: 10px;
    display: grid;
    gap: 9px;
  }

  .detail-group {
    padding: 11px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #ffffff;
  }

  .detail-group h3 {
    margin: 0 0 8px;
    color: #334155;
    font-size: 11px;
    font-weight: 900;
  }

  .detail-row {
    padding: 7px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid #f1f5f9;
    color: #64748b;
    font-size: 11px;
  }

  .detail-row:last-child {
    border-bottom: 0;
  }

  .detail-row strong {
    color: #0f172a;
  }

  .sheet-item {
    padding: 8px;
    border-radius: 10px;
    background: #f8fafc;
  }

  .sheet-item + .sheet-item {
    margin-top: 7px;
  }

  .sheet-item > strong {
    display: block;
    margin-bottom: 6px;
    color: #334155;
    font-size: 11px;
  }

  .sheet-values {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .sheet-values span {
    padding: 6px;
    border-radius: 8px;
    color: #64748b;
    background: #ffffff;
    font-size: 10px;
    text-align: center;
  }

  .error-group {
    border-color: #fecdd3;
    background: #fff7f8;
  }

  .error-group ul {
    margin: 0;
    padding-inline-start: 17px;
    color: var(--danger);
    font-size: 10px;
    line-height: 1.6;
  }

  .preserved-note {
    margin-top: 10px;
    padding: 9px 10px;
    display: flex;
    align-items: center;
    gap: 7px;
    border-radius: 11px;
    color: #0f766e;
    background: #ccfbf1;
    font-size: 11px;
    font-weight: 800;
  }

  .dorm-type-summary {
    margin-top: 12px;
    padding: 12px;
    border: 1px solid #99f6e4;
    border-radius: 14px;
    background: #ffffff;
  }

  .dorm-type-summary h3 {
    margin: 0 0 10px;
    color: #0f766e;
    font-size: 12px;
    font-weight: 900;
  }

  .dorm-summary-list {
    display: grid;
    gap: 10px;
  }

  .dorm-summary-card {
    padding: 10px;
    border: 1px solid #ccfbf1;
    border-radius: 13px;
    background: #f8fffd;
  }

  .dorm-summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }

  .dorm-summary-header strong {
    color: #0f172a;
    font-size: 12px;
    font-weight: 900;
  }

  .dorm-summary-header span {
    color: #0f766e;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
  }

  .dorm-summary-header b {
    color: #0f172a;
  }

  .dorm-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }

  .access-card {
    max-width: 500px;
    margin: 90px auto;
    padding: 34px;
    border: 1px solid #fecdd3;
    border-radius: 22px;
    color: var(--danger);
    background: #ffffff;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07);
    text-align: center;
  }

  .access-card h1 {
    margin: 12px 0 6px;
    color: #0f172a;
    font-size: 22px;
  }

  .access-card p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    .files-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 560px) {
    .upload-page {
      padding: 15px;
    }

    .file-card {
      padding: 16px;
      border-radius: 20px;
    }

    .card-heading {
      flex-direction: column;
      align-items: stretch;
    }

    .status-badge {
      width: fit-content;
    }

    .drop-zone {
      min-height: 150px;
    }

    .stats-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dorm-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dorm-summary-header {
      align-items: flex-start;
      flex-direction: column;
    }
  }
`;

export default UploadPage;