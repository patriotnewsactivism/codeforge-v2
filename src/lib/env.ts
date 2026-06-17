export function validateEnv(): string | null {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) {
    return "VITE_CONVEX_URL is missing. Run `npx convex dev` to start the Convex backend.";
  }
  return null;
}
