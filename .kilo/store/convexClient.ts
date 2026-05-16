export function createConvexClient(address?: string): any | null {
  try {
    const mod = require("convex");
    const addr =
      address ||
      process.env.CONVEX_ADDRESS ||
      "https://honorable-finch-460.convex.cloud";
    if (typeof mod.createClient === "function") {
      return mod.createClient({ address: addr });
    }
    if (typeof mod.default?.createClient === "function") {
      return mod.default.createClient({ address: addr });
    }
  } catch {
    // convex client not available; fall back to local
  }
  return null;
}
