/**
 * POST /api/answer
 * Generate natural language answer from SQL query results (stateless)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateAnswerCompletion } from '@/lib/llm/groq-client';
import { ANSWER_SYSTEM_PROMPT, buildAnswerPrompt } from '@/lib/llm/prompts';
import type { AnswerGenerationResponse, CellValue } from '@/lib/types';

// Request validation schema
const answerRequestSchema = z.object({
  question: z.string().min(1, 'Question is required'),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  rowCount: z.number(),
});

export async function POST(request: NextRequest): Promise<NextResponse<AnswerGenerationResponse>> {
  try {
    // Parse request body
    const body = await request.json();

    // Validate request
    const validation = answerRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0].message },
        { status: 400 }
      );
    }

    const { question, columns, rows, rowCount } = validation.data;

    console.log(`[Answer] Generating answer for: "${question.substring(0, 50)}..."`);

    // Handle empty results
    if (rowCount === 0) {
      return NextResponse.json({
        success: true,
        answer: 'No matching data found for your query.',
      });
    }

    // Build prompt and generate answer
    const prompt = buildAnswerPrompt(question, columns, rows as CellValue[][], rowCount);
    const answer = await generateAnswerCompletion(ANSWER_SYSTEM_PROMPT, prompt);

    if (!answer || !answer.trim()) {
      // Fall back to simple formatting
      return NextResponse.json({
        success: true,
        answer: formatAnswerFallback(columns, rows as CellValue[][], rowCount),
      });
    }

    console.log(`[Answer] Generated answer: ${answer.substring(0, 100)}...`);

    return NextResponse.json({
      success: true,
      answer,
    });
  } catch (error) {
    console.error('[Answer] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `Answer generation failed: ${message}` },
      { status: 500 }
    );
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
