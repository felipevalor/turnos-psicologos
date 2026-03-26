import { useState, useEffect } from 'react';
import { BottomSheet } from './BottomSheet';
import { createPatient, updatePatient } from '../lib/api';
import { useNotifications } from '../lib/NotificationContext';
import type { Patient } from '../lib/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patient?: Pick<Patient, 'nombre' | 'email' | 'telefono'>;
  onSuccess: () => void;
}

export function PatientFormModal({ isOpen, onClose, patient, onSuccess }: Props) {
  const { showToast } = useNotifications();
  const isEdit = Boolean(patient);

  const [nombre, setNombre] = useState(patient?.nombre ?? '');
  const [email, setEmail] = useState(patient?.email ?? '');
  const [telefono, setTelefono] = useState(patient?.telefono ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNombre(patient?.nombre ?? '');
      setEmail(patient?.email ?? '');
      setTelefono(patient?.telefono ?? '');
    }
  }, [isOpen, patient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !email.trim()) return;

    setLoading(true);
    const res = isEdit
      ? await updatePatient(patient!.email, { nombre, telefono })
      : await createPatient({ nombre, email, telefono });
    setLoading(false);

    if (!res.success) {
      showToast(res.error ?? 'Error al guardar paciente', 'error');
      return;
    }

    showToast(isEdit ? 'Paciente actualizado' : 'Paciente agregado', 'success');
    onSuccess();
    onClose();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Editar paciente' : 'Agregar paciente'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre completo *</label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl text-sm border-none focus:ring-2 focus:ring-[#1a2e4a]/20"
            placeholder="Ana García"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Email *</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={isEdit}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl text-sm border-none focus:ring-2 focus:ring-[#1a2e4a]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="ana@mail.com"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Teléfono</label>
          <input
            type="tel"
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl text-sm border-none focus:ring-2 focus:ring-[#1a2e4a]/20"
            placeholder="1122334455"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !nombre.trim() || !email.trim()}
            className="flex-1 py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors disabled:opacity-50"
          >
            {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar paciente'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
