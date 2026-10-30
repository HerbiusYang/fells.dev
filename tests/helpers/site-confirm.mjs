export async function acceptSiteConfirm(page) {
  const dialog = page.locator('dialog[data-app-confirm]');
  await dialog.locator('[data-confirm-accept]').click();
  await dialog.waitFor({ state: 'detached' });
}
