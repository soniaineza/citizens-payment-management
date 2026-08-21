import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api, { formatMoney } from '../api';
import { useI18n, apiError, formatDate } from '../i18n';

const PIE_COLORS = ['#0b0b0f', '#4453c8', '#0e7a4d', '#b45309', '#b42318', '#7c3aed'];

function StatCard({ icon, tone, label, value, sub }) {
  const toneClass = {
    pink: 'stat-icon--pink',
    green: 'stat-icon--green',
    red: 'stat-icon--red',
    purple: 'stat-icon--purple',
  }[tone] || 'stat-icon--pink';
  return (
    <div className="card stat-card h-100">
      <div className="card-body d-flex align-items-center gap-3">
        <span className={`stat-icon ${toneClass}`}>{icon}</span>
        <div className="min-width-0">
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
          {sub && <div className="text-muted small">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ user }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState(null);
  const [recentPayments, setRecentPayments] = useState([]);
  const [unpaid, setUnpaid] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [byPlace, setByPlace] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/reports/summary'),
      api.get('/payments'),
      api.get('/citizens'),
      api.get('/reports/monthly'),
      api.get('/reports/by-place'),
    ])
      .then(([sum, pays, citizens, monthRes, placeRes]) => {
        if (!active) return;
        setSummary(sum.data);
        setRecentPayments(pays.data.slice(0, 6));
        const unpaidList = citizens.data.filter((c) => (c.payment_count || 0) === 0).slice(0, 6);
        setUnpaid(unpaidList);
        setMonthly(monthRes.data);
        setByPlace(placeRes.data);
      })
      .catch((err) => setError(apiError(err)));
    return () => { active = false; };
  }, []);

  return (
    <div>
      <div className="mb-4">
        <h2 className="mb-1">{t('dash.hello')}, {user?.name?.split(' ')[0]} 👋</h2>
        <p className="text-muted mb-0">{t('dash.overview')}</p>
      </div>

      {error && <div className="alert alert-danger py-2 mb-4">{error}</div>}

      {summary && (
        <div className="row g-3 mb-4">
          <div className="col-sm-6 col-lg-3">
            <StatCard icon="👥" tone="pink" label={t('dash.totalCitizens')} value={summary.total_citizens} />
          </div>
          <div className="col-sm-6 col-lg-3">
            <StatCard icon="✅" tone="green" label={t('dash.paid')} value={summary.paid_citizens} />
          </div>
          <div className="col-sm-6 col-lg-3">
            <StatCard icon="⏳" tone="red" label={t('dash.unpaid')} value={summary.unpaid_citizens} />
          </div>
          <div className="col-sm-6 col-lg-3">
            <StatCard icon="💰" tone="purple" label={t('dash.collected')} value={formatMoney(summary.total_collected)} />
          </div>
        </div>
      )}

      <div className="row g-4 mb-4">
        <div className="col-lg-7">
          <div className="kr-card">
            <h5 className="mb-3">{t('dash.monthlyChart')}</h5>
            {monthly.length === 0 ? (
              <p className="text-muted mb-0">{t('dash.noPayments')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthly} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'var(--text-2)', fontSize: 12 }}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-2)', fontSize: 12 }}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickLine={false}
                    tickFormatter={(v) => formatMoney(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                    }}
                    formatter={(value) => [formatMoney(value), t('dash.collected')]}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {monthly.map((_, i) => (
                      <Cell key={i} fill="var(--text-3)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="col-lg-5">
          <div className="kr-card">
            <h5 className="mb-3">{t('dash.placeChart')}</h5>
            {byPlace.length === 0 ? (
              <p className="text-muted mb-0">{t('dash.noPayments')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={byPlace}
                    dataKey="total"
                    nameKey="place"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    paddingAngle={2}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: 'var(--text-3)' }}
                  >
                    {byPlace.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                    }}
                    formatter={(value) => [formatMoney(value)]}
                  />
                  <Legend
                    wrapperStyle={{ color: 'var(--text-2)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="kr-card">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="mb-0">{t('dash.recentPayments')}</h5>
              <Link to="/payments" className="btn btn-sm btn-outline-secondary">{t('dash.viewAll')}</Link>
            </div>
            {recentPayments.length === 0 ? (
              <p className="text-muted mb-0">{t('dash.noPayments')}</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>{t('dash.tableDate')}</th>
                      <th>{t('dash.tableCitizen')}</th>
                      <th>{t('dash.tablePlace')}</th>
                      <th className="text-end">{t('dash.tableAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPayments.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.payment_date)}</td>
                        <td className="fw-semibold">{p.citizen_name}</td>
                        <td>{p.place || '—'}</td>
                        <td className="text-end money">{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-lg-5">
          <div className="kr-card">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="mb-0">{t('dash.notYetPaid')}</h5>
              <Link to="/citizens" className="btn btn-sm btn-outline-secondary">{t('dash.viewAll')}</Link>
            </div>
            {unpaid.length === 0 ? (
              <p className="text-muted mb-0">{t('dash.everyonePaid')}</p>
            ) : (
              <ul className="list-unstyled mb-0">
                {unpaid.map((c) => (
                  <li key={c.id} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                    <div>
                      <div className="fw-semibold">{c.name}</div>
                      <div className="text-muted small">{c.id_number}</div>
                    </div>
                    <span className="badge badge-unpaid">{t('cit.unpaid')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
