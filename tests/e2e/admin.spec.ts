import { expect, test, type Page } from '@playwright/test'

// Seeded accounts (pnpm seed). The agent is the first seeded agent.
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? '', password: process.env.SEED_ADMIN_PASSWORD ?? '' }
const AGENT = { email: 'anna.lindqvist@support.example.test', password: process.env.SEED_AGENT_PASSWORD ?? '' }

async function login(page: Page, account: { email: string; password: string }) {
  test.skip(!account.email || !account.password, 'Seed credentials are not set in .env')
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/admin\/?$/)
}

const nav = (page: Page) => page.locator('nav')

// Opens the first ticket and its "..." menu, where Payload puts Create New, Duplicate and,
// for roles allowed to delete, Delete.
async function openTicketMenu(page: Page) {
  await page.goto('/admin/collections/tickets?limit=1')
  await page.locator('tbody tr a').first().click()
  await page.waitForURL(/\/collections\/tickets\/\d+/)
  await page.locator('#field-subject').waitFor()
  await page.locator('.doc-controls .popup-button').click()
  // The menu is rendered as a popup outside the controls, so find it by its content.
  return page.locator('.popup__content').filter({ hasText: 'Create New' }).first()
}

test.describe('logged out', () => {
  test('the admin sends you to the login page, with no field help button', async ({ page }) => {
    await page.goto('/admin/collections/tickets')
    await expect(page).toHaveURL(/\/admin\/login/)
    await expect(page.getByRole('button', { name: 'Open field help' })).toHaveCount(0)
  })
})

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN)
  })

  test('sees the Users section', async ({ page }) => {
    await expect(nav(page).getByRole('link', { name: 'Users' })).toBeVisible()
  })

  test('searches the tickets list and gets the bulk status bar on selection', async ({ page }) => {
    await page.goto('/admin/collections/tickets?limit=10&search=login')
    const rows = page.locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    await expect(rows.first()).toContainText(/login/i)

    await rows.first().locator('input[type=checkbox]').check()
    await expect(page.getByText(/Change status of 1 selected ticket to/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  test('the ticket status field offers only the allowed next statuses', async ({ page }) => {
    await page.goto('/admin/collections/tickets?limit=1&where[status][equals]=new')
    await page.locator('tbody tr a').first().click()
    await expect(page.getByText('From "New" the ticket can move to "In progress" or "Closed".')).toBeVisible()
  })

  test('the create form shows the status as New, read-only', async ({ page }) => {
    await page.goto('/admin/collections/tickets/create')
    await expect(page.getByText('New tickets start as "New".')).toBeVisible()
  })

  test('the ticket menu offers Delete', async ({ page }) => {
    const menu = await openTicketMenu(page)
    await expect(menu.getByText('Delete', { exact: true }).first()).toBeVisible()
  })

  test('the field help panel opens and counts characters', async ({ page }) => {
    await page.goto('/admin/collections/tickets')
    await page.getByRole('button', { name: 'Open field help' }).click()
    const dialog = page.getByRole('dialog', { name: 'Field help' })
    await expect(dialog).toContainText('Field help: Tickets')
    await dialog.getByRole('textbox').fill('What is priority?')
    await expect(dialog).toContainText('17 / 500')
  })
})

test.describe('agent', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, AGENT)
  })

  test('has no Users section, and its address is a 404', async ({ page }) => {
    await expect(nav(page).getByRole('link', { name: 'Tickets' })).toBeVisible()
    await expect(nav(page).getByRole('link', { name: 'Users' })).toHaveCount(0)
    await page.goto('/admin/collections/users')
    await expect(page.getByText('Nothing found')).toBeVisible()
  })

  test('gets the bulk status bar but no bulk Delete', async ({ page }) => {
    await page.goto('/admin/collections/tickets?limit=10')
    await page.locator('tbody tr').first().locator('input[type=checkbox]').check()
    await expect(page.getByText(/Change status of 1 selected ticket to/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })

  test('the ticket menu has no Delete', async ({ page }) => {
    const menu = await openTicketMenu(page)
    await expect(menu.getByText('Duplicate', { exact: true }).first()).toBeVisible()
    await expect(menu.getByText('Delete', { exact: true })).toHaveCount(0)
  })
})
