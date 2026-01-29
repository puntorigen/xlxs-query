/**
 * Foreign key relationship detection
 * Automatically detects relationships between tables based on column names and values
 */

import type { SchemaInfo, Relationship, TableSchema, ColumnInfo } from '@/lib/types';
import { SessionDatabase } from './duckdb';

// ============================================================================
// Configuration
// ============================================================================

/** Minimum confidence to include a relationship */
const MIN_CONFIDENCE = 0.5;

/** Common ID column suffixes */
const ID_SUFFIXES = ['_id', '_code', '_key', '_ref', '_number', '_no'];

/** Common ID column patterns */
const ID_PATTERNS = [
  /^(.+)_id$/i,
  /^(.+)_code$/i,
  /^(.+)_key$/i,
  /^id_(.+)$/i,
  /^fk_(.+)$/i,
];

// ============================================================================
// Main Detector
// ============================================================================

/**
 * Detect foreign key relationships between tables
 */
export async function detectRelationships(
  db: SessionDatabase,
  schema: SchemaInfo
): Promise<Relationship[]> {
  const relationships: Relationship[] = [];
  const tables = schema.tables;

  // Compare each pair of tables
  for (let i = 0; i < tables.length; i++) {
    for (let j = 0; j < tables.length; j++) {
      if (i === j) continue;

      const fromTable = tables[i];
      const toTable = tables[j];

      // Find potential FK columns in fromTable
      const fkCandidates = findFKCandidates(fromTable, toTable);

      for (const candidate of fkCandidates) {
        // Validate the relationship by checking value overlap
        const confidence = await validateRelationship(
          db,
          fromTable.name,
          candidate.fromColumn,
          toTable.name,
          candidate.toColumn
        );

        if (confidence >= MIN_CONFIDENCE) {
          relationships.push({
            fromTable: fromTable.name,
            fromColumn: candidate.fromColumn,
            toTable: toTable.name,
            toColumn: candidate.toColumn,
            confidence,
          });
        }
      }
    }
  }

  // Remove duplicate/reverse relationships (keep highest confidence)
  return deduplicateRelationships(relationships);
}

// ============================================================================
// Candidate Finding
// ============================================================================

interface FKCandidate {
  fromColumn: string;
  toColumn: string;
  score: number;
}

/**
 * Find potential FK columns that might reference another table
 */
function findFKCandidates(
  fromTable: TableSchema,
  toTable: TableSchema
): FKCandidate[] {
  const candidates: FKCandidate[] = [];

  for (const fromCol of fromTable.columns) {
    for (const toCol of toTable.columns) {
      const score = scoreFKCandidate(fromCol, toCol, toTable.name);
      if (score > 0) {
        candidates.push({
          fromColumn: fromCol.name,
          toColumn: toCol.name,
          score,
        });
      }
    }
  }

  // Sort by score and return top candidates
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Score how likely a column pair represents a FK relationship
 */
function scoreFKCandidate(
  fromCol: ColumnInfo,
  toCol: ColumnInfo,
  toTableName: string
): number {
  // MUST have compatible types - FK relationships require type compatibility
  if (!areTypesCompatible(fromCol.type, toCol.type)) {
    return 0; // Incompatible types cannot form a FK relationship
  }

  let score = 0;

  // Exact column name match
  if (fromCol.name === toCol.name) {
    score += 5;
  }

  // Column name contains table name (e.g., product_id -> products)
  const tableNameBase = toTableName.replace(/_/g, '').toLowerCase();
  if (fromCol.name.toLowerCase().includes(tableNameBase)) {
    score += 3;
  }

  // Column ends with ID suffix and matches target column
  for (const suffix of ID_SUFFIXES) {
    if (fromCol.name.toLowerCase().endsWith(suffix)) {
      score += 2;
      break;
    }
  }

  // Target column is likely a primary key (named 'id' or ends with '_id')
  if (
    toCol.name.toLowerCase() === 'id' ||
    toCol.name.toLowerCase().endsWith('_id')
  ) {
    score += 2;
  }

  // Exact type match gets a bonus
  if (fromCol.type === toCol.type) {
    score += 1;
  }

  // Pattern matching for common FK naming
  for (const pattern of ID_PATTERNS) {
    const match = fromCol.name.match(pattern);
    if (match) {
      const base = match[1].toLowerCase();
      if (
        toTableName.toLowerCase().includes(base) ||
        toCol.name.toLowerCase().includes(base)
      ) {
        score += 3;
      }
    }
  }

  return score;
}

/**
 * Check if two column types are compatible for a FK relationship
 * VARCHAR can only match VARCHAR, numbers can match numbers, etc.
 */
function areTypesCompatible(type1: ColumnInfo['type'], type2: ColumnInfo['type']): boolean {
  // Exact match is always compatible
  if (type1 === type2) return true;

  // Numeric types are compatible with each other
  const numericTypes = ['INTEGER', 'DOUBLE'];
  if (numericTypes.includes(type1) && numericTypes.includes(type2)) {
    return true;
  }

  // Date/timestamp are compatible
  const dateTypes = ['DATE', 'TIMESTAMP'];
  if (dateTypes.includes(type1) && dateTypes.includes(type2)) {
    return true;
  }

  // All other combinations are incompatible
  return false;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a relationship by checking value overlap
 */
async function validateRelationship(
  db: SessionDatabase,
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn: string
): Promise<number> {
  try {
    // Get distinct values from the FK column
    const fromResult = await db.execute(`
      SELECT COUNT(DISTINCT "${fromColumn}") as cnt
      FROM "${fromTable}"
      WHERE "${fromColumn}" IS NOT NULL
    `);
    const fromCount = Number(fromResult.rows[0]?.[0] || 0);

    if (fromCount === 0) return 0;

    // Count how many FK values exist in the target table
    const matchResult = await db.execute(`
      SELECT COUNT(DISTINCT f."${fromColumn}") as matched
      FROM "${fromTable}" f
      INNER JOIN "${toTable}" t ON f."${fromColumn}" = t."${toColumn}"
      WHERE f."${fromColumn}" IS NOT NULL
    `);
    const matchedCount = Number(matchResult.rows[0]?.[0] || 0);

    // Confidence is ratio of matched values
    return matchedCount / fromCount;
  } catch (error) {
    console.error(
      `[Relationships] Error validating ${fromTable}.${fromColumn} -> ${toTable}.${toColumn}:`,
      error
    );
    return 0;
  }
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Remove duplicate relationships, keeping highest confidence
 */
function deduplicateRelationships(relationships: Relationship[]): Relationship[] {
  const seen = new Map<string, Relationship>();

  for (const rel of relationships) {
    // Create a canonical key (sorted table names)
    const tables = [rel.fromTable, rel.toTable].sort();
    const cols = [rel.fromColumn, rel.toColumn].sort();
    const key = `${tables[0]}.${cols[0]}-${tables[1]}.${cols[1]}`;

    const existing = seen.get(key);
    if (!existing || existing.confidence < rel.confidence) {
      seen.set(key, rel);
    }
  }

  return Array.from(seen.values());
}
