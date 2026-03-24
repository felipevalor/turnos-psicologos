export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  CACHE?: KVNamespace;
  KAPSO_API_KEY?: string;
  KAPSO_PHONE_NUMBER_ID?: string;
};

export type AppVariables = {
  psychologistId: number;
  psychologistEmail: string;
};
