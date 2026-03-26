export interface PatientRow {
  nombre: string;
  email: string;
  telefono: string;
}

export interface ExportRow {
  nombre: string;
  email: string;
  telefono: string;
  total_sesiones: number;
  ultima_sesion: string;
  proxima_sesion: string;
  sesion_fecha: string;
  sesion_hora_inicio: string;
  sesion_estado: 'realizada' | 'proxima' | 'cancelada' | null;
}

const REQUIRED_COLUMNS = ['nombre', 'email', 'telefono'] as const;

// Parses a single CSV line respecting RFC 4180 double-quote escaping.
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

export function parseCSV(csv: string): PatientRow[] {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      throw new Error(`El archivo debe tener columnas: nombre, email, teléfono`);
    }
  }

  const idx = {
    nombre: headers.indexOf('nombre'),
    email: headers.indexOf('email'),
    telefono: headers.indexOf('telefono'),
  };

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    return {
      nombre: (cols[idx.nombre] ?? '').trim(),
      email: (cols[idx.email] ?? '').trim().toLowerCase(),
      telefono: (cols[idx.telefono] ?? '').trim(),
    };
  }).filter(r => r.nombre && r.email);
}

function escapeCSVValue(value: string | number | null): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const EXPORT_HEADERS = [
  'nombre', 'email', 'telefono', 'total_sesiones',
  'ultima_sesion', 'proxima_sesion', 'sesion_fecha',
  'sesion_hora_inicio', 'sesion_estado',
] as const;

export function buildCSV(rows: ExportRow[]): string {
  const lines = [EXPORT_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(EXPORT_HEADERS.map(h => escapeCSVValue(row[h])).join(','));
  }
  return lines.join('\n');
}

export function downloadFile(content: string | Blob, filename: string, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
