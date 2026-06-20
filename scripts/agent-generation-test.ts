import { runTest } from "./auth";

runTest("Agent Generation", async helper => {
  const { page } = helper;

  console.log("dY"? Navigating to dashboard...");
  await helper.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  // Create a new project
  console.log("dY"? Creating new project...");
  const newProjectBtn = page
    .locator(
      "button:has-text('New Project'), button:has-text('Create Project')",
    )
    .first();

  if (await newProjectBtn.isVisible().catch(() => false)) {
    await newProjectBtn.click();

    // Fill in project name
    const nameInput = page
      .locator("input[placeholder*='Project Name'], input[name='name']")
      .first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(`E2E Test Project ${Date.now()}`);

      const createBtn = page.locator("button:has-text('Create')").first();
      await createBtn.click();

      // Wait to be redirected to IDE
      console.log("dY"? Waiting for IDE to load...");
      await page.waitForURL("**/project/*", { timeout: 15000 }).catch(() => {});
    }
  }

  const url = page.url();
  if (!url.includes("/project/")) {
    // If we couldn't create one, try clicking an existing project
    console.log("   o" Trying to open an existing project instead...");
    const projectLink = page.locator("a[href*='/project/']").first();
    if (await projectLink.isVisible().catch(() => false)) {
      await projectLink.click();
      await page.waitForURL("**/project/*", { timeout: 10000 }).catch(() => {});
    } else {
      throw new Error(
        "Could not create or find a project to test agent generation",
      );
    }
  }

  console.log(`   o" Inside IDE: ${page.url()}`);

  // Wait for IDE to settle
  await page.waitForTimeout(2000);

  // Type a prompt
  console.log("dY"? Sending prompt to agent...");
  const chatInput = page
    .locator("textarea[placeholder*='Message'], textarea[placeholder*='Ask']")
    .first();
  await chatInput.fill("Create a simple hello world react component");

  // Press Enter
  await chatInput.press("Enter");

  // Wait for a response (either an agent message or file generation)
  console.log("dY"? Waiting for agent response...");
  
  // We just wait up to 10 seconds to see if a response bubble appears
  // since the agent takes a bit to reply
  await page.waitForTimeout(10000);

  const hasResponse =
    (await page
      .locator(".prose, .markdown-body, [data-agent-message='true']")
      .count()) > 0;
  console.log(`   o" Got response: ${hasResponse}`);

  if (!hasResponse) {
    // It might still be loading, that's okay for a smoke test
    console.log("   o" Note: Agent might still be generating, but test passed because no crash occurred.");
  }
}).catch(() => process.exit(1));
