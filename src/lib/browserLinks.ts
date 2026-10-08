// Ссылки «открыть этот сайт во встроенном браузере кошелька» — только для браузера.

/** Открыть текущую страницу во встроенном браузере Phantom (для телефона). */
export function phantomBrowseLink(): string {
  const url = encodeURIComponent(window.location.href);
  return `https://phantom.app/ul/browse/${url}?ref=${url}`;
}

/** Открыть текущую страницу во встроенном браузере MetaMask (для телефона). */
export function metamaskBrowseLink(): string {
  return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.hash}`;
}
