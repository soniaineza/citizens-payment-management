import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import api, { formatMoney, today } from '../api';
import { useI18n, apiError, formatDate } from '../i18n';

const emptyForm = { citizen_id: '', amount: '', payment_date: today(), place: '', method: 'Cash', notes: '' };

export default function Payments({ user }) {
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
  const [selected, setSelected] = useState(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [receiptPayment, setReceiptPayment] = useState(null);

  const isViewer = user?.role === 'viewer';

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

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === payments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(payments.map((p) => p.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(t('pay.bulkDeleteConfirm').replace('{count}', selected.size))) return;
    try {
      await api.post('/payments/bulk-delete', { ids: [...selected] });
      setSelected(new Set());
      load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const exportExcel = () => {
    const data = payments.map((p) => ({
      Date: p.payment_date ? formatDate(p.payment_date) : '', Citizen: p.citizen_name, 'ID Number': p.id_number,
      Place: p.place || '', Method: p.method || '', Amount: p.amount,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payments');
    XLSX.writeFile(wb, `payments-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const downloadReceipt = (p) => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('Payment Receipt', 20, 20);
    doc.setFontSize(12);
    doc.text(`Receipt #${p.id}`, 20, 35);
    doc.text(`Date: ${formatDate(p.payment_date)}`, 20, 45);
    doc.text(`Citizen: ${p.citizen_name}`, 20, 55);
    doc.text(`ID Number: ${p.id_number}`, 20, 65);
    doc.text(`Amount: ${formatMoney(p.amount)} RWF`, 20, 75);
    doc.text(`Place: ${p.place || 'N/A'}`, 20, 85);
    doc.text(`Method: ${p.method || 'N/A'}`, 20, 95);
    if (p.notes) doc.text(`Notes: ${p.notes}`, 20, 105);
    doc.text('---', 20, 115);
    doc.text('Thank you for your payment.', 20, 125);
    doc.save(`receipt-${p.id}.pdf`);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    setImportResult(null);

    const ext = file.name.split('.').pop().toLowerCase();
    let rows = [];
    if (ext === 'csv') {
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) { setImportPreview({ rows: [], error: 'File has no data rows.' }); return; }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const idIdx = headers.findIndex((h) => h === 'id_number' || h === 'id number' || h === 'id');
      const amtIdx = headers.findIndex((h) => h === 'amount');
      if (idIdx === -1 || amtIdx === -1) { setImportPreview({ rows: [], error: 'CSV must have "id_number" and "amount" columns.' }); return; }
      const dateIdx = headers.findIndex((h) => h === 'payment_date' || h === 'date');
      const placeIdx = headers.findIndex((h) => h === 'place');
      const methodIdx = headers.findIndex((h) => h === 'method');
      const notesIdx = headers.findIndex((h) => h === 'notes');
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        rows.push({
          line: i + 1, idNumber: cols[idIdx] || '', amount: cols[amtIdx] || '',
          payment_date: dateIdx > -1 ? cols[dateIdx] || '' : '',
          place: placeIdx > -1 ? cols[placeIdx] || '' : '',
          method: methodIdx > -1 ? cols[methodIdx] || '' : '',
          notes: notesIdx > -1 ? cols[notesIdx] || '' : '',
        });
      }
    } else {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      for (let i = 0; i < json.length; i++) {
        const r = json[i];
        rows.push({
          line: i + 2, idNumber: r.id_number || r['ID Number'] || r.ID || '', amount: r.amount || '',
          payment_date: r.payment_date || r.Date || '', place: r.place || '',
          method: r.method || '', notes: r.notes || '',
        });
      }
    }

    const citizenIdMap = {};
    citizens.forEach((c) => { citizenIdMap[c.id_number.toLowerCase()] = true; });
    const preview = rows.map((r) => {
      const hasAmount = r.amount && !isNaN(parseFloat(r.amount)) && parseFloat(r.amount) > 0;
      const citizenExists = r.idNumber && citizenIdMap[r.idNumber.toLowerCase()];
      const isEmpty = !r.idNumber || !hasAmount;
      const noCitizen = !isEmpty && !citizenExists;
      return { ...r, status: isEmpty ? 'empty' : noCitizen ? 'no_citizen' : 'ok' };
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
        const lines = ['id_number,amount,payment_date,place,method,notes'];
        json.forEach((r) => {
          const row = [r.id_number || r['ID Number'] || r.ID || '', r.amount || '', r.payment_date || r.Date || '', r.place || '', r.method || '', r.notes || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
          lines.push(row);
        });
        csvText = lines.join('\n');
      }
      const { data } = await api.post('/payments/import', { csv: csvText });
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
        <div className="d-flex flex-wrap gap-2">
          {!isViewer && (
            <button className="btn btn-primary btn-lg" onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(true); }}>
              {t('pay.record')}
            </button>
          )}
          {!isViewer && (
            <button className="btn btn-outline-secondary btn-lg" onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); setImportPreview(null); }}>
              {t('pay.import')}
            </button>
          )}
          <button className="btn btn-outline-secondary btn-lg" onClick={exportExcel}>⬇️ {t('pay.exportCsv')}</button>
          {selected.size > 0 && !isViewer && (
            <button className="btn btn-danger btn-lg" onClick={handleBulkDelete}>
              🗑️ {t('pay.bulkDelete')} ({selected.size})
            </button>
          )}
        </div>
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
                  {!isViewer && <th style={{ width: 40 }}>
                    <input type="checkbox" className="form-check-input" checked={selected.size === payments.length && payments.length > 0} onChange={toggleSelectAll} />
                  </th>}
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
                    {!isViewer && <td>
                      <input type="checkbox" className="form-check-input" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                    </td>}
                    <td>{formatDate(p.payment_date)}</td>
                    <td className="fw-semibold">{p.citizen_name}</td>
                    <td>{p.id_number}</td>
                    <td>{p.place || '—'}</td>
                    <td>{p.method || '—'}</td>
                    <td className="text-end money">{formatMoney(p.amount)}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn-icon me-1" title={t('pay.receipt')} onClick={() => downloadReceipt(p)}>📄</button>
                      {!isViewer && <>
                        <button className="btn-icon me-1" title={t('pay.editTitle')} onClick={() => openEdit(p)}>✏️</button>
                        <button className="btn-icon" title={t('pay.deleteTitle')} onClick={() => setDeleting(p)}>🗑️</button>
                      </>}
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

      {showImport && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'var(--overlay)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('pay.importTitle')}</h5>
                <button type="button" className="btn-close" onClick={() => { setShowImport(false); setImportPreview(null); }}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">{t('pay.importHint')}</p>
                {importResult && !importResult.error && (
                  <div className="alert alert-success py-2">
                    {t('pay.importResult').replace('{imported}', importResult.imported).replace('{skipped}', importResult.skipped).replace('{total}', importResult.total)}
                  </div>
                )}
                {importResult && importResult.error && (
                  <div className="alert alert-danger py-2">{importResult.error}</div>
                )}
                {importPreview && importPreview.error && (
                  <div className="alert alert-danger py-2">{importPreview.error}</div>
                )}
                {importPreview && importPreview.rows && importPreview.rows.length > 0 && (
                  <div className="mb-3">
                    <div className="d-flex gap-3 mb-2">
                      <span className="badge badge-paid">{t('pay.importRowsOk').replace('{count}', importPreview.rows.filter((r) => r.status === 'ok').length)}</span>
                      <span className="badge badge-unpaid">{t('pay.importRowsSkip').replace('{count}', importPreview.rows.filter((r) => r.status !== 'ok').length)}</span>
                    </div>
                    <div className="table-responsive" style={{ maxHeight: 300 }}>
                      <table className="table table-sm mb-0">
                        <thead>
                          <tr><th>#</th><th>{t('cit.id')}</th><th>{t('pay.amount')}</th><th>{t('cit.thStatus')}</th></tr>
                        </thead>
                        <tbody>
                          {importPreview.rows.slice(0, 50).map((r) => (
                            <tr key={r.line}>
                              <td>{r.line}</td>
                              <td>{r.idNumber}</td>
                              <td>{r.amount}</td>
                              <td>
                                {r.status === 'ok' && <span className="badge badge-paid">{t('cit.paid')}</span>}
                                {r.status === 'no_citizen' && <span className="badge badge-unpaid">No citizen</span>}
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
                <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowImport(false); setImportPreview(null); }}>{t('pay.importCancel')}</button>
                {importPreview && importPreview.rows && (
                  <button type="button" className="btn btn-primary px-4" disabled={!importFile || importing || importPreview.rows.filter((r) => r.status === 'ok').length === 0} onClick={handleImport}>
                    {importing ? t('pay.importing') : t('pay.importProceed')}
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
