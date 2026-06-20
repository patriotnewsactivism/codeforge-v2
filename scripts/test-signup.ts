import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const client = new ConvexHttpClient(
  process.env.VITE_CONVEX_URL || "http://127.0.0.1:3210",
);

async function main() {
  try {
    const res = await client.action(api.auth.signIn, {
      provider: "password",
      params: {
        name: "Real User",
        email: "real@example.com",
        password: "password123",
        flow: "signUp",
        redirectTo: "/onboarding",
      },
    });
    console.log("Success:", res);
  } catch (err) {
    console.error("Error signing up:", err);
  }
}

main();
