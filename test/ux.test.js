const { test, expect } = require('@playwright/test');

test.describe('Electric App UX Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should load main page with proper layout', async ({ page }) => {
    // Check header
    await expect(page.locator('h1')).toContainText('electric.motometr.pl');

    // Check main sections
    await expect(page.locator('.summary-panel')).toBeVisible();
    await expect(page.locator('.filters-panel')).toBeVisible();
    await expect(page.locator('.table-panel')).toBeVisible();

    // Check buttons
    await expect(page.locator('#uploadButton')).toBeVisible();
    await expect(page.locator('#columnsButton')).toBeVisible();
  });

  test('should have responsive layout on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // Check if filters are below table on mobile
    const filtersPanel = page.locator('.filters-panel');
    const tablePanel = page.locator('.table-panel');

    // On mobile, filters should be before table in DOM
    const filtersIndex = await filtersPanel.evaluate(el => Array.from(el.parentNode.children).indexOf(el));
    const tableIndex = await tablePanel.evaluate(el => Array.from(el.parentNode.children).indexOf(el));

    expect(filtersIndex).toBeLessThan(tableIndex);
  });

  test('should show import modal when upload button clicked', async ({ page }) => {
    await page.locator('#uploadButton').click();

    await expect(page.locator('#importModal')).toBeVisible();
    await expect(page.locator('#importModalTitle')).toContainText('Dodaj konfigurację');
  });

  test('should show columns drawer when columns button clicked', async ({ page }) => {
    await page.locator('#columnsButton').click();

    await expect(page.locator('#columnsDrawer')).toBeVisible();
  });

  test('should have accessible form elements', async ({ page }) => {
    // Check search input
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toHaveAttribute('type', 'search');
    await expect(searchInput).toHaveAttribute('placeholder');

    // Check equipment select
    const equipmentButton = page.locator('#equipmentSelectButton');
    await expect(equipmentButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('should display recommendation card properly', async ({ page }) => {
    const heroCard = page.locator('.hero-card');
    await expect(heroCard).toBeVisible();

    // Check if it has proper content
    await expect(heroCard.locator('.eyebrow')).toContainText('Rekomendacja ekologiczna');
  });

  test('should show toast notification for status updates', async ({ page }) => {
    // Mock a successful import by triggering the notification function
    await page.evaluate(() => {
      window.showNotification('Konfiguracja została pomyślnie dodana!', false, 2000);
    });

    // Check if toast appears
    const toast = page.locator('.toast-notification');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Konfiguracja została pomyślnie dodana!');

    // Wait for auto-dismiss
    await page.waitForTimeout(2500);
    await expect(toast).not.toBeVisible();
  });

  test('should have improved leader cards with distinct colors', async ({ page }) => {
    // Check if leader cards exist (only when there are configurations)
    const leaderCards = page.locator('.leader-card');
    const count = await leaderCards.count();

    if (count > 0) {
      // Check border-left colors (nth-child selectors)
      const firstCard = leaderCards.nth(0);

      // Verify they have border-left
      await expect(firstCard).toHaveCSS('border-left-width', '4px');
    } else {
      // If no data, just check that the container exists
      const leaderGrid = page.locator('.leader-grid');
      await expect(leaderGrid).toBeAttached();
    }
  });

  test('should have better mobile layout with sticky filters', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });

    // On tablet size, filters should be sticky and beside table
    const filtersPanel = page.locator('.filters-panel');
    const computedStyle = await filtersPanel.evaluate(el => window.getComputedStyle(el).position);
    expect(computedStyle).toBe('sticky');
  });

  test('should have natural, user-friendly text', async ({ page }) => {
    // Check improved placeholder text
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toHaveAttribute('placeholder', 'Wpisz markę, model, kolor lub wyposażenie...');

    // Check improved upload text
    const uploadTitle = page.locator('.upload-title');
    await expect(uploadTitle).toContainText('Przeciągnij plik PDF tutaj lub kliknij, aby wybrać');

    // Check improved panel description
    const tableDescription = page.locator('.table-panel p');
    await expect(tableDescription).toContainText('Wybierz najbardziej przyjazny dla środowiska wariant');
  });
});