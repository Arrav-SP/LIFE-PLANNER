import { expect, test, type Page } from '@playwright/test'

async function quickAdd(page: Page, text: string) {
  await page.getByRole('button', { name: 'Quick add' }).first().click()
  const input = page.getByLabel('What do you want to add?')
  await input.fill(text)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(input).toBeHidden()
}

test('coach ranks today’s tasks and can pull an upcoming one into today', async ({ page }) => {
  await page.goto('/')
  await quickAdd(page, 'Revise DBMS today !high for 40 minutes')
  await quickAdd(page, 'Prepare OS slides tomorrow')
  await page.goto('/coach')
  await expect(page.getByRole('heading', { name: 'Coach', level: 1 })).toBeVisible()

  const list = page.getByRole('list').filter({ hasText: 'Revise DBMS' }).first()
  const items = list.getByRole('listitem')
  await expect(items.first()).toContainText('Revise DBMS')
  await expect(items.first()).toContainText('Due today')
  await expect(items.nth(1)).toContainText('Prepare OS slides')
  await expect(items.nth(1)).toContainText('Due in 1 day')

  await page.getByRole('button', { name: 'Move it to today' }).click()
  await expect(page.getByRole('button', { name: 'Move it to today' })).toBeHidden()
  await page.goto('/tasks?view=today')
  await expect(page.getByText('Prepare OS slides', { exact: true })).toBeVisible()
})

test('coach explains how to get a study plan when there are no subjects', async ({ page }) => {
  await page.goto('/coach')
  await expect(page.getByText('No subjects yet')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add a subject' })).toBeVisible()
})
