/**
 * POST /api/upload
 * Handle Excel file upload and processing
 * Returns parsed data for client-side DuckDB loading (stateless)
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { processExcelFile } from '@/lib/excel';
import type { UploadResponse, SchemaInfo, TableSchema, Relationship } from '@/lib/types';

export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  try {
    // Get form data
    const formData = await request.formData();
    const file = formData.get('file');

    // Validate file
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const fileName = file.name;
    if (!fileName.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json(
        { success: false, error: 'Only .xlsx files are supported' },
        { status: 400 }
      );
    }

    // Validate file size (max 50MB)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 50MB.' },
        { status: 400 }
      );
    }

    console.log(`[Upload] Processing file: ${fileName} (${file.size} bytes)`);

    // Read file buffer
    const buffer = await file.arrayBuffer();

    // Step 1: Process Excel file
    console.log('[Upload] Step 1: Processing Excel file...');
    const workbook = await processExcelFile(buffer, fileName);

    // Step 2: Build schema info (without loading into server-side DB)
    console.log('[Upload] Step 2: Building schema...');
    const tables: TableSchema[] = workbook.sheets
      .filter((sheet) => sheet.columns.length > 0 && sheet.data.length > 0)
      .map((sheet) => ({
        name: sheet.name,
        columns: sheet.columns.map((col) => ({
          ...col,
          // Add sample values from first few data rows
          sampleValues: sheet.data
            .slice(0, 5)
            .map((row) => row[sheet.columns.indexOf(col)])
            .filter((v) => v !== null && v !== undefined),
        })),
        rowCount: sheet.rowCount,
        hasAggregateColumn: sheet.columns.some((col) => col.name === 'is_aggregate'),
      }));

    // Step 3: Detect relationships between tables (basic detection without DB)
    console.log('[Upload] Step 3: Detecting relationships...');
    const relationships = detectBasicRelationships(tables);

    const schema: SchemaInfo = {
      tables,
      relationships,
    };

    // Generate a unique ID for this upload
    const uploadId = uuidv4();

    console.log(`[Upload] Complete. Upload ID: ${uploadId}`);

    // Build response with full data for client-side loading
    const response: UploadResponse = {
      success: true,
      uploadId,
      schema,
      sheets: workbook.sheets.map((sheet) => ({
        name: sheet.name,
        sheetType: sheet.sheetType,
        rowCount: sheet.rowCount,
        columns: sheet.columns,
        // Include full data for client-side DuckDB
        data: sheet.data,
        // Preview data for UI display
        previewData: sheet.previewData,
        // For matrix sheets, include original layout for display
        originalPreviewData: sheet.originalPreviewData,
        // Include aggregate info for matrix sheets
        aggregateInfo: sheet.aggregateInfo,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Upload] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `Failed to process file: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * Basic relationship detection without database queries
 * Looks for column name patterns that suggest foreign keys
 */
function detectBasicRelationships(tables: TableSchema[]): Relationship[] {
  const relationships: Relationship[] = [];

  for (const sourceTable of tables) {
    for (const column of sourceTable.columns) {
      // Look for columns that might be foreign keys
      const colLower = column.name.toLowerCase();
      
      // Pattern: table_id, tableId, table_name
      for (const targetTable of tables) {
        if (targetTable.name === sourceTable.name) continue;

        const targetLower = targetTable.name.toLowerCase();
        
        // Check if column name suggests a relationship
        if (
          colLower === `${targetLower}_id` ||
          colLower === `${targetLower}id` ||
          colLower === targetLower
        ) {
          // Look for matching column in target table
          const targetColumn = targetTable.columns.find(
            (c) =>
              c.name.toLowerCase() === 'id' ||
              c.name.toLowerCase() === `${targetLower}_id` ||
              c.name.toLowerCase() === column.name.toLowerCase()
          );

          if (targetColumn && column.type === targetColumn.type) {
            relationships.push({
              fromTable: sourceTable.name,
              fromColumn: column.name,
              toTable: targetTable.name,
              toColumn: targetColumn.name,
              confidence: 0.7,
            });
          }
        }
      }
    }
  }

  return relationships;
}
