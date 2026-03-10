import { useState, useEffect } from 'react';
import { BottomSheet } from './BottomSheet';
import { cancelBooking, rescheduleBooking, getSlots } from '../lib/api';
import type { SlotWithBooking, Slot } from '../lib/types';

interface Props {
    slot: SlotWithBooking;
    onClose: () => void;
    onSuccess: () => void;
    onManageRecurring?: () => void;
}

function formatDateDisplay(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
    });
}

import { addDaysToLocal } from '../lib/date';

function getNext14Days(): string[] {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
        dates.push(addDaysToLocal(today, i));
    }
    return dates;
}

export function SessionManagementModal({ slot, onClose, onSuccess, onManageRecurring }: Props) {
    const [view, setView] = useState<'menu' | 'cancel_confirm' | 'reschedule'>('menu');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Reschedule state
    const [dates] = useState(getNext14Days());
    const [selectedDate, setSelectedDate] = useState(dates[0]);
    const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [selectedNewSlotId, setSelectedNewSlotId] = useState<number | null>(null);

    useEffect(() => {
        if (view === 'reschedule') {
            setLoadingSlots(true);
            getSlots(selectedDate).then(res => {
                setLoadingSlots(false);
                if (res.success && res.data) {
                    setAvailableSlots(res.data);
                }
            });
        }
    }, [view, selectedDate]);

    const handleCancel = async () => {
        if (!slot.booking_id) return;
        setLoading(true);
        setError('');
        const res = await cancelBooking(slot.booking_id);
        setLoading(false);
        if (res.success) {
            onSuccess();
        } else {
            setError(res.error || 'Error al cancelar la sesión');
        }
    };

    const handleReschedule = async () => {
        if (!slot.booking_id || !selectedNewSlotId) return;
        setLoading(true);
        setError('');
        const res = await rescheduleBooking(slot.booking_id, { new_slot_id: selectedNewSlotId });
        setLoading(false);
        if (res.success) {
            onSuccess();
        } else {
            setError(res.error || 'Error al reprogramar la sesión');
        }
    };

    const dayShortNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    return (
        <BottomSheet isOpen title="Gestionar sesión" onClose={onClose}>
            {/* Header Info */}
            <div className="mb-5 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-sm font-bold text-[#1a2e4a]">{slot.patient_name}</p>
                <p className="text-xs text-slate-500 mt-1">{slot.patient_email} • {slot.patient_phone}</p>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
                    <span className="text-xs font-semibold bg-[#1a2e4a]/10 text-[#1a2e4a] px-2 py-1 rounded">
                        {formatDateDisplay(slot.date)}
                    </span>
                    <span className="text-xs font-semibold bg-[#1a2e4a] text-white px-2 py-1 rounded">
                        {slot.start_time} - {slot.end_time}
                    </span>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                    {error}
                </div>
            )}

            {view === 'menu' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <button
                            onClick={() => setView('reschedule')}
                            className="flex flex-col items-center justify-center gap-2 p-4 border border-slate-200 rounded-xl hover:border-[#1a2e4a]/50 hover:bg-slate-50 transition-colors"
                        >
                            <svg className="w-6 h-6 text-[#1a2e4a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="text-sm font-semibold text-[#1a2e4a]">Reprogramar</span>
                        </button>

                        <button
                            onClick={() => setView('cancel_confirm')}
                            className="flex flex-col items-center justify-center gap-2 p-4 border border-red-100 bg-red-50/50 rounded-xl hover:bg-red-50 transition-colors"
                        >
                            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span className="text-sm font-semibold text-red-600">Cancelar sesión</span>
                        </button>
                    </div>

                    {slot.recurring_booking_id && onManageRecurring && (
                        <div className="mt-4 p-4 border border-blue-100 bg-blue-50/50 rounded-xl">
                            <p className="text-sm font-medium text-blue-900 mb-2">Esta sesión es parte de una recurrencia</p>
                            <button
                                onClick={onManageRecurring}
                                className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                                Gestionar recurrencia
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                    )}
                </div>
            )}

            {view === 'cancel_confirm' && (
                <div className="space-y-4">
                    <p className="text-sm text-slate-700">
                        ¿Confirmás que querés cancelar la sesión de <strong className="font-semibold text-[#1a2e4a]">{slot.patient_name}</strong> el <strong className="font-semibold text-[#1a2e4a]">{formatDateDisplay(slot.date)}</strong>?
                    </p>
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => setView('menu')}
                            className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            Volver
                        </button>
                        <button
                            onClick={handleCancel}
                            disabled={loading}
                            className="flex-1 py-3 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Cancelando...' : 'Sí, cancelar'}
                        </button>
                    </div>
                </div>
            )}

            {view === 'reschedule' && (
                <div className="space-y-4">
                    <div className="flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
                        {dates.map((d) => {
                            const [, , dd] = d.split('-').map(Number);
                            const dateObj = new Date(d + 'T00:00:00');
                            const isSelected = selectedDate === d;
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => { setSelectedDate(d); setSelectedNewSlotId(null); }}
                                    className={`flex-none flex flex-col items-center justify-center w-14 h-16 rounded-xl border transition-all ${isSelected
                                        ? 'bg-[#1a2e4a] border-[#1a2e4a] text-white shadow-md'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-[#1a2e4a]/30'
                                        }`}
                                >
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                                        {dayShortNames[dateObj.getDay()]}
                                    </span>
                                    <span className={`text-lg font-black leading-tight ${isSelected ? 'text-white' : 'text-[#1a2e4a]'}`}>
                                        {dd}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="min-h-[120px]">
                        {loadingSlots ? (
                            <div className="flex justify-center py-6">
                                <div className="w-6 h-6 border-3 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : availableSlots.length === 0 ? (
                            <p className="text-center text-sm text-slate-500 py-6">No hay turnos disponibles para este día</p>
                        ) : (
                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2">
                                {availableSlots.map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => setSelectedNewSlotId(s.id)}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${selectedNewSlotId === s.id
                                            ? 'bg-[#4caf7d] border-[#4caf7d] text-white shadow-sm scale-105'
                                            : 'bg-white border-slate-200 text-[#1a2e4a] hover:border-[#4caf7d] hover:text-[#4caf7d]'
                                            }`}
                                    >
                                        {s.start_time}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2 border-t border-slate-100">
                        <button
                            onClick={() => setView('menu')}
                            className="flex-1 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            Volver
                        </button>
                        <button
                            onClick={handleReschedule}
                            disabled={loading || !selectedNewSlotId}
                            className="flex-1 py-3 text-sm font-semibold text-white bg-[#1a2e4a] rounded-xl hover:bg-[#243d61] transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Reprogramando...' : 'Confirmar'}
                        </button>
                    </div>
                </div>
            )}
        </BottomSheet>
    );
}
