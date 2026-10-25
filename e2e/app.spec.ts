import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:4010';
const fixtureDir = fileURLToPath(new URL('./../tests/api/fixtures/', import.meta.url));

async function loadSpec(page: Page, url = `${API}/specs/fastapi.json`) {
  await page.goto('/');
  await page.getByTestId('spec-url-input').fill(url);
  await page.getByTestId('load-spec').click();
  await expect(page.getByTestId('spec-title')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('load-error')).toHaveCount(0);
}

async function enableTryItOut(page: Page, method: string, path: string) {
  const button = page.getByTestId(`try-it-out-${method}-${path}`);
  await expect(button).toBeVisible();
  await button.click();
}

test.describe('documentation', () => {
  test('loads a spec and groups endpoints by tag', async ({ page }) => {
    await loadSpec(page);
    await expect(page.getByTestId('spec-title')).toHaveText('FastAPI Demo');
    await expect(page.getByTestId('operation-count')).toContainText('6 endpoints');
    await expect(page.getByRole('button', { name: /pets/i }).first()).toBeVisible();
    await expect(page.getByTestId('operation-get-/pets')).toBeVisible();
    await expect(page.getByTestId('operation-post-/pets')).toBeVisible();
    await expect(page.getByTestId('authorize-button')).toBeVisible();
  });

  test('filters endpoints and clears the filter', async ({ page }) => {
    await loadSpec(page);
    const filter = page.getByTestId('endpoint-filter');
    await filter.fill('health');
    await expect(page.getByTestId('operation-count')).toHaveText('1 of 6 endpoints');
    await expect(page.getByTestId('operation-get-/health')).toBeVisible();
    await expect(page.getByTestId('operation-get-/pets')).toHaveCount(0);

    await filter.fill('nothing-matches-this');
    await expect(page.getByText(/No endpoints match/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(page.getByTestId('operation-count')).toHaveText('6 endpoints');
  });

  test('expands an endpoint, sends it and renders the response', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('operation-get-/pets').click();
    await expect(page.getByText('List pets').first()).toBeVisible();
    await expect(page.getByTestId('send-get-/pets')).toHaveCount(0);
    await expect(page.getByTestId('response-doc-200')).toContainText('Media type');
    await expect(page.getByTestId('response-media-200')).toHaveValue('application/json');
    await expect(page.getByTestId('response-tab-200-example')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('response-tab-200-schema').click();
    await expect(page.getByTestId('response-tab-200-schema')).toHaveAttribute('aria-selected', 'true');
    await enableTryItOut(page, 'get', '/pets');
    await expect(page.getByTestId('send-get-/pets')).toBeEnabled();
    await page.getByTestId('send-get-/pets').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await expect(page.locator('.response .json-code')).toContainText('Rex');
    await expect(page.locator('.response')).toContainText('ms');

    await page.getByRole('tab', { name: /Headers/ }).click();
    await expect(page.locator('.headers-table')).toContainText('x-total-count');
  });

  test('opens schemas and shows nested models', async ({ page }) => {
    await loadSpec(page);
    const schemas = page.locator('#schemas');
    await schemas.scrollIntoViewIfNeeded();
    await schemas.getByRole('button', { name: /^Pet\b/ }).click();
    await expect(schemas.locator('.schema-card.is-open .schema-tree')).toBeVisible();
    await expect(schemas.locator('.schema-card.is-open')).toContainText('owner');
  });

  test('loads Swagger 2.0 and renders converted request bodies', async ({ page }) => {
    await loadSpec(page, `${API}/specs/go.json`);
    await expect(page.getByTestId('spec-title')).toHaveText('Go Orders API');
    await expect(page.locator('.pill-oas')).toContainText('Swagger 2.0');
    await page.getByTestId('operation-post-/orders').click();
    await expect(page.getByTestId('request-body-input')).toBeVisible();
    await expect(page.getByTestId('request-body-input')).toHaveValue(/items/);
  });

  test('loads a YAML specification', async ({ page }) => {
    await loadSpec(page, `${API}/specs/express.yaml`);
    await expect(page.getByTestId('spec-title')).toHaveText('Express Users API');
    await expect(page.getByTestId('operation-get-/users')).toBeVisible();
  });

  test('loads a pasted specification', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Paste a spec/i }).click();
    const text = readFileSync(fixtureDir + 'flask.json', 'utf8');
    await page.getByTestId('paste-spec-input').fill(text);
    await page.getByRole('button', { name: 'Load pasted spec' }).click();
    await expect(page.getByTestId('spec-title')).toHaveText('Flask Inventory');
  });
});

