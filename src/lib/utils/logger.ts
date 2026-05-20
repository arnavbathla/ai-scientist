import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "researchos" },
  redact: {
    paths: [
      "anthropicApiKey",
      "ANTHROPIC_API_KEY",
      "passwordHash",
      "password",
      "Authorization",
      "authorization",
      "headers.authorization",
      "headers.cookie",
      "cookie",
    ],
    censor: "[REDACTED]",
  },
});
