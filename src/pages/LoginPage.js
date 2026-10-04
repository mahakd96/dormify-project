import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Globe,
} from 'lucide-react';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginPage({ language, onLanguageToggle }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const TECHNION_LOGO_SRC = '/brand/technion-logo.png';

  const { login } = useAuth();
  const navigate = useNavigate();

  const isHebrew = language === 'he';

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    if (error) setError('');
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    if (error) setError('');
  };

  const validate = () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      return isHebrew
        ? 'יש להזין כתובת אימייל'
        : 'Please enter an email address';
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      return isHebrew
        ? 'כתובת האימייל אינה תקינה'
        : 'The email address is invalid';
    }

    if (!password) {
      return isHebrew
        ? 'יש להזין סיסמה'
        : 'Please enter a password';
    }

    return '';
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();

    if (isLoading) return;

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const result = await login(email.trim(), password);

      if (result?.success) {
        navigate('/dashboard', { replace: true });
      } else {
        setError(
          result?.error ||
            (isHebrew
              ? 'כתובת האימייל או הסיסמה שגויים'
              : 'Incorrect email address or password')
        );

        setIsLoading(false);
      }
    } catch (err) {
      setError(
        isHebrew
          ? 'אירעה שגיאה לא צפויה. נסו שוב מאוחר יותר'
          : 'An unexpected error occurred. Please try again later'
      );

      setIsLoading(false);
    }
  };

  return (
    <div
      className="login-wrapper"
      dir={isHebrew ? 'rtl' : 'ltr'}
    >
      <button
        type="button"
        className="language-toggle"
        onClick={onLanguageToggle}
        title={isHebrew ? 'English' : 'עברית'}
        aria-label={
          isHebrew
            ? 'Switch to English'
            : 'החלפה לעברית'
        }
      >
        <Globe size={19} />
        <span>{isHebrew ? 'EN' : 'עב'}</span>
      </button>

      <div className="left-panel">
        <div className="brand-content">
          <div
            className="logo-container"
            aria-label="Technion logo"
          >
            <img
              src={TECHNION_LOGO_SRC}
              alt="Technion"
              className="main-logo"
            />
          </div>

          <h1 className="brand-title">
            {isHebrew
              ? 'מערכת ניהול מעונות'
              : 'Dormitories Management System'}
          </h1>

          <p className="brand-subtitle">
            University Housing Management System
          </p>

          <div className="brand-decorative" />
        </div>

        <div className="left-footer">
          <p>
            © 2026 Dormify Project Contributors
          </p>
        </div>
      </div>

      <div className="right-panel">
        <div className="form-container">
          <div className="form-header">
            <h2>
              {isHebrew
                ? 'התחברות למערכת'
                : 'Login'}
            </h2>

            <p>
              {isHebrew
                ? 'נא להזין את פרטי ההתחברות שלך'
                : 'Please enter your login details'}
            </p>
          </div>

          <form
            className="login-form"
            onSubmit={handleSubmit}
            noValidate
          >
            {error && (
              <div
                className="error-alert"
                role="alert"
              >
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">
                {isHebrew
                  ? 'כתובת אימייל'
                  : 'Email Address'}
              </label>

              <div className="input-wrapper">
                <Mail
                  size={20}
                  className="input-icon"
                />

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  placeholder="name@example.edu"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">
                {isHebrew
                  ? 'סיסמה'
                  : 'Password'}
              </label>

              <div className="input-wrapper">
                <Lock
                  size={20}
                  className="input-icon"
                />

                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder={
                    isHebrew
                      ? 'הכנס את הסיסמה שלך'
                      : 'Enter your password'
                  }
                  autoComplete="current-password"
                />

                <button
                  type="button"
                  className="toggle-password"
                  onClick={() =>
                    setShowPassword((v) => !v)
                  }
                  aria-label={
                    showPassword
                      ? isHebrew
                        ? 'הסתר סיסמה'
                        : 'Hide password'
                      : isHebrew
                        ? 'הצג סיסמה'
                        : 'Show password'
                  }
                >
                  {showPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>
              </div>
            </div>

            <button
              className="submit-btn"
              type="submit"
              disabled={isLoading}
            >
              {isLoading
                ? isHebrew
                  ? 'מתחבר...'
                  : 'Logging in...'
                : isHebrew
                  ? 'התחבר'
                  : 'Login'}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .login-wrapper {
          min-height: 100vh;
          display: flex;
          position: relative;
          font-family:
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            Roboto,
            'Helvetica Neue',
            Arial,
            sans-serif;
        }

        .language-toggle {
          position: absolute;
          top: 24px;
          z-index: 20;
          width: 54px;
          height: 42px;
          border-radius: 10px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          color: #475569;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          font-family: inherit;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
        }

        .login-wrapper[dir="rtl"] .language-toggle {
          left: 24px;
          right: auto;
        }

        .login-wrapper[dir="ltr"] .language-toggle {
          right: 24px;
          left: auto;
        }

        .language-toggle:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .language-toggle span {
          font-size: 11px;
          font-weight: 700;
        }

        .left-panel {
          flex: 1;
          background:
            linear-gradient(
              165deg,
              #004e89 0%,
              #002a4d 50%,
              #001529 100%
            );
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 60px;
          overflow: hidden;
        }

        .brand-content {
          position: relative;
          z-index: 1;
        }

        .logo-container {
          background: rgba(255,255,255,0.98);
          width: 420px;
          height: 165px;
          border-radius: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 44px;
          box-shadow:
            0 30px 80px rgba(0,0,0,0.40);
          padding: 18px 22px;
          border:
            1px solid rgba(255,255,255,0.30);
        }

        .main-logo {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .brand-title {
          font-size: 48px;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 18px;
          line-height: 1.2;
        }

        .brand-subtitle {
          font-size: 22px;
          color: rgba(255,255,255,0.9);
          font-weight: 400;
          direction: ltr;
        }

        .login-wrapper[dir="rtl"] .brand-subtitle {
          text-align: right;
        }

        .login-wrapper[dir="ltr"] .brand-subtitle {
          text-align: left;
        }

        .brand-decorative {
          width: 120px;
          height: 5px;
          background:
            linear-gradient(
              90deg,
              #3d9fe0,
              rgba(61,159,224,0.25)
            );
          margin-top: 46px;
          border-radius: 3px;
        }

        .left-footer {
          position: relative;
          z-index: 1;
          color: rgba(255,255,255,0.6);
          font-size: 14px;
        }

        .right-panel {
          flex: 1;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px;
        }

        .form-container {
          width: 100%;
          max-width: 480px;
        }

        .form-header {
          margin-bottom: 40px;
        }

        .form-header h2 {
          font-size: 32px;
          font-weight: 700;
          color: #001529;
          margin-bottom: 8px;
        }

        .form-header p {
          font-size: 16px;
          color: #64748b;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .error-alert {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 12px;
          color: #b91c1c;
          font-size: 14px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 600;
          color: #0f172a;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          background: #ffffff;
          transition: all 0.2s ease;
        }

        .input-wrapper:focus-within {
          border-color: #004e89;
          box-shadow:
            0 0 0 3px rgba(0,78,137,0.08);
        }

        .input-icon {
          position: absolute;
          color: #94a3b8;
          pointer-events: none;
          z-index: 2;
        }

        .login-wrapper[dir="rtl"] .input-icon {
          right: 16px;
          left: auto;
        }

        .login-wrapper[dir="ltr"] .input-icon {
          left: 16px;
          right: auto;
        }

        .input-wrapper input {
          width: 100%;
          height: 52px;
          border: none;
          outline: none;
          box-shadow: none;
          border-radius: 12px;
          font-size: 15px;
          background: transparent;
          font-family: inherit;
          position: relative;
          z-index: 1;
        }

        .login-wrapper[dir="rtl"] .input-wrapper input {
          padding: 14px 50px;
          text-align: right;
        }

        .login-wrapper[dir="ltr"] .input-wrapper input {
          padding: 14px 50px;
          text-align: left;
        }

        .input-wrapper input:focus {
          border: none;
          outline: none;
          box-shadow: none;
        }

        .toggle-password {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          width: 40px;
          height: 40px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          z-index: 3;
        }

        .login-wrapper[dir="rtl"] .toggle-password {
          left: 8px;
          right: auto;
        }

        .login-wrapper[dir="ltr"] .toggle-password {
          right: 8px;
          left: auto;
        }

        .toggle-password:hover {
          color: #475569;
          background: #f1f5f9;
        }

        /* Hide browser built-in password controls */
        #password::-ms-reveal,
        #password::-ms-clear {
          display: none;
        }

        #password::-webkit-credentials-auto-fill-button {
          visibility: hidden;
          display: none !important;
          pointer-events: none;
        }

        .login-wrapper[dir="ltr"] #password {
          padding-left: 50px;
          padding-right: 58px;
        }

        .login-wrapper[dir="rtl"] #password {
          padding-right: 50px;
          padding-left: 58px;
        }

        .submit-btn {
          width: 100%;
          padding: 16px;
          background:
            linear-gradient(
              135deg,
              #004e89 0%,
              #002a4d 100%
            );
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 8px;
          font-family: inherit;
        }

        .submit-btn:hover:not(:disabled) {
          box-shadow:
            0 8px 20px rgba(0,42,77,0.20);
        }

        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        @media (max-width: 1024px) {
          .login-wrapper {
            flex-direction: column;
          }

          .left-panel {
            min-height: 320px;
            padding: 40px 30px;
          }

          .logo-container {
            width: 320px;
            height: 140px;
            margin-bottom: 26px;
          }

          .brand-title {
            font-size: 32px;
          }

          .brand-subtitle {
            font-size: 16px;
          }

          .right-panel {
            padding: 40px 30px;
          }
        }
      `}</style>
    </div>
  );
}

export default LoginPage;