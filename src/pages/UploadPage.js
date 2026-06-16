import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { uploadAPI } from '../services/api';
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Download,
  X,
  Loader
} from 'lucide-react';

function UploadPage({ language }) {
  const { canUploadExcel } = useAuth();

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

   // Additions file states
  const [additionsFile, setAdditionsFile] = useState(null);
  const [uploadingAdditions, setUploadingAdditions] = useState(false);
  const [additionsResult, setAdditionsResult] = useState(null);
  const [additionsError, setAdditionsError] = useState(null);
  const [additionsDragOver, setAdditionsDragOver] = useState(false);

  const isHebrew = language === 'he';

  const t = {
    he: {
      title: 'העלאת קובץ שיבוץ',
      subtitle: 'ייבוא קובץ המעונות הרשמי, בדיקת הנתונים וחלוקה לפי אזורים',
      additionsTitle: 'העלאת קובץ מתווספים',
      additionsSubtitle: 'קובץ זה מוסיף סטודנטים עם החלטה חיובית ומשלים מידע לסטודנטים קיימים',
      additionsUpload: 'התחל ייבוא קובץ מתווספים',
      additionsUploading: 'קובץ המתווספים בתהליך עיבוד...',
      additionsSuccess: 'קובץ המתווספים הועלה ועובד בהצלחה',
      eyebrow: 'ניהול נתוני שיבוץ',
      template: 'הורד תבנית',
      dropTitle: 'גרור קובץ לכאן או לחץ לבחירה',
      dropSubtitle: 'תומך בקבצי Excel מסוג .xlsx או .xls',
      selectedFile: 'קובץ נבחר',
      removeFile: 'הסר קובץ',
      upload: 'התחל ייבוא וחלוקה לפי אזורים',
      uploading: 'הקובץ בתהליך עיבוד...',
      uploadingHelp: 'נא להשאיר את החלון פתוח עד לקבלת תוצאה. קובץ גדול עשוי לקחת יותר זמן.',
      longUploadTitle: 'העיבוד עשוי להימשך מספר דקות',
      longUploadText: 'קובץ גדול עשוי לקחת זמן. אם הקובץ קטן והעיבוד נמשך זמן רב מהרגיל, נסו שוב מאוחר יותר או פנו לתמיכה.',
      noAccess: 'אין לך הרשאה להעלות קבצים',
      accessHint: 'פעולה זו זמינה למנהל/ת מרכזי/ת בלבד.',
      expectedColumns: 'עמודות מרכזיות שהמערכת מחפשת',
      expectedSubtitle: 'הקובץ יכול להכיל יותר עמודות — אלו העמודות הקריטיות לייבוא תקין.',
      success: 'הקובץ הועלה ועובד בהצלחה',
      error: 'שגיאה בהעלאת הקובץ',
      batchId: 'מספר אצווה',
      totalStudents: 'סה״כ סטודנטים שנקלטו',
      created: 'נוצרו',
      updated: 'עודכנו',
      skipped: 'דולגו',
      splitByRegion: 'פירוט לפי אזורים',
      sheetSummary: 'פירוט לפי גיליונות',
      skippedReasons: 'סיבות דילוג עיקריות',
      technicalErrors: 'שגיאות לבדיקה',
      notificationsCreated: 'נוצרו הודעות למנהלי האזורים',
      readyChecklist: 'מה יקרה אחרי ההעלאה?',
      check1: 'המערכת תקרא את גיליונות הקובץ',
      check2: 'סטודנטים יעודכנו או ייווצרו לפי תעודת זהות',
      check3: 'הנתונים יחולקו לתיבות האזורים הרלוונטיים',
      check4: 'לאחר מכן ניתן להריץ שיבוץ באזור המתאים',
      fileRulesTitle: 'דרישות קובץ',
      fileRule1: 'קובץ Excel רשמי של המעונות',
      fileRule2: 'עמודות תעודת זהות, שם פרטי ושם משפחה חייבות להופיע',
      fileRule3: 'סטטוס החלטה חיובית נדרש כדי שהסטודנט ייכנס לשיבוץ',
      fileRule4: 'גיליון עוזבים לא מיועד לשיבוץ מחדש',
      elapsed: 'זמן שעבר',
      seconds: 'שניות',
      minutes: 'דקות',
      status: 'סטטוס',
      processing: 'מעבד',
      completed: 'הושלם',
      failed: 'נכשל',
      emptyResult: 'הייבוא הסתיים אך לא התקבלו פרטי תוצאה להצגה',
      chooseAnother: 'בחר קובץ אחר',
      uploadAnother: 'העלה קובץ נוסף',
      hideDetails: 'הסתר פרטים',
      showDetails: 'הצג פרטים',
      columns: [
        { name: 'ת״ז ישראלית', example: '123456789' },
        { name: 'שם פרטי', example: 'מיכל' },
        { name: 'שם משפחה', example: 'כהן' },
        { name: 'החלטת מעונות - אביב', example: 'החלטה חיובית' },
        { name: 'אזור החלטה לאביב', example: '2 / 3 / 4' },
        { name: 'תיאור סוג מגורים', example: 'רווקים / רווקות' },
        { name: 'תיאור קוד לאום מבוקש', example: 'יהודי / מוסלמי' },
        { name: 'כתובת במעונות נוכחית', example: 'בניין / דירה / חדר' },
      ],
    },
    en: {
      title: 'Upload Allocation File',
      subtitle: 'Import the official dormitory Excel file, validate records, and split by regions',
      additionsTitle: 'Upload Additions File',
      additionsSubtitle: 'This file adds students with positive decisions and enriches existing student records',
      additionsUpload: 'Start additions import',
      additionsUploading: 'Processing additions file...',
      additionsSuccess: 'Additions file uploaded and processed successfully',
      eyebrow: 'Allocation Data Management',
      template: 'Download template',
      dropTitle: 'Drag a file here or click to browse',
      dropSubtitle: 'Supports Excel files: .xlsx or .xls',
      selectedFile: 'Selected file',
      removeFile: 'Remove file',
      upload: 'Start import and split by regions',
      uploading: 'Processing file...',
      uploadingHelp: 'Keep this window open until a result is returned. Large files may take longer.',
      longUploadTitle: 'Processing may take a few minutes',
      longUploadText: 'Large files may take longer to process. If the file is small and processing takes much longer than expected, please try again later or contact support.',
      noAccess: 'You do not have permission to upload files',
      accessHint: 'This action is available only for central administrators.',
      expectedColumns: 'Key columns expected by the system',
      expectedSubtitle: 'The file can contain more columns — these are the critical ones for a valid import.',
      success: 'File uploaded and processed successfully',
      error: 'Error uploading file',
      batchId: 'Batch ID',
      totalStudents: 'Total students imported',
      created: 'Created',
      updated: 'Updated',
      skipped: 'Skipped',
      splitByRegion: 'Region breakdown',
      sheetSummary: 'Sheet summary',
      skippedReasons: 'Main skipped reasons',
      technicalErrors: 'Errors to review',
      notificationsCreated: 'Notifications were created for regional managers',
      readyChecklist: 'What happens after upload?',
      check1: 'The system reads all Excel sheets',
      check2: 'Students are created or updated by student ID',
      check3: 'Records are split into the relevant regional inboxes',
      check4: 'Then you can run allocation for the selected region',
      fileRulesTitle: 'File requirements',
      fileRule1: 'Official dormitory Excel file',
      fileRule2: 'Student ID, first name, and last name columns must exist',
      fileRule3: 'A positive dormitory decision is required for allocation',
      fileRule4: 'Leaving students are not allocated again',
      elapsed: 'Elapsed',
      seconds: 'seconds',
      minutes: 'minutes',
      status: 'Status',
      processing: 'Processing',
      completed: 'Completed',
      failed: 'Failed',
      emptyResult: 'The import finished but no displayable result was returned',
      chooseAnother: 'Choose another file',
      uploadAnother: 'Upload another file',
      hideDetails: 'Hide details',
      showDetails: 'Show details',
      columns: [
        { name: 'Israeli ID', example: '123456789' },
        { name: 'First name', example: 'Maya' },
        { name: 'Last name', example: 'Cohen' },
        { name: 'Dorm decision - spring', example: 'Positive decision' },
        { name: 'Spring decision region', example: '2 / 3 / 4' },
        { name: 'Housing type description', example: 'Male / Female' },
        { name: 'Requested nationality description', example: 'Jewish / Muslim' },
        { name: 'Current dormitory address', example: 'Building / apartment / room' },
      ],
    }
  }[isHebrew ? 'he' : 'en'];

  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    if (!uploading) {
      setElapsedSeconds(0);
      return undefined;
    }

    const intervalId = setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [uploading]);

  const formattedElapsed = useMemo(() => {
    if (elapsedSeconds < 60) {
      return `${elapsedSeconds} ${t.seconds}`;
    }

    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${minutes} ${t.minutes}${seconds ? ` ${seconds} ${t.seconds}` : ''}`;
  }, [elapsedSeconds, t.minutes, t.seconds]);

  const isValidExcelFile = (candidateFile) => {
    if (!candidateFile) return false;
    const lowerName = candidateFile.name.toLowerCase();
    return lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
  };

  const resetResultState = () => {
    setUploadResult(null);
    setError(null);
    setShowDetails(true);
  };

  const setSelectedFile = (selectedFile) => {
    if (!selectedFile) return;

    if (!isValidExcelFile(selectedFile)) {
      setFile(null);
      setUploadResult(null);
      setError(t.error);
      return;
    }

    setFile(selectedFile);
    resetResultState();
  };

  const setSelectedAdditionsFile = (selectedFile) => {
  if (!selectedFile) return;

  if (!isValidExcelFile(selectedFile)) {
    setAdditionsFile(null);
    setAdditionsResult(null);
    setAdditionsError(t.error);
    return;
  }

  setAdditionsFile(selectedFile);
  setAdditionsResult(null);
  setAdditionsError(null);
  setShowDetails(true);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    setSelectedFile(event.dataTransfer.files[0]);
  };
  const handleAdditionsDrop = (event) => {
  event.preventDefault();
  setAdditionsDragOver(false);
  setSelectedAdditionsFile(event.dataTransfer.files[0]);
  };

  const handleFileSelect = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const handleAdditionsFileSelect = (event) => {
  setSelectedAdditionsFile(event.target.files[0]);
  };

  const handleRemoveFile = (event) => {
    if (event) event.stopPropagation();

    setFile(null);
    setUploading(false);
    resetResultState();

    const input = document.getElementById('file-input');
    if (input) input.value = '';
  };

  const handleRemoveAdditionsFile = (event) => {
  if (event) event.stopPropagation();

  setAdditionsFile(null);
  setUploadingAdditions(false);
  setAdditionsResult(null);
  setAdditionsError(null);

  const input = document.getElementById('additions-file-input');
  if (input) input.value = '';
  };

  const handleUpload = async () => {
    if (!file || uploading) return;

    setUploading(true);
    setError(null);
    setUploadResult(null);
    setShowDetails(true);

    try {
      const result = await uploadAPI.uploadExcel(file);
      setUploadResult(result || { success: true });
    } catch (err) {
      setError(err?.message || t.error);
    } finally {
      setUploading(false);
    }
  };


  const handleUploadAdditions = async () => {
  if (!additionsFile || uploadingAdditions) return;

  setUploadingAdditions(true);
  setAdditionsError(null);
  setAdditionsResult(null);
  setShowDetails(true);

  try {
    const result = await uploadAPI.uploadAdditionsExcel(additionsFile);
    setAdditionsResult(result || { success: true });
  } catch (err) {
    setAdditionsError(err?.message || t.error);
  } finally {
    setUploadingAdditions(false);
  }
  };

  const fileSize = file ? `${(file.size / 1024).toFixed(1)} KB` : '';
  const skippedCount = uploadResult?.skipped ?? 0;
  const hasRegions = Array.isArray(uploadResult?.region_breakdown) && uploadResult.region_breakdown.length > 0;
  const hasSheetCounts = uploadResult?.sheet_counts && Object.keys(uploadResult.sheet_counts).length > 0;
  const hasSkippedReasons = uploadResult?.skipped_by_reason && Object.keys(uploadResult.skipped_by_reason).length > 0;
  const hasErrors = Array.isArray(uploadResult?.errors) && uploadResult.errors.length > 0;

  const renderMiniStat = (label, value, className = '') => (
    <div className={`mini-stat ${className}`}>
      <span className="mini-stat-number">{value ?? 0}</span>
      <span className="mini-stat-label">{label}</span>
    </div>
  );

  const renderAccessDenied = () => (
    <div className="upload-page">
      <section className="access-card">
        <div className="access-icon">
          <AlertCircle size={34} />
        </div>
        <h1>{t.noAccess}</h1>
        <p>{t.accessHint}</p>
      </section>
      <style>{styles}</style>
    </div>
  );

  if (!canUploadExcel()) {
    return renderAccessDenied();
  }

  return (
    <div className={`upload-page ${isHebrew ? 'rtl' : 'ltr'}`}>
      <section className="hero-card">
        <div className="hero-content">
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>

        <div className="hero-actions">
          <div className={`status-pill ${uploading ? 'active' : uploadResult?.success ? 'done' : error ? 'failed' : ''}`}>
            <span className="status-dot" />
            <span>
              {uploading
                ? t.processing
                : uploadResult?.success
                  ? t.completed
                  : error
                    ? t.failed
                    : t.status}
            </span>
          </div>

          <button className="template-btn" type="button">
            <Download size={18} />
            {t.template}
          </button>
        </div>
      </section>

      <main className="upload-layout">
        <section className="upload-main-card">
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''} ${uploading ? 'is-uploading' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => {
              if (!uploading) {
                const input = document.getElementById('file-input');
                if (input) input.click();
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && !uploading) {
                const input = document.getElementById('file-input');
                if (input) input.click();
              }
            }}
          >
            <input
              type="file"
              id="file-input"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              hidden
            />

            {file ? (
              <div className="file-selected">
                <div className="file-icon">
                  <FileSpreadsheet size={32} />
                </div>

                <div className="file-meta">
                  <span className="file-label">{t.selectedFile}</span>
                  <strong>{file.name}</strong>
                  <small>{fileSize}</small>
                </div>

                {!uploading && (
                  <button
                    className="remove-btn"
                    type="button"
                    onClick={handleRemoveFile}
                    aria-label={t.removeFile}
                    title={t.removeFile}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ) : (
              <div className="drop-empty">
                <div className="upload-icon">
                  <Upload size={38} />
                </div>
                <h2>{t.dropTitle}</h2>
                <p>{t.dropSubtitle}</p>
              </div>
            )}
          </div>

          {file && !uploadResult && (
            <button className="upload-btn" type="button" onClick={handleUpload} disabled={uploading}>
              {uploading ? (
                <>
                  <Loader size={20} className="spin" />
                  {t.uploading}
                </>
              ) : (
                t.upload
              )}
            </button>
          )}

          {uploading && (
            <div className="processing-card">
              <div className="processing-header">
                <Loader size={20} className="spin" />
                <div>
                  <strong>{t.uploading}</strong>
                  <span>{t.uploadingHelp}</span>
                </div>
              </div>

              <div className="elapsed-row">
                <span>{t.elapsed}</span>
                <strong>{formattedElapsed}</strong>
              </div>

              <div className="progress-track">
                <div className="progress-bar" />
              </div>

              {elapsedSeconds >= 300 && (
                <div className="long-upload-warning">
                  <AlertCircle size={18} />
                  <div>
                    <strong>{t.longUploadTitle}</strong>
                    <p>{t.longUploadText}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="result-card error">
              <div className="result-header">
                <AlertCircle size={24} />
                <div>
                  <strong>{t.error}</strong>
                  <span>{error}</span>
                </div>
              </div>
            </div>
          )}

          {uploadResult && uploadResult.success && (
            <div className="result-card success">
              <div className="result-header">
                <Check size={24} />
                <div>
                  <strong>{t.success}</strong>
                  {uploadResult.batch_id && <span>{t.batchId}: #{uploadResult.batch_id}</span>}
                </div>
              </div>

              <div className="stats-grid">
                {renderMiniStat(t.totalStudents, uploadResult.total_students, 'primary')}
                {renderMiniStat(t.created, uploadResult.created)}
                {renderMiniStat(t.updated, uploadResult.updated)}
                {renderMiniStat(t.skipped, skippedCount, skippedCount > 0 ? 'warning' : '')}
              </div>

              <button className="details-toggle" type="button" onClick={() => setShowDetails(!showDetails)}>
                {showDetails ? t.hideDetails : t.showDetails}
              </button>

              {showDetails && (
                <div className="result-details">
                  {hasRegions && (
                    <div className="detail-block">
                      <h3>{t.splitByRegion}</h3>
                      <div className="region-list">
                        {uploadResult.region_breakdown.map((item) => (
                          <div key={`${item.region_id}-${item.region_name}`} className="region-item">
                            <span>{item.region_name}</span>
                            <strong>{item.count}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasSheetCounts && (
                    <div className="detail-block">
                      <h3>{t.sheetSummary}</h3>
                      <div className="sheet-list">
                        {Object.entries(uploadResult.sheet_counts).map(([sheetName, info]) => (
                          <div key={sheetName} className="sheet-row">
                            <div className="sheet-title">{sheetName}</div>

                            {typeof info === 'object' && info !== null ? (
                              <div className="sheet-stats">
                                <span>{isHebrew ? 'שורות' : 'Rows'}: <strong>{info.rows ?? 0}</strong></span>
                                <span>{t.created}: <strong>{info.created ?? 0}</strong></span>
                                <span>{t.updated}: <strong>{info.updated ?? 0}</strong></span>
                                <span>{t.skipped}: <strong>{info.skipped ?? 0}</strong></span>
                              </div>
                            ) : (
                              <strong>{String(info)}</strong>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasSkippedReasons && (
                    <div className="detail-block">
                      <h3>{t.skippedReasons}</h3>
                      <div className="key-value-list">
                        {Object.entries(uploadResult.skipped_by_reason).map(([reason, count]) => (
                          <div key={reason} className="key-value-row warning-row">
                            <span>{reason}</span>
                            <strong>{count}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasErrors && (
                    <div className="detail-block">
                      <h3>{t.technicalErrors}</h3>
                      <ul className="error-list">
                        {uploadResult.errors.slice(0, 8).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!hasRegions && !hasSheetCounts && !hasSkippedReasons && !hasErrors && (
                    <p className="empty-result">{t.emptyResult}</p>
                  )}

                  <div className="notification-info">
                    <Check size={16} />
                    <span>{t.notificationsCreated}</span>
                  </div>
                </div>
              )}

              <button className="secondary-action" type="button" onClick={handleRemoveFile}>
                {t.uploadAnother}
              </button>
            </div>
          )}
          <div className="upload-divider" />

<div className="upload-subsection">
  <div className="subsection-heading">
    <h2>{t.additionsTitle}</h2>
    <p>{t.additionsSubtitle}</p>
  </div>

  <div
    className={`drop-zone ${additionsDragOver ? 'drag-over' : ''} ${additionsFile ? 'has-file' : ''} ${uploadingAdditions ? 'is-uploading' : ''}`}
    onDragOver={(event) => {
      event.preventDefault();
      setAdditionsDragOver(true);
    }}
    onDragLeave={() => setAdditionsDragOver(false)}
    onDrop={handleAdditionsDrop}
    onClick={() => {
      if (!uploadingAdditions) {
        const input = document.getElementById('additions-file-input');
        if (input) input.click();
      }
    }}
    role="button"
    tabIndex={0}
    onKeyDown={(event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !uploadingAdditions) {
        const input = document.getElementById('additions-file-input');
        if (input) input.click();
      }
    }}
  >
    <input
      type="file"
      id="additions-file-input"
      accept=".xlsx,.xls"
      onChange={handleAdditionsFileSelect}
      hidden
    />

    {additionsFile ? (
      <div className="file-selected">
        <div className="file-icon additions-file-icon">
          <FileSpreadsheet size={32} />
        </div>

        <div className="file-meta">
          <span className="file-label">{t.selectedFile}</span>
          <strong>{additionsFile.name}</strong>
          <small>{`${(additionsFile.size / 1024).toFixed(1)} KB`}</small>
        </div>

        {!uploadingAdditions && (
          <button
            className="remove-btn"
            type="button"
            onClick={handleRemoveAdditionsFile}
            aria-label={t.removeFile}
            title={t.removeFile}
          >
            <X size={18} />
          </button>
        )}
      </div>
    ) : (
      <div className="drop-empty">
        <div className="upload-icon additions-icon">
          <Upload size={38} />
        </div>
        <h2>{t.dropTitle}</h2>
        <p>{t.dropSubtitle}</p>
      </div>
    )}
  </div>

  {additionsFile && !additionsResult && (
    <button
      className="upload-btn additions-btn"
      type="button"
      onClick={handleUploadAdditions}
      disabled={uploadingAdditions}
    >
      {uploadingAdditions ? (
        <>
          <Loader size={20} className="spin" />
          {t.additionsUploading}
        </>
      ) : (
        t.additionsUpload
      )}
    </button>
  )}

  {additionsError && (
    <div className="result-card error">
      <div className="result-header">
        <AlertCircle size={24} />
        <div>
          <strong>{t.error}</strong>
          <span>{additionsError}</span>
        </div>
      </div>
    </div>
  )}

  {additionsResult && additionsResult.success && (
    <div className="result-card success">
      <div className="result-header">
        <Check size={24} />
        <div>
          <strong>{t.additionsSuccess}</strong>
          {additionsResult.batch_id && <span>{t.batchId}: #{additionsResult.batch_id}</span>}
        </div>
      </div>

      <div className="stats-grid">
        {renderMiniStat(t.totalStudents, additionsResult.total_students, 'primary')}
        {renderMiniStat(t.created, additionsResult.created)}
        {renderMiniStat(t.updated, additionsResult.updated)}
        {renderMiniStat(t.skipped, additionsResult.skipped ?? 0, additionsResult.skipped > 0 ? 'warning' : '')}
      </div>

      {additionsResult.existing_category_preserved !== undefined && (
        <div className="notification-info">
          <Check size={16} />
          <span>
            {isHebrew
              ? `נשמר סטטוס קיים עבור ${additionsResult.existing_category_preserved} סטודנטים`
              : `Existing category preserved for ${additionsResult.existing_category_preserved} students`}
          </span>
        </div>
      )}

      <button className="secondary-action" type="button" onClick={handleRemoveAdditionsFile}>
        {t.uploadAnother}
      </button>
    </div>
  )}
</div>

        </section>

        <aside className="side-panel">
          <section className="info-card">
            <h3>{t.readyChecklist}</h3>
            <ul className="check-list">
              {[t.check1, t.check2, t.check3, t.check4].map((item) => (
                <li key={item}>
                  <span className="check-dot">
                    <Check size={13} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="info-card">
            <h3>{t.fileRulesTitle}</h3>
            <ul className="plain-list">
              {[t.fileRule1, t.fileRule2, t.fileRule3, t.fileRule4].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </main>

      <section className="columns-section">
        <div className="section-heading">
          <h2>{t.expectedColumns}</h2>
          <p>{t.expectedSubtitle}</p>
        </div>

        <div className="columns-grid">
          {t.columns.map((column) => (
            <article key={column.name} className="column-card">
              <span>{column.name}</span>
              <small>{column.example}</small>
            </article>
          ))}
        </div>
      </section>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .upload-page {
    min-height: 100%;
    padding: 28px;
    color: #172033;
    background:
      radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 34%),
      radial-gradient(circle at bottom right, rgba(20, 184, 166, 0.12), transparent 30%),
      #f5f8fc;
  }

  .upload-page.rtl {
    direction: rtl;
  }

  .upload-page.ltr {
    direction: ltr;
  }

  .hero-card {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    gap: 20px;
    padding: 28px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 28px;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(239, 246, 255, 0.92)),
      white;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
    margin-bottom: 24px;
  }

  .hero-content {
    max-width: 760px;
  }

  .eyebrow {
    display: inline-flex;
    width: fit-content;
    padding: 7px 12px;
    border-radius: 999px;
    background: #e0f2fe;
    color: #0369a1;
    font-size: 12px;
    font-weight: 800;
    margin-bottom: 12px;
  }

  .hero-card h1 {
    margin: 0 0 8px;
    font-size: clamp(26px, 3vw, 38px);
    font-weight: 900;
    letter-spacing: -0.04em;
    color: #0f172a;
  }

  .hero-card p {
    margin: 0;
    color: #64748b;
    font-size: 15px;
    line-height: 1.7;
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: space-between;
    gap: 14px;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 112px;
    justify-content: center;
    padding: 10px 14px;
    border-radius: 999px;
    background: #f1f5f9;
    color: #64748b;
    font-size: 13px;
    font-weight: 800;
  }

  .status-pill.active {
    background: #dbeafe;
    color: #1d4ed8;
  }

  .status-pill.done {
    background: #dcfce7;
    color: #15803d;
  }

  .status-pill.failed {
    background: #fee2e2;
    color: #b91c1c;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  .template-btn,
  .secondary-action,
  .details-toggle {
    border: none;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .template-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 16px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    color: #334155;
    border-radius: 14px;
    font-size: 14px;
    font-weight: 800;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
  }

  .template-btn:hover {
    transform: translateY(-1px);
    border-color: #bfdbfe;
    color: #1d4ed8;
  }

  .upload-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 24px;
    align-items: start;
  }

  .upload-main-card,
  .side-panel .info-card,
  .columns-section,
  .access-card {
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 26px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 22px 50px rgba(15, 23, 42, 0.07);
  }

  .upload-main-card {
    padding: 24px;
  }

  .drop-zone {
    border: 2px dashed #cbd5e1;
    border-radius: 24px;
    padding: 42px;
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(239, 246, 255, 0.9));
    cursor: pointer;
    transition: all 0.24s ease;
    outline: none;
  }

  .drop-zone:hover,
  .drop-zone.drag-over {
    border-color: #2563eb;
    background: #eff6ff;
    transform: translateY(-2px);
  }

  .drop-zone.has-file {
    min-height: unset;
    padding: 22px;
    border-style: solid;
    border-color: #93c5fd;
    background: #ffffff;
  }

  .drop-zone.is-uploading {
    cursor: wait;
    opacity: 0.9;
  }

  .drop-empty {
    text-align: center;
  }

  .upload-icon {
    width: 78px;
    height: 78px;
    border-radius: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 18px;
    background: linear-gradient(135deg, #38bdf8, #2563eb);
    color: white;
    box-shadow: 0 18px 32px rgba(37, 99, 235, 0.22);
  }

  .drop-empty h2 {
    margin: 0 0 8px;
    font-size: 22px;
    color: #0f172a;
  }

  .drop-empty p {
    margin: 0;
    color: #64748b;
  }

  .file-selected {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .file-icon {
    width: 58px;
    height: 58px;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #047857;
    background: #d1fae5;
    flex: 0 0 auto;
  }

  .file-meta {
    flex: 1;
    min-width: 0;
  }

  .file-label {
    display: block;
    font-size: 12px;
    color: #64748b;
    font-weight: 800;
    margin-bottom: 4px;
  }

  .file-meta strong {
    display: block;
    color: #0f172a;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta small {
    color: #94a3b8;
    font-weight: 700;
  }

  .remove-btn {
    width: 40px;
    height: 40px;
    border-radius: 14px;
    border: none;
    display: grid;
    place-items: center;
    color: #b91c1c;
    background: #fee2e2;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .remove-btn:hover {
    background: #fecaca;
    transform: scale(1.04);
  }

  .upload-btn {
    width: 100%;
    min-height: 54px;
    margin-top: 16px;
    border: none;
    border-radius: 18px;
    font-family: inherit;
    font-size: 16px;
    font-weight: 900;
    color: white;
    cursor: pointer;
    background: linear-gradient(135deg, #0ea5e9, #2563eb);
    box-shadow: 0 18px 35px rgba(37, 99, 235, 0.22);
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .upload-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 22px 42px rgba(37, 99, 235, 0.28);
  }

  .upload-btn:disabled {
    opacity: 0.75;
    cursor: not-allowed;
    transform: none;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .processing-card,
  .result-card {
    margin-top: 18px;
    border-radius: 22px;
    padding: 20px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
  }

  .processing-card {
    background: linear-gradient(135deg, #ffffff, #f8fbff);
  }

  .processing-header,
  .result-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .processing-header strong,
  .result-header strong {
    display: block;
    color: #0f172a;
    font-size: 16px;
    margin-bottom: 4px;
  }

  .processing-header span,
  .result-header span {
    display: block;
    color: #64748b;
    font-size: 13px;
    line-height: 1.6;
  }

  .elapsed-row {
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 14px;
    background: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #475569;
    font-size: 13px;
  }

  .elapsed-row strong {
    color: #2563eb;
  }

  .progress-track {
    height: 9px;
    overflow: hidden;
    border-radius: 999px;
    background: #e2e8f0;
    margin-top: 14px;
  }

  .progress-bar {
    height: 100%;
    width: 38%;
    border-radius: 999px;
    background: linear-gradient(90deg, #38bdf8, #2563eb, #38bdf8);
    background-size: 200% 100%;
    animation: progressMove 1.35s ease-in-out infinite;
  }

  @keyframes progressMove {
    0% {
      transform: translateX(-120%);
      background-position: 0% 50%;
    }
    100% {
      transform: translateX(300%);
      background-position: 100% 50%;
    }
  }

  .long-upload-warning {
    margin-top: 16px;
    padding: 14px;
    display: flex;
    gap: 10px;
    border-radius: 16px;
    background: #fffbeb;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  .long-upload-warning strong {
    display: block;
    font-size: 14px;
    margin-bottom: 3px;
  }

  .long-upload-warning p {
    margin: 0;
    color: #92400e;
    line-height: 1.6;
    font-size: 13px;
  }

  .result-card.success {
    border-color: #bbf7d0;
    background: linear-gradient(135deg, #ffffff, #f0fdf4);
  }

  .result-card.success .result-header svg {
    color: #16a34a;
  }

  .result-card.error {
    border-color: #fecaca;
    background: linear-gradient(135deg, #ffffff, #fff1f2);
  }

  .result-card.error .result-header svg {
    color: #dc2626;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-top: 18px;
  }

  .mini-stat {
    padding: 14px;
    border: 1px solid #e2e8f0;
    border-radius: 18px;
    background: white;
    text-align: center;
  }

  .mini-stat.primary {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .mini-stat.warning {
    background: #fffbeb;
    border-color: #fde68a;
  }

  .mini-stat-number {
    display: block;
    color: #0f172a;
    font-size: 25px;
    font-weight: 900;
    line-height: 1;
    margin-bottom: 7px;
  }

  .mini-stat-label {
    display: block;
    color: #64748b;
    font-size: 12px;
    font-weight: 800;
  }

  .details-toggle,
  .secondary-action {
    margin-top: 14px;
    border-radius: 14px;
    padding: 10px 14px;
    font-weight: 900;
    background: #f8fafc;
    color: #334155;
    border: 1px solid #e2e8f0;
  }

  .details-toggle:hover,
  .secondary-action:hover {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .secondary-action {
    width: 100%;
  }

  .result-details {
    margin-top: 16px;
    display: grid;
    gap: 14px;
  }

  .detail-block {
    padding: 16px;
    border-radius: 18px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
  }

  .detail-block h3 {
    margin: 0 0 12px;
    color: #0f172a;
    font-size: 15px;
  }

  .region-list,
  .key-value-list,
  .sheet-list {
    display: grid;
    gap: 8px;
  }

  .sheet-row {
    padding: 12px;
    border-radius: 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }

  .sheet-title {
    font-weight: 900;
    color: #0f172a;
    margin-bottom: 8px;
  }

  .sheet-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    color: #64748b;
    font-size: 12px;
  }

  .sheet-stats span {
    background: #ffffff;
    border-radius: 10px;
    padding: 8px;
    text-align: center;
  }

  .region-item,
  .key-value-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: #f8fafc;
    color: #334155;
    font-size: 13px;
  }

  .region-item strong,
  .key-value-row strong {
    padding: 3px 10px;
    border-radius: 999px;
    background: #dbeafe;
    color: #1d4ed8;
    min-width: 42px;
    text-align: center;
  }

  .warning-row strong {
    background: #fef3c7;
    color: #92400e;
  }

  .error-list {
    margin: 0;
    padding-inline-start: 18px;
    color: #b91c1c;
    font-size: 12px;
    line-height: 1.7;
  }

  .empty-result {
    margin: 0;
    color: #64748b;
  }

  .notification-info {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #15803d;
    background: #dcfce7;
    padding: 12px;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 800;
  }

  .side-panel {
    display: grid;
    gap: 18px;
  }

  .info-card {
    padding: 22px;
  }

  .info-card h3 {
    margin: 0 0 14px;
    color: #0f172a;
    font-size: 16px;
  }

  .check-list,
  .plain-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }

  .check-list li,
  .plain-list li {
    color: #475569;
    font-size: 13px;
    line-height: 1.6;
  }

  .check-list li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .rtl .check-list li {
    flex-direction: row;
  }

  .check-dot {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #dcfce7;
    color: #16a34a;
    flex: 0 0 auto;
    margin-top: 1px;
  }

  .plain-list li {
    position: relative;
    padding-inline-start: 16px;
  }

  .plain-list li::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 99px;
    background: #38bdf8;
    position: absolute;
    inset-inline-start: 0;
    top: 0.7em;
  }

  .columns-section {
    margin-top: 24px;
    padding: 24px;
  }

  .section-heading {
    margin-bottom: 16px;
  }

  .section-heading h2 {
    margin: 0 0 6px;
    color: #0f172a;
    font-size: 20px;
  }

  .section-heading p {
    margin: 0;
    color: #64748b;
    font-size: 14px;
  }

  .columns-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .column-card {
    padding: 15px;
    border-radius: 18px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    transition: all 0.2s ease;
  }

  .column-card:hover {
    border-color: #bfdbfe;
    transform: translateY(-2px);
    box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
  }

  .column-card span {
    display: block;
    color: #0f172a;
    font-weight: 900;
    font-size: 13px;
    margin-bottom: 6px;
  }

  .column-card small {
    color: #94a3b8;
    font-weight: 700;
    font-size: 12px;
  }

  .access-card {
    max-width: 560px;
    margin: 80px auto;
    padding: 40px;
    text-align: center;
  }

  .access-icon {
    width: 72px;
    height: 72px;
    border-radius: 24px;
    margin: 0 auto 18px;
    display: grid;
    place-items: center;
    color: #b91c1c;
    background: #fee2e2;
  }

  .access-card h1 {
    margin: 0 0 8px;
    color: #0f172a;
  }

  .access-card p {
    margin: 0;
    color: #64748b;
  }
    .upload-divider {
    height: 1px;
    background: #e2e8f0;
    margin: 30px 0;
  }

  .upload-subsection {
    display: grid;
    gap: 16px;
  }

  .subsection-heading h2 {
    margin: 0 0 6px;
    color: #0f172a;
    font-size: 22px;
    font-weight: 900;
  }

  .subsection-heading p {
    margin: 0;
    color: #64748b;
    font-size: 14px;
    line-height: 1.6;
  }

  .additions-icon {
    background: linear-gradient(135deg, #14b8a6, #0f766e);
  }

  .additions-file-icon {
    color: #0f766e;
    background: #ccfbf1;
  }

  .additions-btn {
    background: linear-gradient(135deg, #14b8a6, #0f766e);
    box-shadow: 0 18px 35px rgba(15, 118, 110, 0.22);
  }

  .additions-btn:hover {
    box-shadow: 0 22px 42px rgba(15, 118, 110, 0.28);
  }

  @media (max-width: 1120px) {
    .upload-layout {
      grid-template-columns: 1fr;
    }

    .side-panel {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .columns-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .upload-page {
      padding: 16px;
    }

    .hero-card {
      flex-direction: column;
      padding: 22px;
      border-radius: 22px;
    }

    .hero-actions {
      align-items: stretch;
    }

    .template-btn,
    .status-pill {
      width: 100%;
    }

    .drop-zone {
      padding: 28px 18px;
    }

    .file-selected {
      align-items: flex-start;
    }

    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .sheet-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .side-panel {
      grid-template-columns: 1fr;
    }

    .columns-grid {
      grid-template-columns: 1fr;
    }
  }
`;

export default UploadPage;
