import { runTest } from "../auth";

runTest("IDE Critical Path", async (helper) => {
  const { page } = helper;

  console.log("Step 1: Navigate to /dashboard");
  await helper.goto("/dashboard");
  await page.waitForTimeout(3000);

  const url = page.url();

  // May be redirected to onboarding for new users
  if (url.includes("/onboarding")) {
    console.log("   ℹ Redirected to onboarding (new user)");
    console.log("   ℹ No projects available to test IDE path");
    return;
  }

  if (!url.includes("/dashboard")) {
    await helper.screenshot("e2e-ide-dashboard-fail.png");
    throw new Error(`Not on dashboard. URL: ${url}`);
  }
  console.log("   ✓ On dashboard");

  console.log("Step 2: Check for existing projects");
  const noProjects = await page
    .locator("text=No projects yet")
    .isVisible()
    .catch(() => false);

  if (noProjects) {
    console.log("   ℹ No projects exist — empty state shown");
    console.log("   ℹ Skipping IDE navigation (no project available)");
    return;
  }

  // Try to find and click a project card
  const projectCard = page.locator(".cursor-pointer").first();
  const hasProjectCard = await projectCard.isVisible().catch(() => false);

  if (!hasProjectCard) {
    await helper.screenshot("e2e-ide-noprojects-fail.png");
    throw new Error("Expected project cards but none visible");
  }
  console.log("   ✓ Project card found");

  console.log("Step 3: Navigate to project IDE");
  await projectCard.click();
  await page.waitForTimeout(5000);

  const ideUrl = page.url();
  const inIDE = ideUrl.includes("/project/");

  if (!inIDE) {
    await helper.screenshot("e2e-ide-navigate-fail.png");
    const content = await page.locator("body").innerText();
    console.log(`   Page content: ${content.slice(0, 300)}`);
    throw new Error(`Failed to navigate to IDE. URL: ${ideUrl}`);
  }
  console.log(`   ✓ Navigated to IDE: ${ideUrl}`);

  console.log("Step 4: Check IDE loads");
  const hasFileTree = await page
    .locator("text=Files")
    .isVisible()
    .catch(() => false);
  const hasEditor = await page
    .locator(".monaco-editor")
    .isVisible()
    .catch(() => false);
  const hasChatTab = await page
    .locator("text=Chat")
    .isVisible()
    .catch(() => false);

  console.log(
    `   File tree: ${hasFileTree}, Editor: ${hasEditor}, Chat tab: ${hasChatTab}`
  );

  if (!hasFileTree && !hasEditor && !hasChatTab) {
    await helper.screenshot("e2e-ide-load-fail.png");
    throw new Error("IDE core components not detected");
  }
  console.log("   ✓ IDE loaded successfully");

}).catch(() => process.exit(1));
