import { runTest } from "../auth";

runTest("Dashboard Operations", async (helper) => {
  const { page } = helper;

  console.log("Step 1: Navigate to /dashboard");
  await helper.goto("/dashboard");

  // Wait for Convex queries to resolve
  await page.waitForTimeout(3000);

  const url = page.url();
  const onDashboard = url.includes("/dashboard") || url.includes("/onboarding");
  console.log(`   Current URL: ${url}`);
  console.log(`   ✓ On dashboard or onboarding: ${onDashboard}`);

  if (!onDashboard) {
    await helper.screenshot("e2e-dashboard-url-fail.png");
    throw new Error(`Not on dashboard. URL: ${url}`);
  }

  // May have been redirected to onboarding if it's a new user
  if (url.includes("/onboarding")) {
    console.log("   ℹ Redirected to onboarding (new user), skipping dashboard checks");
    return;
  }

  console.log("Step 2: Check project list area");
  const hasProjectHeader = await page
    .locator("text=Your Projects")
    .isVisible()
    .catch(() => false);
  const noProjects = await page
    .locator("text=No projects yet")
    .isVisible()
    .catch(() => false);
  const anyProjectCard = await page
    .locator(".cursor-pointer")
    .first()
    .isVisible()
    .catch(() => false);

  console.log(
    `   Header visible: ${hasProjectHeader}, Empty state: ${noProjects}, Has cards: ${anyProjectCard}`
  );

  if (!hasProjectHeader && !noProjects) {
    await helper.screenshot("e2e-dashboard-content-fail.png");
    const content = await page.locator("body").innerText();
    console.log(`   Page content: ${content.slice(0, 300)}`);
    throw new Error("Dashboard project area not detected");
  }
  console.log("   ✓ Project list area present");

  console.log("Step 3: Check 'New Project' button");
  const newProjectBtn = await page
    .locator("button:has-text('New Project')")
    .isVisible()
    .catch(() => false);
  if (!newProjectBtn) {
    await helper.screenshot("e2e-dashboard-newproject-fail.png");
    throw new Error("New Project button not visible");
  }
  console.log("   ✓ New Project button visible");

  console.log("Step 4: Open create project dialog");
  await page.locator("button:has-text('New Project')").click();
  await page.waitForTimeout(1000);

  const dialogTitle = await page
    .locator("text=Create New Project")
    .isVisible()
    .catch(() => false);
  if (!dialogTitle) {
    await helper.screenshot("e2e-dashboard-dialog-fail.png");
    throw new Error("Create project dialog did not open");
  }
  console.log("   ✓ Create project dialog opened");

  const projectNameInput = await page
    .locator("input#name")
    .isVisible()
    .catch(() => false);
  if (!projectNameInput) {
    await helper.screenshot("e2e-dashboard-dialog-input-fail.png");
    throw new Error("Project name input not visible in dialog");
  }
  console.log("   ✓ Project name input visible");

}).catch(() => process.exit(1));
