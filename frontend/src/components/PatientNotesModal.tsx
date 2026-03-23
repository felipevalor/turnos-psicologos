import { useState, useEffect } from 'react';
import { BottomSheet } from './BottomSheet';
import { getNotes, createNote, updateNote, deleteNote } from '../lib/api';
import type { PatientNote } from '../lib/types';
import { useNotifications } from '../lib/NotificationContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientEmail: string;
  patientName: string;
}

export function PatientNotesModal({ isOpen, onClose, patientEmail, patientName }: Props) {
  const { showToast, confirm } = useNotifications();
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const loadNotes = async () => {
    setLoading(true);
    const res = await getNotes(patientEmail);
    setLoading(false);
    if (res.success && res.data) {
      setNotes(res.data);
    } else {
      showToast('Error al cargar notas', 'error');
    }
  };

  useEffect(() => {
    if (isOpen && patientEmail) {
      loadNotes();
      setNewNote('');
      setEditingId(null);
    }
  }, [isOpen, patientEmail]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    setLoading(true);
    const res = await createNote({ patient_email: patientEmail, contenido: newNote });
    setLoading(false);
    if (res.success) {
      setNewNote('');
      showToast('Nota guardada correctamente', 'success');
      loadNotes();
    } else {
      showToast(res.error ?? 'Error al guardar nota', 'error');
    }
  };

  const handleUpdateNote = async (id: number) => {
    if (!editContent.trim()) return;
    setLoading(true);
    const res = await updateNote(id, { contenido: editContent });
    setLoading(false);
    if (res.success) {
      setEditingId(null);
      showToast('Nota actualizada', 'success');
      loadNotes();
    } else {
      showToast(res.error ?? 'Error al actualizar nota', 'error');
    }
  };

  const handleDeleteNote = async (id: number) => {
    const ok = await confirm({
      title: '¿Eliminar nota?',
      message: 'Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      type: 'danger'
    });
    if (!ok) return;

    setLoading(true);
    const res = await deleteNote(id);
    setLoading(false);
    if (res.success) {
      showToast('Nota eliminada', 'success');
      loadNotes();
    } else {
      showToast(res.error ?? 'Error al eliminar nota', 'error');
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Notas: ${patientName}`}>
      <div className="space-y-6 pb-4">
        {/* New Note Form */}
        <form onSubmit={handleAddNote} className="space-y-3">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Escribir una nueva nota privada..."
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2e4a]/20 min-h-[100px] resize-none"
          />
          <button
            type="submit"
            disabled={loading || !newNote.trim()}
            className="w-full bg-[#1a2e4a] text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-[#243d61] disabled:opacity-50 transition-colors"
          >
            {loading && !editingId ? 'Guardando...' : 'Guardar Nota'}
          </button>
        </form>

        {/* Notes List */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Historial de notas</h3>
          {loading && notes.length === 0 ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notes.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4 italic">No hay notas para este paciente.</p>
          ) : (
            <div className="space-y-4">
              {notes.map((note) => (
                <div key={note.id} className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
                  {editingId === note.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2e4a]/20 min-h-[80px] resize-none bg-white"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdateNote(note.id)}
                          className="text-xs bg-[#1a2e4a] text-white px-3 py-1.5 rounded-lg font-bold"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs bg-white border border-slate-200 text-slate-500 px-3 py-1.5 rounded-lg"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{note.contenido}</p>
                      <div className="flex items-center justify-between pt-1">
                        <p className="text-[10px] text-slate-400">
                          {new Date(note.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <div className="flex gap-3">
                          <button
                            onClick={() => { setEditingId(note.id); setEditContent(note.contenido); }}
                            className="text-[11px] text-[#1a2e4a] font-bold hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            className="text-[11px] text-red-500 font-bold hover:underline"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
