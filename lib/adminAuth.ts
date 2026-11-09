// HTTP Basic Auth check for the admin area. Credentials come from ADMIN_USER / ADMIN_PASSWORD;
// without them every request is refused, so a missing config never opens the admin area.
export function isAdminAuthorization(header: string | null): boolean {
  const user = process.env.ADMIN_USER
  const password = process.env.ADMIN_PASSWORD
  if (!user || !password || !header) return false

  const [scheme, encoded] = header.split(' ')
  if (scheme !== 'Basic' || !encoded) return false

  try {
    const decoded = atob(encoded)
    const separator = decoded.indexOf(':')
    return separator >= 0 && decoded.slice(0, separator) === user && decoded.slice(separator + 1) === password
  } catch {
    return false
  }
}
