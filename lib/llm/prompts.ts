/**
 * LLM prompt templates for SQL generation
 */

import type { SchemaInfo, ConversationEntry } from '@/lib/types';
import { buildSchemaContext } from './schema-context';

// ============================================================================
// System Prompt
// ============================================================================

export const SYSTEM_PROMPT = `You are an expert SQL query generator for spreadsheet data stored in DuckDB. Your task is to convert natural language questions into precise SQL queries.

## CRITICAL RULES

1. **READ-ONLY ONLY**: Generate ONLY SELECT or WITH...SELECT queries
2. **NEVER use**: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, COPY, or any data modification
3. **Use exact column names** from the schema - do not guess or hallucinate columns
4. **Quote identifiers** with double quotes if they contain special characters
5. **Use appropriate aggregations** (SUM, AVG, COUNT, MIN, MAX) for numerical questions
6. **JOIN tables** when the question involves data from multiple tables
7. **Add LIMIT 100** for queries that might return many rows (unless counting or aggregating)

## OUTPUT FORMAT

Respond with a JSON object containing:
- "sql": The SQL query string (or null if query cannot be generated)
- "assumptions": Optional string explaining any assumptions made
- "error": Optional error message if the query cannot be generated

## EXAMPLES

Question: "What is the total sales amount?"
Response: {"sql": "SELECT SUM(quantity * unit_price) AS total_sales FROM sales", "assumptions": "Calculated total as quantity times unit price"}

Question: "Show me all products"
Response: {"sql": "SELECT * FROM products LIMIT 100"}

Question: "What is the average price by category?"
Response: {"sql": "SELECT category, AVG(unit_price) AS avg_price FROM sales JOIN products ON sales.product_id = products.product_id GROUP BY category"}

Question: "Who is the top sales rep?"
Response: {"sql": "SELECT e.name, SUM(s.quantity * s.unit_price) AS total_sales FROM sales s JOIN employees e ON s.sales_rep_id = e.rep_id GROUP BY e.name ORDER BY total_sales DESC LIMIT 1"}

## IMPORTANT

- For currency/money questions, return numeric values (the UI will format them)
- For percentage questions, calculate and return as decimal (0.15 for 15%)
- When comparing values, use appropriate operators and handle NULL values
- For date ranges, use DuckDB date functions (DATE '2024-01-01', EXTRACT, etc.)`;

// ============================================================================
// User Prompt Builder
// ============================================================================

/**
 * Build the user prompt with schema and conversation context
 */
export function buildUserPrompt(
  question: string,
  schema: SchemaInfo,
  conversationHistory: ConversationEntry[] = []
): string {
  const schemaContext = buildSchemaContext(schema);
  const conversationContext = buildConversationContext(conversationHistory);

  return `## DATABASE SCHEMA

${schemaContext}

${conversationContext}
## CURRENT QUESTION

${question}

Generate a SQL query to answer this question. Remember to return a JSON object with "sql", and optionally "assumptions" or "error" fields.`;
}

/**
 * Build conversation context for follow-up questions
 */
function buildConversationContext(history: ConversationEntry[]): string {
  if (history.length === 0) {
    return '';
  }

  const recentHistory = history.slice(-5); // Keep last 5 Q&A pairs
  const contextLines = recentHistory.map((entry) => {
    const answer = entry.error
      ? `Error: ${entry.error}`
      : entry.answer;
    return `Q: ${entry.question}\nA: ${answer}`;
  });

  return `## CONVERSATION HISTORY

${contextLines.join('\n\n')}

Use this context to understand follow-up questions. If the current question refers to previous context (e.g., "what about X" or "show me more"), incorporate relevant filters or groupings from the conversation.

`;
}

// ============================================================================
// Error Retry Prompt
// ============================================================================

/**
 * Build a prompt for retrying after an error
 */
export function buildRetryPrompt(
  originalQuestion: string,
  failedSql: string,
  errorMessage: string,
  schema: SchemaInfo
): string {
  const schemaContext = buildSchemaContext(schema);

  return `## DATABASE SCHEMA

${schemaContext}

## PREVIOUS ATTEMPT

The following SQL query failed:
\`\`\`sql
${failedSql}
\`\`\`

Error message: ${errorMessage}

## ORIGINAL QUESTION

${originalQuestion}

## INSTRUCTIONS

Please fix the SQL query to avoid the error. Common fixes:
- Use correct column names from the schema
- Add proper table aliases for JOINs
- Handle NULL values appropriately
- Use correct DuckDB syntax

Generate a corrected SQL query.`;
}
