export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  CACHE?: KVNamespace;
};

export type AppVariables = {
  psychologistId: number;
  psychologistEmail: string;
};
