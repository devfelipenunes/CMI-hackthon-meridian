import { expect, test } from "@playwright/test";

test.describe("público", () => {
  test("a lista carrega o ledger e os leilões", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("sealed-bid auctions");
    await expect(page.getByText(/ledger [\d,]+/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("um id inexistente mostra 404, não erro de RPC", async ({ page }) => {
    await page.goto("/market/999999999");
    await expect(page.getByText("Auction not found")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Try again")).toHaveCount(0);
  });

  test("a rota pública não guarda preço em storage nem na URL", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    const state = await page.evaluate(() => ({
      href: location.href,
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    expect(state.href).not.toMatch(/price|preco|preço|amount|valor/i);
    expect(state.local).not.toMatch(/price|777777777/i);
    expect(state.session).not.toMatch(/price|777777777/i);
  });
});
