/**
 * Validate environment at startup. Warns on common misconfigurations; does not exit
 * (DB check will fail if DB is unreachable). Keeps startup fast and errors explicit.
 */
export function validateEnv(): void {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 16) {
    console.warn(
      '[Config] JWT_SECRET missing or < 16 chars. Google/Apple sign-in will fail. Set in backend/.env.'
    );
  }

  if (!process.env.DB_HOST) {
    console.warn('[Config] DB_HOST not set. Defaulting to localhost.');
  }
}
