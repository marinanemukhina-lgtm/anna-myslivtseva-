import { test, expect } from "@playwright/test";

test("scientific reading imports as hidden editable drafts, never automatically publishes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "One writable CMS fixture run is sufficient.");
  await page.goto("/admin");
  await page.getByLabel("Пароль", { exact:true }).fill("browser-fixture-only-password");
  await page.getByRole("button", { name:"Войти", exact:true }).click();
  await expect(page.getByLabel("Специализация", { exact:true })).toBeVisible();
  await page.getByRole("button", { name:"Новости", exact:true }).click();
  const importButton = page.getByRole("button", { name:"Загрузить научные статьи в черновики" });
  await expect(importButton).toBeEnabled();
  await importButton.click();
  await expect(page.getByRole("status")).toContainText("Они не опубликованы");
  await expect(page.getByText("Что ВОЗ рекомендует при хронической боли в пояснице")).toBeVisible();
  const approval = page.getByRole("checkbox", { name:/Научный черновик. Публикация заблокирована/ });
  await expect(approval).toBeDisabled();
  await page.goto("/news");
  await expect(page.getByRole("heading", { name:"Новости" }).first()).toBeVisible();
  await expect(page.getByText("Что ВОЗ рекомендует при хронической боли в пояснице")).toHaveCount(0);
});
