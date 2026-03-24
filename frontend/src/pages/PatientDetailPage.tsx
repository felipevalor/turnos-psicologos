import { useState, useEffect, useMemo } from 'react';
import { getPatientHistory, createNote, updateNote } from '../lib/api';
import type { PatientHistory, PatientNote } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { useNotifications } from '../lib/NotificationContext';

interface Props {
  email: string;
  onBack: () => void;
}

export function PatientDetailPage({ email, onBack }: Props) {
  const { showToast } = useNotifications();
  const [history, setHistory] = useState<PatientHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadHistory();
  }, [email]);

  const loadHistory = async () => {
    setLoading(true);
    const res = await getPatientHistory(email);
    if (res.success && res.data) {
      setHistory(res.data);
    }
    setLoading(false);
  };

  const timeline = useMemo(() => {
    if (!history) return [];
    
    const items = [
      ...history.bookings.map(b => ({ ...b, type: 'booking' as const })),
      ...history.cancellations.map(c => ({ ...c, type: 'cancellation' as const }))
    ];

    return items.sort((a, b) => {
      if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha);
      return b.hora_inicio.localeCompare(a.hora_inicio);
    });
  }, [history]);

  const getNoteForTimelineItem = (slotId?: number) => {
    if (!slotId || !history) return null;
    return history.notes.find(n => n.slot_id === slotId);
  };

  const handleSaveNote = async (slotId: number, existingNote?: PatientNote) => {
    if (!noteContent.trim()) return;
    setIsSaving(true);
    
    let res;
    if (existingNote) {
      res = await updateNote(existingNote.id, { contenido: noteContent });
    } else {
      res = await createNote({ patient_email: email, contenido: noteContent, slot_id: slotId });
    }

    if (res.success) {
      showToast('Nota guardada', 'success');
      setEditingNoteId(null);
      setNoteContent('');
      loadHistory();
    } else {
      showToast(res.error || 'Error al guardar la nota', 'error');
    }
    setIsSaving(false);
  };

  const startEditing = (slotId: number, content: string) => {
    setEditingNoteId(slotId);
    setNoteContent(content);
  };

  const formatDateLong = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  };

  if (loading && !history) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!history) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-100 shadow-sm p-4 px-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl hover:bg-slate-50 transition-colors text-slate-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="text-xl font-bold text-[#1a2e4a]">{email}</h2>
            <p className="text-xs text-slate-400">Historial completo del paciente</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider px-2">Línea de Tiempo</h3>
          
          <div className="space-y-4">
            {timeline.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center text-slate-400">
                No hay turnos registrados para este paciente
              </div>
            ) : (
              timeline.map((item, idx) => {
                const note = item.type === 'booking' ? getNoteForTimelineItem(item.slot_id) : null;
                const isEditing = item.type === 'booking' && editingNoteId === item.slot_id;
                const isFuture = item.fecha >= new Date().toISOString().split('T')[0];
                const horaFin = 'hora_fin' in item ? item.hora_fin : '';

                return (
                  <div key={`${item.type}-${item.fecha}-${item.hora_inicio}`} className="relative pl-8 pb-4 group last:pb-0">
                    {/* Timeline rail */}
                    {idx !== timeline.length - 1 && (
                      <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-slate-100 group-last:hidden" />
                    )}
                    
                    {/* Bullet */}
                    <div className={`absolute left-0 top-1.5 w-6 h-6 rounded-full border-4 border-white shadow-sm flex items-center justify-center ${
                      item.type === 'cancellation' ? 'bg-red-400' : isFuture ? 'bg-blue-400' : 'bg-[#4caf7d]'
                    }`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:border-slate-200 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                            {formatDateLong(item.fecha)}
                          </p>
                          <p className="text-base font-bold text-[#1a2e4a] mt-0.5">
                            {item.hora_inicio} — {horaFin}
                          </p>
                        </div>
                        <StatusBadge status={(item.type === 'cancellation' ? 'cancelled' : 'booked') as any} />
                      </div>

                      {item.type === 'cancellation' && (
                        <div className="bg-red-50 text-red-600 rounded-xl p-3 text-xs font-semibold">
                          Cancelado • Motivo: {'reason' in item && item.reason === 'patient_cancel' ? 'Paciente' : 'reason' in item && item.reason === 'admin_cancel' ? 'Psicólogo' : 'Reprogramación'}
                        </div>
                      )}

                      {item.type === 'booking' && (
                        <div className="mt-4 pt-4 border-t border-slate-50">
                          {isEditing ? (
                            <div className="space-y-3">
                              <textarea
                                value={noteContent}
                                onChange={(e) => setNoteContent(e.target.value)}
                                placeholder="Escribe notas de evolución para esta sesión..."
                                className="w-full bg-slate-50 border-none rounded-xl text-sm p-3 min-h-[100px] focus:ring-2 focus:ring-[#1a2e4a]/20 outline-none"
                              />
                              <div className="flex justify-end gap-2">
                                <button 
                                  onClick={() => setEditingNoteId(null)}
                                  className="px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-slate-600"
                                >
                                  Cancelar
                                </button>
                                <button 
                                  onClick={() => handleSaveNote(item.slot_id, note || undefined)}
                                  disabled={isSaving}
                                  className="px-4 py-1.5 bg-[#1a2e4a] text-white text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all active:scale-95 disabled:opacity-50"
                                >
                                  {isSaving ? 'Guardando...' : 'Guardar Nota'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="group/note">
                              {note ? (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nota de sesión</span>
                                    <button 
                                      onClick={() => startEditing(item.slot_id, note.contenido)}
                                      className="text-[10px] font-bold text-blue-500 hover:underline opacity-0 group-hover/note:opacity-100 transition-opacity"
                                    >
                                      Editar
                                    </button>
                                  </div>
                                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                                    {note.contenido}
                                  </p>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => startEditing(item.slot_id, '')}
                                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 hover:bg-slate-50 hover:border-slate-200 transition-all"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  <span className="text-xs font-bold">Agregar nota de evolución</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider px-2">Resumen</h3>
          <div className="bg-[#1a2e4a] rounded-2xl p-6 text-white shadow-lg space-y-6">
            <div>
              <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-1">Total de Sesiones</p>
              <p className="text-4xl font-bold">{history.bookings.length}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/10 rounded-xl p-3">
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mb-1">Cancelaciones</p>
                <p className="text-xl font-bold">{history.cancellations.length}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mb-1">Tasa Cancel.</p>
                <p className="text-xl font-bold">
                  {history.bookings.length + history.cancellations.length > 0
                    ? Math.round((history.cancellations.length / (history.bookings.length + history.cancellations.length)) * 100)
                    : 0}%
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 text-xs text-white/40 italic">
              * Datos basados en el historial registrado en la plataforma.
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h4 className="text-sm font-bold text-[#1a2e4a]">Notas Generales</h4>
            <div className="space-y-3">
              {history.notes.filter(n => !n.slot_id).map(note => (
                <div key={note.id} className="p-3 bg-slate-50 rounded-xl text-sm text-slate-600">
                  {note.contenido}
                </div>
              ))}
              {history.notes.filter(n => !n.slot_id).length === 0 && (
                <p className="text-xs text-slate-400 italic">No hay notas generales registradas.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
