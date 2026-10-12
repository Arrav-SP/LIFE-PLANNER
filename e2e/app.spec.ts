import { expect, test, type Page } from '@playwright/test'

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768

async function quickAdd(page: Page, text: string) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Quick add' }).last().click()
  else await page.keyboard.press('q')
  const input = page.getByLabel('What do you want to add?')
  await expect(input).toBeVisible()
  await input.fill(text)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(input).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('quick add parses natural language and shows the task today', async ({ page }) => {
  await page.getByRole('button', { name: 'Quick add' }).first().click()
  await page.getByLabel('What do you want to add?').fill('Study OS for 90 minutes today at 11 PM #fat')
  const preview = page.getByText('Will be saved as')
  await expect(preview).toBeVisible()
  await expect(page.getByText('1h 30m').first()).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.goto('/tasks?view=today')
  await expect(page.getByText('Study OS', { exact: true })).toBeVisible()
  await expect(page.getByText('#fat')).toBeVisible()
})

test('completing one occurrence of a repeating task keeps the series', async ({ page }) => {
  await quickAdd(page, 'Solve 5 Striver problems every day')
  await page.goto('/tasks?view=today')
  const row = page.getByRole('listitem').filter({ hasText: 'Solve 5 Striver problems' })
  // The label flips to "Reopen" once saved, so click and wait for that.
  await row.getByRole('checkbox', { name: /Complete/ }).click()
  await expect(row.getByRole('checkbox', { name: /Reopen/ })).toBeChecked()
  await page.goto('/tasks?view=upcoming')
  await expect(page.getByText('Solve 5 Striver problems').first()).toBeVisible()
})

test('habit check-in builds a streak', async ({ page }) => {
  await page.goto('/habits?new=1')
  await page.getByLabel('Name').fill('Gym')
  await page.getByRole('button', { name: 'Add habit' }).click()
  await page.goto('/')
  await page.getByRole('checkbox', { name: 'Check in Gym' }).first().click()
  await expect(page.getByRole('checkbox', { name: 'Undo Gym' }).first()).toBeChecked()
  await page.goto('/habits')
  await expect(page.getByTitle('Current streak')).toContainText('1')
})

test('events show on the calendar and in the day planner', async ({ page }) => {
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Event', exact: true }).click()
  await page.getByLabel('Title').fill('DBMS lab')
  await page.getByLabel('Start time').fill('10:00')
  await page.getByLabel('End time').fill('11:30')
  await page.getByRole('button', { name: 'Add event' }).click()
  await expect(page.locator('.fc').getByText('DBMS lab').first()).toBeVisible()
  await page.goto('/planner')
  await expect(page.getByText('DBMS lab').first()).toBeVisible()
})

test('goal with a milestone shows progress', async ({ page }) => {
  await page.goto('/goals?new=1')
  await page.getByLabel('Title').fill('Finish ML Specialization')
  await page.getByLabel('Measure progress by').selectOption('milestones')
  await page.getByRole('button', { name: 'Create goal' }).click()
  await page.getByLabel('New milestone').fill('Course 1')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Complete Course 1' }).click()
  await expect(page.getByRole('checkbox', { name: 'Reopen Course 1' })).toBeChecked()
  await expect(page.getByText('100%').first()).toBeVisible()
})

test('focus timer keeps running after a reload', async ({ page }) => {
  await page.goto('/study')
  await page.getByRole('tab', { name: 'Stopwatch' }).click()
  await page.getByRole('button', { name: 'Start focusing' }).click()
  await expect(page.getByRole('timer')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByRole('timer')).not.toHaveText('00:00')
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByText(/Saved/)).toBeVisible()
})

test('dark theme persists across reloads', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('exports all data as JSON', async ({ page }) => {
  await quickAdd(page, 'Export me')
  await page.goto('/settings')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export everything (JSON)' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^life-planner-.*\.json$/)
})

test('notes convert into tasks', async ({ page }) => {
  await page.goto('/inbox')
  await page.getByLabel('Capture a note').fill('Buy lab record tomorrow')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Actions for Buy lab record tomorrow' }).click()
  await page.getByRole('menuitem', { name: 'Make it a task' }).click()
  await page.goto('/tasks?view=upcoming')
  await expect(page.getByText('Buy lab record')).toBeVisible()
})

test('pages fit the screen without sideways scrolling', async ({ page }) => {
  for (const path of ['/', '/tasks', '/calendar', '/planner', '/habits', '/goals', '/projects', '/study', '/fitness', '/inbox', '/analytics', '/review', '/reminders', '/search', '/settings']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1)
  }
})

test('pages link to each other: habit, goal and note', async ({ page }) => {
  await page.goto('/goals?new=1')
  await page.getByLabel('Title').fill('Clear FAT')
  await page.getByRole('button', { name: 'Create goal' }).click()
  await page.goto('/habits?new=1')
  await page.getByLabel('Name').fill('DSA problems')
  await page.getByLabel('Linked goal').selectOption({ label: 'Clear FAT' })
  await page.getByRole('button', { name: 'Add habit' }).click()

  // Habit card links to its goal, and the goal links back to the habit.
  await page.getByRole('link', { name: 'Clear FAT' }).click()
  await expect(page).toHaveURL(/\/goals\?goal=/)
  await page.getByRole('link', { name: 'DSA problems' }).click()
  await expect(page).toHaveURL(/\/habits\?habit=/)
  await expect(page.locator('li.ring-2')).toContainText('DSA problems')

  // A captured note's toast opens the note itself.
  if (isMobile(page)) await page.getByRole('button', { name: 'Quick add' }).last().click()
  else await page.keyboard.press('q')
  await page.getByLabel('Type').selectOption('note')
  await page.getByLabel('What do you want to add?').fill('Ask about lab marks')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await expect(page).toHaveURL(/\/inbox/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Ask about lab marks')
})

test('the reminders panel fits on screen', async ({ page }) => {
  // Narrower than the Pixel 7 preset, like many Android phones.
  if (isMobile(page)) await page.setViewportSize({ width: 360, height: 780 })
  await page.getByRole('button', { name: /^(\d+ )?reminders$/i }).filter({ visible: true }).first().click()
  const panel = page.getByText('Nothing needs your attention.').locator('..')
  await expect(panel).toBeVisible()
  const box = (await panel.boundingBox())!
  const width = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)
})
