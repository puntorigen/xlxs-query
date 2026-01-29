/**
 * Query module exports
 * 
 * For Vercel deployment, query execution happens client-side.
 * Only validation and attribution utilities are exported.
 */

export { validateSql, checkQueryComplexity } from './validator';
export type { ValidationResult } from './validator';

export { extractTablesFromSql, formatTablesUsed } from './attribution';

// Note: executeQuery is no longer exported as it depends on server-side DuckDB
// Client-side execution is handled by the useBrowserDb hook
