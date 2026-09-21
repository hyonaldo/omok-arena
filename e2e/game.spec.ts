import { expect, test } from '@playwright/test'

const point = (page: import('@playwright/test').Page, row: number, col: number) =>
  page.getByRole('gridcell', { name: `${row + 1}행 ${col + 1}열 빈자리` })

test('a local two-player match can finish and restart', async ({ page }) => {
  await page.goto('/')
  for (const [row, col] of [[7, 2], [8, 2], [7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5], [7, 6]]) {
    await point(page, row, col).click()
  }
  await expect(page.getByRole('dialog')).toContainText('흑 승리')
  await expect(page.getByText('1판')).toBeVisible()
  await page.getByRole('button', { name: '한 판 더' }).click()
  await expect(page.getByText('흑 차례')).toBeVisible()
})

test('Groq mode locks its turn and applies the server move', async ({ page }) => {
  await page.route('**/api/ai-move', async (route) => {
    const request = route.request().postDataJSON()
    expect(request).toMatchObject({ aiColor: 'white', moveNumber: 1, lastMove: { row: 7, col: 7 } })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ move: { row: 6, col: 7 } }) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Groq과 대국' }).click()
  await point(page, 7, 7).click()
  await expect(page.getByRole('gridcell', { name: '7행 8열 백돌' })).toBeVisible()
  await expect(page.getByText('내 차례')).toBeVisible()
})

test('the board and primary controls fit inside a mobile viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Groq과 대국' })).toBeVisible()
  const box = await page.getByRole('grid', { name: '오목판' }).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
})
