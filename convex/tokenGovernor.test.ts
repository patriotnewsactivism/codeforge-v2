/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("token governor & BYOK verification", () => {
  test("allows token requests within tier quotas", async () => {
    const t = convexTest(schema, modules);
    const check = await t.query(api.tokenGovernor.checkTokenBudget, {
      tier: "free",
      requestedTokens: 2000,
      recentMinuteTokens: 1000,
      todayTokens: 10000,
    });

    expect(check.allowed).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  test("flags per-minute rate limit breaches", async () => {
    const t = convexTest(schema, modules);
    const check = await t.query(api.tokenGovernor.checkTokenBudget, {
      tier: "free",
      requestedTokens: 5000,
      recentMinuteTokens: 7000,
      todayTokens: 10000,
    });

    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Rate limit exceeded");
  });

  test("verifies BYOK keys with proper prefix and checksum", async () => {
    const t = convexTest(schema, modules);
    const validRes = await t.mutation(api.tokenGovernor.verifyByokKey, {
      provider: "openai",
      apiKeyMasked: "sk-proj-12345678",
      encryptedKeyHex: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      keyChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(validRes.valid).toBe(true);

    const invalidRes = await t.mutation(api.tokenGovernor.verifyByokKey, {
      provider: "openai",
      apiKeyMasked: "invalid-key-format",
      encryptedKeyHex: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      keyChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(invalidRes.valid).toBe(false);
  });
});
