/**
 * Return the element that owns the app's styles.
 *
 * In the normal app this is `#root`. In the userscript the app lives inside an
 * open shadow root, so `document.body` would be outside the shadow tree and
 * would not receive the app styles. It would also sit underneath the fixed
 * userscript host, making dialogs impossible to click.
 */
export function appPortalTarget(): Element {
  const shadowHost = document.getElementById('routecraft-userscript-host');
  const shadowRoot = (shadowHost as HTMLElement | null)?.shadowRoot;
  return shadowRoot?.getElementById('root') ?? document.getElementById('root') ?? document.body;
}
