import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Building2, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = login(email, password);
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
    }
    
    setIsLoading(false);
  };

  const demoAccounts = [
    { email: 'admin@technion.ac.il', role: 'מנהל מרכזי', roleEn: 'Central Admin' },
    { email: 'canada.boss@technion.ac.il', role: 'מנהל אזור קנדה', roleEn: 'Canada Boss' },
    { email: 'canada.emp1@technion.ac.il', role: 'עובד אזור קנדה', roleEn: 'Canada Employee' },
  ];

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="logo">
              <Building2 size={40} />
            </div>
            <h1>Dormify</h1>
            <p>מערכת ניהול מעונות הטכניון</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="error-message">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label>אימייל</label>
              <div className="input-wrapper">
                <Mail size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@technion.ac.il"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>סיסמה</label>
              <div className="input-wrapper">
                <Lock size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="הכנס סיסמה"
                  required
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="login-btn" disabled={isLoading}>
              {isLoading ? 'מתחבר...' : 'התחברות'}
            </button>
          </form>

          <div className="demo-accounts">
            <p>חשבונות לדוגמה (סיסמה: 123456)</p>
            <div className="demo-list">
              {demoAccounts.map((account, index) => (
                <button
                  key={index}
                  className="demo-btn"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword('123456');
                  }}
                >
                  <span className="demo-role">{account.role}</span>
                  <span className="demo-email">{account.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="login-footer">
          <p>© 2026 Technion - Israel Institute of Technology</p>
        </div>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #1e3a5f 0%, #3d9fe0 100%);
          padding: 20px;
        }

        .login-container {
          width: 100%;
          max-width: 420px;
        }

        .login-card {
          background: white;
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .logo {
          width: 72px;
          height: 72px;
          background: linear-gradient(135deg, #3d9fe0, #1e3a5f);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
          color: white;
        }

        .login-header h1 {
          font-size: 28px;
          font-weight: 700;
          color: #1e3a5f;
          margin-bottom: 4px;
        }

        .login-header p {
          color: #64748b;
          font-size: 14px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #dc2626;
          font-size: 14px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-wrapper svg {
          position: absolute;
          right: 12px;
          color: #9ca3af;
          pointer-events: none;
        }

        .input-wrapper input {
          width: 100%;
          padding: 12px 44px 12px 44px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 15px;
          font-family: inherit;
          transition: all 0.2s;
        }

        .input-wrapper input:focus {
          outline: none;
          border-color: #3d9fe0;
          box-shadow: 0 0 0 3px rgba(61, 159, 224, 0.1);
        }

        .toggle-password {
          position: absolute;
          left: 12px;
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          padding: 4px;
          display: flex;
          pointer-events: auto;
        }

        .toggle-password:hover {
          color: #6b7280;
        }

        .login-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #3d9fe0, #1e3a5f);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 8px;
        }

        .login-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(61, 159, 224, 0.4);
        }

        .login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .demo-accounts {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid #e5e7eb;
        }

        .demo-accounts > p {
          font-size: 12px;
          color: #9ca3af;
          text-align: center;
          margin-bottom: 12px;
        }

        .demo-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .demo-btn {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .demo-btn:hover {
          background: #f1f5f9;
          border-color: #3d9fe0;
        }

        .demo-role {
          font-size: 13px;
          font-weight: 500;
          color: #374151;
        }

        .demo-email {
          font-size: 11px;
          color: #9ca3af;
          direction: ltr;
        }

        .login-footer {
          text-align: center;
          margin-top: 24px;
        }

        .login-footer p {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </div>
  );
}

export default LoginPage;
