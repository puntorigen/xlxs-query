/**
 * POST /api/sql
 * Generate SQL from natural language question (stateless)
 * Does not execute SQL - that happens client-side in DuckDB-WASM
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateCompletion } from '@/lib/llm/groq-client';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt } from '@/lib/llm/prompts';
import { validateSql } from '@/lib/query/validator';
import { extractTablesFromSql } from '@/lib/query/attribution';
import type { SqlGenerationRequest, SqlGenerationResponse, SchemaInfo, ConversationEntry } from '@/lib/types';

// Request validation schema
const sqlRequestSchema = z.object({
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long'),
  schema: z.object({
    tables: z.array(z.object({
      name: z.string(),
      columns: z.array(z.object({
        name: z.string(),
        originalName: z.string(),
        type: z.string(),
        nullable: z.boolean(),
        sampleValues: z.array(z.unknown()),
      })),
      rowCount: z.number(),
      hasAggregateColumn: z.boolean().optional(),
      notes: z.string().optional(),
    })),
    relationships: z.array(z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      toTable: z.string(),
      toColumn: z.string(),
      confidence: z.number(),
    })),
  }),
  conversationHistory: z.array(z.object({
    id: z.string(),
    question: z.string(),
    sql: z.string().nullable(),
    answer: z.string(),
    tablesUsed: z.array(z.string()),
    timestamp: z.string().or(z.date()),
    error: z.string().optional(),
  })).optional(),
  previousSql: z.string().optional(),
  previousError: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse<SqlGenerationResponse>> {
  try {
    // Parse request body
    const body = await request.json();

    // Validate request
    const validation = sqlRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0].message },
        { status: 400 }
      );
    }

    const { question, schema, conversationHistory, previousSql, previousError } = validation.data as SqlGenerationRequest;

    console.log(`[SQL] Generating SQL for: "${question.substring(0, 50)}..."`);

    // Build the appropriate prompt
    let prompt: string;
    if (previousSql && previousError) {
      // Retry prompt with error context
      prompt = buildRetryPrompt(question, previousSql, previousError, schema as SchemaInfo);
    } else {
      // Normal prompt
      const history = (conversationHistory || []).map((entry) => ({
        ...entry,
        timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp as string),
      })) as ConversationEntry[];
      prompt = buildUserPrompt(question, schema as SchemaInfo, history);
    }

    // Generate SQL using LLM
    const response = await generateCompletion(SYSTEM_PROMPT, prompt);

    if (response.error || !response.sql) {
      return NextResponse.json({
        success: false,
        error: response.error || 'Could not generate SQL for this question',
      });
    }

    // Validate the generated SQL
    const validation_result = validateSql(response.sql);
    if (!validation_result.valid) {
      return NextResponse.json({
        success: false,
        sql: response.sql,
        error: validation_result.error || 'Generated SQL is invalid',
      });
    }

    const safeSql = validation_result.sanitizedSql || response.sql;

    // Extract tables used
    const tablesUsed = extractTablesFromSql(safeSql, schema as SchemaInfo);

    console.log(`[SQL] Generated SQL: ${safeSql.substring(0, 100)}...`);

    return NextResponse.json({
      success: true,
      sql: safeSql,
      assumptions: response.assumptions,
      tablesUsed,
    });
  } catch (error) {
    console.error('[SQL] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `SQL generation failed: ${message}` },
      { status: 500 }
    );
  }
}
