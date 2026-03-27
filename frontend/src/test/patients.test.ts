import { describe, it, expect } from 'vitest';
import { parseCSV, buildCSV } from '../lib/patients';

describe('parseCSV', () => {
  it('parses a valid 3-column CSV with header', () => {
    const csv = 'nombre,email,telefono\nAna García,ana@mail.com,1122\nJuan,juan@mail.com,3344';
    const result = parseCSV(csv);
    expect(result).toEqual([
      { nombre: 'Ana García', email: 'ana@mail.com', telefono: '1122' },
      { nombre: 'Juan', email: 'juan@mail.com', telefono: '3344' },
    ]);
  });

  it('trims whitespace and lowercases email', () => {
    const csv = 'nombre,email,telefono\n  Ana ,  ANA@mail.com , 1122 ';
    const result = parseCSV(csv);
    expect(result[0].email).toBe('ana@mail.com');
    expect(result[0].nombre).toBe('Ana');
  });

  it('returns empty array for CSV with only header', () => {
    expect(parseCSV('nombre,email,telefono\n')).toEqual([]);
  });

  it('throws if required columns are missing', () => {
    expect(() => parseCSV('name,mail,phone\nAna,ana@m.com,111')).toThrow();
  });

  it('handles missing telefono value (empty string)', () => {
    const csv = 'nombre,email,telefono\nAna,ana@mail.com,';
    const result = parseCSV(csv);
    expect(result[0].telefono).toBe('');
  });

  it('handles RFC 4180 quoted values containing commas', () => {
    const csv = 'nombre,email,telefono\n"García, Ana",ana@mail.com,1122';
    const result = parseCSV(csv);
    expect(result[0].nombre).toBe('García, Ana');
  });
});

describe('buildCSV', () => {
  it('builds a CSV string from export rows', () => {
    const rows = [
      {
        nombre: 'Ana', email: 'ana@mail.com', telefono: '111',
        total_sesiones: 2, ultima_sesion: '2026-03-01', proxima_sesion: '2026-04-01',
        sesion_fecha: '2026-03-01', sesion_hora_inicio: '10:00', sesion_estado: 'realizada' as const,
      },
    ];
    const csv = buildCSV(rows);
    expect(csv).toContain('nombre,email,telefono');
    expect(csv).toContain('Ana,ana@mail.com');
    expect(csv).toContain('2026-03-01');
  });

  it('wraps values containing commas in quotes', () => {
    const rows = [
      {
        nombre: 'García, Ana', email: 'ana@mail.com', telefono: '',
        total_sesiones: 0, ultima_sesion: '', proxima_sesion: '',
        sesion_fecha: '', sesion_hora_inicio: '', sesion_estado: null,
      },
    ];
    const csv = buildCSV(rows);
    expect(csv).toContain('"García, Ana"');
  });
});
