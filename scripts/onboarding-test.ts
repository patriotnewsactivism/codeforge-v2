import { runTest } from "./auth";

runTest("Onboarding Flow", async helper => {
  const { page } = helper;

  console.log("dY"? Navigating to onboarding...");
  await helper.goto("/onboarding");
  await page.waitForLoadState("networkidle");

  const url = page.url();
  console.log(`   o" Current URL: ${url}`);

  if (!url.includes("/onboarding") && !url.includes("/dashboard")) {
    throw new Error("Failed to reach onboarding or dashboard");
  }

  // If we are on onboarding, let's fill it out
  if (url.includes("/onboarding")) {
    console.log("dY"? Filling out onboarding form...");

    // Check if there are options to select (e.g., role)
    const developerOption = page.locator("text=Developer").first();
    if (await developerOption.isVisible().catch(() => false)) {
      await developerOption.click();
    }

    // Continue button
    const continueBtn = page
      .locator("button:has-text('Continue'), button:has-text('Get Started')")
      .first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForLoadState("networkidle");
    }

    console.log("dY"? Checking redirect to dashboard...");
    await page.waitForURL("**/dashboard", { timeout: 10000 }).catch(() => {});

    if (!page.url().includes("/dashboard")) {
      throw new Error("Did not redirect to dashboard after onboarding");
    }
    console.log("   o" Reached dashboard successfully!");
  } else {
    console.log("   o" Already onboarded (reached dashboard)");
  }
}).catch(() => process.exit(1));
