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

test("a collection can be renamed", async ({ page }) => {
  await expect(
    page.getByRole("button", { exact: true, name: "Scratchpad 2" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Rename Scratchpad" }).click();

  const input = page.getByLabel("Collection name");
  await input.fill("My APIs");
  await input.press("Enter");

  await expect(
    page.getByRole("button", { exact: true, name: "My APIs 2" })
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

test("a curl command can be imported", async ({ page }) => {
  await page.getByRole("button", { name: "Import cURL" }).click();

  await page
    .getByLabel("cURL command")
    .fill(
      "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"ada\"}'"
    );

  await page.getByRole("button", { name: "Run cURL import" }).click();

  await expect(page.getByLabel("URL")).toHaveValue(
    "https://api.example.com/users"
  );
  await expect(page.getByLabel("Key").first()).toHaveValue("Content-Type");

  await page.getByRole("button", { name: "Body" }).first().click();
  await expect(page.getByLabel("Request body")).toHaveValue('{"name":"ada"}');
});

test("a bearer token auth can be configured", async ({ page }) => {
  await page.getByRole("button", { name: "Auth" }).click();

  await page.getByLabel("Auth type").selectOption("bearer");
  await page.getByLabel("Token").fill("{{token}}");

  await expect(page.getByLabel("Token")).toHaveValue("{{token}}");
});

test("an oauth2 client credentials grant can be configured", async ({
  page
}) => {
  await page.getByRole("button", { name: "Auth" }).click();

  await page.getByLabel("Auth type").selectOption("oauth2");
  await page.getByLabel("Grant type").selectOption("client_credentials");

  // token-only grants hide the browser-redirect fields
  await expect(page.getByLabel("Auth URL")).toHaveCount(0);

  await page
    .getByLabel("Access Token URL")
    .fill("https://example.com/oauth/token");
  await page.getByLabel("Client ID").fill("{{clientId}}");
  await page.getByLabel("Scope").fill("read write");

  await expect(page.getByLabel("Access Token URL")).toHaveValue(
    "https://example.com/oauth/token"
  );
  await expect(page.getByRole("button", { name: "Get New Token" })).toBeVisible();
});

test("oauth2 authorization code grant reveals the redirect fields", async ({
  page
}) => {
  await page.getByRole("button", { name: "Auth" }).click();

  await page.getByLabel("Auth type").selectOption("oauth2");
  await page.getByLabel("Grant type").selectOption("authorization_code");

  await expect(page.getByLabel("Auth URL")).toBeVisible();
  await expect(page.getByLabel("Redirect URL")).toBeVisible();
});

test("environments are first class and switchable", async ({ page }) => {
  await page.getByRole("button", { name: "Env" }).click();

  await expect(page.getByLabel("Key").first()).toHaveValue("baseUrl");

  await page.getByRole("button", { name: "New environment" }).click();

  // new environment becomes active and starts empty
  await expect(page.getByLabel("Key").first()).toHaveValue("");
  await page.getByLabel("Key").first().fill("stagingOnly");

  // switching the global environment swaps the variable set
  await page
    .getByLabel("Environment", { exact: true })
    .selectOption({ label: "Default" });
  await expect(page.getByLabel("Key").first()).toHaveValue("baseUrl");

  await page
    .getByLabel("Environment", { exact: true })
    .selectOption({ label: "Environment 2" });
  await expect(page.getByLabel("Key").first()).toHaveValue("stagingOnly");
});

test("a request can override the active environment", async ({ page }) => {
  await page.getByRole("button", { name: "Env" }).click();
  await page.getByRole("button", { name: "New environment" }).click();
  await page.getByLabel("Key").first().fill("baseUrl");
  await page
    .getByLabel("Variable value")
    .first()
    .fill("https://staging.example.com");

  // make Default the active environment again
  await page
    .getByLabel("Environment", { exact: true })
    .selectOption({ label: "Default" });

  await page.getByLabel("URL", { exact: true }).fill("{{baseUrl}}/ping");

  // override just this request to the staging environment
  await page
    .getByLabel("Request environment")
    .selectOption({ label: "Environment 2" });

  await expect(
    page.locator('span[title="baseUrl = https://staging.example.com"]')
  ).toBeVisible();
});

test("an environment variable can be masked and revealed", async ({ page }) => {
  await page.getByRole("button", { name: "Env" }).click();

  const firstValue = page.getByLabel("Variable value").first();
  await expect(firstValue).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Mark as secret" }).first().click();
  await expect(firstValue).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Reveal value" }).click();
  await expect(firstValue).toHaveAttribute("type", "text");
});
