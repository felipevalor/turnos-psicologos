import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

export const holidaysRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type PublicHoliday = {
    date: string;
    localName: string;
    name: string;
    countryCode: string;
};

// In-memory fallback cache (per-isolate; KV used when available for cross-isolate persistence)
const memoryCache = new Map<number, { timestamp: number; data: PublicHoliday[] }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const KV_CACHE_TTL_SECONDS = 86400;

export async function fetchArgentineHolidays(year: number, kv?: KVNamespace): Promise<PublicHoliday[]> {
    const kvKey = `holidays:AR:${year}`;

    // 1. Try KV cache
    if (kv) {
        const cached = await kv.get(kvKey);
        if (cached) return JSON.parse(cached) as PublicHoliday[];
    }

    // 2. Try in-memory cache
    const memCached = memoryCache.get(year);
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL_MS) {
        return memCached.data;
    }

    // 3. Fetch from external API
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`, {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const data = (await res.json()) as PublicHoliday[];

        if (kv) {
            await kv.put(kvKey, JSON.stringify(data), { expirationTtl: KV_CACHE_TTL_SECONDS });
        }
        memoryCache.set(year, { timestamp: Date.now(), data });

        return data;
    } catch {
        // Return empty array on failure — slots will be generated for "holiday" dates
        return memoryCache.get(year)?.data ?? [];
    }
}

// GET /api/holidays?year=YYYY
holidaysRouter.get('/', authMiddleware, async (c) => {
    const psychologistId = c.get('psychologistId');
    const yearQuery = c.req.query('year');
    const year = yearQuery ? parseInt(yearQuery, 10) : new Date().getFullYear();

    if (isNaN(year) || year < 2020 || year > 2100) {
        return c.json({ success: false, error: 'Año inválido' }, 400);
    }

    // 1. Fetch from external API
    const externalHolidays = await fetchArgentineHolidays(year, c.env.CACHE);

    // 2. Fetch overrides from DB for this psychologist
    const overridesResult = await c.env.DB.prepare(
        'SELECT "date" FROM holiday_overrides WHERE psychologist_id = ? AND "date" LIKE ?'
    )
        .bind(psychologistId, `${year}-%`)
        .all<{ date: string }>();

    const overriddenDates = new Set(overridesResult.results.map(r => r.date));

    // 3. Combine them
    const data = externalHolidays.map(hol => ({
        date: hol.date,
        localName: hol.localName,
        overridden: overriddenDates.has(hol.date)
    }));

    return c.json({ success: true, data });
});

// POST /api/holidays/override
holidaysRouter.post('/override', authMiddleware, async (c) => {
    const psychologistId = c.get('psychologistId');

    let body: { date?: string };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
    }

    const { date } = body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return c.json({ success: false, error: 'Fecha inválida (YYYY-MM-DD)' }, 400);
    }

    try {
        await c.env.DB.prepare(
            'INSERT OR IGNORE INTO holiday_overrides (psychologist_id, "date") VALUES (?, ?)'
        ).bind(psychologistId, date).run();

        return c.json({ success: true });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: 'Error al agregar excepción de feriado' }, 500);
    }
});

// DELETE /api/holidays/override/:date
holidaysRouter.delete('/override/:date', authMiddleware, async (c) => {
    const psychologistId = c.get('psychologistId');
    const date = c.req.param('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return c.json({ success: false, error: 'Fecha inválida (YYYY-MM-DD)' }, 400);
    }

    try {
        await c.env.DB.prepare(
            'DELETE FROM holiday_overrides WHERE psychologist_id = ? AND "date" = ?'
        ).bind(psychologistId, date).run();

        return c.json({ success: true });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: 'Error al eliminar excepción de feriado' }, 500);
    }
});
