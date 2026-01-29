/**
 * Query execution with retry logic
 * Handles SQL execution and automatic error recovery
 */

import { SessionDatabase } from '@/lib/db';
import { generateCompletion, generateAnswerCompletion } from '@/lib/llm/groq-client';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt, buildAnswerPrompt, ANSWER_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { validateSql } from './validator';
import { extractTablesFromSql } from './attribution';
import type { SchemaInfo, ConversationEntry, QueryResult, CellValue } from '@/lib/types';
import { sleep } from '@/lib/utils';

// ============================================================================
// Configuration
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 500, 1000]; // ms
const QUERY_TIMEOUT = 5000; // ms

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute a natural language query with automatic retry on error
 */
export async function executeQuery(
  question: string,
  db: SessionDatabase,
  schema: SchemaInfo,
  conversationHistory: ConversationEntry[]
): Promise<QueryResult> {
  let lastSql: string | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Apply retry delay
    if (attempt > 0) {
      await sleep(RETRY_DELAYS[attempt]);
      console.log(`[Executor] Retry attempt ${attempt + 1}/${MAX_RETRIES}`);
    }

    try {
      // Step 1: Generate SQL
      const sql = await generateSqlWithRetry(
        question,
        schema,
        conversationHistory,
        lastSql,
        lastError
      );

      if (!sql) {
        return {
          success: false,
          error: 'Could not generate a SQL query for this question',
        };
      }

      lastSql = sql;

      // Step 2: Validate SQL
      const validation = validateSql(sql);
      if (!validation.valid) {
        lastError = validation.error || 'Invalid SQL';
        continue;
      }

      const safeSql = validation.sanitizedSql || sql;

      // Step 3: Execute SQL
      const result = await executeWithTimeout(db, safeSql, QUERY_TIMEOUT);

      // Step 4: Extract tables used
      const tablesUsed = extractTablesFromSql(safeSql, schema);
      
      // Step 5: Generate natural language answer using LLM
      const answer = await generateNaturalAnswer(
        question,
        result.columns,
        result.rows,
        result.rowCount
      );

      return {
        success: true,
        answer,
        sql: safeSql,
        tablesUsed,
        resultPreview: result.rows.slice(0, 100),
        columnNames: result.columns,
        rowCount: result.rowCount,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Executor] Attempt ${attempt + 1} failed:`, lastError);
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: simplifyError(lastError),
    sql: lastSql || undefined,
  };
}

// ============================================================================
// SQL Generation
// ============================================================================

/**
 * Generate SQL, potentially with error context for retry
 */
async function generateSqlWithRetry(
  question: string,
  schema: SchemaInfo,
  conversationHistory: ConversationEntry[],
  previousSql: string | null,
  previousError: string | null
): Promise<string | null> {
  let prompt: string;
  let systemPrompt = SYSTEM_PROMPT;

  if (previousSql && previousError) {
    // Use retry prompt with error context
    prompt = buildRetryPrompt(question, previousSql, previousError, schema);
  } else {
    // Normal prompt
    prompt = buildUserPrompt(question, schema, conversationHistory);
  }

  const response = await generateCompletion(systemPrompt, prompt);

  if (response.error) {
    console.error('[Executor] LLM error:', response.error);
  }

  return response.sql;
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute SQL with a timeout
 */
async function executeWithTimeout(
  db: SessionDatabase,
  sql: string,
  timeout: number
): Promise<{ columns: string[]; rows: CellValue[][]; rowCount: number }> {
  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Query execution timeout'));
    }, timeout);

    try {
      const result = await db.execute(sql);
      clearTimeout(timeoutId);
      resolve(result);
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

// ============================================================================
// Natural Language Answer Generation
// ============================================================================

/**
 * Generate a natural language answer from query results using LLM
 */
async function generateNaturalAnswer(
  question: string,
  columns: string[],
  rows: CellValue[][],
  rowCount: number
): Promise<string> {
  // For empty results, return a simple message
  if (rowCount === 0) {
    return 'No matching data found for your query.';
  }

  try {
    const prompt = buildAnswerPrompt(question, columns, rows, rowCount);
    const response = await generateAnswerCompletion(ANSWER_SYSTEM_PROMPT, prompt);
    
    if (response && response.trim()) {
      return response;
    }
    
    // Fall back to simple formatting if LLM fails
    return formatAnswerFallback(columns, rows, rowCount);
  } catch (error) {
    console.error('[Executor] Error generating natural answer:', error);
    // Fall back to simple formatting
    return formatAnswerFallback(columns, rows, rowCount);
  }
}

/**
 * Fallback answer formatting when LLM is unavailable
 */
function formatAnswerFallback(
  columns: string[],
  rows: CellValue[][],
  rowCount: number
): string {
  // Single value result
  if (rowCount === 1 && columns.length === 1) {
    return formatValue(rows[0][0]);
  }

  // Single row, multiple columns
  if (rowCount === 1) {
    const parts = columns.map((col, i) => `${col}: ${formatValue(rows[0][i])}`);
    return parts.join(', ');
  }

  // Multiple rows
  if (rowCount <= 5) {
    const formatted = rows.map((row) => {
      if (columns.length === 1) {
        return formatValue(row[0]);
      }
      return columns.map((col, i) => `${col}: ${formatValue(row[i])}`).join(', ');
    });
    return formatted.join('\n');
  }

  // Many rows
  return `Found ${rowCount} results. See the table below for details.`;
}

/**
 * Format a single value for display
 */
function formatValue(value: CellValue): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  if (typeof value === 'number') {
    // Check if it looks like currency (large number or has decimals)
    if (Math.abs(value) >= 100 || (value % 1 !== 0 && Math.abs(value) >= 1)) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    }
    // Regular number
    return new Intl.NumberFormat('en-US').format(value);
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  return String(value);
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Simplify error message for user display
 */
function simplifyError(error: string | null): string {
  if (!error) {
    return 'An unexpected error occurred. Please try rephrasing your question.';
  }

  // Common DuckDB errors
  if (error.includes('does not exist')) {
    const match = error.match(/Table with name (\w+) does not exist/);
    if (match) {
      return `Table "${match[1]}" was not found. The available tables may have different names.`;
    }
    const colMatch = error.match(/column "(\w+)" not found/i);
    if (colMatch) {
      return `Column "${colMatch[1]}" was not found. Please check the column name.`;
    }
  }

  if (error.includes('syntax error')) {
    return 'There was a syntax error in the generated query. Please try rephrasing your question.';
  }

  if (error.includes('timeout')) {
    return 'The query took too long to execute. Try asking a more specific question.';
  }

  // Generic fallback
  return 'Could not execute the query. Please try rephrasing your question.';
}
