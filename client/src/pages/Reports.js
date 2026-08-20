import React, { useEffect, useState, useCallback } from 'react';
import api, { formatMoney, today } from '../api';
import { useI18n, apiError, formatDate } from '../i18n';

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: today() };
}

export default function Reports() {
  const { t } = useI18n();
  const [filters, setFilters] = useState(monthRange());
  const [place, setPlace] = useState('');
  const [report, setReport] = useState(null);
  const [byPlace, setByPlace] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { ...filters, place };
      const [rep, places, months] = await Promise.all([
        api.get('/reports/payments', { params }),
        api.get('/reports/by-place', { params: filters }),
        api.get('/reports/monthly', { params: filters }),
      ]);
      setReport(rep.data);
      setByPlace(places.data);
      setMonthly(months.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [filters, place]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!report || report.payments.length === 0) return;
    const header = ['Date', 'Citizen', 'ID Number', 'Place', 'Method', 'Amount'];
    const lines = report.payments.map((p) =>
      [p.payment_date, `"${p.citizen_name}"`, `"${p.id_number}"`, `"${p.place || ''}"`, `"${p.method || ''}"`, p.amount].join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-report-${filters.from || 'all'}-${filters.to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const avg = report && report.totals.count ? report.totals.total / report.totals.count : 0;
  const maxPlace = byPlace.length ? Math.max(...byPlace.map((p) => Number(p.total))) : 1;
  const maxMonth = monthly.length ? Math.max(...monthly.map((m) => Number(m.total))) : 1;

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <h2 className="mb-0">{t('rep.title')}</h2>
          <p className="text-muted mb-0">{t('rep.subtitle')}</p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-outline-secondary" onClick={() => setFilters(monthRange())}>{t('rep.thisMonth')}</button>
          <button className="btn btn-outline-secondary" onClick={() => setFilters({ from: '', to: '' })}>{t('rep.allTime')}</button>
          <button className="btn btn-primary" onClick={exportCsv} disabled={!report || report.payments.length === 0}>
            ⬇️ {t('rep.exportCsv')}
          </button>
        </div>
      </div>

      <div className="kr-card mb-3 p-3">
        <div className="row g-2 align-items-end">
          <div className="col-md-3">
            <label className="form-label small text-muted">{t('rep.from')}</label>
            <input type="date" className="form-control" value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">{t('rep.to')}</label>
            <input type="date" className="form-control" value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">{t('rep.place')}</label>
            <input className="form-control" placeholder={t('pay.allPlaces')} value={place}
              onChange={(e) => setPlace(e.target.value)} />
          </div>
          <div className="col-md-3 d-flex justify-content-md-end">
            {report && (
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPlace('')}>{t('rep.clearFilters')}</button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 mb-3">{error}</div>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <>
          {report && (
            <div className="row g-3 mb-4">
              <div className="col-sm-6 col-lg-3">
                <div className="card stat-card h-100">
                  <div className="card-body">
                    <div className="stat-label">{t('rep.payments')}</div>
                    <div className="stat-value">{report.totals.count}</div>
                  </div>
                </div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="card stat-card h-100">
                  <div className="card-body">
                    <div className="stat-label">{t('rep.totalCollected')}</div>
                    <div className="stat-value money">{formatMoney(report.totals.total)}</div>
                  </div>
                </div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="card stat-card h-100">
                  <div className="card-body">
                    <div className="stat-label">{t('rep.avgPayment')}</div>
                    <div className="stat-value money">{formatMoney(avg)}</div>
                  </div>
                </div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="card stat-card h-100">
                  <div className="card-body">
                    <div className="stat-label">{t('rep.period')}</div>
                    <div className="h5 mb-0 pt-1">
                      {formatDate(report.totals.earliest || filters.from)} → {formatDate(report.totals.latest || filters.to)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="row g-4">
            <div className="col-lg-7">
              <div className="kr-card">
                <h5 className="mb-3">{t('rep.details')}</h5>
                {report && report.payments.length === 0 ? (
                  <p className="text-muted mb-0">{t('rep.noPayments')}</p>
                ) : (
                  <div className="table-responsive" style={{ maxHeight: 420 }}>
                    <table className="table table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>{t('rep.thDate')}</th>
                          <th>{t('rep.thCitizen')}</th>
                          <th>{t('rep.thPlace')}</th>
                          <th>{t('rep.thMethod')}</th>
                          <th className="text-end">{t('rep.thAmount')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report && report.payments.map((p) => (
                          <tr key={p.id}>
                            <td>{formatDate(p.payment_date)}</td>
                            <td>{p.citizen_name}</td>
                            <td>{p.place || '—'}</td>
                            <td>{p.method || '—'}</td>
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
              <div className="kr-card mb-4">
                <h5 className="mb-3">{t('rep.byPlace')}</h5>
                {byPlace.length === 0 ? (
                  <p className="text-muted mb-0">{t('rep.noData')}</p>
                ) : (
                  byPlace.map((p) => (
                    <div key={p.place} className="mb-3">
                      <div className="d-flex justify-content-between small">
                        <span className="fw-semibold">{p.place}</span>
                        <span className="money">{formatMoney(p.total)} ({p.count})</span>
                      </div>
                      <div className="progress" style={{ height: '0.6rem' }}>
                        <div className="progress-bar" role="progressbar"
                          style={{ width: `${(Number(p.total) / maxPlace) * 100}%` }}>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="kr-card">
                <h5 className="mb-3">{t('rep.byMonth')}</h5>
                {monthly.length === 0 ? (
                  <p className="text-muted mb-0">{t('rep.noData')}</p>
                ) : (
                  monthly.map((m) => (
                    <div key={m.month} className="mb-3">
                      <div className="d-flex justify-content-between small">
                        <span className="fw-semibold">{m.month}</span>
                        <span className="money">{formatMoney(m.total)} ({m.count})</span>
                      </div>
                      <div className="progress" style={{ height: '0.6rem' }}>
                        <div className="progress-bar" role="progressbar"
                          style={{ width: `${(Number(m.total) / maxMonth) * 100}%` }}>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}