'use client';

import { useState, useCallback, useEffect } from 'react';
import { FileSpreadsheet, Upload, ToggleLeft, ToggleRight, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadZone } from '@/components/upload-zone';
import { SheetTabs } from '@/components/sheet-tabs';
import { DataGrid } from '@/components/data-grid';
import { SchemaPanel } from '@/components/schema-panel';
import { ChatPanel } from '@/components/chat-panel';
import { useBrowserDb } from '@/hooks/use-browser-db';
import type { UploadResponse, QueryResponse, CellValue, ColumnInfo, Relationship, SheetType, AggregateInfo, SchemaInfo } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

interface SheetData {
  name: string;
  sheetType: SheetType;
  rowCount: number;
  columns: ColumnInfo[];
  /** Full data for DuckDB loading */
  data: CellValue[][];
  previewData: CellValue[][];
  /** Original layout for matrix sheets (before normalization) */
  originalPreviewData?: CellValue[][];
  /** Aggregate detection info for matrix sheets */
  aggregateInfo?: AggregateInfo;
}

interface AppState {
  uploadId: string | null;
  fileName: string | null;
  sheets: SheetData[];
  schema: SchemaInfo | null;
  relationships: Relationship[];
  activeSheet: string | null;
  isLoading: boolean;
  isDbLoading: boolean;
  error: string | null;
  /** For matrix sheets: show original (true) or normalized (false) view */
  showOriginalView: boolean;
}

// ============================================================================
// Main Component
// ============================================================================

