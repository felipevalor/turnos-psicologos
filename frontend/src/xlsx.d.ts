declare module 'xlsx' {
  interface WorkBook {
    Sheets: Record<string, WorkSheet>;
    SheetNames: string[];
  }
  interface WorkSheet {}
  interface Utils {
    sheet_to_json<T = unknown>(ws: WorkSheet, opts?: { defval?: unknown }): T[];
    json_to_sheet<T = unknown>(data: T[]): WorkSheet;
    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void;
  }
  export function read(data: ArrayBuffer | string, opts?: unknown): WorkBook;
  export function writeFile(wb: WorkBook, filename: string, opts?: unknown): void;
  export const utils: Utils;
}
