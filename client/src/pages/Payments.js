import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { formatMoney, today } from '../api';
import { useI18n, apiError, formatDate } from '../i18n';

const emptyForm = { citizen_id: '', amount: '', payment_date: today(), place: '', method: 'Cash', notes: '' };

export default function Payments() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [payments, setPayments] = useState([]);
  const [citizens, setCitizens] = useState([]);
  const [totals, setTotals] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({ place: '', from: '', to: '' });
  const [citizenSearch, setCitizenSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const citizen = searchParams.get('citizen');
    if (citizen) setForm((f) => ({ ...f, citizen_id: citizen }));
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { ...filters };
      if (form.citizen_id) params.citizen_id = form.citizen_id;
      const [pays, cit] = await Promise.all([
        api.get('/payments', { params }),
        api.get('/citizens'),
      ]);
      setPayments(pays.data);
      setCitizens(cit.data);
      const total = pays.data.reduce((sum, p) => sum + Number(p.amount), 0);
      setTotals({ count: pays.data.length, total });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [filters, form.citizen_id]);

  useEffect(() => { load(); }, [load]);

  const filteredCitizens = citizens.filter((c) =>
    !citizenSearch || c.name.toLowerCase().includes(citizenSearch.toLowerCase()) || c.id_number.toLowerCase().includes(citizenSearch.toLowerCase())
  );

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      if (editing) {
        await api.put(`/payments/${editing.id}`, payload);
      } else {
        await api.post('/payments', payload);
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({ citizen_id: p.citizen_id, amount: p.amount, payment_date: p.payment_date?.slice(0, 10) || today(), place: p.place || '', method: p.method || 'Cash', notes: p.notes || '' });
    setShowForm(true);
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/payments/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (err) {
      setError(apiError(err));
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <h2 className="mb-0">{t('pay.title')}</h2>
          <p className="text-muted mb-0">{t('pay.subtitle')}</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(true); }}>
          {t('pay.record')}
        </button>
      </div>

      <div className="kr-card mb-3 p-3">
        <div className="row g-2 align-items-end">
          <div className="col-md-3">
            <label className="form-label small text-muted">{t('pay.placeFilter')}</label>
            <input className="form-control" placeholder={t('pay.allPlaces')} value={filters.place}
              onChange={(e) => setFilters({ ...filters, place: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">{t('pay.from')}</label>
            <input type="date" className="form-control" value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">{t('pay.to')}</label>
            <input type="date" className="form-control" value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div className="col-md-3">
            {totals && (
              <div className="text-md-end">
                <div className="text-muted small">{totals.count} {t('pay.payments')}</div>
                <div className="h5 money mb-0">{t('pay.totalLabel')} {formatMoney(totals.total)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 mb-3">{error}</div>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : payments.length === 0 ? (
        <div className="empty-state">
          {t('pay.empty')}{form.citizen_id ? ` ${t('pay.forCitizen')}` : ''}.
        </div>
      ) : (
        <div className="kr-card p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>{t('pay.thDate')}</th>
                  <th>{t('pay.thCitizen')}</th>
                  <th>{t('pay.thId')}</th>
                  <th>{t('pay.thPlace')}</th>
                  <th>{t('pay.thMethod')}</th>
                  <th className="text-end">{t('pay.thAmount')}</th>
                  <th className="text-end">{t('pay.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.payment_date)}</td>
                    <td className="fw-semibold">{p.citizen_name}</td>
                    <td>{p.id_number}</td>
                    <td>{p.place || '—'}</td>
                    <td>{p.method || '—'}</td>
                    <td className="text-end money">{formatMoney(p.amount)}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn-icon me-1" title={t('pay.editTitle')} onClick={() => openEdit(p)}>✏️</button>
                      <button className="btn-icon" title={t('pay.deleteTitle')} onClick={() => setDeleting(p)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'var(--overlay)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleSave}>
                <div className="modal-header">
                  <h5 className="modal-title">{editing ? t('pay.editTitle') : t('pay.recordTitle')}</h5>
                  <button type="button" className="btn-close" onClick={() => setShowForm(false)}></button>
                </div>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">{t('pay.citizen')} *</label>
                      {editing ? (
                        <input className="form-control" value={citizens.find((c) => c.id === Number(form.citizen_id))?.name || ''} disabled />
                      ) : (
                        <>
                          <input className="form-control mb-1" placeholder={t('pay.searchCitizen')} value={citizenSearch}
                            onChange={(e) => setCitizenSearch(e.target.value)} />
                          <select className="form-select" required value={form.citizen_id}
                            onChange={(e) => setForm({ ...form, citizen_id: e.target.value })}>
                            <option value="">{t('pay.chooseCitizen')}</option>
                            {filteredCitizens.map((c) => (
                              <option key={c.id} value={c.id}>{c.name} — {c.id_number}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('pay.amount')} *</label>
                      <input type="number" min="0" step="0.01" className="form-control" required value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('pay.date')}</label>
                      <input type="date" className="form-control" value={form.payment_date}
                        onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('pay.placeFilter')}</label>
                      <input className="form-control" value={form.place}
                        onChange={(e) => setForm({ ...form, place: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('pay.method')}</label>
                      <select className="form-select" value={form.method}
                        onChange={(e) => setForm({ ...form, method: e.target.value })}>
                        <option>{t('pay.cash')}</option>
                        <option>{t('pay.bank')}</option>
                        <option>{t('pay.mobile')}</option>
                        <option>{t('pay.cheque')}</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('pay.notes')}</label>
                      <input className="form-control" value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>{t('pay.cancel')}</button>
                  <button type="submit" className="btn btn-primary px-4" disabled={saving}>
                    {saving ? t('pay.saving') : editing ? t('pay.saveChanges') : t('pay.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'var(--overlay)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('pay.deleteTitle')}</h5>
                <button type="button" className="btn-close" onClick={() => setDeleting(null)}></button>
              </div>
              <div className="modal-body">
                {t('pay.deleteBody')} <strong>{formatMoney(deleting.amount)}</strong>{' '}
                {t('pay.deleteBody2')} <strong>{deleting.citizen_name}</strong>{' '}
                {formatDate(deleting.payment_date)}? {t('pay.deleteBody3')}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setDeleting(null)}>{t('pay.cancel')}</button>
                <button className="btn btn-danger px-4" onClick={confirmDelete}>{t('pay.delete')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
