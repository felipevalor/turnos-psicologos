import { useState, useEffect } from 'react';
import { getDashboard } from '../lib/api';
import type { DashboardData } from '../lib/types';

interface Props {
    onNavigateToAgenda?: (date: string) => void;
}

export function DashboardTab({ onNavigateToAgenda }: Props) {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let mounted = true;
        getDashboard().then((res) => {
            if (!mounted) return;
            if (res.success && res.data) {
                setData(res.data);
            } else {
                setError(res.error || 'Error al cargar métricas');
            }
            setLoading(false);
        });
        return () => {
            mounted = false;
        };
    }, []);

    function DiffBadge({ cur, prev, isNegativeGood = false, isNeutral = false }: { cur: number; prev: number; isNegativeGood?: boolean; isNeutral?: boolean }) {
        if (cur === prev || prev === 0) return null;
        const diff = cur - prev;
        const isPositive = diff > 0;
        const sign = isPositive ? '+' : '';

        let colorClass = 'bg-gray-100 text-gray-600';
        if (!isNeutral) {
            if (isPositive) {
                colorClass = isNegativeGood ? 'bg-[#ef4444] text-white' : 'bg-[#4caf7d] text-white';
            } else {
                colorClass = isNegativeGood ? 'bg-[#4caf7d] text-white' : 'bg-[#ef4444] text-white';
            }
        }

        return (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ml-2 ${colorClass}`}>
                {isPositive ? '↑' : '↓'} {sign}{diff}
            </span>
        );
    }

    function formatTime(t: string) {
        return t.substring(0, 5);
    }

    function getMonthName() {
        return new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date());
    }

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="bg-white border rounded-lg p-6 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
                        <div className="h-8 bg-gray-200 rounded w-1/4 mb-2"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    </div>
                ))}
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-red-50 text-[#ef4444] p-4 rounded-lg">
                {error || 'No se pudieron cargar los datos del dashboard'}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Hoy */}
            <div className="bg-white border rounded-lg p-6 shadow-sm md:col-span-2 lg:col-span-1">
                <h3 className="text-gray-500 text-sm font-medium mb-1">Sesiones de hoy</h3>
                <p className="text-xs text-gray-400 mb-4">{data.today.date}</p>

                {data.today.upcoming_sessions.length > 0 ? (
                    <ul className="space-y-3">
                        {data.today.upcoming_sessions.map(s => (
                            <li key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-100">
                                <div className="flex items-center gap-3">
                                    <div className="bg-[#1a2e4a] text-white px-2 py-1 rounded text-sm font-medium">
                                        {formatTime(s.hora_inicio)}
                                    </div>
                                    <div>
                                        <p className="font-medium text-sm text-[#1a2e4a]">{s.patient_name}</p>
                                    </div>
                                </div>
                                {onNavigateToAgenda && data.today.date && (
                                    <button
                                        onClick={() => onNavigateToAgenda(data.today.date!)}
                                        className="text-xs font-semibold text-[#1a2e4a] hover:text-[#243d61] flex items-center gap-0.5 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 transition-colors"
                                    >
                                        Ver
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center py-6 text-gray-500 bg-gray-50 rounded border border-dashed border-gray-200">
                        No hay sesiones para hoy
                    </div>
                )}
            </div>

            {/* Card 2: Ocupación semanal */}
            <div className="bg-white border rounded-lg p-6 shadow-sm">
                <h3 className="text-gray-500 text-sm font-medium mb-4">Ocupación semanal</h3>
                <div className="flex items-baseline mb-1">
                    <span className="text-3xl font-bold text-[#1a2e4a]">{data.week.occupancy_pct}%</span>
                    <DiffBadge cur={data.week.occupancy_pct} prev={data.week.prev_occupancy_pct} />
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    {data.week.booked_slots} de {data.week.total_slots} turnos ocupados esta semana
                </p>
                <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                        className="bg-[#1a2e4a] h-2 rounded-full"
                        style={{ width: `${Math.min(data.week.occupancy_pct, 100)}%` }}
                    ></div>
                </div>
            </div>

            {/* Card 3: Ocupación mensual */}
            <div className="bg-white border rounded-lg p-6 shadow-sm">
                <h3 className="text-gray-500 text-sm font-medium mb-1">Ocupación mensual</h3>
                <p className="text-xs text-gray-400 mb-4 capitalize">{getMonthName()}</p>

                <div className="flex items-baseline mb-1">
                    <span className="text-3xl font-bold text-[#1a2e4a]">{data.month.occupancy_pct}%</span>
                    <DiffBadge cur={data.month.occupancy_pct} prev={data.month.prev_occupancy_pct} />
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    {data.month.booked_slots} de {data.month.total_slots} turnos ocupados este mes
                </p>
                <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                        className="bg-[#1a2e4a] h-2 rounded-full"
                        style={{ width: `${Math.min(data.month.occupancy_pct, 100)}%` }}
                    ></div>
                </div>
            </div>

            {/* Card 4: Sesiones del mes */}
            <div className="bg-white border rounded-lg p-6 shadow-sm">
                <h3 className="text-gray-500 text-sm font-medium mb-4">Sesiones del mes</h3>
                <div className="flex items-baseline mb-1">
                    <span className="text-3xl font-bold text-[#1a2e4a]">{data.month.new_sessions}</span>
                    <span className="text-gray-600 ml-2">sesiones</span>
                    <DiffBadge cur={data.month.new_sessions} prev={data.month.prev_booked_slots} />
                </div>
                <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                    <span className="text-[#ef4444] font-medium">{data.month.cancelled} canceladas</span>
                    <span className="text-gray-300">•</span>
                    <span>{data.month.cancellation_rate_pct}% tasa de cancelación</span>
                </p>
            </div>

            {/* Card 5: Pacientes */}
            <div className="bg-white border rounded-lg p-6 shadow-sm">
                <h3 className="text-gray-500 text-sm font-medium mb-4">Pacientes</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl font-bold text-[#1a2e4a]">{data.patients.active}</span>
                            <svg className="w-5 h-5 text-[#1a2e4a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                        </div>
                        <p className="text-sm text-gray-600 font-medium">Activos</p>
                    </div>

                    <div className="bg-yellow-50/50 p-4 rounded-lg border border-yellow-100">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl font-bold text-yellow-700">{data.patients.new_this_month}</span>
                            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                            </svg>
                        </div>
                        <p className="text-sm text-yellow-800 font-medium">Nuevos (mes)</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
