import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, NavLink } from 'react-router-dom';
import api from './api';
import { useI18n, getLang } from './i18n';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Citizens from './pages/Citizens';
import Payments from './pages/Payments';
import Reports from './pages/Reports';

function getTheme() {
  try {
    return document.documentElement.getAttribute('data-theme') || 'light';
  } catch {
    return 'light';
  }
}

function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme());
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {}
    setThemeState(next);
  };
  return (
    <button
      className="btn-icon"
      onClick={toggle}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      style={{ borderRadius: '100px' }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle">
      <button className={lang === 'fr' ? 'active' : ''} onClick={() => setLang('fr')}>FR</button>
      <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
    </div>
  );
}

function Layout({ user, onLogout }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    onLogout();
    navigate('/login');
  };

  const initial = (user?.name || 'U').charAt(0).toUpperCase();

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="main-container d-flex align-items-center gap-3 py-2 flex-wrap">
          <div className="brand d-flex align-items-center">
            <span className="brand-mark">🗂️</span>
            <span className="brand-text">{t('app.brand')}</span>
          </div>

          <nav className="nav-pills-menu ms-2 ms-md-4 flex-grow-1">
            <NavLink className="nav-link" to="/">{t('nav.dashboard')}</NavLink>
            <NavLink className="nav-link" to="/citizens">{t('nav.citizens')}</NavLink>
            <NavLink className="nav-link" to="/payments">{t('nav.payments')}</NavLink>
            <NavLink className="nav-link" to="/reports">{t('nav.reports')}</NavLink>
          </nav>

          <div className="d-flex align-items-center gap-2 ms-auto">
            <ThemeToggle />
            <LanguageToggle />
            {user && (
              <span className="user-chip d-none d-md-inline-flex">
                <span className="avatar">{initial}</span>
                {user.name}
              </span>
            )}
            <button className="btn btn-outline-secondary btn-sm" onClick={handleLogout}>
              {t('nav.signout')}
            </button>
          </div>
        </div>
      </header>

      <main className="main-container">
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/citizens" element={<Citizens />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  const token = localStorage.getItem('token');
  const location = useLocation();
  const lang = getLang();

  useEffect(() => {
    if (token && !user) {
      api.get('/auth/me')
        .then((res) => {
          setUser(res.data);
          localStorage.setItem('user', JSON.stringify(res.data));
        })
        .catch(() => {});
    }
  }, [token, user]);

  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';

  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <Login onLogin={setUser} />}
      />
      <Route
        path="/register"
        element={token ? <Navigate to="/" replace /> : <Register onLogin={setUser} />}
      />
      <Route
        path="/*"
        element={
          token ? (
            <Layout user={user} onLogout={() => setUser(null)} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}