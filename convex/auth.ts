import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { CodeForgeEmail, CodeForgePasswordReset } from "./email";
import { TestCredentials } from "./testAuth";

declare const process: { env: Record<string, string | undefined> };

/**
 * Converts a space-separated PEM private key (as stored by Convex CLI)
 * into a properly newline-delimited PEM key that importPKCS8 can parse.
 */
function decodePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.includes("\n")) return key;

  if (!key.startsWith("-----BEGIN")) {
    try {
      return atob(key);
    } catch {
      return key;
    }
  }

  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";
  const content = key
    .replace(/-----BEGIN PRIVATE KEY-----\s*/, "")
    .replace(/\s*-----END PRIVATE KEY-----/, "")
    .trim();
  const base64 = content.replace(/\s+/g, "");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `${beginMarker}\n${lines.join("\n")}\n${endMarker}`;
}

const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
if (jwtPrivateKey) {
  process.env.JWT_PRIVATE_KEY = decodePrivateKey(jwtPrivateKey)!;
}

const resendConfigured = Boolean(process.env.RESEND_API_KEY);

// OAuth providers are only enabled when their credentials are present, so an
// unconfigured provider never crashes the auth flow. @convex-dev/auth reads
// AUTH_<PROVIDER>_ID / AUTH_<PROVIDER>_SECRET from the environment.
const githubConfigured = Boolean(
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
);
const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...(githubConfigured
      ? [
          GitHub({
            profile(profile, tokens) {
              return {
                id: profile.id.toString(),
                name: profile.name,
                email: profile.email,
                image: profile.avatar_url,
                githubToken: tokens.access_token,
              };
            },
          }),
        ]
      : []),
    ...(googleConfigured
      ? [
          Google({
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                image: profile.picture,
              };
            },
          }),
        ]
      : []),
    Password({
      // Only require email verification when Resend is configured.
      // Without it, sign-up and sign-in both fail because OTP can't be sent.
      ...(resendConfigured ? { verify: CodeForgeEmail } : {}),
      ...(resendConfigured ? { reset: CodeForgePasswordReset } : {}),
    }),
    // Enable test credentials in preview/dev environments
    ...(process.env.IS_PREVIEW === "true" ? [TestCredentials] : []),
  ],
});

// Surfaced to the client so the UI can show only the OAuth buttons that
// are actually configured.
export const enabledOAuthProviders = query({
  args: {},
  handler: async () => ({
    github: githubConfigured,
    google: googleConfigured,
  }),
});

export const currentUser = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});
