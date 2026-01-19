import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { regions } from '../data/mockData';
import { Upload, FileSpreadsheet, Check, AlertCircle, Download, X } from 'lucide-react';

function UploadPage({ language }) {
  const { canUploadExcel } = useAuth();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const t = {
    he: {
      title: 'העלאת קובץ שיבוץ',
      subtitle: 'העלה קובץ אקסל עם נתוני הסטודנטים',
      dragDrop: 'גרור קובץ לכאן או לחץ לבחירה',
      supportedFormats: 'פורמטים נתמכים: .xlsx, .xls',
      upload: 'העלה קובץ',
      uploading: 'מעלה...',
      downloadTemplate: 'הורד תבנית',
      expectedColumns: 'עמודות צפויות בקובץ:',
      studentId: 'תעודת זהות',
      roommateId: 'ת.ז חבר לחדר',
      gender: 'מגדר',
      religion: 'דת',
      region: 'אזור מעון',
      success: 'הקובץ הועלה בהצלחה!',
      studentsFound: 'סטודנטים נמצאו',
      splitByRegion: 'חולקו לפי אזורים:',
      error: 'שגיאה בהעלאת הקובץ',
      noAccess: 'אין לך הרשאה להעלות קבצים',
      removeFile: 'הסר קובץ',
    },
    en: {
      title: 'Upload Allocation File',
      subtitle: 'Upload Excel file with student data',
      dragDrop: 'Drag file here or click to select',
      supportedFormats: 'Supported formats: .xlsx, .xls',
      upload: 'Upload File',
      uploading: 'Uploading...',
      downloadTemplate: 'Download Template',
      expectedColumns: 'Expected columns in file:',
      studentId: 'Student ID',
      roommateId: 'Roommate ID',
      gender: 'Gender',
      religion: 'Religion',
      region: 'Dorm Region',
      success: 'File uploaded successfully!',
      studentsFound: 'Students found',
      splitByRegion: 'Split by regions:',
      error: 'Error uploading file',
      noAccess: 'You do not have permission to upload files',
      removeFile: 'Remove file',
    }
  }[language];

  if (!canUploadExcel()) {
    return (
      <div className="upload-page">
        <div className="no-access">
          <AlertCircle size={48} />
          <h2>{t.noAccess}</h2>
        </div>
        <style>{`
          .upload-page { padding: 24px; }
          .no-access { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 400px; color: #94a3b8; gap: 16px; }
        `}</style>
      </div>
    );
  }

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    
    // Simulate upload and processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Mock result
    setUploadResult({
      success: true,
      totalStudents: 247,
      regionBreakdown: [
        { region: 'canada', name: 'מעונות קנדה', count: 52 },
        { region: 'mizrah', name: 'מעונות מזרח', count: 48 },
        { region: 'taub', name: 'מעונות טאוב', count: 61 },
        { region: 'sherman', name: 'מעונות שרמן', count: 45 },
        { region: 'einstein', name: 'מעונות איינשטיין', count: 41 },
      ]
    });
    
    setUploading(false);
  };

  const columns = [
    { name: t.studentId, example: '123456789' },
    { name: t.roommateId, example: '987654321' },
    { name: t.gender, example: 'זכר / נקבה' },
    { name: t.religion, example: 'יהודי / מוסלמי / נוצרי' },
    { name: t.region, example: 'קנדה / מזרח / טאוב' },
  ];

  return (
    <div className="upload-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button className="template-btn">
          <Download size={18} />
          {t.downloadTemplate}
        </button>
      </div>

      <div className="upload-section">
        <div 
          className={`drop-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input').click()}
        >
          <input 
            type="file" 
            id="file-input" 
            accept=".xlsx,.xls" 
            onChange={handleFileSelect} 
            hidden 
          />
          
          {file ? (
            <div className="file-info">
              <FileSpreadsheet size={40} />
              <div className="file-details">
                <span className="file-name">{file.name}</span>
                <span className="file-size">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
              <button className="remove-btn" onClick={(e) => { e.stopPropagation(); setFile(null); setUploadResult(null); }}>
                <X size={18} />
              </button>
            </div>
          ) : (
            <>
              <Upload size={48} />
              <p>{t.dragDrop}</p>
              <span>{t.supportedFormats}</span>
            </>
          )}
        </div>

        {file && !uploadResult && (
          <button className="upload-btn" onClick={handleUpload} disabled={uploading}>
            {uploading ? t.uploading : t.upload}
          </button>
        )}

        {uploadResult && (
          <div className={`result-card ${uploadResult.success ? 'success' : 'error'}`}>
            <div className="result-header">
              {uploadResult.success ? <Check size={24} /> : <AlertCircle size={24} />}
              <span>{uploadResult.success ? t.success : t.error}</span>
            </div>
            {uploadResult.success && (
              <div className="result-details">
                <div className="total-students">
                  <span className="number">{uploadResult.totalStudents}</span>
                  <span className="label">{t.studentsFound}</span>
                </div>
                <div className="region-breakdown">
                  <h4>{t.splitByRegion}</h4>
                  {uploadResult.regionBreakdown.map(item => (
                    <div key={item.region} className="region-item">
                      <span>{item.name}</span>
                      <span className="count">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="columns-section">
        <h3>{t.expectedColumns}</h3>
        <div className="columns-grid">
          {columns.map((col, index) => (
            <div key={index} className="column-card">
              <span className="column-name">{col.name}</span>
              <span className="column-example">{col.example}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .upload-page { padding: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }
        
        .template-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 14px;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }
        .template-btn:hover { background: #f8fafc; }

        .upload-section { max-width: 600px; margin: 0 auto; }

        .drop-zone {
          border: 2px dashed #cbd5e1;
          border-radius: 16px;
          padding: 48px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: #f8fafc;
        }

        .drop-zone:hover, .drop-zone.drag-over {
          border-color: #3d9fe0;
          background: #eff6ff;
        }

        .drop-zone.has-file {
          border-style: solid;
          border-color: #3d9fe0;
          background: white;
          padding: 24px;
        }

        .drop-zone svg { color: #94a3b8; margin-bottom: 16px; }
        .drop-zone p { font-size: 16px; color: #475569; margin-bottom: 8px; }
        .drop-zone span { font-size: 13px; color: #94a3b8; }

        .file-info {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .file-info svg { color: #059669; }
        .file-details { flex: 1; text-align: right; }
        [dir="ltr"] .file-details { text-align: left; }
        .file-name { display: block; font-weight: 600; color: #1e293b; }
        .file-size { font-size: 13px; color: #64748b; }

        .remove-btn {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: none;
          background: #fee2e2;
          color: #dc2626;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .upload-btn {
          width: 100%;
          padding: 14px;
          margin-top: 16px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }

        .upload-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(61, 159, 224, 0.4); }
        .upload-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }

        .result-card {
          margin-top: 24px;
          padding: 24px;
          border-radius: 16px;
        }

        .result-card.success { background: #d1fae5; border: 1px solid #6ee7b7; }
        .result-card.error { background: #fee2e2; border: 1px solid #fca5a5; }

        .result-header {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 20px;
        }

        .result-card.success .result-header { color: #059669; }
        .result-card.error .result-header { color: #dc2626; }

        .result-details { background: white; border-radius: 12px; padding: 20px; }

        .total-students {
          text-align: center;
          padding-bottom: 16px;
          margin-bottom: 16px;
          border-bottom: 1px solid #e5e7eb;
        }

        .total-students .number { display: block; font-size: 36px; font-weight: 700; color: #059669; }
        .total-students .label { font-size: 14px; color: #64748b; }

        .region-breakdown h4 { font-size: 14px; color: #64748b; margin-bottom: 12px; }

        .region-item {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f1f5f9;
        }

        .region-item .count {
          background: #dbeafe;
          color: #2563eb;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
        }

        .columns-section {
          max-width: 600px;
          margin: 48px auto 0;
        }

        .columns-section h3 {
          font-size: 16px;
          color: #64748b;
          margin-bottom: 16px;
        }

        .columns-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }

        .column-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px;
          text-align: center;
        }

        .column-name { display: block; font-weight: 600; margin-bottom: 4px; }
        .column-example { font-size: 12px; color: #94a3b8; }
      `}</style>
    </div>
  );
}

export default UploadPage;
