import { test, expect } from "@playwright/test";
test("desktop navigation, offer modal validation, keyboard focus, saved inquiry and admin review", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Selling your home made simple." }),
  ).toBeVisible();
  const trigger = page.locator(".desktop-cta button");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    dialog.getByText("This field is required.").first(),
  ).toBeVisible();
  await dialog.getByLabel("Street address").fill("456 Browser Test Lane");
  await dialog
    .getByRole("textbox", { name: "City", exact: true })
    .fill("Wesley Chapel");
  await dialog.getByLabel("ZIP code").fill("33545");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog
    .getByLabel("Condition", { exact: true })
    .selectOption("Minor repairs");
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByLabel("Street address")).toHaveValue(
    "456 Browser Test Lane",
  );
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Full name").fill("Browser Seller");
  await dialog
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("browser@example.test");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Request my offer review." })
    .click();
  await expect(dialog.getByText("You’ve taken the first step.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation").getByText("About Us").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "A home sale is personal",
  );
  await page.getByRole("navigation").getByText("FAQs").click();
  await page.getByText("How do you determine a cash offer?").click();
  await expect(
    page.getByText("We consider location, current condition", { exact: false }),
  ).toBeVisible();
  await page.goto("/admin");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("admin@example.test");
  await page.getByLabel("Password").fill("test-password-long-enough");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Seller inquiries" }).click();
  await expect(page.getByText("Browser Seller")).toBeVisible();
});
test("mobile layout, menu, contact failure and retry preserve inputs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".mobile-sticky button")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation").getByText("Contact").click();
  await page.getByLabel("Full name").fill("Mobile Test");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("mobile@example.test");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Can we discuss my house?");
  await page.getByRole("checkbox").check();
  await page.route("**/api/contact", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary test outage. Please retry." }),
    }),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toContainText("Temporary test outage");
  await expect(page.getByLabel("Full name")).toHaveValue("Mobile Test");
  await page.unroute("**/api/contact");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("You’ve taken the first step.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/offer");
  await expect(
    page.getByRole("heading", { name: "Tell us about your home." }),
  ).toBeVisible();
});
test("modal focus stays trapped and entries survive dismissal; tablet has no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.locator(".desktop-cta button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Street address").fill("Preserved address");
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[role=dialog]"),
      ),
    ).toBeTruthy();
  }
  await page.keyboard.press("Escape");
  await page.locator(".desktop-cta button").click();
  await expect(dialog.getByLabel("Street address")).toHaveValue(
    "Preserved address",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
