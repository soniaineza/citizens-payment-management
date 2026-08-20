import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';
import { useI18n, apiError } from '../i18n';

export default function Register({ onLogin }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const isAdminCreating = !!localStorage.getItem('token');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      if (isAdminCreating) {
        setSuccess(`${t('auth.accountCreated')} ${data.user.email}`);
        setName('');
        setEmail('');
        setPassword('');
      } else {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLogin(data.user);
        navigate('/');
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="text-center mb-4">
          <span className="auth-brand mx-auto d-flex">🗂️</span>
          <h1 className="h3 mb-1">{t('auth.register.title')}</h1>
          <p className="text-muted mb-0">
            {t(isAdminCreating ? 'auth.register.subtitleAdmin' : 'auth.register.subtitle')}
          </p>
        </div>

        {error && <div className="alert alert-danger py-2">{error}</div>}
        {success && <div className="alert alert-success py-2">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label">{t('auth.name')}</label>
            <input
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="mb-3">
            <label className="form-label">{t('auth.email')}</label>
            <input
              type="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <label className="form-label">{t('auth.passwordHint')}</label>
            <input
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <button className="btn btn-primary w-100 py-2" disabled={loading}>
            {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
          </button>
        </form>

        <div className="text-center mt-3 small text-muted">
          {isAdminCreating ? (
            <Link to="/">{t('auth.backToApp')}</Link>
          ) : (
            <>
              {t('auth.haveAccount')} <Link to="/login">{t('auth.signin')}</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}