import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("the collection plus starts a request in that collection", async ({
  page
}) => {
  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 2" })
  ).toBeVisible();

  await page
    .getByRole("button", { exact: true, name: "New request in Scratchpad" })
    .click();

  await expect(page.getByLabel("Request name")).toHaveValue(
    "Untitled request"
  );
  await expect(page.getByLabel("Method")).toHaveValue("GET");
  await expect(page.getByText("Collection 2", { exact: true })).toHaveCount(0);

  await page.getByLabel("Request name").fill("Header plus request");
  await page.getByRole("button", { exact: true, name: "Save" }).click();

  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 3" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "GET Header plus request"
    })
  ).toBeVisible();
});

test("a request can be deleted from the sidebar", async ({ page }) => {
  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 2" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Delete Echo anything" }).click();

  await expect(
    page.getByRole("button", { exact: true, name: "POST Echo anything" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 1" })
  ).toBeVisible();
});

test("a new collection can be created", async ({ page }) => {
  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 2" })
  ).toBeVisible();

  await page.getByRole("button", { exact: true, name: "New collection" }).click();

  await expect(
    page.getByRole("button", { exact: true, name: "Collection 2 0" })
  ).toBeVisible();
});

test("import loads collections from a file", async ({ page }) => {
  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 2" })
  ).toBeVisible();

  const payload = JSON.stringify({
    collections: [
      {
        id: "col-imported",
        name: "Imported",
        requests: [
          {
            id: "req-imported",
            name: "Imported call",
            method: "GET",
            url: "{{baseUrl}}/get",
            params: [],
            headers: [],
            body: ""
          }
        ]
      }
    ],
    history: [],
    environment: [
      { id: "env-1", key: "baseUrl", value: "https://example.com", enabled: true }
    ]
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: "openport.json",
    mimeType: "application/json",
    buffer: Buffer.from(payload)
  });

  await expect(
    page.getByRole("button", { exact: true, name: "Imported 1" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "GET Imported call" })
  ).toBeVisible();
});