export default function Home() {
  const [state, setState] = useState<AppState>({
    uploadId: null,
    fileName: null,
    sheets: [],
    schema: null,
    relationships: [],
    activeSheet: null,
    isLoading: false,
    isDbLoading: false,
    error: null,
    showOriginalView: true, // Default to showing original view
  });

  // Browser DuckDB hook
  const browserDb = useBrowserDb();

  // Initialize DuckDB on first render
  useEffect(() => {
    if (!browserDb.isInitialized && !browserDb.isLoading) {
      browserDb.initialize();
    }
  }, [browserDb]);

  // Get current sheet data
  const currentSheet = state.sheets.find((s) => s.name === state.activeSheet);

  // Handle file upload
  const handleUpload = useCallback(async (file: File) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Ensure DuckDB is initialized
      if (!browserDb.isInitialized) {
        await browserDb.initialize();
      }

      const formData = new FormData();
      formData.append('file', file);

      // Step 1: Upload and parse file on server
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result: UploadResponse = await response.json();

      if (!result.success || !result.uploadId) {
        throw new Error(result.error || 'Upload failed');
      }

      // Step 2: Load data into client-side DuckDB
      setState((prev) => ({ ...prev, isDbLoading: true }));

      const sheetsToLoad = (result.sheets || []).map((s) => ({
        name: s.name,
        columns: s.columns,
        data: s.data,
      }));

      await browserDb.loadSheets(sheetsToLoad, result.schema!);

      setState({
        uploadId: result.uploadId,
        fileName: file.name,
        sheets: result.sheets || [],
        schema: result.schema || null,
        relationships: result.schema?.relationships || [],
        activeSheet: result.sheets?.[0]?.name || null,
        isLoading: false,
        isDbLoading: false,
        error: null,
        showOriginalView: true,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isDbLoading: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      }));
    }
  }, [browserDb]);

  // Handle query using client-side DuckDB
  const handleQuery = useCallback(
    async (question: string): Promise<QueryResponse> => {
      if (!state.uploadId || !browserDb.isInitialized) {
        return { success: false, error: 'No file uploaded or database not ready' };
      }

      try {
        return await browserDb.executeQuery(question);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Query failed',
        };
      }
    },
    [state.uploadId, browserDb]
  );

  // Handle new upload (reset state)
  const handleNewUpload = useCallback(async () => {
    await browserDb.reset();
    setState({
      uploadId: null,
      fileName: null,
      sheets: [],
      schema: null,
      relationships: [],
      activeSheet: null,
      isLoading: false,
      isDbLoading: false,
      error: null,
      showOriginalView: true,
    });
  }, [browserDb]);

  // Render upload view
  if (!state.uploadId) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
        {/* Header */}
        <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Spreadsheet Intelligence
                </h1>
                <p className="text-sm text-slate-500">
                  Query your Excel data with natural language
                </p>
              </div>
            </div>
            {/* DuckDB status indicator */}
            {!browserDb.isInitialized && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Initializing database...</span>
              </div>
            )}
          </div>
        </header>

        {/* Upload Zone */}
        <div className="container mx-auto px-4 py-16">
          <UploadZone
            onUpload={handleUpload}
            isLoading={state.isLoading || state.isDbLoading}
            error={state.error || browserDb.error}
            loadingMessage={
              state.isDbLoading
                ? 'Loading data into database...'
                : state.isLoading
                ? 'Processing file...'
                : undefined
            }
          />
        </div>
      </main>
    );
  }

  // Render main view
  return (
    <main className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Spreadsheet Intelligence
              </h1>
              <p className="text-xs text-slate-500">{state.fileName}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleNewUpload}>
            <Upload className="h-4 w-4 mr-2" />
            Upload New File
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 container mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-8rem)]">
          {/* Left Panel: Sheet Preview */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Sheet Tabs */}
            <SheetTabs
              sheets={state.sheets.map((s) => ({
                name: s.name,
                sheetType: s.sheetType,
                rowCount: s.rowCount,
              }))}
              activeSheet={state.activeSheet || ''}
              onSheetChange={(name) =>
                setState((prev) => ({ ...prev, activeSheet: name }))
              }
            />

            {/* Data Grid */}
            <Card className="flex-1 overflow-hidden">
              <CardHeader className="py-3 px-4 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {currentSheet?.name || 'No sheet selected'}
                    {currentSheet?.sheetType === 'matrix' && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        (matrix format - normalized for queries)
                      </span>
                    )}
                  </CardTitle>
                  {/* Toggle for matrix sheets */}
                  {currentSheet?.sheetType === 'matrix' && currentSheet.originalPreviewData && (
                    <button
                      onClick={() => setState(prev => ({ ...prev, showOriginalView: !prev.showOriginalView }))}
                      className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      {state.showOriginalView ? (
                        <ToggleLeft className="h-5 w-5" />
                      ) : (
                        <ToggleRight className="h-5 w-5 text-primary" />
                      )}
                      <span>{state.showOriginalView ? 'Original View' : 'Normalized View'}</span>
                    </button>
                  )}
                </div>
              </CardHeader>
              {/* Aggregate info banner */}
              {currentSheet?.sheetType === 'matrix' && 
               currentSheet.aggregateInfo && 
               currentSheet.aggregateInfo.aggregatePeriods.length > 0 && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>
                    <strong>{currentSheet.aggregateInfo.aggregatePeriods.length} aggregate column{currentSheet.aggregateInfo.aggregatePeriods.length > 1 ? 's' : ''} detected:</strong>{' '}
                    {currentSheet.aggregateInfo.aggregatePeriods.join(', ')}.
                    These are excluded from SUM queries to avoid double-counting.
                  </span>
                </div>
              )}
              <CardContent className="p-0">
                {currentSheet ? (
                  <DataGrid
                    data={
                      currentSheet.sheetType === 'matrix'
                        ? (state.showOriginalView && currentSheet.originalPreviewData
                            ? currentSheet.originalPreviewData
                            : currentSheet.previewData)
                        : currentSheet.previewData
                    }
                    highlightAggregates={
                      currentSheet.sheetType === 'matrix' && state.showOriginalView
                        ? currentSheet.aggregateInfo
                        : undefined
                    }
                    showAggregateColumn={
                      currentSheet.sheetType === 'matrix' && !state.showOriginalView
                    }
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 text-slate-500">
                    Select a sheet to preview
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Schema Panel */}
            {currentSheet && (
              <Card>
                <CardHeader className="py-3 px-4 border-b">
                  <CardTitle className="text-base">Schema</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <SchemaPanel
                    columns={currentSheet.columns}
                    rowCount={currentSheet.rowCount}
                    relationships={state.relationships}
                    tableName={currentSheet.name}
                    sheetType={currentSheet.sheetType}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel: Chat */}
          <Card className="flex flex-col overflow-hidden h-full max-h-[calc(100vh-8rem)]">
            <ChatPanel onQuery={handleQuery} disabled={!state.uploadId || !browserDb.isInitialized} />
          </Card>
        </div>
      </div>
    </main>
  );
}
