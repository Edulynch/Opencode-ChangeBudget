export function canonicalizeLiteralPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return null;
  }

  const components = normalized.split('/');
  if (
    components.some((component) => component === '.' || component === '..')
    || /[\0\r\n*?\[\]{}!()]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function isChangeBudgetPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized === '.changebudget' || normalized.startsWith('.changebudget/');
}
