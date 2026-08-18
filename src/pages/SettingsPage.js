import React, { useState } from 'react';
import {
  Settings,
  Globe,
  Shield,
  LockKeyhole,
  Mail,
  X,
  Save,
  Loader2,
} from 'lucide-react';
import { settingsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

function SettingsPage({ language = 'he', onLanguageToggle }) {
  const isHebrew = language === 'he';
  const { refreshUser } = useAuth();

  const [activeModal, setActiveModal] = useState(null);
  const [formMessage, setFormMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [emailForm, setEmailForm] = useState({
    currentEmail: '',
    newEmail: '',
    confirmEmail: '',
    // G3-18: email change now requires current-password re-authentication,
    // same as the password-change form above.
    password: '',
  });

  const translations = {
    he: {
      title: 'הגדרות',
      subtitle: 'ניהול הגדרות המערכת, שפה ואבטחת החשבון',
      language: 'שפה',
      languageDescription: 'בחרי את שפת הממשק של מערכת Dormify',
      hebrew: 'עברית',
      english: 'English',

      security: 'אבטחה',
      securityDescription: 'ניהול סיסמת החשבון וכתובת האימייל',
      changePassword: 'שינוי סיסמה',
      changeEmail: 'שינוי אימייל',
      passwordNote: 'עדכני את הסיסמה במקרה של חשד לחשבון לא מאובטח',
      emailNote: 'עדכני את כתובת האימייל המשויכת לחשבון שלך',

      currentPassword: 'סיסמה נוכחית',
      newPassword: 'סיסמה חדשה',
      confirmPassword: 'אימות סיסמה חדשה',

      currentEmail: 'אימייל נוכחי',
      newEmail: 'אימייל חדש',
      confirmEmail: 'אימות אימייל חדש',

      save: 'שמירה',
      saving: 'שומר...',
      cancel: 'ביטול',

      passwordMismatch: 'הסיסמאות החדשות אינן תואמות',
      emailMismatch: 'כתובות האימייל אינן תואמות',
      passwordUpdated: 'הסיסמה עודכנה בהצלחה',
      emailUpdated: 'האימייל עודכן בהצלחה',
      requiredFields: 'יש למלא את כל השדות',
      passwordError: 'שגיאה בעדכון הסיסמה',
      emailError: 'שגיאה בעדכון האימייל',

      confirmPasswordChangeTitle:
        'האם את בטוחה שברצונך לשנות את הסיסמה?\n\nלאחר השינוי תצטרכי להשתמש בסיסמה החדשה בהתחברות הבאה.',
      confirmEmailChangeTitle:
        'האם את בטוחה שברצונך לשנות את כתובת האימייל?\n\nלאחר השינוי תצטרכי להשתמש באימייל החדש בהתחברות הבאה.',
    },
    en: {
      title: 'Settings',
      subtitle: 'Manage system language and account security',
      language: 'Language',
      languageDescription: 'Choose the interface language for Dormify',
      hebrew: 'עברית',
      english: 'English',

      security: 'Security',
      securityDescription: 'Manage account password and email address',
      changePassword: 'Change Password',
      changeEmail: 'Change Email',
      passwordNote: 'Update your password if you suspect account risk',
      emailNote: 'Update the email address associated with your account',

      currentPassword: 'Current password',
      newPassword: 'New password',
      confirmPassword: 'Confirm new password',

      currentEmail: 'Current email',
      newEmail: 'New email',
      confirmEmail: 'Confirm new email',

      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',

      passwordMismatch: 'New passwords do not match',
      emailMismatch: 'Email addresses do not match',
      passwordUpdated: 'Password updated successfully',
      emailUpdated: 'Email updated successfully',
      requiredFields: 'Please fill in all fields',
      passwordError: 'Failed to update password',
      emailError: 'Failed to update email',

      confirmPasswordChangeTitle:
        'Are you sure you want to change your password?\n\nAfter this change, you will need to use the new password the next time you log in.',
      confirmEmailChangeTitle:
        'Are you sure you want to change your email address?\n\nAfter this change, you will need to use the new email the next time you log in.',
    },
  };

  const t = translations[language] || translations.he;

  const handleLanguageClick = (targetLanguage) => {
    if (targetLanguage !== language && onLanguageToggle) {
      onLanguageToggle();
    }
  };

  const resetMessages = () => {
    setFormMessage('');
    setMessageType('');
  };

  const closeModal = () => {
    setActiveModal(null);
    resetMessages();
    setIsSubmitting(false);

    setPasswordForm({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });

    setEmailForm({
      currentEmail: '',
      newEmail: '',
      confirmEmail: '',
      password: '',
    });
  };

  const showError = (message) => {
    setFormMessage(message);
    setMessageType('error');
  };

  const showSuccess = (message) => {
    setFormMessage(message);
    setMessageType('success');
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    resetMessages();

    if (
      !passwordForm.currentPassword ||
      !passwordForm.newPassword ||
      !passwordForm.confirmPassword
    ) {
      showError(t.requiredFields);
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showError(t.passwordMismatch);
      return;
    }

    const confirmed = window.confirm(t.confirmPasswordChangeTitle);

    if (!confirmed) {
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await settingsAPI.changePassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
        confirm_password: passwordForm.confirmPassword,
      });

      showSuccess(response?.message || t.passwordUpdated);

      setTimeout(() => {
        closeModal();
      }, 2000);
    } catch (err) {
      showError(err?.message || t.passwordError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    resetMessages();

    if (
      !emailForm.currentEmail ||
      !emailForm.newEmail ||
      !emailForm.confirmEmail ||
      !emailForm.password
    ) {
      showError(t.requiredFields);
      return;
    }

    if (emailForm.newEmail !== emailForm.confirmEmail) {
      showError(t.emailMismatch);
      return;
    }

    const confirmed = window.confirm(t.confirmEmailChangeTitle);

    if (!confirmed) {
      return;
    }

    try {
      setIsSubmitting(true);

      // G3-18: password is required server-side too - a wrong password
      // returns a clean 400, surfaced below via the existing catch.
      const response = await settingsAPI.changeEmail({
        current_email: emailForm.currentEmail,
        new_email: emailForm.newEmail,
        confirm_email: emailForm.confirmEmail,
        password: emailForm.password,
      });

      // Reflect the new email in the header/session immediately rather
      // than requiring a reload - see AuthContext.refreshUser.
      await refreshUser();

      showSuccess(response?.message || t.emailUpdated);

      setTimeout(() => {
        closeModal();
      }, 2000);
    } catch (err) {
      showError(err?.message || t.emailError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="settings-page" dir={isHebrew ? 'rtl' : 'ltr'}>
      <div className="settings-container">
        <div className="settings-hero">
          <div className="hero-icon">
            <Settings size={28} />
          </div>

          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-header">
            <div className="section-icon blue">
              <Globe size={20} />
            </div>

            <div>
              <h3>{t.language}</h3>
              <p>{t.languageDescription}</p>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <span className="setting-label">{t.language}</span>
            </div>

            <div className="lang-toggle">
              <button
                type="button"
                className={language === 'he' ? 'active' : ''}
                onClick={() => handleLanguageClick('he')}
              >
                {t.hebrew}
              </button>

              <button
                type="button"
                className={language === 'en' ? 'active' : ''}
                onClick={() => handleLanguageClick('en')}
              >
                {t.english}
              </button>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-header">
            <div className="section-icon green">
              <Shield size={20} />
            </div>

            <div>
              <h3>{t.security}</h3>
              <p>{t.securityDescription}</p>
            </div>
          </div>

          <div className="security-actions">
            <div className="security-action">
              <div className="action-text">
                <span className="setting-label">{t.changePassword}</span>
                <span className="setting-note">{t.passwordNote}</span>
              </div>

              <button
                type="button"
                className="change-btn"
                onClick={() => {
                  resetMessages();
                  setActiveModal('password');
                }}
              >
                <LockKeyhole size={16} />
                {t.changePassword}
              </button>
            </div>

            <div className="security-action">
              <div className="action-text">
                <span className="setting-label">{t.changeEmail}</span>
                <span className="setting-note">{t.emailNote}</span>
              </div>

              <button
                type="button"
                className="change-btn"
                onClick={() => {
                  resetMessages();
                  setActiveModal('email');
                }}
              >
                <Mail size={16} />
                {t.changeEmail}
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeModal && (
        <div className="modal-backdrop">
          <div className="settings-modal">
            <div className="modal-header">
              <div>
                <h2>
                  {activeModal === 'password' ? t.changePassword : t.changeEmail}
                </h2>
              </div>

              <button
                type="button"
                className="modal-close"
                onClick={closeModal}
                disabled={isSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            {activeModal === 'password' ? (
              <form onSubmit={handlePasswordSubmit} className="modal-form">
                <label>
                  <span>{t.currentPassword}</span>
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setPasswordForm({
                        ...passwordForm,
                        currentPassword: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  <span>{t.newPassword}</span>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setPasswordForm({
                        ...passwordForm,
                        newPassword: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  <span>{t.confirmPassword}</span>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setPasswordForm({
                        ...passwordForm,
                        confirmPassword: e.target.value,
                      })
                    }
                  />
                </label>

                {formMessage && (
                  <div className={`form-message ${messageType}`}>
                    {formMessage}
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={closeModal}
                    disabled={isSubmitting}
                  >
                    {t.cancel}
                  </button>

                  <button type="submit" className="save-btn" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Save size={16} />
                    )}
                    {isSubmitting ? t.saving : t.save}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleEmailSubmit} className="modal-form">
                <label>
                  <span>{t.currentEmail}</span>
                  <input
                    type="email"
                    value={emailForm.currentEmail}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setEmailForm({
                        ...emailForm,
                        currentEmail: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  <span>{t.newEmail}</span>
                  <input
                    type="email"
                    value={emailForm.newEmail}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setEmailForm({
                        ...emailForm,
                        newEmail: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  <span>{t.confirmEmail}</span>
                  <input
                    type="email"
                    value={emailForm.confirmEmail}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setEmailForm({
                        ...emailForm,
                        confirmEmail: e.target.value,
                      })
                    }
                  />
                </label>

                {/* G3-18: current password required to change email,
                    same as the change-password form above. */}
                <label>
                  <span>{t.currentPassword}</span>
                  <input
                    type="password"
                    value={emailForm.password}
                    disabled={isSubmitting}
                    onChange={(e) =>
                      setEmailForm({
                        ...emailForm,
                        password: e.target.value,
                      })
                    }
                  />
                </label>

                {formMessage && (
                  <div className={`form-message ${messageType}`}>
                    {formMessage}
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={closeModal}
                    disabled={isSubmitting}
                  >
                    {t.cancel}
                  </button>

                  <button type="submit" className="save-btn" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Save size={16} />
                    )}
                    {isSubmitting ? t.saving : t.save}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <style>{`
        .settings-page {
          min-height: 100vh;
          padding: 32px 24px;
          background:
            radial-gradient(circle at top right, rgba(61, 159, 224, 0.08), transparent 28%),
            radial-gradient(circle at bottom left, rgba(37, 99, 235, 0.06), transparent 26%),
            #f4f7fb;
        }

        .settings-container {
          width: 100%;
          max-width: 760px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .settings-hero {
          display: flex;
          align-items: center;
          gap: 16px;
          background: white;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 24px;
          padding: 24px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.07);
        }

        .hero-icon {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #2563eb;
          background: rgba(37, 99, 235, 0.1);
          flex-shrink: 0;
        }

        .settings-hero h1 {
          margin: 0;
          font-size: 30px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.03em;
        }

        .settings-hero p {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.6;
        }

        .settings-card {
          background: white;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 22px;
          padding: 22px 24px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
        }

        .card-header {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding-bottom: 18px;
          margin-bottom: 18px;
          border-bottom: 1px solid #eef2f7;
        }

        .section-icon {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .section-icon.blue {
          color: #2563eb;
          background: rgba(37, 99, 235, 0.1);
        }

        .section-icon.green {
          color: #059669;
          background: rgba(5, 150, 105, 0.1);
        }

        .card-header h3 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
          font-weight: 950;
        }

        .card-header p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.6;
        }

        .setting-row,
        .security-action {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
        }

        .security-actions {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .security-action {
          padding: 16px;
          border: 1px solid #eef2f7;
          border-radius: 16px;
          background: #fbfdff;
        }

        .setting-text,
        .action-text {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .setting-label {
          color: #0f172a;
          font-size: 15px;
          font-weight: 900;
        }

        .setting-note {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.5;
        }

        .lang-toggle {
          display: flex;
          gap: 6px;
          background: #f1f5f9;
          padding: 5px;
          border-radius: 14px;
          flex-shrink: 0;
        }

        .lang-toggle button {
          min-width: 92px;
          padding: 10px 16px;
          border: none;
          background: transparent;
          border-radius: 10px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 850;
          color: #334155;
          cursor: pointer;
          transition: 0.18s ease;
        }

        .lang-toggle button:hover {
          background: rgba(255, 255, 255, 0.65);
        }

        .lang-toggle button.active {
          background: white;
          color: #0f172a;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
        }

        .change-btn,
        .save-btn,
        .cancel-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 11px 16px;
          border-radius: 12px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          transition: 0.18s ease;
          white-space: nowrap;
        }

        .change-btn {
          background: #f1f5f9;
          color: #0f172a;
          border: 1px solid #e2e8f0;
        }

        .change-btn:hover {
          background: #eaf2ff;
          border-color: rgba(37, 99, 235, 0.22);
          color: #2563eb;
          transform: translateY(-1px);
        }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.42);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
          backdrop-filter: blur(4px);
        }

        .settings-modal {
          width: 100%;
          max-width: 460px;
          background: white;
          border-radius: 22px;
          padding: 22px;
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
          border: 1px solid rgba(255, 255, 255, 0.8);
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 16px;
          margin-bottom: 16px;
          border-bottom: 1px solid #eef2f7;
        }

        .modal-header h2 {
          margin: 0;
          color: #0f172a;
          font-size: 20px;
          font-weight: 950;
        }

        .modal-close {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: none;
          background: #f1f5f9;
          color: #334155;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-close:disabled,
        .save-btn:disabled,
        .cancel-btn:disabled,
        input:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .modal-form label {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .modal-form label span {
          color: #334155;
          font-size: 13px;
          font-weight: 900;
        }

        .modal-form input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #dbe3ef;
          background: #f8fafc;
          border-radius: 12px;
          padding: 12px 14px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          outline: none;
        }

        .modal-form input:focus {
          background: white;
          border-color: rgba(37, 99, 235, 0.55);
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.08);
        }

        .form-message {
          padding: 11px 13px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 900;
        }

        .form-message.success {
          background: rgba(5, 150, 105, 0.1);
          color: #047857;
          border: 1px solid rgba(5, 150, 105, 0.18);
        }

        .form-message.error {
          background: rgba(220, 38, 38, 0.08);
          color: #dc2626;
          border: 1px solid rgba(220, 38, 38, 0.16);
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 8px;
        }

        .save-btn {
          border: 1px solid #2563eb;
          background: #2563eb;
          color: white;
        }

        .save-btn:hover:not(:disabled) {
          background: #1d4ed8;
        }

        .cancel-btn {
          border: 1px solid #e2e8f0;
          background: white;
          color: #334155;
        }

        .cancel-btn:hover:not(:disabled) {
          background: #f8fafc;
        }

        .spin {
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 700px) {
          .settings-page {
            padding: 18px 14px;
          }

          .settings-hero {
            align-items: flex-start;
            padding: 20px;
          }

          .settings-hero h1 {
            font-size: 25px;
          }

          .setting-row,
          .security-action {
            flex-direction: column;
            align-items: stretch;
          }

          .lang-toggle {
            width: 100%;
          }

          .lang-toggle button {
            flex: 1;
            min-width: 0;
          }

          .change-btn,
          .save-btn,
          .cancel-btn {
            width: 100%;
          }

          .modal-actions {
            flex-direction: column-reverse;
          }
        }
      `}</style>
    </div>
  );
}

export default SettingsPage;