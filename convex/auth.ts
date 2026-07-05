import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { CodeForgeEmail, CodeForgePasswordReset } from "./email";
import { TestCredentials } from "./testAuth";

declare const process: { env: Record<string, string | undefined> };

// No process.env mutations allowed in Convex Edge runtime.
// If your JWT_PRIVATE_KEY fails to parse, ensure it's saved with correct newlines in the Convex Dashboard.

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
            // Request repo scope so the token captured at sign-in can read
            // (and push to) the user's repositories — this is what powers
            // one-click "Continue with GitHub" import/push without any
            // platform-wide token.
            authorization: {
              params: { scope: "read:user user:email repo" },
            },
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