const frameworkFixtures = [
  { file: 'fastapi.json', title: 'FastAPI Demo', operations: 6, schema: 'Pet', version: '3.1.0' },
  { file: 'express.yaml', title: 'Express Users API', operations: 4, schema: 'User', version: '3.0.3' },
  { file: 'spring.json', title: 'Spring Pet Clinic', operations: 3, schema: 'Owner', version: '3.0.1' },
  { file: 'flask.json', title: 'Flask Inventory', operations: 3, schema: 'Item', version: '3.0.2' },
  { file: 'django.yaml', title: 'Django Shop API', operations: 2, schema: 'Product', version: '3.0.3' },
  { file: 'nestjs.json', title: 'NestJS Tasks', operations: 3, schema: 'Task', version: '3.0.0' },
  { file: 'aspnet.json', title: 'ASP.NET Weather', operations: 2, schema: 'WeatherForecast', version: '3.0.1' },
  { file: 'go.json', title: 'Go Orders API', operations: 4, schema: 'Order', version: 'Swagger 2.0' },
];

test.describe('framework compatibility', () => {
  for (const fixture of frameworkFixtures) {
    test(`renders ${fixture.file}`, async ({ page }) => {
      await loadSpec(page, `${API}/specs/${fixture.file}`);
      await expect(page.getByTestId('spec-title')).toHaveText(fixture.title);
      await expect(page.getByTestId('operation-count')).toHaveText(`${fixture.operations} endpoints`);
      await expect(page.locator('.pill-oas')).toContainText(fixture.version);

      const schemas = page.locator('#schemas');
      await schemas.scrollIntoViewIfNeeded();
      await expect(
        schemas.locator('.schema-card-name', { hasText: new RegExp(`^${fixture.schema}$`) }),
      ).toBeVisible();
    });
  }

  test('renders the edge-case specification', async ({ page }) => {
    await loadSpec(page, `${API}/specs/edge.json`);
    await expect(page.getByTestId('spec-title')).toHaveText('Edge Cases');
    await expect(page.getByTestId('operation-count')).toHaveText('2 endpoints');
    await expect(page.locator('#schemas .schema-card-name', { hasText: 'Node' })).toBeVisible();
  });
});

test.describe('authorization and execution', () => {
  test('authorizes a bearer token and creates a pet', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('authorize-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('auth-input-bearerAuth').fill('demo-token');
    await page.getByTestId('auth-save').click();
    await expect(page.getByTestId('authorize-button')).toContainText('Authorized (1)');

    await page.getByTestId('operation-post-/pets').click();
    await enableTryItOut(page, 'post', '/pets');
    await page.getByTestId('send-post-/pets').click();
    await expect(page.locator('.status-pill')).toContainText('201', { timeout: 15000 });
    await expect(page.locator('.response')).toContainText('Rex');
  });

  test('shows the unauthorized response when no token is configured', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('operation-post-/pets').click();
    await enableTryItOut(page, 'post', '/pets');
    await page.getByTestId('send-post-/pets').click();
    await expect(page.locator('.status-pill')).toContainText('401', { timeout: 15000 });
  });

  test('fills in a required path parameter and sends the request', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('operation-get-/pets/{petId}').click();
    const petId = page.getByTestId('param-path-petId');
    await expect(petId).toBeVisible();
    await expect(petId).toBeDisabled();
    await enableTryItOut(page, 'get', '/pets/{petId}');
    await expect(petId).toBeEnabled();
    await petId.fill('2');
    await page.getByTestId('send-get-/pets/{petId}').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await expect(page.locator('.response')).toContainText('Milo');
  });
});

