import { runTest } from "../auth";

runTest("Landing & Public Pages", async helper => {
  const { page } = helper;

  console.log("Step 1: Landing page at /");
  await helper.goto("/");

  const headline = await page
    .locator("text=that gets smarter after every failure")
    .isVisible()
    .catch(() => false);
  if (!headline) {
    await helper.screenshot("e2e-landing-headline.png");
    throw new Error("Landing page headline not visible");
  }
  console.log("   ✓ Headline visible");

  const ctaButton = await page
    .locator("text=Get Started")
    .first()
    .isVisible()
    .catch(() => false);
  if (!ctaButton) {
    await helper.screenshot("e2e-landing-cta.png");
    throw new Error("CTA button not visible");
  }
  console.log("   ✓ CTA button visible");

  const signInLink = await page
    .locator("text=Sign In")
    .first()
    .isVisible()
    .catch(() => false);
  if (!signInLink) {
    await helper.screenshot("e2e-landing-signin.png");
    throw new Error("Sign In link not visible");
  }
  console.log("   ✓ Sign In link visible");

  const codeForgeBrand = await page
    .locator("text=CodeForge")
    .first()
    .isVisible()
    .catch(() => false);
  console.log(`   ✓ Brand visible: ${codeForgeBrand}`);

  console.log("Step 2: Pricing page at /pricing");
  await helper.goto("/pricing");

  const pricingLoaded = await page
    .locator("text=agent army")
    .isVisible()
    .catch(() => false);
  if (!pricingLoaded) {
    await helper.screenshot("e2e-pricing-hero.png");
    throw new Error("Pricing page hero not visible");
  }
  console.log("   ✓ Pricing hero visible");

  const freeTier = await page
    .locator("text=Free")
    .first()
    .isVisible()
    .catch(() => false);
  const weeklyTier = await page
    .locator("text=Weekly Boost")
    .isVisible()
    .catch(() => false);
  const monthlyTier = await page
    .locator("text=Monthly Pro")
    .isVisible()
    .catch(() => false);
  const founderTier = await page
    .locator("text=Founder")
    .isVisible()
    .catch(() => false);

  if (!freeTier || !weeklyTier || !monthlyTier || !founderTier) {
    await helper.screenshot("e2e-pricing-tiers.png");
    throw new Error(
      `Pricing tiers not all visible: Free=${freeTier} Weekly=${weeklyTier} Monthly=${monthlyTier} Founder=${founderTier}`,
    );
  }
  console.log("   ✓ All 4 pricing tiers visible");
}).catch(() => process.exit(1));
