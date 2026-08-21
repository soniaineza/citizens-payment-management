import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api, { formatMoney } from '../api';
import { useI18n, apiError, formatDate } from '../i18n';

const emptyForm = {
  name: '', id_number: '', phone: '', gender: '', spouse_name: '', spouse_id: '',
  num_other_persons: '', district: '', sector: '', cell: '', village: '',
  ics_serial: '', registration_date: '', address: '', place: '', notes: '',
};

export default function Citizens({ user }) {
  const { t } = useI18n();
  const [citizens, setCitizens] = useState([]);
  const [search, setSearch] = useState('');
  const [place, setPlace] = useState('');
  const [places, setPlaces] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [newColumns, setNewColumns] = useState([]);
  const navigate = useNavigate();

  const isViewer = user?.role === 'viewer';

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

  const filteredCitizens = citizens.filter((c) => {
    if (dateFrom && c.registration_date && c.registration_date < dateFrom) return false;
    if (dateTo && c.registration_date && c.registration_date > dateTo) return false;
    return true;
  });

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredCitizens.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredCitizens.map((c) => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(t('cit.bulkDeleteConfirm').replace('{count}', selected.size))) return;
    try {
      await api.post('/citizens/bulk-delete', { ids: [...selected] });
      setSelected(new Set());
      load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const exportExcel = () => {
    const data = filteredCitizens.map((c) => ({
      Name: c.name, 'ID Number': c.id_number, Phone: c.phone || '', Gender: c.gender || '',
      Place: c.place || '', Village: c.village || '', District: c.district || '',
      Sector: c.sector || '', Cell: c.cell || '', Address: c.address || '',
      Notes: c.notes || '', 'Registration Date': c.registration_date || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Citizens');
    XLSX.writeFile(wb, `citizens-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

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

  const knownCitizenCols = new Set([
    'name', 'id_number', 'id number', 'id', 'phone', 'gender',
    'spouse_name', 'spouse name', 'spouse_id', 'spouse id',
    'num_other_persons', 'num other persons', 'district', 'sector',
    'cell', 'village', 'ics_serial', 'ics serial',
    'registration_date', 'registration date', 'address', 'place', 'notes',
  ]);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    setImportResult(null);

    const ext = file.name.split('.').pop().toLowerCase();
    let rows = [];
    let headers = [];
    if (ext === 'csv') {
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) { setImportPreview({ rows: [], error: 'File has no data rows.' }); return; }
      headers = lines[0].split(',').map((h) => h.trim());
      const nameIdx = headers.findIndex((h) => h.toLowerCase() === 'name');
      const idIdx = headers.findIndex((h) => h.toLowerCase() === 'id_number' || h.toLowerCase() === 'id number' || h.toLowerCase() === 'id');
      if (nameIdx === -1 || idIdx === -1) { setImportPreview({ rows: [], error: 'CSV must have "name" and "id_number" columns.' }); return; }
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        rows.push({ line: i + 1, name: cols[nameIdx] || '', idNumber: cols[idIdx] || '' });
      }
    } else {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      if (json.length > 0) headers = Object.keys(json[0]);
      for (let i = 0; i < json.length; i++) {
        const r = json[i];
        rows.push({ line: i + 2, name: r.name || r.Name || '', idNumber: r.id_number || r['ID Number'] || r.ID || '' });
      }
    }

    // Detect new columns
    const detected = headers.map((h) => h.toLowerCase().trim()).filter((h) => h && !knownCitizenCols.has(h));
    const uniqueNew = [...new Set(detected)];
    setNewColumns(uniqueNew);

    const existingIds = new Set(citizens.map((c) => c.id_number.toLowerCase()));
    const preview = rows.map((r) => {
      const isEmpty = !r.name || !r.idNumber;
      const isExisting = !isEmpty && existingIds.has(r.idNumber.toLowerCase());
      return { ...r, status: isEmpty ? 'empty' : isExisting ? 'update' : 'ok' };
    });
    setImportPreview({ rows: preview });
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const ext = importFile.name.split('.').pop().toLowerCase();
      let csvText;
      if (ext === 'csv') {
        csvText = await importFile.text();
      } else {
        const data = await importFile.arrayBuffer();
        const wb = XLSX.read(data);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);
        if (json.length === 0) { setImportResult({ error: 'Excel file is empty.' }); return; }
        const allKeys = Object.keys(json[0]);
        const lines = [allKeys.join(',')];
        json.forEach((r) => {
          const row = allKeys.map((k) => `"${String(r[k] || '').replace(/"/g, '""')}"`).join(',');
          lines.push(row);
        });
        csvText = lines.join('\n');
      }
      const { data } = await api.post('/citizens/import', { csv: csvText });
      setImportResult(data);
      setImportPreview(null);
      setImportFile(null);
      load();
    } catch (err) {
      setImportResult({ error: apiError(err) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <h2 className="mb-0">{t('cit.title')}</h2>
          <p className="text-muted mb-0">{t('cit.subtitle')}</p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {!isViewer && <button className="btn btn-primary btn-lg" onClick={openAdd}>{t('cit.add')}</button>}
          {!isViewer && <button className="btn btn-outline-secondary btn-lg" onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); setImportPreview(null); setNewColumns([]); }}>{t('cit.import')}</button>}
          <button className="btn btn-outline-secondary btn-lg" onClick={exportExcel}>⬇️ {t('cit.exportCsv')}</button>
          {selected.size > 0 && !isViewer && (
            <button className="btn btn-danger btn-lg" onClick={handleBulkDelete}>
              🗑️ {t('cit.bulkDelete')} ({selected.size})
            </button>
          )}
        </div>
      </div>

      <div className="kr-card mb-3 p-3">
        <div className="row g-2 align-items-center">
          <div className="col-md-4">
            <input className="form-control" placeholder={t('cit.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="col-md-2">
            <select className="form-select" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="">{t('cit.allPlaces')}</option>
              {places.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder={t('cit.dateFrom')} />
          </div>
          <div className="col-md-2">
            <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder={t('cit.dateTo')} />
          </div>
          <div className="col-md-2 text-md-end">
            <span className="text-muted small">{filteredCitizens.length} {t('cit.count')}</span>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 mb-3">{error}</div>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : filteredCitizens.length === 0 ? (
        <div className="empty-state">
          {t('cit.empty')} <strong>+ {t('cit.add')}</strong> {t('cit.emptyCta')}
        </div>
      ) : (
        <div className="kr-card p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  {!isViewer && <th style={{ width: 40 }}>
                    <input type="checkbox" className="form-check-input" checked={selected.size === filteredCitizens.length && filteredCitizens.length > 0} onChange={toggleSelectAll} />
                  </th>}
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
                {filteredCitizens.map((c) => {
                  const paid = (c.payment_count || 0) > 0;
                  return (
                    <tr key={c.id}>
                      {!isViewer && <td>
                        <input type="checkbox" className="form-check-input" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                      </td>}
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
                        {!isViewer && <>
                          <button className="btn-icon me-1" title={t('cit.editModalTitle')}
                            onClick={() => openEdit(c)}>
                            ✏️
                          </button>
                          <button className="btn-icon" title={t('cit.deleteTitle')}
                            onClick={() => setDeleting(c)}>
                            🗑️
                          </button>
                        </>}
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
                      <input className="form-control" value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.id')} *</label>
                      <input className="form-control" value={form.id_number} required onChange={(e) => setForm({ ...form, id_number: e.target.value })} />
                      <div className="form-text">{t('cit.idHint')}</div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.phone')}</label>
                      <input className="form-control" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.place')}</label>
                      <input className="form-control" value={form.place} placeholder={t('cit.placeExample')} onChange={(e) => setForm({ ...form, place: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.gender')}</label>
                      <select className="form-select" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                        <option value="">—</option>
                        <option value="M">{t('cit.genderM')}</option>
                        <option value="F">{t('cit.genderF')}</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.regDate')}</label>
                      <input type="date" className="form-control" value={form.registration_date} onChange={(e) => setForm({ ...form, registration_date: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.spouseName')}</label>
                      <input className="form-control" value={form.spouse_name} onChange={(e) => setForm({ ...form, spouse_name: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.spouseId')}</label>
                      <input className="form-control" value={form.spouse_id} onChange={(e) => setForm({ ...form, spouse_id: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.numPersons')}</label>
                      <input type="number" min="0" className="form-control" value={form.num_other_persons} onChange={(e) => setForm({ ...form, num_other_persons: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.icsSerial')}</label>
                      <input className="form-control" value={form.ics_serial} onChange={(e) => setForm({ ...form, ics_serial: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.district')}</label>
                      <input className="form-control" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.sector')}</label>
                      <input className="form-control" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.cell')}</label>
                      <input className="form-control" value={form.cell} onChange={(e) => setForm({ ...form, cell: e.target.value })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{t('cit.village')}</label>
                      <input className="form-control" value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{t('cit.address')}</label>
                      <input className="form-control" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{t('cit.notes')}</label>
                      <textarea className="form-control" rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>{t('cit.cancel')}</button>
                  <button type="submit" className="btn btn-primary px-4" disabled={saving}>
                    {saving ? t('cit.saving') : editing ? t('cit.saveEdit') : t('cit.saveAdd')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'var(--overlay)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('cit.importTitle')}</h5>
                <button type="button" className="btn-close" onClick={() => { setShowImport(false); setImportPreview(null); }}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">{t('cit.importHint')}</p>
                {importResult && !importResult.error && (
                  <div className="alert alert-success py-2">
                    {t('cit.importResult2').replace('{imported}', importResult.imported).replace('{updated}', importResult.updated || 0).replace('{skipped}', importResult.skipped).replace('{total}', importResult.total)}
                    {importResult.newColumns && importResult.newColumns.length > 0 && (
                      <div className="mt-1 small">
                        New columns created: <strong>{importResult.newColumns.join(', ')}</strong>
                      </div>
                    )}
                  </div>
                )}
                {importResult && importResult.error && (
                  <div className="alert alert-danger py-2">{importResult.error}</div>
                )}
                {importPreview && importPreview.error && (
                  <div className="alert alert-danger py-2">{importPreview.error}</div>
                )}
                {newColumns.length > 0 && (
                  <div className="alert alert-info py-2 mb-2" style={{ background: 'var(--tint-indigo)', color: 'var(--tint-indigo-fg)' }}>
                    New columns will be created: <strong>{newColumns.join(', ')}</strong>
                  </div>
                )}
                {importPreview && importPreview.rows && importPreview.rows.length > 0 && (
                  <div className="mb-3">
                    <div className="d-flex gap-3 mb-2">
                      <span className="badge badge-paid">{t('cit.importRowsOk').replace('{count}', importPreview.rows.filter((r) => r.status === 'ok').length)}</span>
                      <span className="badge" style={{ background: 'var(--tint-amber)', color: 'var(--tint-amber-fg)' }}>{t('cit.importRowsUpdate').replace('{count}', importPreview.rows.filter((r) => r.status === 'update').length)}</span>
                      <span className="badge badge-unpaid">{t('cit.importRowsSkip').replace('{count}', importPreview.rows.filter((r) => r.status === 'empty').length)}</span>
                    </div>
                    <div className="table-responsive" style={{ maxHeight: 300 }}>
                      <table className="table table-sm mb-0">
                        <thead>
                          <tr><th>#</th><th>{t('cit.name')}</th><th>{t('cit.id')}</th><th>{t('cit.thStatus')}</th></tr>
                        </thead>
                        <tbody>
                          {importPreview.rows.slice(0, 50).map((r) => (
                            <tr key={r.line}>
                              <td>{r.line}</td>
                              <td>{r.name}</td>
                              <td>{r.idNumber}</td>
                              <td>
                                {r.status === 'ok' && <span className="badge badge-paid">{t('cit.paid')}</span>}
                                {r.status === 'update' && <span className="badge" style={{ background: 'var(--tint-amber)', color: 'var(--tint-amber-fg)' }}>{t('cit.importUpdate')}</span>}
                                {r.status === 'empty' && <span className="badge bg-secondary">Empty</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {importPreview.rows.length > 50 && <p className="text-muted small mt-2">...and {importPreview.rows.length - 50} more rows</p>}
                  </div>
                )}
                <input type="file" className="form-control" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowImport(false); setImportPreview(null); }}>{t('cit.importCancel')}</button>
                {importPreview && importPreview.rows && (
                  <button type="button" className="btn btn-primary px-4" disabled={!importFile || importing || importPreview.rows.length === 0} onClick={handleImport}>
                    {importing ? t('cit.importing') : t('cit.importProceed')}
                  </button>
                )}
              </div>
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
