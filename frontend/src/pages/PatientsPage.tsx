import { useState, useEffect, useMemo, useRef } from 'react';
import { getPatients, deletePatient, exportPatients } from '../lib/api';
import { useNotifications } from '../lib/NotificationContext';
import { PatientFormModal } from '../components/PatientFormModal';
import { ImportPatientsModal } from '../components/ImportPatientsModal';
import { buildCSV, downloadFile } from '../lib/patients';
import type { Patient } from '../lib/types';
import type { ExportRow } from '../lib/patients';

interface Props {
  onViewDetail: (email: string) => void;
}

export function PatientsPage({ onViewDetail }: Props) {
  const { showToast, confirm } = useNotifications();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formModal, setFormModal] = useState<{ open: boolean; patient?: Patient }>({ open: false });
  const [importOpen, setImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadPatients = async () => {
    setLoading(true);
    const res = await getPatients();
    if (res.success && res.data) setPatients(res.data);
    setLoading(false);
  };

  const filteredPatients = useMemo(() => {
    const s = search.toLowerCase();
    return patients.filter(p =>
      p.nombre.toLowerCase().includes(s) ||
      p.email.toLowerCase().includes(s) ||
      p.telefono.includes(s)
    );
  }, [patients, search]);

  const handleDelete = async (patient: Patient) => {
    const ok = await confirm({
      title: `¿Eliminar a ${patient.nombre}?`,
      message: 'Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      type: 'danger',
    });
    if (!ok) return;
    const res = await deletePatient(patient.email);
    if (!res.success) {
      showToast(res.error ?? 'Error al eliminar paciente', 'error');
      return;
    }
    showToast('Paciente eliminado', 'success');
    loadPatients();
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExportMenuOpen(false);
    setExportLoading(true);
    try {
      const res = await exportPatients();
      if (!res.success || !res.data) {
        showToast('Error al exportar pacientes', 'error');
        return;
      }
      const rows = res.data as ExportRow[];
      if (format === 'csv') {
        downloadFile(buildCSV(rows), 'pacientes.csv', 'text/csv;charset=utf-8;');
      } else {
        const { utils, writeFile } = await import('xlsx');
        const ws = utils.json_to_sheet(rows);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'Pacientes');
        writeFile(wb, 'pacientes.xlsx');
      }
      showToast('Exportación lista', 'success');
    } finally {
      setExportLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short', year: '2-digit',
    });
  };

  if (loading && patients.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre, email o teléfono..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-[#1a2e4a]/20 transition-all"
            />
          </div>

          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            Importar
          </button>

          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportMenuOpen(v => !v)}
              disabled={exportLoading}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {exportLoading ? 'Exportando...' : 'Exportar ▾'}
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-100 rounded-xl shadow-lg z-10 min-w-[120px] overflow-hidden">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors"
                >
                  CSV
                </button>
                <button
                  onClick={() => handleExport('xlsx')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors"
                >
                  Excel
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => setFormModal({ open: true })}
            className="px-4 py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors whitespace-nowrap"
          >
            + Agregar paciente
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-50">
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Paciente</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contacto</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider text-center">Sesiones</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Última / Próxima</th>
                <th className="px-6 py-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium">
                    No se encontraron pacientes
                  </td>
                </tr>
              ) : (
                filteredPatients.map(p => (
                  <tr key={p.email} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-[#1a2e4a]">{p.nombre}</p>
                      <button
                        onClick={() => onViewDetail(p.email)}
                        className="text-[11px] text-[#1a2e4a] font-semibold hover:underline mt-0.5"
                      >
                        Ver historial completo
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-slate-600">{p.email}</p>
                      <p className="text-xs text-slate-400">{p.telefono || 'Sin teléfono'}</p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 text-sm font-bold">
                        {p.total_sesiones}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 w-12 lowercase">Última:</span>
                          <span className="text-xs font-semibold text-slate-600">{formatDate(p.ultima_sesion)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-blue-400 w-12 lowercase">Prox:</span>
                          <span className="text-xs font-bold text-[#1a2e4a]">{formatDate(p.proxima_sesion)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {p.source === 'manual' && (
                          <>
                            <button
                              onClick={() => setFormModal({ open: true, patient: p })}
                              className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-[#1a2e4a] transition-all"
                              title="Editar paciente"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              className="p-2 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all"
                              title="Eliminar paciente"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onViewDetail(p.email)}
                          className="p-2 rounded-xl bg-slate-100 text-slate-400 group-hover:bg-[#1a2e4a] group-hover:text-white transition-all shadow-sm"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PatientFormModal
        isOpen={formModal.open}
        onClose={() => setFormModal({ open: false })}
        patient={formModal.patient}
        onSuccess={loadPatients}
      />

      <ImportPatientsModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={loadPatients}
      />
    </div>
  );
}
