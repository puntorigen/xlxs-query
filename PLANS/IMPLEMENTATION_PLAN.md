# Implementation Plan: Spreadsheet Intelligence App

> Natural language querying of Excel spreadsheets with exact numerical accuracy

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Processing Pipeline](#3-processing-pipeline)
4. [Core Modules](#4-core-modules)
5. [LLM Integration](#5-llm-integration)
6. [UI/UX Design](#6-uiux-design)
7. [Error Handling](#7-error-handling)
8. [File Structure](#8-file-structure)
9. [Dependencies](#9-dependencies)
10. [Implementation Phases](#10-implementation-phases)
11. [Known Limitations](#11-known-limitations)

---

## 1. Overview

### Goal

Build a web application that allows users to:
- Upload Excel (.xlsx) files
- Ask natural language questions about the data
- Receive **exactly correct** numerical answers
- See transparency: SQL used, sheets referenced

### Key Principles

1. **LLM generates SQL, never computes math** - Ensures numerical accuracy
2. **Formula evaluation with HyperFormula** - Don't rely on cached Excel values
3. **DuckDB for deterministic queries** - Fast, reliable SQL execution
4. **Transparency first** - Show work, enable verification

### Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | Next.js 14 (App Router) | Fullstack React |
| Excel Parsing | SheetJS (xlsx) | Extract cells + formulas |
| Formula Engine | HyperFormula | Evaluate Excel formulas |
| Query Engine | DuckDB (node-api) | SQL execution |
| LLM Provider | Groq (OpenAI-compatible) | NLQ → SQL generation |
| Styling | Tailwind + shadcn/ui | Clean, modern UI |
| Validation | Zod | Schema validation |

---

## 2. Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js + React)                     │
│  ┌────────────────────────────────────┬────────────────────────────────┐ │
│  │         Sheet Preview Panel        │         Chat Panel             │ │
│  │  • Upload zone (drag-drop)         │  • Question input              │ │
│  │  • Sheet tabs                      │  • Conversation history        │ │
│  │  • Data grid preview               │  • Answer cards with:          │ │
│  │  • Schema info (cols, types)       │    - Result value              │ │
│  │  • Header row override             │    - SQL (collapsible)         │ │
│  │                                    │    - Sheets used (badges)      │ │
│  └────────────────────────────────────┴────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┬─┘
                                                                         │
┌────────────────────────────────────────────────────────────────────────┼─┐
│                           BACKEND (API Routes)                         │ │
│                                                                         │
│  POST /api/upload                POST /api/query                        │
│  ┌─────────────────────┐         ┌─────────────────────────────────────┐│
│  │ 1. Parse XLSX       │         │ 1. Build context (schema + history) ││
│  │ 2. Evaluate formulas│         │ 2. Call Groq LLM → Get SQL          ││
│  │ 3. Detect headers   │         │ 3. Validate SQL safety              ││
│  │ 4. Classify sheets  │         │ 4. Execute in DuckDB                ││
│  │ 5. Normalize matrix │         │ 5. Retry on error (max 3)           ││
│  │ 6. Load into DuckDB │         │ 6. Extract attribution              ││
│  │ 7. Detect relations │         │ 7. Return answer + transparency     ││
│  │ 8. Return schema    │         │                                     ││
│  └─────────────────────┘         └─────────────────────────────────────┘│
│                                                                         │
│  SESSION STATE (in-memory, per upload):                                 │
│  • DuckDB instance with all tables                                      │
│  • Schema + detected relationships                                      │
│  • Conversation history (last 5 Q&A pairs)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload` | POST | Upload Excel, process, return schema |
| `/api/query` | POST | Natural language question → answer |

---

## 3. Processing Pipeline

### Upload Processing Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Excel File  │────▶│   SheetJS    │────▶│ HyperFormula │────▶│Header Detect │
│   (.xlsx)    │     │   Parse      │     │  Evaluate    │     │  + Classify  │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                      │
                     ┌──────────────┐     ┌──────────────┐            │
                     │   DuckDB     │◀────│  Normalize   │◀───────────┘
                     │    Load      │     │  (if matrix) │
                     └──────────────┘     └──────────────┘
```

### Step 1: SheetJS Parse

Parse Excel with formula extraction enabled:

```typescript
import * as XLSX from 'xlsx';

const workbook = XLSX.read(buffer, { 
  cellFormula: true,  // Extract formula strings
  cellStyles: false,  // Skip styles (not needed)
});

// Cell object structure:
// cell.f = "SUM(B5:B7)"  ← formula string (without =)
// cell.v = 365000        ← cached value (may be missing!)
// cell.t = "n"           ← type (n=number, s=string, etc.)
```

### Step 2: HyperFormula Evaluate

**Why needed**: Excel files may not have cached values if:
- Created programmatically (never opened in Excel)
- Formulas modified but file not re-saved
- Cross-sheet references need recalculation

```typescript
import { HyperFormula } from 'hyperformula';

// Build arrays from SheetJS data:
// - If cell has formula (.f), use "=" + formula
// - Otherwise, use raw value
const sheetData = buildSheetArrays(workbook);

// Evaluate all formulas
const hf = HyperFormula.buildFromSheets(sheetData, {
  licenseKey: 'gpl-v3'
});

// Get computed values
const evaluatedData = hf.getAllSheetsValues();
```

### Step 3: Header Detection

Scan first 20 rows and score each as potential header:

```
Score calculation:
  +2 × non-empty cells
  +5 if all cells are strings
  +3 if all values unique
  +2 if next row has same column count
  -10 if only 1 non-empty cell (likely title)

Select highest-scoring row as header
```

**Example from test file**:
| Sheet | Title Rows | Header Row | Detection |
|-------|-----------|------------|-----------|
| Sales | 1-4 | Row 5 | `Transaction ID, Date, Region...` |
| Products | 1 | Row 3 | `Product ID, Product Name...` |
| Employees | 1 | Row 3 | `Rep ID, Name, Region...` |
| Budgets | 1-2 | Row 3 | Matrix format detected |
| Actuals | 1 | Row 3 | `Department, Category...` |

### Step 4: Sheet Classification

Detect if sheet is **Table** or **Matrix**:

| Type | Characteristics | Action |
|------|-----------------|--------|
| **Table** | Clear header row, uniform data below | Load as-is |
| **Matrix** | Sparse first column, period headers (Q1/Q2), numeric columns | Normalize |

**Matrix detection heuristics**:
- First column has mixed None/text in pattern (section markers)
- Headers contain period patterns: Q1, Q2, H1, Jan, Feb, etc.
- Multiple numeric columns with similar structure

### Step 5: Matrix Normalization

Convert matrix/report sheets to queryable long format:

```
INPUT (Budgets sheet):
|       |          | Q1 Budget | Q2 Budget | H1 Total |
| SALES |          |           |           |          |
|       | Salaries | 180000    | 185000    | 365000   |
|       | Travel   | 25000     | 30000     | 55000    |

OUTPUT (normalized table):
| department | category | period    | amount |
|------------|----------|-----------|--------|
| Sales      | Salaries | Q1 Budget | 180000 |
| Sales      | Salaries | Q2 Budget | 185000 |
| Sales      | Travel   | Q1 Budget | 25000  |
| Sales      | Travel   | Q2 Budget | 30000  |
```

**Algorithm**:
1. Find period header row (contains Q1/Q2/H1/Jan/Feb patterns)
2. Track `currentDepartment` from section marker rows
3. For each data row, emit one record per period column
4. Skip subtotal rows (label contains "Total")
5. Optionally skip calculated columns (H1 Total = Q1 + Q2)

### Step 6: DuckDB Load

Load all processed sheets as tables:

```typescript
import { DuckDBInstance } from '@duckdb/node-api';

// Create in-memory database
const db = await DuckDBInstance.create(':memory:');
const conn = await db.connect();

// For each sheet, create table and insert data
await conn.run(`
  CREATE TABLE sales (
    transaction_id VARCHAR,
    date DATE,
    region VARCHAR,
    product_id VARCHAR,
    quantity INTEGER,
    unit_price DOUBLE,
    sales_rep_id VARCHAR
  )
`);

// Use appender for efficient bulk insert
const appender = await conn.createAppender('sales');
// ... append rows
appender.close();
```

### Step 7: Relationship Detection

Detect foreign key relationships for cross-sheet queries:

```typescript
// Simple heuristic: match column names across tables
const relationships = {
  'sales.product_id': 'products.product_id',
  'sales.sales_rep_id': 'employees.rep_id',
};

// Also check value patterns (e.g., PROD-XXX format matches)
```

---

## 4. Core Modules

### 4.1 Excel Parser (`lib/excel/parser.ts`)

```typescript
interface ParsedWorkbook {
  sheets: Map<string, ParsedSheet>;
  sheetNames: string[];
}

interface ParsedSheet {
  name: string;
  rawData: CellValue[][];      // From SheetJS
  evaluatedData: CellValue[][]; // After HyperFormula
  headerRow: number;
  sheetType: 'table' | 'matrix';
}

function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook;
```

### 4.2 Formula Evaluator (`lib/excel/formula-evaluator.ts`)

```typescript
function evaluateFormulas(
  sheets: Map<string, RawSheet>
): Map<string, EvaluatedSheet>;
```

### 4.3 Header Detector (`lib/excel/header-detector.ts`)

```typescript
interface HeaderDetectionResult {
  headerRow: number;
  confidence: number;
  columns: ColumnInfo[];
}

function detectHeader(data: CellValue[][]): HeaderDetectionResult;
```

### 4.4 Sheet Classifier (`lib/excel/sheet-classifier.ts`)

```typescript
type SheetType = 'table' | 'matrix' | 'metadata';

function classifySheet(data: CellValue[][], headerRow: number): SheetType;
```

### 4.5 Matrix Normalizer (`lib/excel/matrix-normalizer.ts`)

```typescript
interface NormalizedData {
  columns: string[];  // ['department', 'category', 'period', 'amount']
  rows: CellValue[][];
}

function normalizeMatrix(data: CellValue[][], headerRow: number): NormalizedData;
```

### 4.6 DuckDB Manager (`lib/db/duckdb.ts`)

```typescript
class SessionDatabase {
  private db: DuckDBInstance;
  private conn: DuckDBConnection;
  
  async loadSheet(name: string, columns: ColumnDef[], rows: any[]): Promise<void>;
  async execute(sql: string): Promise<QueryResult>;
  async getSchema(): Promise<SchemaInfo>;
}
```

### 4.7 SQL Validator (`lib/query/validator.ts`)

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedSql?: string;
}

function validateSql(sql: string): ValidationResult;

// Rules:
// - Must start with SELECT or WITH
// - Block: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, COPY, PRAGMA
// - Add LIMIT if missing (max 1000 rows)
```

---

## 5. LLM Integration

### 5.1 Groq Client Setup

```typescript
import OpenAI from 'openai';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});
```

### 5.2 Schema Context Builder

Build compact schema for LLM prompt:

```typescript
function buildSchemaContext(schema: SchemaInfo): string {
  return `
Tables:
- sales (transaction_id VARCHAR, date DATE, region VARCHAR, product_id VARCHAR, quantity INTEGER, unit_price DOUBLE, sales_rep_id VARCHAR) - 23 rows
- products (product_id VARCHAR, product_name VARCHAR, category VARCHAR, cost DOUBLE, margin VARCHAR) - 5 rows
- employees (rep_id VARCHAR, name VARCHAR, region VARCHAR, hire_date DATE, h1_quota INTEGER, commission VARCHAR) - 5 rows
- budgets (department VARCHAR, category VARCHAR, period VARCHAR, amount DOUBLE) - 18 rows
- actuals (department VARCHAR, category VARCHAR, q1_actual DOUBLE, q2_actual DOUBLE) - 9 rows

Detected Relationships:
- sales.product_id → products.product_id
- sales.sales_rep_id → employees.rep_id

Sample values:
- sales.region: West, East, North, South
- products.category: Hardware, Software, Services
- budgets.period: Q1 Budget, Q2 Budget
`;
}
```

### 5.3 System Prompt

```typescript
const SYSTEM_PROMPT = `You are a SQL query generator for spreadsheet data. Your task is to convert natural language questions into DuckDB SQL queries.

RULES:
1. Generate ONLY read-only SQL (SELECT or WITH ... SELECT)
2. NEVER use INSERT, UPDATE, DELETE, DROP, or any data modification
3. Use exact column names from the schema
4. For aggregations, use appropriate SQL functions (SUM, AVG, COUNT, etc.)
5. When joining tables, use the detected relationships
6. Add LIMIT 100 for queries that might return many rows

OUTPUT FORMAT (JSON):
{
  "sql": "SELECT ...",
  "assumptions": "Optional: any assumptions made about the question"
}

If the question cannot be answered with the available data, respond with:
{
  "sql": null,
  "error": "Explanation of why the query cannot be generated"
}`;
```

### 5.4 Conversation Memory

Include recent Q&A for follow-up questions:

```typescript
interface ConversationEntry {
  question: string;
  sql: string;
  answer: string;
  sheetsUsed: string[];
}

function buildConversationContext(history: ConversationEntry[]): string {
  if (history.length === 0) return '';
  
  return `
Previous conversation:
${history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n')}

Use this context to understand follow-up questions.
`;
}
```

### 5.5 Query Generation

```typescript
async function generateSql(
  question: string,
  schema: SchemaInfo,
  history: ConversationEntry[]
): Promise<{ sql: string; assumptions?: string }> {
  const response = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `
Schema:
${buildSchemaContext(schema)}

${buildConversationContext(history)}

Question: ${question}
` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,  // Low temperature for consistency
  });
  
  return JSON.parse(response.choices[0].message.content);
}
```

---

## 6. UI/UX Design

### Layout (2-Panel Responsive)

```
┌────────────────────────────────────────────────────────────────────────┐
│  📊 Spreadsheet Intelligence          [Upload New File]                │
├────────────────────────────────────────┬───────────────────────────────┤
│                                        │                               │
│  ┌─[Sales][Products][Employees]...─┐   │  💬 Ask about your data       │
│  │                                 │   │                               │
│  │    | A | B | C | D | E | F |    │   │  ┌─────────────────────────┐  │
│  │  ──┼───┼───┼───┼───┼───┼───┤    │   │  │ What was total sales   │  │
│  │  1 │ T │ D │ R │ P │ Q │ U │    │   │  │ in H1 2024?            │  │
│  │  2 │ x │ x │ x │ x │ x │ x │    │   │  └─────────────────────────┘  │
│  │  3 │ x │ x │ x │ x │ x │ x │    │   │          [Ask] ↵              │
│  │  ...                            │   │                               │
│  └─────────────────────────────────┘   │  ─────────────────────────────│
│                                        │                               │
│  Schema: 7 columns, 23 rows            │  Q: What was total sales?     │
│  ┌─────────────────────────────────┐   │                               │
│  │ • transaction_id (VARCHAR)      │   │  💰 $125,432.50               │
│  │ • date (DATE)                   │   │                               │
│  │ • region (VARCHAR)              │   │  ▶ Show SQL                   │
│  │ • product_id (VARCHAR)          │   │  📊 From: Sales               │
│  │ • quantity (INTEGER)            │   │                               │
│  │ • unit_price (DOUBLE)           │   │  ─────────────────────────────│
│  │ • sales_rep_id (VARCHAR)        │   │                               │
│  └─────────────────────────────────┘   │  Q: What about West region?   │
│                                        │                               │
│  Header row: 5 [Change ▼]              │  💰 $52,150.00                 │
│                                        │                               │
└────────────────────────────────────────┴───────────────────────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| `UploadZone` | Drag-drop file upload with progress |
| `SheetTabs` | Navigate between sheets |
| `DataGrid` | Simple table preview (first 100 rows) |
| `SchemaPanel` | Column names, types, row count |
| `ChatPanel` | Question input + history |
| `AnswerCard` | Result + expandable SQL + attribution |

### Answer Card Structure

```
┌──────────────────────────────────────────┐
│ Q: Which sales rep had the highest       │
│    total sales?                          │
│                                          │
│ 🏆 Emily Rodriguez - $89,997.00          │
│                                          │
│ ▼ SQL Used                               │
│ ┌──────────────────────────────────────┐ │
│ │ SELECT e.name,                       │ │
│ │   SUM(s.quantity * s.unit_price)     │ │
│ │     AS total_sales                   │ │
│ │ FROM sales s                         │ │
│ │ JOIN employees e                     │ │
│ │   ON s.sales_rep_id = e.rep_id       │ │
│ │ GROUP BY e.name                      │ │
│ │ ORDER BY total_sales DESC            │ │
│ │ LIMIT 1                              │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ 📊 From: Sales, Employees                │
└──────────────────────────────────────────┘
```

### States

| State | Display |
|-------|---------|
| No file | Upload zone prominent |
| Processing | Spinner + "Analyzing spreadsheet..." |
| Ready | Sheet preview + chat enabled |
| Querying | Typing indicator in chat |
| Error | Error card with suggestion |

---

## 7. Error Handling

### Retry Strategy

```typescript
async function executeWithRetry(
  question: string,
  schema: SchemaInfo,
  history: ConversationEntry[]
): Promise<QueryResult> {
  const maxAttempts = 3;
  const delays = [0, 500, 1000];
  let lastError: Error | null = null;
  let lastSql: string | null = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(delays[attempt]);
    }
    
    try {
      // Generate SQL (with error context on retry)
      const { sql } = await generateSql(
        question,
        schema,
        history,
        lastError ? { error: lastError.message, attemptedSql: lastSql } : undefined
      );
      
      lastSql = sql;
      
      // Validate
      const validation = validateSql(sql);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      // Execute
      return await db.execute(sql);
      
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts - 1) {
        // Final failure
        return {
          error: true,
          message: simplifyError(error),
          attemptedSql: lastSql,
          suggestion: 'Try rephrasing your question'
        };
      }
    }
  }
}
```

### Error Types

| Error | Detection | Recovery |
|-------|-----------|----------|
| Column not found | DuckDB error message | Retry with available columns in prompt |
| Table not found | DuckDB error message | Retry with available tables in prompt |
| Type mismatch | DuckDB error message | Retry with column types in prompt |
| SQL syntax | DuckDB error message | Retry with error message |
| Timeout (>5s) | Execution timeout | Add LIMIT, retry |
| LLM API error | HTTP error | Exponential backoff |
| Empty result | No rows returned | Return "No matching data" (not error) |

---

## 8. File Structure

```
xlsx-query/
├── app/
│   ├── layout.tsx                  # Root layout with providers
│   ├── page.tsx                    # Main page component
│   ├── globals.css                 # Tailwind imports
│   └── api/
│       ├── upload/
│       │   └── route.ts            # POST: Upload + process Excel
│       └── query/
│           └── route.ts            # POST: NLQ → SQL → Execute
├── lib/
│   ├── excel/
│   │   ├── parser.ts               # SheetJS wrapper
│   │   ├── formula-evaluator.ts    # HyperFormula integration
│   │   ├── header-detector.ts      # Find header row
│   │   ├── sheet-classifier.ts     # Table vs Matrix detection
│   │   └── matrix-normalizer.ts    # Unpivot matrix sheets
│   ├── db/
│   │   ├── duckdb.ts               # DuckDB instance management
│   │   ├── loader.ts               # Load sheets → tables
│   │   └── relationships.ts        # Detect FK relationships
│   ├── llm/
│   │   ├── groq-client.ts          # Groq API client
│   │   ├── prompts.ts              # System + user prompts
│   │   └── schema-context.ts       # Build schema string for LLM
│   ├── query/
│   │   ├── validator.ts            # SQL safety validation
│   │   ├── executor.ts             # Execute + retry logic
│   │   └── attribution.ts          # Extract tables used from SQL
│   ├── session.ts                  # Session state management
│   └── types.ts                    # TypeScript interfaces
├── components/
│   ├── upload-zone.tsx             # Drag-drop file upload
│   ├── sheet-tabs.tsx              # Sheet navigation
│   ├── data-grid.tsx               # Spreadsheet preview
│   ├── schema-panel.tsx            # Schema info display
│   ├── chat-panel.tsx              # Chat interface
│   ├── answer-card.tsx             # Individual answer
│   └── ui/                         # shadcn/ui components
│       ├── button.tsx
│       ├── card.tsx
│       ├── tabs.tsx
│       ├── input.tsx
│       └── ...
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
├── .env.local.example              # GROQ_API_KEY template
├── .gitignore
└── README.md
```

---

## 9. Dependencies

### package.json

```json
{
  "name": "xlsx-query",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "xlsx": "^0.18.5",
    "hyperformula": "^2.7.0",
    "@duckdb/node-api": "^1.1.0",
    "openai": "^4.52.0",
    "zod": "^3.23.0",
    "tailwindcss": "^3.4.0",
    "lucide-react": "^0.400.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### Environment Variables

```bash
# .env.local
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 10. Implementation Phases

### Phase 1: Project Setup (30 min) ✅

- [x] Initialize Next.js with TypeScript
- [x] Install dependencies
- [x] Configure Tailwind CSS
- [x] Add shadcn/ui components (button, card, tabs, input, badge, scroll-area)
- [x] Create `.env.local.example`
- [x] Set up basic layout

### Phase 2: Excel Processing (1.5 hr) ✅

- [x] Implement `parser.ts` - SheetJS with cellFormula
- [x] Implement `formula-evaluator.ts` - HyperFormula integration
- [x] Implement `header-detector.ts` - scoring algorithm
- [x] Implement `sheet-classifier.ts` - table vs matrix
- [x] Implement `matrix-normalizer.ts` - unpivot logic
- [x] Implement `processor.ts` - main orchestrator
- [ ] Unit test with `company_data.xlsx` (will test via API)

### Phase 3: Database Layer (45 min) ✅

- [x] Implement `duckdb.ts` - session database class
- [x] Implement `loader.ts` - create tables, insert data
- [x] Implement `relationships.ts` - FK detection
- [ ] Test cross-sheet queries manually (will test via API)

### Phase 4: Query Engine (1.5 hr) ✅

- [x] Implement `groq-client.ts` - API client setup
- [x] Implement `prompts.ts` - system prompt
- [x] Implement `schema-context.ts` - build schema string
- [x] Implement `validator.ts` - SQL safety checks
- [x] Implement `executor.ts` - execute + retry logic
- [x] Implement `attribution.ts` - extract tables from SQL
- [x] Implement `session.ts` - conversation history

### Phase 5: API Routes (30 min) ✅

- [x] Implement `POST /api/upload`
- [x] Implement `POST /api/query`
- [ ] Test endpoints with Postman/curl (will test via UI)

### Phase 6: Frontend UI (1.5 hr) ✅

- [x] Implement `upload-zone.tsx` - drag-drop upload
- [x] Implement `sheet-tabs.tsx` - sheet navigation
- [x] Implement `data-grid.tsx` - simple table preview
- [x] Implement `schema-panel.tsx` - column info
- [x] Implement `chat-panel.tsx` - input + history
- [x] Implement `answer-card.tsx` - result display
- [x] Implement main `page.tsx` - wire everything together
- [x] Add loading states and error handling

### Phase 7: Polish & Test (30 min) ✅

- [x] Test full flow with `company_data.xlsx`
- [x] Test cross-sheet queries
- [x] Test follow-up questions
- [x] Test error recovery
- [x] Write README with setup instructions
- [x] Document known limitations

**Total Estimated Time: ~6 hours**

---

## 11. Known Limitations

### To Document in README

1. **Matrix Sheet Detection**
   - Heuristics may not detect all corporate report formats
   - Complex multi-level headers not fully supported
   - User can manually mark sheets as matrix (future enhancement)

2. **Formula Support**
   - HyperFormula supports ~400 functions but not all Excel functions
   - Complex array formulas may not evaluate correctly
   - External references (other files) not supported

3. **File Size**
   - Large files (>100k rows) may be slow
   - In-memory processing limits practical size
   - Future: streaming, Parquet export

4. **Query Complexity**
   - Very complex analytical queries may require multiple attempts
   - LLM may misinterpret ambiguous questions
   - Recommend clear, specific questions

5. **Session Persistence**
   - Single session only (in-memory)
   - Uploading new file clears previous data
   - No saved query history between sessions

6. **Supported Formats**
   - Only `.xlsx` format (not `.xls`, `.csv`, `.ods`)
   - Future: add support for other formats

---

## Appendix: Test File Structure

### company_data.xlsx

| Sheet | Rows | Type | Notes |
|-------|------|------|-------|
| Sales | 23 | Table | Header row 5, transactions data |
| Products | 5 | Table | Header row 3, product catalog |
| Employees | 5 | Table | Header row 3, sales team info |
| Budgets | ~20 | Matrix | Department sections, Q1/Q2 columns |
| Actuals | 9 | Table | Header row 3, actual spend data |

### Example Queries to Test

1. "What was total sales revenue in H1?"
2. "Which product category had the highest sales?"
3. "Show me Emily Rodriguez's sales performance"
4. "What is the budget variance for Marketing?"
5. "Which region exceeded their quota?"
6. "Compare Q1 vs Q2 budget for Engineering"
