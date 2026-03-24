import { useState, useEffect, useMemo } from 'react';
import { getPatients } from '../lib/api';
import type { Patient } from '../lib/types';

interface Props {
  onViewDetail: (email: string) => void;
}

export function PatientsPage({ onViewDetail }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    setLoading(true);
    const res = await getPatients();
    if (res.success && res.data) {
      setPatients(res.data);
    }
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short', year: '2-digit'
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
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre, email o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-[#1a2e4a]/20 transition-all"
          />
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
                filteredPatients.map((p) => (
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
                      <button
                        onClick={() => onViewDetail(p.email)}
                        className="p-2 rounded-xl bg-slate-100 text-slate-400 group-hover:bg-[#1a2e4a] group-hover:text-white transition-all shadow-sm"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
