import { test, expect } from "@playwright/test";
import { scryptSync } from "node:crypto";

// Synthetic values only. Never use a real administrator password in browser QA.
const syntheticPassword = "Синтетический-test-🌿-123";

test("setup is explicit, local-only, Node-compatible and clearable", async ({ page }, testInfo) => {
  await page.goto("/admin/setup");
  await expect(page.getByRole("heading", { name: "Подготовка пароля" })).toBeVisible();
  const password = page.getByLabel("Новый пароль", { exact: true });
  const confirmation = page.getByLabel("Повторите пароль", { exact: true });
  const generate = page.getByRole("button", { name: "Сформировать хеш", exact: true });
  await expect(password).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await expect(page.getByLabel("Значение ADMIN_PASSWORD_HASH")).toHaveCount(0);
  await page.waitForLoadState("networkidle");

  const requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), body: request.postData() }));
  await page.evaluate(() => {
    window.__setupTestCalls = [];
    for (const name of ["setItem", "removeItem", "clear"]) {
      Storage.prototype[name] = function () { window.__setupTestCalls.push(`storage:${name}`); };
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async () => { window.__setupTestCalls.push("clipboard"); };
    }
  });
  await password.fill(syntheticPassword);
  await confirmation.fill(syntheticPassword);
  await expect(page.getByLabel("Значение ADMIN_PASSWORD_HASH")).toHaveCount(0);
  await generate.click();
  const result = page.getByLabel("Значение ADMIN_PASSWORD_HASH");
  await expect(result).toHaveValue(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  const first = await result.inputValue();
  const [salt, hash] = first.split(":");
  expect(hash).toBe(scryptSync(syntheticPassword, salt, 64).toString("hex"));
  await expect(password).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.__setupTestCalls)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Synthetic fixture only; never capture a real administrator credential.
  await page.screenshot({ path: testInfo.outputPath("admin-setup-synthetic.png"), fullPage: true });

  await page.getByRole("button", { name: "Выделить значение" }).click();
  expect(await result.evaluate((element) => element.selectionEnd - element.selectionStart)).toBe(first.length);
  expect(await page.evaluate(() => window.__setupTestCalls)).toEqual([]);
  await page.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(result).toHaveCount(0);
  await expect(password).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await page.reload();
  await expect(password).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await expect(result).toHaveCount(0);
});

test("setup rejects missing, short and mismatched passwords without generating", async ({ page }) => {
  await page.goto("/admin/setup");
  const generate = page.getByRole("button", { name: "Сформировать хеш", exact: true });
  await generate.click();
  await expect(page.getByRole("alert")).toContainText("от 12 до 256");
  await page.getByLabel("Новый пароль", { exact: true }).fill("synthetic");
  await generate.click();
  await expect(page.getByRole("alert")).toContainText("от 12 до 256");
  await page.getByLabel("Новый пароль", { exact: true }).fill(syntheticPassword);
  await page.getByLabel("Повторите пароль", { exact: true }).fill("synthetic-other-password");
  await generate.click();
  await expect(page.getByRole("alert")).toContainText("Пароли не совпадают");
  await expect(page.getByLabel("Значение ADMIN_PASSWORD_HASH")).toHaveCount(0);
});

test("a same-turn Clear discards an already requested generation", async ({ page }) => {
  await page.goto("/admin/setup");
  await page.getByLabel("Новый пароль", { exact: true }).fill(syntheticPassword);
  await page.getByLabel("Повторите пароль", { exact: true }).fill(syntheticPassword);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Сформировать хеш").click();
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Очистить").click();
  });
  await expect(page.getByLabel("Новый пароль", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Повторите пароль", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Сформировать хеш", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Значение ADMIN_PASSWORD_HASH")).toHaveCount(0);
});