test.describe('request console', () => {
  test('sends a free-form request and records history', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('nav-request').click();
    await page.getByTestId('composer-url').fill(`${API}/health`);
    await page.getByTestId('composer-send').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await expect(page.locator('.response')).toContainText('ok');

    await page.getByTestId('history-button').click();
    const drawer = page.locator('.drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('/health');

    const search = drawer.getByTestId('history-search');
    await search.fill('no-such-request');
    await expect(drawer.getByText('No matching requests')).toBeVisible();
    await search.fill('health');
    await expect(drawer.locator('.history-item').first()).toBeVisible();

    await drawer.locator('.history-item').first().click();
    await expect(page.getByTestId('composer-url')).toHaveValue(/\/health$/);
  });

  test('sends a JSON POST body', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('nav-request').click();
    await page.getByTestId('composer-url').fill(`${API}/echo`);
    await page.getByTestId('composer-method').selectOption('post');
    await page.getByTestId('composer-tab-body').click();
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.getByTestId('composer-body').fill('{"hello":"world"}');
    await page.getByTestId('composer-send').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await expect(page.locator('.response')).toContainText('world');
  });

  test('reports invalid JSON without sending', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('nav-request').click();
    await page.getByTestId('composer-url').fill(`${API}/echo`);
    await page.getByTestId('composer-method').selectOption('post');
    await page.getByTestId('composer-tab-body').click();
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.getByTestId('composer-body').fill('{ invalid');
    await page.getByTestId('composer-send').click();
    await expect(page.locator('.response-error')).toContainText(/valid JSON/i);
  });

  test('generates code from the console', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('nav-request').click();
    await page.getByTestId('composer-url').fill(`${API}/echo`);
    await page.getByTestId('composer-method').selectOption('post');
    await page.getByRole('button', { name: 'Code' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.code-output')).toContainText('curl --request POST');
    await dialog.getByRole('tab', { name: 'Python' }).click();
    await expect(dialog.locator('.code-output')).toContainText('import requests');
  });
});

test.describe('theme and screenshots', () => {
  test('cycles theme and persists the choice', async ({ page }) => {
    await loadSpec(page);
    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('captures Chrome Web Store screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    mkdirSync('store-assets', { recursive: true });

    await page.goto('/');
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'store-assets/01-landing.png' });

    await loadSpec(page);
    await page.screenshot({ path: 'store-assets/02-docs.png' });

    await page.getByTestId('operation-get-/pets').click();
    await enableTryItOut(page, 'get', '/pets');
    await page.getByTestId('send-get-/pets').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await page.locator('.op-card.is-open').first().evaluate((el) => {
      const top = el.getBoundingClientRect().top + window.scrollY - 132;
      window.scrollTo({ top, behavior: 'instant' });
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'store-assets/03-run-request.png' });

    await page.getByTestId('nav-request').click();
    await page.getByTestId('composer-url').fill(`${API}/echo`);
    await page.getByTestId('composer-method').selectOption('post');
    await page.getByTestId('composer-tab-body').click();
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.getByTestId('composer-body').fill('{"hello":"world"}');
    await page.getByTestId('composer-send').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await page.screenshot({ path: 'store-assets/04-request-console.png' });

    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('nav-docs').click();
    await page.screenshot({ path: 'store-assets/05-dark-mode.png' });
  });

  test('captures reference screenshots', async ({ page }) => {
    mkdirSync('screenshots', { recursive: true });
    await page.goto('/');
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'screenshots/landing-light.png', fullPage: true });

    await loadSpec(page);
    await page.screenshot({ path: 'screenshots/docs-light.png', fullPage: false });

    await page.getByTestId('operation-get-/pets').click();
    await enableTryItOut(page, 'get', '/pets');
    await page.getByTestId('send-get-/pets').click();
    await expect(page.locator('.status-pill')).toContainText('200', { timeout: 15000 });
    await page.locator('.op-card.is-open').first().screenshot({ path: 'screenshots/operation-expanded.png' });

    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'screenshots/docs-dark.png', fullPage: false });

    await page.getByTestId('nav-request').click();
    await page.screenshot({ path: 'screenshots/composer-dark.png', fullPage: false });
  });
});
