import React from 'react';
import { Settings, Globe, Bell, Shield } from 'lucide-react';

function SettingsPage({ language, onLanguageToggle }) {
  const t = {
    he: { title: 'הגדרות', subtitle: 'הגדרות מערכת', language: 'שפה', hebrew: 'עברית', english: 'English', notifications: 'התראות', emailNotifications: 'התראות באימייל', security: 'אבטחה', changePassword: 'שנה סיסמה' },
    en: { title: 'Settings', subtitle: 'System settings', language: 'Language', hebrew: 'עברית', english: 'English', notifications: 'Notifications', emailNotifications: 'Email notifications', security: 'Security', changePassword: 'Change Password' }
  }[language];

  return (
    <div className="settings-page">
      <div className="page-header"><h1>{t.title}</h1><p>{t.subtitle}</p></div>
      
      <div className="settings-section">
        <h3><Globe size={18} /> {t.language}</h3>
        <div className="setting-item">
          <span>{t.language}</span>
          <div className="lang-toggle">
            <button className={language === 'he' ? 'active' : ''} onClick={() => language !== 'he' && onLanguageToggle()}>{t.hebrew}</button>
            <button className={language === 'en' ? 'active' : ''} onClick={() => language !== 'en' && onLanguageToggle()}>{t.english}</button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3><Bell size={18} /> {t.notifications}</h3>
        <div className="setting-item">
          <span>{t.emailNotifications}</span>
          <label className="toggle"><input type="checkbox" defaultChecked /><span className="slider"></span></label>
        </div>
      </div>

      <div className="settings-section">
        <h3><Shield size={18} /> {t.security}</h3>
        <div className="setting-item">
          <span>{t.changePassword}</span>
          <button className="change-btn">{t.changePassword}</button>
        </div>
      </div>

      <style>{`
        .settings-page { padding: 24px; max-width: 600px; }
        .page-header { margin-bottom: 32px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }
        .settings-section { background: white; border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .settings-section h3 { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #64748b; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #f1f5f9; }
        .setting-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; }
        .lang-toggle { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 8px; }
        .lang-toggle button { padding: 8px 16px; border: none; background: none; border-radius: 6px; font-family: inherit; cursor: pointer; }
        .lang-toggle button.active { background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
        .toggle { position: relative; width: 44px; height: 24px; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; inset: 0; background: #cbd5e1; border-radius: 24px; transition: 0.3s; }
        .slider:before { content: ""; position: absolute; height: 18px; width: 18px; right: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; }
        [dir="ltr"] .slider:before { right: auto; left: 3px; }
        .toggle input:checked + .slider { background: #3d9fe0; }
        .toggle input:checked + .slider:before { transform: translateX(-20px); }
        [dir="ltr"] .toggle input:checked + .slider:before { transform: translateX(20px); }
        .change-btn { padding: 8px 16px; background: #f1f5f9; border: none; border-radius: 8px; font-family: inherit; cursor: pointer; }
      `}</style>
    </div>
  );
}

export default SettingsPage;
