import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { formatMoney } from '../api';
import { useI18n, apiError, formatDate } from '../i18n';

const emptyForm = {
  name: '', id_number: '', phone: '', gender: '', spouse_name: '', spouse_id: '',
  num_other_persons: '', district: '', sector: '', cell: '', village: '',
  ics_serial: '', registration_date: '', address: '', place: '', notes: '',
};

export default function Citizens() {
  const { t } = useI18n();
  const [citizens, setCitizens] = useState([]);
  const [search, setSearch] = useState('');
  const [place, setPlace] = useState('');
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/citizens', { params: { search, place } });
      setCitizens(data);
      setPlaces([...new Set(data.map((c) => c.place).filter(Boolean))].sort());
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [search, place]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalError('');
    setShowModal(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name, id_number: c.id_number, phone: c.phone || '', gender: c.gender || '',
      spouse_name: c.spouse_name || '', spouse_id: c.spouse_id || '',
      num_other_persons: c.num_other_persons == null ? '' : c.num_other_persons,
      district: c.district || '', sector: c.sector || '', cell: c.cell || '',
      village: c.village || '', ics_serial: c.ics_serial || '',
      registration_date: c.registration_date || '', address: c.address || '',
      place: c.place || '', notes: c.notes || '',
    });
    setModalError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    try {
      const idNumber = form.id_number.trim().toLowerCase();
      const dup = citizens.find((c) =>
        c.id_number.trim().toLowerCase() === idNumber && c.id !== (editing && editing.id)
      );
      if (dup) {
        setModalError(`${t('cit.dup')} ${dup.name}.`);
        return;
      }
      if (editing) {
        await api.put(`/citizens/${editing.id}`, form);
      } else {
        await api.post('/citizens', form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setModalError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/citizens/${deleting.id}`);
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
          <h2 className="mb-0">{t('cit.title')}</h2>
          <p className="text-muted mb-0">{t('cit.subtitle')}</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={openAdd}>{t('cit.add')}</button>
      </div>

      <div className="kr-card mb-3 p-3">
        <div className="row g-2 align-items-center">
          <div className="col-md-6">
            <input
              className="form-control"
              placeholder={t('cit.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="col-md-3">
            <select className="form-select" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="">{t('cit.allPlaces')}</option>
              {places.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="col-md-3 text-md-end">
            <span className="text-muted small">{citizens.length} {t('cit.count')}</span>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 mb-3">{error}</div>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : citizens.length === 0 ? (
        <div className="empty-state">
          {t('cit.empty')} <strong>+ {t('cit.add')}</strong> {t('cit.emptyCta')}
        </div>
      ) : (
        <div className="kr-card p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>{t('cit.thName')}</th>
                  <th>{t('cit.thGender')}</th>
                  <th>{t('cit.thId')}</th>
                  <th>{t('cit.thPhone')}</th>
                  <th>{t('cit.thPlace')}</th>
                  <th>{t('cit.thVillage')}</th>
                  <th>{t('cit.thStatus')}</th>
                  <th className="text-end">{t('cit.thTotalPaid')}</th>
                  <th>{t('cit.thLastPayment')}</th>
                  <th className="text-end">{t('cit.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {citizens.map((c) => {
                  const paid = (c.payment_count || 0) > 0;
                  return (
                    <tr key={c.id}>
                      <td className="fw-semibold">{c.name}</td>
                      <td>{c.gender || '—'}</td>
                      <td>{c.id_number}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.place || '—'}</td>
                      <td>{c.village || '—'}</td>
                      <td>
                        <span className={`badge ${paid ? 'badge-paid' : 'badge-unpaid'}`}>
                          {paid ? t('cit.paid') : t('cit.unpaid')}
                        </span>
                      </td>
                      <td className="text-end money">{formatMoney(c.total_paid)}</td>
                      <td>{formatDate(c.last_payment_date)}</td>
                      <td className="text-end text-nowrap">
                        <button className="btn-icon me-1" title={t('pay.record')}
                          onClick={() => navigate(`/payments?citizen=${c.id}`)}>
                          💵
                        </button>
                        <button className="btn-icon me-1" title={t('cit.editModalTitle')}
                          onClick={() => openEdit(c)}>
                          ✏️
                        </button>
                        <button className="btn-icon" title={t('cit.deleteTitle')}
                          onClick={() => setDeleting(c)}>
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'var(--overlay)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleSave}>
                <div className="modal-header">
                  <h5 className="modal-title">{editing ? t('cit.editModalTitle') : t('cit.addModalTitle')}</h5>
                  <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
                </div>
                <div className="modal-body">
                  {modalError && <div className="alert alert-danger py-2">{modalError}</div>}
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.name')} *</label>
                      <input className="form-control" value={form.name} required
                        onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.id')} *</label>
                      <input className="form-control" value={form.id_number} required
                        onChange={(e) => setForm({ ...form, id_number: e.target.value })} />
                      <div className="form-text">{t('cit.idHint')}</div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.phone')}</label>
                      <input className="form-control" value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.place')}</label>
                      <input className="form-control" value={form.place}
                        placeholder={t('cit.placeExample')}
                        onChange={(e) => setForm({ ...form, place: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.gender')}</label>
                      <select className="form-select" value={form.gender}
                        onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                        <option value="">—</option>
                        <option value="M">{t('cit.genderM')}</option>
                        <option value="F">{t('cit.genderF')}</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.regDate')}</label>
                      <input type="date" className="form-control" value={form.registration_date}
                        onChange={(e) => setForm({ ...form, registration_date: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.spouseName')}</label>
                      <input className="form-control" value={form.spouse_name}
                        onChange={(e) => setForm({ ...form, spouse_name: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.spouseId')}</label>
                      <input className="form-control" value={form.spouse_id}
                        onChange={(e) => setForm({ ...form, spouse_id: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.numPersons')}</label>
                      <input type="number" min="0" className="form-control" value={form.num_other_persons}
                        onChange={(e) => setForm({ ...form, num_other_persons: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.icsSerial')}</label>
                      <input className="form-control" value={form.ics_serial}
                        onChange={(e) => setForm({ ...form, ics_serial: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.district')}</label>
                      <input className="form-control" value={form.district}
                        onChange={(e) => setForm({ ...form, district: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.sector')}</label>
                      <input className="form-control" value={form.sector}
                        onChange={(e) => setForm({ ...form, sector: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.cell')}</label>
                      <input className="form-control" value={form.cell}
                        onChange={(e) => setForm({ ...form, cell: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.village')}</label>
                      <input className="form-control" value={form.village}
                        onChange={(e) => setForm({ ...form, village: e.target.value })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{t('cit.address')}</label>
                      <input className="form-control" value={form.address}
                        onChange={(e) => setForm({ ...form, address: e.target.value })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{t('cit.notes')}</label>
                      <textarea className="form-control" rows="2" value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>
                    {t('cit.cancel')}
                  </button>
                  <button type="submit" className="btn btn-primary px-4" disabled={saving}>
                    {saving ? t('cit.saving') : editing ? t('cit.saveEdit') : t('cit.saveAdd')}
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
                <h5 className="modal-title">{t('cit.deleteTitle')}</h5>
                <button type="button" className="btn-close" onClick={() => setDeleting(null)}></button>
              </div>
              <div className="modal-body">
                {t('cit.deleteBody')} <strong>{deleting.name}</strong>? {t('cit.deleteBody2')}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setDeleting(null)}>{t('cit.cancel')}</button>
                <button className="btn btn-danger px-4" onClick={confirmDelete}>{t('cit.delete')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
