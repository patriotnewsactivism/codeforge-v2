import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { TestCredentials } from "./testAuth";
import {
  ViktorSpacesEmail,
  ViktorSpacesPasswordReset,
} from "./ViktorSpacesEmail";

declare const process: { env: Record<string, string | undefined> };

/**
 * Converts a space-separated PEM private key (as stored by Convex CLI)
 * into a properly newline-delimited PEM key that importPKCS8 can parse.
 *
 * Convex stores keys with spaces instead of newlines, e.g.:
 *   "-----BEGIN PRIVATE KEY----- MIIEv... -----END PRIVATE KEY-----"
 *
 * We need:
 *   "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----"
 */
function decodePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  // Already has newlines — fine as-is
  if (key.includes("\n")) return key;
  // Base64 encoded whole key
  if (!key.startsWith("-----BEGIN")) {
    try {
      return atob(key);
    } catch {
      return key;
    }
  }
  // Space-separated PEM: extract content between header and footer
  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";
  // Strip the markers (they may have trailing/leading spaces)
  let content = key
    .replace(/-----BEGIN PRIVATE KEY-----\s*/, "")
    .replace(/\s*-----END PRIVATE KEY-----/, "")
    .trim();
  // content is space-separated base64 — join into one string then wrap at 64 chars
  const base64 = content.replace(/\s+/g, "");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `${beginMarker}\n${lines.join("\n")}\n${endMarker}`;
}

const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
if (jwtPrivateKey) {
  process.env.JWT_PRIVATE_KEY = decodePrivateKey(jwtPrivateKey)!;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      verify: ViktorSpacesEmail,
      reset: ViktorSpacesPasswordReset,
    }),
    ...(process.env.VIKTOR_SPACES_IS_PREVIEW === "true" ? [TestCredentials] : []),
  ],
});

export const currentUser = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});
