import { useState, useRef } from 'react';
import { BottomSheet } from './BottomSheet';
import { previewImport, confirmImport } from '../lib/api';
import { parseCSV } from '../lib/patients';
import { useNotifications } from '../lib/NotificationContext';
import type { ConflictRow } from '../lib/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'review' | 'done';

interface ParsedRow { nombre: string; email: string; telefono: string; }

export function ImportPatientsModal({ isOpen, onClose, onSuccess }: Props) {
  const { showToast } = useNotifications();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [cleanRows, setCleanRows] = useState<ParsedRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [decisions, setDecisions] = useState<Map<string, 'keep' | 'replace'>>(new Map());
  const [importedCount, setImportedCount] = useState(0);

  const reset = () => {
    setStep('upload');
    setCleanRows([]);
    setConflicts([]);
    setDecisions(new Map());
    setImportedCount(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => { reset(); onClose(); };

  const parseFile = async (file: File): Promise<ParsedRow[]> => {
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      return parseCSV(text);
    }
    const { read, utils } = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = read(buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
    if (!raw.length || !('nombre' in raw[0]) || !('email' in raw[0])) {
      throw new Error('El archivo debe tener columnas: nombre, email, teléfono');
    }
    return raw.map(r => ({
      nombre: String(r.nombre ?? '').trim(),
      email: String(r.email ?? '').trim().toLowerCase(),
      telefono: String(r.telefono ?? '').trim(),
    })).filter(r => r.nombre && r.email);
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        showToast('El archivo no tiene filas válidas', 'error');
        return;
      }
      if (rows.length > 500) {
        showToast('La importación no puede superar 500 pacientes a la vez', 'error');
        return;
      }

      const res = await previewImport(rows);
      if (!res.success || !res.data) {
        showToast(res.error ?? 'Error al previsualizar importación', 'error');
        return;
      }

      setCleanRows(res.data.clean);
      setConflicts(res.data.conflicts);
      const initial = new Map<string, 'keep' | 'replace'>();
      for (const c of res.data.conflicts) initial.set(c.incoming.email, 'keep');
      setDecisions(initial);
      setStep('review');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al leer el archivo', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    const toImport: ParsedRow[] = [
      ...cleanRows,
      ...conflicts
        .filter(c => decisions.get(c.incoming.email) === 'replace')
        .map(c => c.incoming),
    ];

    if (toImport.length === 0) {
      showToast('No hay pacientes para importar', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await confirmImport(toImport);
      if (!res.success || !res.data) {
        showToast(res.error ?? 'Error al importar', 'error');
        return;
      }
      setImportedCount(res.data.imported);
      setStep('done');
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  const importCount = cleanRows.length +
    conflicts.filter(c => decisions.get(c.incoming.email) === 'replace').length;

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title="Importar pacientes">
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Subí un archivo CSV o Excel con columnas: <strong>nombre</strong>, <strong>email</strong>, <strong>telefono</strong>.
          </p>

          <label
            className="block border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a]/30 transition-colors"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              if (loading) return;
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={e => {
                if (loading) return;
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            {loading ? (
              <div className="flex justify-center">
                <div className="w-6 h-6 border-2 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <svg className="w-8 h-8 text-slate-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-slate-500">Arrastrá un archivo o <span className="text-[#1a2e4a] font-semibold">hacé clic para seleccionar</span></p>
                <p className="text-xs text-slate-400 mt-1">CSV o Excel (.xlsx)</p>
              </>
            )}
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {cleanRows.length > 0 && (
            <div className="bg-green-50 rounded-xl px-4 py-3 text-sm text-green-700">
              <strong>{cleanRows.length}</strong> paciente{cleanRows.length !== 1 ? 's' : ''} sin conflictos se importará{cleanRows.length !== 1 ? 'n' : ''} automáticamente.
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-600">
                {conflicts.length} conflicto{conflicts.length !== 1 ? 's' : ''} — decidí qué hacer con cada uno:
              </p>
              {conflicts.map(conflict => (
                <div key={conflict.incoming.email} className="border border-slate-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase">{conflict.incoming.email}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-slate-400 mb-1">
                        Existente ({conflict.existingSource === 'manual' ? 'manual' : 'de reservas'})
                      </p>
                      <p className="text-slate-600">{conflict.existing.nombre}</p>
                      <p className="text-slate-400">{conflict.existing.telefono || 'Sin teléfono'}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-400 mb-1">Nuevo (archivo)</p>
                      <p className="text-slate-600">{conflict.incoming.nombre}</p>
                      <p className="text-slate-400">{conflict.incoming.telefono || 'Sin teléfono'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(['keep', 'replace'] as const).map(option => (
                      <button
                        key={option}
                        onClick={() => setDecisions(prev => new Map(prev).set(conflict.incoming.email, option))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          decisions.get(conflict.incoming.email) === option
                            ? 'bg-[#1a2e4a] text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {option === 'keep' ? 'Mantener existente' : 'Reemplazar con nuevo'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={reset}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Atrás
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || importCount === 0}
              className="flex-1 py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors disabled:opacity-50"
            >
              {loading ? 'Importando...' : `Importar ${importCount} paciente${importCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-4 space-y-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            Se importaron <strong>{importedCount}</strong> paciente{importedCount !== 1 ? 's' : ''} correctamente.
          </p>
          <button
            onClick={handleClose}
            className="w-full py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors"
          >
            Cerrar
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
