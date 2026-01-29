/**
 * Database module exports
 * 
 * For Vercel deployment, SQL execution happens client-side via DuckDB-WASM.
 * The browser database is managed by the useBrowserDb hook in hooks/use-browser-db.ts
 * which dynamically imports @duckdb/duckdb-wasm at runtime.
 */

// No server-side exports needed for Vercel architecture
// All database operations happen client-side via the useBrowserDb hook
