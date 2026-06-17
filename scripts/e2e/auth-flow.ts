import { runTest } from "../auth";

runTest("Auth Flow", async helper => {
  const { page, browser } = helper;

  console.log("Step 1: Landing page at /");
  await helper.goto("/");

  const landingLoaded = await page
    .locator("text=that gets smarter after every failure")
    .isVisible()
    .catch(() => false);
  if (!landingLoaded) {
    await helper.screenshot("e2e-auth-landing-fail.png");
    throw new Error("Landing page headline not visible");
  }
  console.log("   ✓ Landing page loads");

  console.log("Step 2: Signup page at /signup");
  await helper.goto("/signup");

  const signupHeading = await page
    .locator("text=Create an account")
    .isVisible()
    .catch(() => false);
  const nameField = await page
    .locator("input[name='name']")
    .isVisible()
    .catch(() => false);
  const emailField = await page
    .locator("input[name='email']")
    .isVisible()
    .catch(() => false);
  const passwordField = await page
    .locator("input[name='password']")
    .isVisible()
    .catch(() => false);
  const submitButton = await page
    .locator("button[type='submit']")
    .isVisible()
    .catch(() => false);

  if (
    !signupHeading ||
    !nameField ||
    !emailField ||
    !passwordField ||
    !submitButton
  ) {
    await helper.screenshot("e2e-auth-signup-fail.png");
    throw new Error(
      `Signup form incomplete: heading=${signupHeading} name=${nameField} email=${emailField} password=${passwordField} submit=${submitButton}`,
    );
  }
  console.log("   ✓ Signup form visible");

  console.log("Step 3: Login page at /login");
  await helper.goto("/login");

  const loginHeading = await page
    .locator("text=Welcome back")
    .isVisible()
    .catch(() => false);
  const loginEmail = await page
    .locator("input[name='email']")
    .isVisible()
    .catch(() => false);
  const loginPassword = await page
    .locator("input[name='password']")
    .isVisible()
    .catch(() => false);
  const loginSubmit = await page
    .locator("button[type='submit']")
    .isVisible()
    .catch(() => false);

  if (!loginHeading || !loginEmail || !loginPassword || !loginSubmit) {
    await helper.screenshot("e2e-auth-login-fail.png");
    throw new Error(
      `Login form incomplete: heading=${loginHeading} email=${loginEmail} password=${loginPassword} submit=${loginSubmit}`,
    );
  }
  console.log("   ✓ Login form visible");

  console.log("Step 4: Unauthenticated /dashboard redirects to /login");
  const baseUrl = new URL(page.url()).origin;
  const incognitoContext = await browser.newContext();
  const incognitoPage = await incognitoContext.newPage();

  try {
    await incognitoPage.goto(`${baseUrl}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await incognitoPage.waitForTimeout(2000);

    const currentUrl = incognitoPage.url();
    const redirectedToLogin = currentUrl.includes("/login");

    if (!redirectedToLogin) {
      await helper.screenshot("e2e-auth-redirect-fail.png");
      throw new Error(
        `Unauthenticated /dashboard did NOT redirect to /login. Current URL: ${currentUrl}`,
      );
    }
    console.log("   ✓ Unauth /dashboard redirects to /login");
  } finally {
    await incognitoContext.close();
  }
}).catch(() => process.exit(1));
