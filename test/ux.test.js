const { test, expect } = require('@playwright/test');

test.describe('Electric App UX Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should load main page with proper layout', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Porównywarka aut elektrycznych');
    await expect(page.locator('.summary-panel')).toBeVisible();
    await expect(page.locator('.filters-bar')).toBeVisible();
    await expect(page.locator('.table-panel')).toBeVisible();
    await expect(page.locator('#uploadButton')).toBeVisible();
    await expect(page.locator('#columnsButton')).toBeVisible();
  });

  test('should show skeletons while initial data is loading', async ({ page }) => {
    await page.route('**/api/cars', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    }, { times: 1 });

    const reloadPromise = page.reload();
    await page.waitForTimeout(250);

    await expect(page.locator('body')).toHaveClass(/is-page-loading/);
    await expect(page.locator('.panel-skeleton-summary')).toBeVisible();
    await expect(page.locator('.panel-skeleton-filters')).toBeVisible();
    await expect(page.locator('.panel-skeleton-table')).toBeVisible();

    await reloadPromise;
    await expect(page.locator('body')).not.toHaveClass(/is-page-loading/);
  });

  test('should have responsive layout on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const filtersPanel = page.locator('.filters-bar');
    const tablePanel = page.locator('.table-panel');
    const filtersIndex = await filtersPanel.evaluate((el) => Array.from(el.parentNode.children).indexOf(el));
    const tableIndex = await tablePanel.evaluate((el) => Array.from(el.parentNode.children).indexOf(el));

    expect(filtersIndex).toBeLessThan(tableIndex);
  });

  test('should show import modal when upload button clicked', async ({ page }) => {
    await page.locator('#uploadButton').click();

    await expect(page.locator('#importModal')).toBeVisible();
    await expect(page.locator('#importModalTitle')).toContainText('Dodaj konfiguracj');
  });

  test('should show columns drawer when columns button clicked', async ({ page }) => {
    await page.locator('#columnsButton').click();
    await expect(page.locator('#columnsDrawer')).toBeVisible();
  });

  test('should have accessible form elements', async ({ page }) => {
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toHaveAttribute('type', 'search');
    await expect(searchInput).toHaveAttribute('placeholder');

    const equipmentButton = page.locator('#equipmentSelectButton');
    await expect(equipmentButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('should display recommendation card properly', async ({ page }) => {
    const heroCard = page.locator('.hero-card');
    await expect(heroCard).toBeVisible();
    await expect(heroCard.locator('.eyebrow')).toHaveText(/.+/);
  });

  test('should show toast notification for status updates', async ({ page }) => {
    await page.evaluate(() => {
      window.showNotification('Konfiguracja została pomyślnie dodana!', false, 2000);
    });

    const toast = page.locator('.toast-notification');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Konfiguracja została pomyślnie dodana!');

    await page.waitForTimeout(2500);
    await expect(toast).not.toBeVisible();
  });

  test('should keep toast message and close button on the same row', async ({ page }) => {
    await page.evaluate(() => {
      window.showNotification('Zapisano zmiany.', false, 5000);
    });

    const messageBox = await page.locator('.toast-message').boundingBox();
    const closeBox = await page.locator('.toast-close').boundingBox();

    expect(messageBox).toBeTruthy();
    expect(closeBox).toBeTruthy();
    expect(Math.abs(closeBox.y - messageBox.y)).toBeLessThan(16);
  });

  test('should show default success message when toast text is empty', async ({ page }) => {
    await page.evaluate(() => {
      window.showNotification('', false, 5000);
    });

    await expect(page.locator('.toast-message')).toHaveText('Zapisano zmiany.');
    await expect(page.locator('.toast-close')).toHaveText('×');
  });

  test('should have improved leader cards with distinct colors', async ({ page }) => {
    const leaderCards = page.locator('.leader-card');
    const count = await leaderCards.count();

    if (count > 0) {
      const firstCard = leaderCards.nth(0);
      await expect(firstCard).toHaveCSS('border-left-width', '4px');
    } else {
      const leaderGrid = page.locator('.leader-grid');
      await expect(leaderGrid).toBeAttached();
    }
  });

  test('should keep filter bar visible on tablet layout', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });

    await expect(page.locator('.filters-bar')).toBeVisible();
  });

  test('should have natural, user-friendly text', async ({ page }) => {
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toHaveAttribute('placeholder', 'Wpisz markę, model, kolor lub wyposażenie...');

    const uploadTitle = page.locator('.upload-title').first();
    await expect(uploadTitle).toContainText('Przeciągnij pliki PDF tutaj lub kliknij, aby wybrać');

    const tableDescription = page.locator('.table-panel p');
    await expect(tableDescription).toContainText('Wybierz najbardziej przyjazny dla środowiska wariant');
  });
});
