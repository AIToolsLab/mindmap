import { expect, test, type Page } from "@playwright/test";

const PRODUCTION_API = "https://app.thoughtful-ai.com/api";
const RESOURCE = "https://app.thoughtful-ai.com";
const CLIENT_ID = "writing-tools-mindmap";
const SESSION_KEY = "prototype-mindmap-oauth-session-v1";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 43_200;
  return `${base64Url({ alg: "EdDSA", typ: "JWT" })}.${base64Url({ exp })}.signature`;
}

function envelope(response: unknown) {
  return { choices: [{ message: { content: JSON.stringify(response) } }] };
}

async function seedSession(page: Page, accessToken = jwt()) {
  await page.addInitScript(({ key, token, expiresAt }) => {
    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, accessToken: token, expiresAt }));
  }, { key: SESSION_KEY, token: accessToken, expiresAt: Date.now() + 43_200_000 });
}

async function installClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copied?: string }).__copied = text;
        },
      },
    });
  });
}

async function mockLogin(page: Page, options: { holdToken?: boolean } = {}) {
  let releaseToken: (() => void) | undefined;
  const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
  let signalToken: (() => void) | undefined;
  const tokenRequested = new Promise<void>((resolve) => { signalToken = resolve; });
  const accessToken = jwt();

  await page.route(`${PRODUCTION_API}/auth/oauth2/authorize**`, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openai:chat");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("resource")).toBe(RESOURCE);
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "pages-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.route(`${PRODUCTION_API}/auth/oauth2/token`, async (route) => {
    signalToken?.();
    if (options.holdToken) await tokenGate;
    const form = new URLSearchParams(route.request().postData() ?? "");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("code")).toBe("pages-code");
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(form.get("resource")).toBe(RESOURCE);
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ access_token: accessToken, token_type: "Bearer", scope: "openai:chat", expires_in: 43_200 }),
    });
  });
  return { accessToken, tokenRequested, releaseToken: () => releaseToken?.() };
}

test.beforeEach(async ({ page }) => {
  await installClipboard(page);
});

test("production requires Connect and loads without console or asset failures", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", (response) => {
    if (response.url().startsWith("http://127.0.0.1:") && response.status() >= 400) failedAssets.push(response.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to Writing Tools" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedAssets).toEqual([]);
});

test("full PKCE login scrubs callback material and authenticates AI calls", async ({ page }) => {
  const login = await mockLogin(page, { holdToken: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await login.tokenRequested;
  await expect.poll(() => new URL(page.url()).search).toBe("");
  login.releaseToken();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

  await page.route(`${PRODUCTION_API}/openai/chat/completions`, async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${login.accessToken}`);
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(envelope({ response: { kind: "question", text: "What matters here?", stance: "deepen" } })),
    });
  });
  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("Help me think.");
  await composer.press("Enter");
  await expect(page.getByText("What matters here?")).toBeVisible();
});

test("failed exchange still leaves no authorization material in the URL", async ({ page }) => {
  await page.route(`${PRODUCTION_API}/auth/oauth2/authorize**`, async (route) => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ code: "bad-code", state: url.searchParams.get("state")! }).toString();
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.route(`${PRODUCTION_API}/auth/oauth2/token`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 400, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "invalid_grant" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect to Writing Tools" })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("401 clears OAuth only and preserves local map work", async ({ page }) => {
  await seedSession(page);
  await page.route(`${PRODUCTION_API}/openai/chat/completions`, (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Writing-Tools-Error", "X-Writing-Tools-Error": "platform-auth" },
    body: JSON.stringify({ error: "invalid_token" }),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "+ New card" }).click();
  await page.locator("textarea.map-card-editor").fill("keep this card");
  await page.locator("textarea.map-card-editor").blur();
  await page.locator("textarea.composer-textarea").fill("Trigger auth");
  await page.locator("textarea.composer-textarea").press("Enter");
  await expect(page.getByRole("heading", { name: "Connect to Writing Tools" })).toBeVisible();
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem("prototype-mindmap-session-v1"))).toContain("keep this card");
});

test("403 keeps the workspace and never offers another login", async ({ page }) => {
  await seedSession(page);
  await page.route(`${PRODUCTION_API}/openai/chat/completions`, (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Writing-Tools-Error", "X-Writing-Tools-Error": "platform-auth" },
    body: JSON.stringify({ error: "forbidden" }),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "+ New card" }).click();
  await page.locator("textarea.map-card-editor").fill("still visible");
  await page.locator("textarea.map-card-editor").blur();
  await page.locator("textarea.composer-textarea").fill("Trigger auth");
  await page.locator("textarea.composer-textarea").press("Enter");
  await expect(page.getByText(/Contact the Writing Tools team for access/)).toBeVisible();
  await expect(page.locator("textarea.map-card-editor")).toHaveValue("still visible");
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
});

test("clipboard output and explicit Disconnect preserve local work", async ({ page }) => {
  await seedSession(page);
  await page.goto("/");
  const draft = page.locator(".draft-editor");
  await draft.fill("Draft to copy");
  await page.getByRole("button", { name: "Copy draft" }).click();
  expect(await page.evaluate(() => (window as Window & { __copied?: string }).__copied)).toBe("Draft to copy");

  await page.getByRole("button", { name: "+ New card" }).click();
  await page.locator("textarea.map-card-editor").fill("Map card");
  await page.locator("textarea.map-card-editor").blur();
  await page.getByRole("button", { name: "Copy map" }).click();
  expect(await page.evaluate(() => (window as Window & { __copied?: string }).__copied)).toBe("# Mindmap\n- Map card\n");

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect to Writing Tools" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("prototype-mindmap-session-v1"))).toContain("Map card");
});
