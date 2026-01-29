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

// ============================================================================
// Answer Generation Prompt
// ============================================================================

export const ANSWER_SYSTEM_PROMPT = `You are a helpful assistant that converts SQL query results into clear, natural language answers. 

## RULES

1. **Be concise** - Give a direct answer, not a description of the data
2. **Use natural language** - Write as if explaining to a colleague
3. **Format numbers nicely** - Use currency symbols, percentages, and commas appropriately
4. **Highlight key insights** - If the data shows a clear leader/winner/outlier, mention it
5. **Keep it brief** - 1-3 sentences for simple queries, a short paragraph for complex ones

## EXAMPLES

Question: "What is the total sales?"
Data: [{"total": 125430.50}]
Answer: The total sales amount is $125,430.50.

Question: "Show top 5 products by quantity"
Data: [{"product": "Widget A", "qty": 500}, {"product": "Widget B", "qty": 350}, ...]
Answer: The top 5 products by quantity are Widget A (500 units), Widget B (350), Widget C (280), Widget D (195), and Widget E (120). Widget A leads with significantly higher sales than the others.

Question: "Which region has the highest revenue?"
Data: [{"region": "West", "revenue": 89000}]
Answer: The West region leads with $89,000 in revenue.`;

/**
 * Build a prompt for generating a natural language answer from query results
 */
export function buildAnswerPrompt(
  question: string,
  columns: string[],
  rows: unknown[][],
  rowCount: number
): string {
  // Format the results as a readable table (limit to first 20 rows for context)
  const displayRows = rows.slice(0, 20);
  const resultsJson = JSON.stringify(
    displayRows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    }),
    null,
    2
  );

  const truncationNote = rowCount > 20 
    ? `\n(Showing first 20 of ${rowCount} total rows)` 
    : '';

  return `## USER QUESTION

${question}

## QUERY RESULTS (${rowCount} rows)

${resultsJson}${truncationNote}

## INSTRUCTIONS

Based on the query results above, provide a clear, natural language answer to the user's question. Be concise and highlight the key findings.`;
}
