import { expect, test } from '@playwright/test'

// Runs against a build pointed at a fake Supabase project (see playwright.config.ts).
// Every request to it is intercepted: first it is unreachable, then it accepts writes.

const USER = '11111111-1111-4111-8111-111111111111'

test('works offline with a saved session, then uploads', async ({ page }) => {
  await page.addInitScript((u) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('sb-fake-auth-token', JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: 1000, expires_in: 3600, token_type: 'bearer', user: { id: u, email: 'arav@example.com', aud: 'authenticated', role: 'authenticated' } }))
  }, USER)
  let serverUp = false
  const posts: { url: string; body: Record<string, unknown> }[] = []
  await page.route('https://fake.supabase.co/**', async (route) => {
    if (!serverUp) return route.abort('internetdisconnected')
    const req = route.request()
    const url = req.url()
    if (url.includes('/auth/v1/token')) {
      return route.fulfill({ json: { access_token: 'new', refresh_token: 'r2', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: USER, email: 'arav@example.com', aud: 'authenticated', role: 'authenticated' } } })
    }
    if (url.includes('/rest/v1/') && req.method() === 'POST') {
      const body = req.postDataJSON()
      posts.push({ url, body })
      const row = { ...body, user_id: USER, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      return route.fulfill({ status: 201, json: row, headers: { 'content-range': '0-0/1' } })
    }
    return route.fulfill({ json: [], headers: { 'content-range': '*/0' } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Sign in')).toHaveCount(0)
  await page.keyboard.press('q')
  await page.getByLabel('What do you want to add?').fill('Offline task')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Offline\. \d+ changes? saved on this device/)).toBeVisible({ timeout: 15_000 })
  await page.goto('/tasks?view=inbox')
  await expect(page.getByText('Offline task', { exact: true })).toBeVisible()

  serverUp = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText(/Synced \d+ changes? made offline/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/change saved on this device|waiting to upload/)).toHaveCount(0)
  const taskPost = posts.find((p) => p.url.includes('/rest/v1/tasks'))
  expect(taskPost?.body.title).toBe('Offline task')
  expect(taskPost?.body.id).toMatch(/[0-9a-f-]{36}/)
})
