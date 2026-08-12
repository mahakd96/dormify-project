import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const TECHNION_LOGO_SRC = '/brand/technion-logo.png';

  const { login } = useAuth();
  const navigate = useNavigate();

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

    if (!trimmedEmail) return 'יש להזין כתובת אימייל';
    if (!EMAIL_PATTERN.test(trimmedEmail)) return 'כתובת האימייל אינה תקינה';
    if (!password) return 'יש להזין סיסמה';

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
      // ✅ MUST await (otherwise token may not be stored yet)
      const result = await login(email.trim(), password);

      if (result?.success) {
        navigate('/dashboard', { replace: true });
      } else {
        setError(result?.error || 'כתובת האימייל או הסיסמה שגויים');
        setIsLoading(false);
      }
    } catch (err) {
      setError('אירעה שגיאה לא צפויה. נסו שוב מאוחר יותר');
      setIsLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="left-panel">
        <div className="brand-content">
          <div className="logo-container" aria-label="Technion logo">
            <img src={TECHNION_LOGO_SRC} alt="Technion" className="main-logo" />
          </div>

          <h1 className="brand-title">מערכת ניהול מעונות</h1>
          <p className="brand-subtitle">Technion Dormitories Management System</p>
          <div className="brand-decorative" />
        </div>

        <div className="left-footer">
          <p>© 2026 Technion - Israel Institute of Technology</p>
        </div>
      </div>

      <div className="right-panel">
        <div className="form-container">
          <div className="form-header">
            <h2>התחברות למערכת</h2>
            <p>נא להזין את פרטי ההתחברות שלך</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="error-alert" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">כתובת אימייל</label>
              <div className="input-wrapper">
                <Mail size={20} className="input-icon" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  placeholder="your.email@technion.ac.il"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">סיסמה</label>
              <div className="input-wrapper">
                <Lock size={20} className="input-icon" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder="הכנס את הסיסמה שלך"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button className="submit-btn" type="submit" disabled={isLoading}>
              {isLoading ? 'מתחבר...' : 'התחבר'}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        * { margin:0; padding:0; box-sizing:border-box; }

        .login-wrapper{
          min-height:100vh;
          display:flex;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          direction: rtl;
        }

        .left-panel{
          flex: 1;
          background: linear-gradient(165deg, #004e89 0%, #002a4d 50%, #001529 100%);
          position: relative;
          display:flex;
          flex-direction:column;
          justify-content:space-between;
          padding: 60px;
          overflow:hidden;
        }

        .brand-content{ position:relative; z-index:1; }

        .logo-container{
          background: rgba(255,255,255,0.98);
          width: 420px;
          height: 165px;
          border-radius: 28px;
          display:flex;
          align-items:center;
          justify-content:center;
          margin-bottom: 44px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.40);
          padding: 18px 22px;
          border: 1px solid rgba(255,255,255,0.30);
        }

        .main-logo{
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .brand-title{
          font-size: 48px;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 18px;
          line-height: 1.2;
        }

        .brand-subtitle{
          font-size: 22px;
          color: rgba(255,255,255,0.9);
          font-weight: 400;
          direction:ltr;
          text-align:right;
        }

        .brand-decorative{
          width: 120px;
          height: 5px;
          background: linear-gradient(90deg, #3d9fe0, rgba(61,159,224,0.25));
          margin-top: 46px;
          border-radius: 3px;
        }

        .left-footer{
          position:relative;
          z-index:1;
          color: rgba(255,255,255,0.6);
          font-size: 14px;
        }

        .right-panel{
          flex: 1;
          background:#ffffff;
          display:flex;
          align-items:center;
          justify-content:center;
          padding: 60px;
        }

        .form-container{ width:100%; max-width:480px; }

        .form-header{ margin-bottom:40px; }

        .form-header h2{
          font-size:32px;
          font-weight:700;
          color:#001529;
          margin-bottom:8px;
        }

        .form-header p{
          font-size:16px;
          color:#64748b;
        }

        .login-form{
          display:flex;
          flex-direction:column;
          gap:24px;
        }

        .error-alert{
          display:flex;
          align-items:center;
          gap:12px;
          padding:14px 16px;
          background:#fef2f2;
          border:1px solid #fecaca;
          border-radius:12px;
          color:#b91c1c;
          font-size:14px;
        }

        .form-group{
          display:flex;
          flex-direction:column;
          gap:8px;
        }

        .form-group label{
          font-size:14px;
          font-weight:600;
          color:#0f172a;
        }

        .input-wrapper{
          position:relative;
          display:flex;
          align-items:center;
        }

        .input-icon{
          position:absolute;
          right:16px;
          color:#94a3b8;
          pointer-events:none;
        }

        .input-wrapper input{
          width:100%;
          padding:14px 50px;
          border:2px solid #e2e8f0;
          border-radius:12px;
          font-size:15px;
          transition: all 0.2s ease;
          background:#ffffff;
        }

        .toggle-password{
          position:absolute;
          left:12px;
          background:transparent;
          border:none;
          color:#94a3b8;
          cursor:pointer;
          padding:8px;
          display:flex;
          align-items:center;
          justify-content:center;
          border-radius:8px;
        }

        .submit-btn{
          width:100%;
          padding:16px;
          background: linear-gradient(135deg, #004e89 0%, #002a4d 100%);
          color:white;
          border:none;
          border-radius:12px;
          font-size:16px;
          font-weight:600;
          cursor:pointer;
          margin-top:8px;
        }

        .submit-btn:disabled{ opacity:0.7; cursor:not-allowed; }

        @media (max-width: 1024px){
          .login-wrapper{ flex-direction:column; }
          .left-panel{ min-height: 320px; padding: 40px 30px; }
          .logo-container{ width: 320px; height: 140px; margin-bottom: 26px; }
          .brand-title{ font-size:32px; }
          .brand-subtitle{ font-size:16px; }
          .right-panel{ padding: 40px 30px; }
        }
      `}</style>
    </div>
  );
}

export default LoginPage;
