/**
 * Database module exports
 */

export { SessionDatabase } from './duckdb';
export type { QueryResult } from './duckdb';

export { loadWorkbookIntoDatabase, enrichSchemaWithSamples } from './loader';

export { detectRelationships } from './relationships';
