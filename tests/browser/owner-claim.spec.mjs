import { test, expect } from "@playwright/test";
import { OWNER_HANDOFF_ACTIVE } from "../../shared/owner-handoff-mode.mjs";
test.skip(!OWNER_HANDOFF_ACTIVE, "Owner claim runs only in the isolated active source build.");

// Only synthetic fixtures. No real invitation/password, production endpoint or screenshots.
const invitation = "a".repeat(64);
const password = "synthetic-owner-password-123";
const available = { enabled: true, configured: true, complete: false, mayIssue: false };

async function open(page, status = available) {
  await page.route("**/api/owner-handoff", (route) => route.fulfill({ json: status }));
  await page.goto("/admin/claim");
}
async function fill(page) {
  await page.getByLabel("Код приглашения", { exact: true }).fill(invitation);
  await page.getByLabel("Новый пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль", { exact: true }).fill(password);
}
const save = (page) => page.getByRole("button", { name: "Сохранить пароль", exact: true });

test("explicit save only, no URL or storage secrets, successful separate login", async ({ page }) => {
  const posts = [];
  const requests = [];
  await page.addInitScript(() => {
    window.__claimStorageWrites = [];
    Storage.prototype.setItem = function (key) { window.__claimStorageWrites.push(key); };
  });
  await page.route("**/api/owner-handoff/redeem", (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { complete: true, loginRequired: true } });
  });
  await open(page);
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await fill(page);
  await page.getByLabel("Повторите пароль", { exact: true }).press("Enter");
  expect(posts).toHaveLength(0);
  await save(page).click();
  await expect(page.getByRole("heading", { name: "Пароль сохранён" })).toBeVisible();
  expect(posts).toEqual([{ invitation, password }]);
  // Status and bundled fonts may finish loading after navigation. Only the
  // explicit redemption may mutate; no request may expose secrets in its URL
  // or leave the same origin, regardless of load timing.
  expect(requests.filter(request => !["GET", "HEAD"].includes(request.method))).toEqual([
    { url: "http://127.0.0.1:4176/api/owner-handoff/redeem", method: "POST" },
  ]);
  for (const request of requests) {
    expect(new URL(request.url).origin).toBe("http://127.0.0.1:4176");
    expect(request.url).not.toContain(invitation);
    expect(request.url).not.toContain(password);
  }
  expect(await page.evaluate(() => window.__claimStorageWrites)).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.locator("input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Перейти ко входу" })).toHaveAttribute("href", "/admin");
});

test("validates locally and cancel clears every field", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/owner-handoff/redeem", (route) => { posts++; return route.abort(); });
  await open(page);
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("64 символов");
  await fill(page);
  await page.getByLabel("Новый пароль", { exact: true }).fill("short");
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("от 12 до 256");
  await page.getByLabel("Новый пароль", { exact: true }).fill(password + "different");
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("Пароли не совпадают");
  await page.getByRole("button", { name: "Отменить и очистить" }).click();
  for (const input of await page.locator("input").all()) await expect(input).toHaveValue("");
  expect(posts).toBe(0);
});

for (const status of [{ ...available, enabled: false }, { ...available, configured: false }, { ...available, complete: true }]) {
  test(`closed status never exposes a redeem form: ${JSON.stringify(status)}`, async ({ page }) => {
    await open(page, status);
    await expect(page.getByRole("heading", { name: status.complete ? "Пароль владельца уже настроен" : "Настройка по приглашению недоступна" })).toBeVisible();
    await expect(page.locator("input")).toHaveCount(0);
  });
}

test("no code ingestion from query or hash; page lifecycle erases entered values", async ({ page }) => {
  await page.route("**/api/owner-handoff", (route) => route.fulfill({ json: available }));
  await page.goto(`/admin/claim?invitation=${invitation}#${invitation}`);
  await expect(page.getByLabel("Код приглашения", { exact: true })).toHaveValue("");
  await fill(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  for (const input of await page.locator("input").all()) await expect(input).toHaveValue("");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(save(page)).toBeVisible();
  for (const input of await page.locator("input").all()) await expect(input).toHaveValue("");
});

for (const failure of ["network", "server", "malformed", "timeout"]) {
  test(`uncertain ${failure} result cannot auto-retry or claim success/failure`, async ({ page }) => {
    let posts = 0;
    if (failure === "timeout") await page.clock.install();
    await page.route("**/api/owner-handoff/redeem", async (route) => {
      posts++;
      if (failure === "network") return route.abort();
      if (failure === "server") return route.fulfill({ status: 503, json: { code: "HANDOFF_UNAVAILABLE" } });
      if (failure === "malformed") return route.fulfill({ status: 200, body: "not json" });
      // Unresolved response is intentionally left pending until the client timeout.
    });
    await open(page);
    await fill(page);
    await save(page).click();
    if (failure === "timeout") await page.clock.fastForward(21000);
    await expect(page.getByRole("alert")).toContainText("Пароль мог сохраниться");
    await expect(page.locator("input")).toHaveCount(0);
    await expect(save(page)).toHaveCount(0);
    expect(posts).toBe(1);
    await expect(page.getByRole("link", { name: "Перейти ко входу" })).toHaveAttribute("href", "/admin");
  });
}

test("double click, cancellation and late success never send twice or show stale success", async ({ page }) => {
  let posts = 0;
  let respond;
  await page.route("**/api/owner-handoff/redeem", async (route) => {
    posts++;
    await new Promise((resolve) => { respond = resolve; });
    await route.fulfill({ json: { complete: true, loginRequired: true } }).catch(() => {});
  });
  await open(page);
  await fill(page);
  await save(page).evaluate((button) => { button.click(); button.click(); });
  await expect.poll(() => posts).toBe(1);
  await page.getByRole("button", { name: "Отменить и очистить" }).click();
  await expect(page.getByRole("alert")).toContainText("Пароль мог сохраниться");
  respond();
  await expect(page.getByRole("heading", { name: "Пароль сохранён" })).toHaveCount(0);
  expect(posts).toBe(1);
});

test("known rejection is safely worded without reflecting server text", async ({ page }) => {
  await page.route("**/api/owner-handoff/redeem", (route) => route.fulfill({ status: 409, json: { code: "INVALID_INVITATION", error: `never reflect ${invitation} ${password}` } }));
  await open(page);
  await fill(page);
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("Приглашение недействительно или уже использовано");
  await expect(page.getByRole("alert")).not.toContainText(invitation);
  for (const input of await page.locator("input").all()) await expect(input).toHaveValue("");
});
