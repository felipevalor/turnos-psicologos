import { useState, useEffect } from 'react';
import { BottomSheet } from './BottomSheet';
import { cancelBooking, rescheduleBooking, cancelRecurring, rescheduleRecurring, updateRecurringFrequency, getSlots } from '../lib/api';
import type { RecurringBooking, SlotWithBooking, Slot } from '../lib/types';

interface Props {
    recurring: RecurringBooking;
    currentBooking?: SlotWithBooking; // If opened from a specific session
    onClose: () => void;
    onSuccess: () => void;
}

function formatDateDisplay(dateStr?: string): string {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
    });
}

import { addDaysToLocal, getTodayDateString } from '../lib/date';

function getNext14Days(): string[] {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
        dates.push(addDaysToLocal(today, i));
    }
    return dates;
}

type ViewState = 'menu' | 'cancel_single' | 'cancel_future' | 'cancel_all' | 'reschedule_single' | 'reschedule_future' | 'change_frequency';

export function RecurringManagementModal({ recurring, currentBooking, onClose, onSuccess }: Props) {
    const [view, setView] = useState<ViewState>('menu');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Form states
    const [cancelFromDate, setCancelFromDate] = useState(currentBooking?.date || getTodayDateString());
    const [rescheduleFromDate, setRescheduleFromDate] = useState(currentBooking?.date || getTodayDateString());
    const [newTime, setNewTime] = useState(recurring.time);
    const [frequency, setFrequency] = useState(recurring.frequency_weeks);

    // Single Session Reschedule state
    const [dates] = useState(getNext14Days());
    const [selectedDate, setSelectedDate] = useState(dates[0]);
    const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [selectedNewSlotId, setSelectedNewSlotId] = useState<number | null>(null);

    useEffect(() => {
        if (view === 'reschedule_single') {
            setLoadingSlots(true);
            getSlots(selectedDate).then(res => {
                setLoadingSlots(false);
                if (res.success && res.data) {
                    setAvailableSlots(res.data);
                }
            });
        }
    }, [view, selectedDate]);

    const handleAction = async (actionFn: () => Promise<{ success: boolean; error?: string }>) => {
        setLoading(true);
        setError('');
        const res = await actionFn();
        setLoading(false);
        if (res.success) {
            onSuccess();
        } else {
            setError(res.error || 'Ocurrió un error');
        }
    };

    const cancelSingle = () => handleAction(() => cancelBooking(currentBooking!.booking_id!));
    const cancelFuture = () => handleAction(() => cancelRecurring(recurring.id, undefined, undefined, cancelFromDate));
    const cancelAll = () => handleAction(() => cancelRecurring(recurring.id));
    const rescheduleSingle = () => handleAction(() => rescheduleBooking(currentBooking!.booking_id!, { new_slot_id: selectedNewSlotId! }));
    const rescheduleFuture = () => handleAction(() => rescheduleRecurring(recurring.id, { from_date: rescheduleFromDate, new_time: newTime }));
    const changeFreq = () => handleAction(() => updateRecurringFrequency(recurring.id, frequency));

    const dayShortNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    return (
        <BottomSheet isOpen title="Gestionar recurrencia" onClose={onClose}>
            <div className="mb-5 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-sm font-bold text-[#1a2e4a]">{recurring.patient_name}</p>
                <p className="text-xs text-slate-500 mt-1">{recurring.patient_email} • {recurring.patient_phone}</p>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
                    <span className="text-xs font-semibold bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        Cada {recurring.frequency_weeks} semana{recurring.frequency_weeks > 1 ? 's' : ''}
                    </span>
                    <span className="text-xs font-semibold bg-[#1a2e4a] text-white px-2 py-1 rounded">
                        {recurring.time}
                    </span>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                    {error}
                </div>
            )}

            {view === 'menu' && (
                <div className="space-y-6">
                    {currentBooking && (
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Esta sesión puntual</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setView('reschedule_single')}
                                    className="p-3 border border-slate-200 rounded-xl text-sm font-semibold text-[#1a2e4a] hover:bg-slate-50"
                                >
                                    Reprogramar sesión
                                </button>
                                <button
                                    onClick={() => setView('cancel_single')}
                                    className="p-3 border border-red-100 bg-red-50/50 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50"
                                >
                                    Cancelar sesión
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Serie recurrente</h4>
                        <div className="grid grid-cols-1 gap-2">
                            <button
                                onClick={() => setView('reschedule_future')}
                                className="p-3 border border-slate-200 rounded-xl text-sm font-semibold text-[#1a2e4a] hover:bg-slate-50 text-left"
                            >
                                Cambiar horario de las futuras sesiones
                            </button>
                            <button
                                onClick={() => setView('change_frequency')}
                                className="p-3 border border-slate-200 rounded-xl text-sm font-semibold text-[#1a2e4a] hover:bg-slate-50 text-left"
                            >
                                Cambiar frecuencia
                            </button>
                            <button
                                onClick={() => setView('cancel_future')}
                                className="p-3 border border-red-100 bg-red-50/50 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 text-left"
                            >
                                Cancelar esta y todas las futuras
                            </button>
                            <button
                                onClick={() => setView('cancel_all')}
                                className="p-3 border border-red-100 bg-red-50/50 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 text-left"
                            >
                                Cancelar toda la recurrencia
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CANCEL_SINGLE */}
            {view === 'cancel_single' && currentBooking && (
                <div className="space-y-4">
                    <p className="text-sm text-slate-700">
                        ¿Confirmás que querés cancelar <strong>solo la sesión del {formatDateDisplay(currentBooking.date)}</strong>? <br /><br />El resto de los turnos de la recurrencia se mantendrán.
                    </p>
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setView('menu')} className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Volver</button>
                        <button onClick={cancelSingle} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-white bg-red-500 rounded-xl disabled:opacity-50">Confirmar</button>
                    </div>
                </div>
            )}

            {/* CANCEL_FUTURE */}
            {view === 'cancel_future' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">A partir de esta fecha</label>
                        <input type="date" className="w-full border rounded-xl px-4 py-3 text-sm" value={cancelFromDate} onChange={e => setCancelFromDate(e.target.value)} required />
                    </div>
                    <p className="text-sm text-slate-700">
                        Se cancelarán y liberarán todos los turnos desde la fecha seleccionada en adelante.
                    </p>
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setView('menu')} className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Volver</button>
                        <button onClick={cancelFuture} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-white bg-red-500 rounded-xl disabled:opacity-50">Confirmar cancelación</button>
                    </div>
                </div>
            )}

            {/* CANCEL_ALL */}
            {view === 'cancel_all' && (
                <div className="space-y-4">
                    <p className="text-sm text-slate-700">
                        ¿Confirmás que querés cancelar <strong>todos los turnos futuros</strong> de esta serie de forma permanente?
                    </p>
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setView('menu')} className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Volver</button>
                        <button onClick={cancelAll} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-white bg-red-500 rounded-xl disabled:opacity-50">Confirmar cancelación</button>
                    </div>
                </div>
            )}

            {/* RESCHEDULE_SINGLE */}
            {view === 'reschedule_single' && (
                <div className="space-y-4">
                    <div className="flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
                        {dates.map((d) => {
                            const [, , dd] = d.split('-').map(Number);
                            const dateObj = new Date(d + 'T00:00:00');
                            const isSelected = selectedDate === d;
                            return (
                                <button
                                    key={d}
                                    onClick={() => { setSelectedDate(d); setSelectedNewSlotId(null); }}
                                    className={`flex-none flex flex-col items-center justify-center w-14 h-16 rounded-xl border transition-all ${isSelected ? 'bg-[#1a2e4a] border-[#1a2e4a] text-white shadow-md' : 'bg-white border-slate-200 text-slate-600'
                                        }`}
                                >
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                                        {dayShortNames[dateObj.getDay()]}
                                    </span>
                                    <span className={`text-lg font-black leading-tight ${isSelected ? 'text-white' : 'text-[#1a2e4a]'}`}>{dd}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="min-h-[120px]">
                        {loadingSlots ? (
                            <div className="flex justify-center py-6"><div className="w-6 h-6 border-3 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" /></div>
                        ) : availableSlots.length === 0 ? (
                            <p className="text-center text-sm text-slate-500 py-6">No hay turnos disponibles para este día</p>
                        ) : (
                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2">
                                {availableSlots.map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => setSelectedNewSlotId(s.id)}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${selectedNewSlotId === s.id ? 'bg-[#4caf7d] border-[#4caf7d] text-white' : 'bg-white border-slate-200'
                                            }`}
                                    >
                                        {s.start_time}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2 border-t border-slate-100">
                        <button onClick={() => setView('menu')} className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Volver</button>
                        <button onClick={rescheduleSingle} disabled={loading || !selectedNewSlotId} className="flex-1 py-3 text-sm font-semibold text-white bg-[#1a2e4a] rounded-xl disabled:opacity-50">Confirmar</button>
                    </div>
                </div>
            )}

            {/* RESCHEDULE_FUTURE */}
            {view === 'reschedule_future' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">A partir de esta fecha</label>
                        <input type="date" className="w-full border rounded-xl px-4 py-3 text-sm" value={rescheduleFromDate} onChange={e => setRescheduleFromDate(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nuevo horario</label>
                        <input type="time" className="w-full border rounded-xl px-4 py-3 text-sm" value={newTime} onChange={e => setNewTime(e.target.value)} required />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setView('menu')} className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Volver</button>
                        <button onClick={rescheduleFuture} disabled={loading} className="flex-1 py-3 text-sm font-semibold text-white bg-[#1a2e4a] rounded-xl disabled:opacity-50">Confirmar cambios</button>
                    </div>
                </div>
            )}

            {/* CHANGE_FREQUENCY */}
            {view === 'change_frequency' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nueva frecuencia</label>
                        <select className="w-full border rounded-xl px-4 py-3 text-sm bg-white" value={frequency} onChange={e => setFrequency(Number(e.target.value))}>
                            <option value={1}>Cada semana</option>
                            <option value={2}>Cada 2 semanas</option>
                            <option value={3}>Cada 3 semanas</option>
                            <option value={4}>Cada 4 semanas</option>
                        </select>
                        <p className="text-xs text-slate-500 mt-2">Nota: Esto no modificará los turnos que ya fueron generados.</p>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setView('menu')} className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Volver</button>
                        <button onClick={changeFreq} disabled={loading || frequency === recurring.frequency_weeks} className="flex-1 py-3 text-sm font-semibold text-white bg-[#1a2e4a] rounded-xl disabled:opacity-50">Confirmar</button>
                    </div>
                </div>
            )}
        </BottomSheet>
    );
}
