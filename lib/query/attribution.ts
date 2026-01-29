/**
 * SQL attribution extraction
 * Identifies which tables/sheets were used in a query
 */

import type { SchemaInfo } from '@/lib/types';

// ============================================================================
// Main Extractor
// ============================================================================

/**
 * Extract table names referenced in a SQL query
 * Maps them back to original sheet names
 */
export function extractTablesFromSql(
  sql: string,
  schema: SchemaInfo
): string[] {
  const tableNames = schema.tables.map((t) => t.name.toLowerCase());
  const foundTables = new Set<string>();

  // Normalize SQL for parsing
  const normalizedSql = sql.toLowerCase();

  // Pattern 1: FROM clause
  const fromMatches = normalizedSql.match(/\bfrom\s+["']?(\w+)["']?/gi) || [];
  for (const match of fromMatches) {
    const tableName = extractTableName(match, 'from');
    if (tableName && tableNames.includes(tableName)) {
      foundTables.add(tableName);
    }
  }

  // Pattern 2: JOIN clauses
  const joinMatches = normalizedSql.match(/\bjoin\s+["']?(\w+)["']?/gi) || [];
  for (const match of joinMatches) {
    const tableName = extractTableName(match, 'join');
    if (tableName && tableNames.includes(tableName)) {
      foundTables.add(tableName);
    }
  }

  // Pattern 3: Table aliases (table AS alias or table alias)
  for (const table of tableNames) {
    // Check if table name appears in query
    const tableRegex = new RegExp(`\\b${escapeRegExp(table)}\\b`, 'i');
    if (tableRegex.test(normalizedSql)) {
      foundTables.add(table);
    }
  }

  // Map back to original table names (preserve case)
  return Array.from(foundTables).map((tableName) => {
    const tableSchema = schema.tables.find(
      (t) => t.name.toLowerCase() === tableName
    );
    return tableSchema?.name || tableName;
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract table name from a FROM or JOIN clause match
 */
function extractTableName(
  match: string,
  keyword: 'from' | 'join'
): string | null {
  // Remove the keyword and clean up
  const afterKeyword = match.replace(new RegExp(`^${keyword}\\s+`, 'i'), '');
  
  // Remove quotes if present
  const cleaned = afterKeyword.replace(/["']/g, '').trim();
  
  // Get just the table name (before any alias or AS)
  const parts = cleaned.split(/\s+/);
  return parts[0] || null;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get a readable list of sheets used
 */
export function formatTablesUsed(tables: string[]): string {
  if (tables.length === 0) {
    return 'No tables referenced';
  }
  
  if (tables.length === 1) {
    return tables[0];
  }
  
  if (tables.length === 2) {
    return `${tables[0]} and ${tables[1]}`;
  }
  
  const allButLast = tables.slice(0, -1).join(', ');
  return `${allButLast}, and ${tables[tables.length - 1]}`;
}
