// DB-free constants safe to import from client components. Keep this file free
// of any `db`/postgres imports — query.ts pulls node-only modules (net/tls/fs)
// and must never reach the client bundle.

/** Default page size for directory infinite scroll. */
export const DIRECTORY_PAGE_SIZE = 50;
