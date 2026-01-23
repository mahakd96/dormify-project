import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const TECHNION_LOGO_SRC = '/brand/technion-logo.png';

  const { login } = useAuth();
  const navigate = useNavigate();

  const demoAccounts = useMemo(
    () => [
      { email: 'admin@technion.ac.il', role: 'מנהל מרכזי' },
      { email: 'canada.boss@technion.ac.il', role: 'מנהל אזור קנדה' },
      { email: 'canada.emp1@technion.ac.il', role: 'עובד אזור קנדה' },
    ],
    []
  );
const handleSubmit = async (e) => {
  e?.preventDefault();
  if (isLoading) return;

  setError('');
  setIsLoading(true);

  // tiny delay so UI feels responsive (optional)
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    const user = await login(email.trim(), password);
    console.log('LOGIN returned:', user);

    if (user) {
      navigate('/dashboard'); // or '/' if that’s your home route
    } else {
      // AuthContext already sets authError, but we keep your local message too
      setError('התחברות נכשלה. בדוק/י פרטים ונסה/י שוב.');
    }
  } catch (err) {
    setError('שגיאה לא צפויה. נסו שוב בעוד רגע.');
  } finally {
    setIsLoading(false);
  }
};


  return (
    <div className="login-wrapper">
      {/* Left Panel - Branding */}
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

      {/* Right Panel - Login Form */}
      <div className="right-panel">
        <div className="form-container">
          <div className="form-header">
            <h2>התחברות למערכת</h2>
            <p>נא להזין את פרטי ההתחברות שלך</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
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
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@technion.ac.il"
                  autoComplete="email"
                  required
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
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="הכנס את הסיסמה שלך"
                  autoComplete="current-password"
                  required
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

            <div className="demo-section">
              <div className="demo-header">
                <span className="demo-badge">דמו</span>
                <span className="demo-info">
                  סיסמה: <strong>123456</strong>
                </span>
              </div>

              <div className="demo-accounts">
                {demoAccounts.map((account, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="demo-account"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword('123456');
                    }}
                  >
                    <span className="account-role">{account.role}</span>
                    <span className="account-email">{account.email}</span>
                  </button>
                ))}
              </div>
            </div>
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

        /* Left Panel - Branding */
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

        .left-panel::before{
          content:'';
          position:absolute;
          top:-50%;
          right:-20%;
          width:80%;
          height:150%;
          background: radial-gradient(circle, rgba(61,159,224,0.18) 0%, transparent 70%);
          pointer-events:none;
          animation: glow-pulse 8s ease-in-out infinite;
        }

        @keyframes glow-pulse{
          0%,100%{ opacity:1; }
          50%{ opacity:0.6; }
        }

        .brand-content{ position:relative; z-index:1; }

        .logo-container{
          background: rgba(255,255,255,0.98);
          width: 420px;           /* wider to match text length */
          height: 165px;          /* shorter to reduce white block feel */
          border-radius: 28px;
          display:flex;
          align-items:center;
          justify-content:center;
          margin-bottom: 44px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.40);
          padding: 18px 22px;     /* less padding = less "white width" */
          border: 1px solid rgba(255,255,255,0.30);
        }

        .main-logo{
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: -webkit-optimize-contrast;
          transform: translateZ(0);
        }

        .brand-title{
          font-size: 48px;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 18px;
          line-height: 1.2;
          text-shadow: 0 2px 20px rgba(0,0,0,0.20);
        }

        .brand-subtitle{
          font-size: 22px;
          color: rgba(255,255,255,0.9);
          font-weight: 400;
          direction:ltr;
          text-align:right;
          text-shadow: 0 1px 10px rgba(0,0,0,0.15);
        }

        .brand-decorative{
          width: 120px;
          height: 5px;
          background: linear-gradient(90deg, #3d9fe0, rgba(61,159,224,0.25));
          margin-top: 46px;
          border-radius: 3px;
          box-shadow: 0 2px 15px rgba(61,159,224,0.45);
        }

        .left-footer{
          position:relative;
          z-index:1;
          color: rgba(255,255,255,0.6);
          font-size: 14px;
        }

        /* Right Panel - Form */
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

        .input-wrapper input:focus{
          outline:none;
          border-color:#004e89;
          box-shadow: 0 0 0 4px rgba(0,78,137,0.10);
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
          transition: all 0.2s ease;
        }

        .toggle-password:hover{
          background:#f1f5f9;
          color:#475569;
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
          transition: all 0.3s ease;
          box-shadow: 0 4px 16px rgba(0,78,137,0.30);
          margin-top:8px;
        }

        .submit-btn:hover:not(:disabled){
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,78,137,0.40);
        }

        .submit-btn:disabled{
          opacity:0.7;
          cursor:not-allowed;
          transform:none;
        }

        .demo-section{
          margin-top:16px;
          padding-top:24px;
          border-top:1px solid #e2e8f0;
        }

        .demo-header{
          display:flex;
          align-items:center;
          gap:12px;
          margin-bottom:16px;
        }

        .demo-badge{
          background:#004e89;
          color:white;
          padding:4px 12px;
          border-radius:6px;
          font-size:12px;
          font-weight:600;
        }

        .demo-info{
          font-size:13px;
          color:#64748b;
        }

        .demo-accounts{
          display:flex;
          flex-direction:column;
          gap:10px;
        }

        .demo-account{
          background:#f8fafc;
          border:2px solid #e2e8f0;
          border-radius:10px;
          padding:12px 16px;
          display:flex;
          flex-direction:column;
          align-items:flex-start;
          gap:4px;
          cursor:pointer;
          transition: all 0.2s ease;
          text-align:right;
        }

        .demo-account:hover{
          border-color:#004e89;
          background:#f1f5f9;
          transform: translateX(-4px);
        }

        .account-role{
          font-size:14px;
          font-weight:600;
          color:#0f172a;
        }

        .account-email{
          font-size:13px;
          color:#64748b;
          direction:ltr;
          text-align:left;
          width:100%;
        }

        @media (max-width: 1024px){
          .login-wrapper{ flex-direction:column; }

          .left-panel{
            min-height: 320px;
            padding: 40px 30px;
          }

          .logo-container{
            width: 320px;
            height: 140px;
            margin-bottom: 26px;
            padding: 14px 18px;
          }

          .brand-title{ font-size:32px; }
          .brand-subtitle{ font-size:16px; }

          .right-panel{ padding: 40px 30px; }
        }

        @media (max-width: 420px){
          .logo-container{
            width: 100%;
            max-width: 340px;
          }
        }
      `}</style>
    </div>
  );
}

export default LoginPage;