import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(10),
  JWT_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  STATIC_DIR: z.string().default("/app/public"),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(5).max(120).default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  RESEND_API_KEY: z.string().optional(),
  AUTH_FROM_EMAIL: z.string().default("CodeForge <noreply@example.com>"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  RAILWAY_ORCHESTRATOR_SECRET: z.string().min(32).optional(),
});

export const config = schema.parse(process.env);
