import { z } from "zod";

/**
 * Environment validation.
 * Values are read lazily so this module is safe to import from the client (env will be empty there).
 */
const schema = z.object({
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().min(1).optional(),
  NEXTAUTH_SECRET: z.string().min(8).optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  NCBI_EMAIL: z.string().optional(),
  NCBI_API_KEY: z.string().optional(),
  OPENALEX_EMAIL: z.string().optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  RESEARCH_WORKER_CONCURRENCY: z.coerce.number().default(2),
  RESEARCH_HEARTBEAT_INTERVAL_MS: z.coerce.number().default(15000),
  RESEARCH_STALE_SESSION_AGE_MS: z.coerce.number().default(120000),
});

export type Env = z.infer<typeof schema>;

let _env: Env | undefined;

export function env(): Env {
  if (_env) return _env;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Use console here because logger imports env — would cycle.
    // eslint-disable-next-line no-console
    console.error("Invalid env:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  _env = parsed.data;
  return _env;
}

/** True iff Anthropic provider has a key configured. */
export function hasAnthropicKey(): boolean {
  const k = env().ANTHROPIC_API_KEY;
  return Boolean(k && k.length > 10);
}
