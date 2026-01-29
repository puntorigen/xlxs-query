/**
 * SQL query validation
 * Ensures queries are read-only and safe to execute
 */

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  sanitizedSql?: string;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/** Keywords that indicate data modification - BLOCKED */
const DANGEROUS_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'REPLACE',
  'MERGE',
  'UPSERT',
  'GRANT',
  'REVOKE',
  'ATTACH',
  'DETACH',
  'COPY',
  'EXPORT',
  'IMPORT',
  'PRAGMA',
  'VACUUM',
  'ANALYZE',
  'LOAD',
  'INSTALL',
];

/** Maximum query length */
const MAX_QUERY_LENGTH = 10000;

/** Default row limit if not specified */
const DEFAULT_ROW_LIMIT = 1000;

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate and sanitize a SQL query
 */
export function validateSql(sql: string | null | undefined): ValidationResult {
  // Check for null/empty
  if (!sql || sql.trim() === '') {
    return { valid: false, error: 'Empty SQL query' };
  }

  const trimmedSql = sql.trim();

  // Check length
  if (trimmedSql.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: 'Query too long' };
  }

  // Normalize for checking (remove comments, extra whitespace)
  const normalizedSql = normalizeForValidation(trimmedSql);

  // Check for dangerous keywords
  const dangerousKeyword = findDangerousKeyword(normalizedSql);
  if (dangerousKeyword) {
    return {
      valid: false,
      error: `Query contains forbidden keyword: ${dangerousKeyword}`,
    };
  }

  // Check query starts with SELECT or WITH
  if (!isReadOnlyQuery(normalizedSql)) {
    return {
      valid: false,
      error: 'Query must start with SELECT or WITH',
    };
  }

  // Add LIMIT if not present and query is a simple SELECT
  const sanitizedSql = ensureLimit(trimmedSql);

  return {
    valid: true,
    sanitizedSql,
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Normalize SQL for validation (remove comments, normalize whitespace)
 */
function normalizeForValidation(sql: string): string {
  return sql
    // Remove single-line comments
    .replace(/--.*$/gm, '')
    // Remove multi-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Check for dangerous keywords
 */
function findDangerousKeyword(normalizedSql: string): string | null {
  for (const keyword of DANGEROUS_KEYWORDS) {
    // Use word boundary to avoid false positives
    // e.g., "SELECTED" should not match "SELECT"
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(normalizedSql)) {
      return keyword;
    }
  }
  return null;
}

/**
 * Check if query is read-only (starts with SELECT or WITH)
 */
function isReadOnlyQuery(normalizedSql: string): boolean {
  return /^(SELECT|WITH)\b/.test(normalizedSql);
}

/**
 * Ensure query has a LIMIT clause for safety
 */
function ensureLimit(sql: string): string {
  const upperSql = sql.toUpperCase();

  // Skip if already has LIMIT
  if (/\bLIMIT\s+\d+/i.test(sql)) {
    return sql;
  }

  // Skip for aggregate queries (they typically return few rows)
  const aggregateFunctions = ['COUNT(', 'SUM(', 'AVG(', 'MIN(', 'MAX('];
  const hasAggregate = aggregateFunctions.some((fn) =>
    upperSql.includes(fn)
  );

  // Skip if it has GROUP BY (likely returns reasonable number of rows)
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(sql);

  // Skip if the select has DISTINCT with aggregation
  if (hasAggregate || hasGroupBy) {
    return sql;
  }

  // Add LIMIT to the end
  // Handle queries ending with semicolon
  if (sql.trim().endsWith(';')) {
    return sql.trim().slice(0, -1) + ` LIMIT ${DEFAULT_ROW_LIMIT};`;
  }

  return sql + ` LIMIT ${DEFAULT_ROW_LIMIT}`;
}

// ============================================================================
// Additional Checks
// ============================================================================

/**
 * Check if a query might be slow (for warning purposes)
 */
export function checkQueryComplexity(sql: string): {
  warnings: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
} {
  const warnings: string[] = [];
  let complexity: 'low' | 'medium' | 'high' = 'low';

  const upperSql = sql.toUpperCase();

  // Check for multiple JOINs
  const joinCount = (upperSql.match(/\bJOIN\b/g) || []).length;
  if (joinCount > 3) {
    warnings.push('Query has many JOINs which may be slow');
    complexity = 'high';
  } else if (joinCount > 1) {
    complexity = 'medium';
  }

  // Check for subqueries
  const subqueryCount = (upperSql.match(/\(\s*SELECT/g) || []).length;
  if (subqueryCount > 2) {
    warnings.push('Query has many subqueries');
    complexity = 'high';
  }

  // Check for LIKE with leading wildcard
  if (/%\w/.test(sql) || sql.includes("LIKE '%")) {
    warnings.push('Leading wildcard in LIKE may be slow');
  }

  // Check for missing WHERE on JOINs
  if (joinCount > 0 && !upperSql.includes('WHERE') && !upperSql.includes('ON')) {
    warnings.push('JOIN without conditions may produce large results');
  }

  return { warnings, estimatedComplexity: complexity };
}
