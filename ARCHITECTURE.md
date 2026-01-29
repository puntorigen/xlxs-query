# Architecture

This document describes the system architecture of Spreadsheet Intelligence, explaining the key components, data flow, and design rationale.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Next.js App (React)                           │  │
│  │  ┌─────────────────────────┐  ┌─────────────────────────────────────┐ │  │
│  │  │    Data Preview Panel   │  │         Chat Panel                  │ │  │
│  │  │  • Sheet tabs           │  │  • Question input                   │ │  │
│  │  │  • Data grid            │  │  • Answer display                   │ │  │
│  │  │  • Original/Normalized  │  │  • SQL transparency                 │ │  │
│  │  │  • Schema display       │  │  • Conversation history             │ │  │
│  │  └─────────────────────────┘  └─────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVER (Next.js API Routes)                        │
│                                                                              │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐   │
│  │    POST /api/upload         │  │       POST /api/query               │   │
│  │                             │  │                                     │   │
│  │  1. Parse Excel (SheetJS)   │  │  1. Build schema context            │   │
│  │  2. Evaluate formulas       │  │  2. Generate SQL (Groq LLM)         │   │
│  │  3. Detect headers          │  │  3. Validate SQL                    │   │
│  │  4. Classify sheets         │  │  4. Execute (DuckDB)                │   │
│  │  5. Analyze aggregates(LLM) │  │  5. Generate natural answer (LLM)   │   │
│  │  6. Normalize matrix sheets │  │  6. Return with transparency        │   │
│  │  7. Load into DuckDB        │  │                                     │   │
│  │  8. Detect relationships    │  │                                     │   │
│  │  9. Create session          │  │                                     │   │
│  └─────────────────────────────┘  └─────────────────────────────────────┘   │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Session Store (In-Memory)                      │  │
│  │  • DuckDB instance per session                                        │  │
│  │  • Schema metadata                                                     │  │
│  │  • Conversation history                                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Groq Cloud API                               │    │
│  │  • Model: openai/gpt-oss-120b                                       │    │
│  │  • Uses: SQL generation, aggregate detection, answer generation      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Excel Processing Pipeline (`lib/excel/`)

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   parser.ts  │───▶│  formula-    │───▶│   header-    │───▶│    sheet-    │
│              │    │  evaluator   │    │   detector   │    │  classifier  │
│  SheetJS     │    │  HyperFormula│    │  Heuristics  │    │  Table/Matrix│
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                                    │
                                                                    ▼
                                                           ┌──────────────┐
                                                           │   matrix-    │
                                                           │  normalizer  │
                                                           │  + LLM agg   │
                                                           └──────────────┘
```

**parser.ts**: Wraps SheetJS to extract raw cell data and formulas from `.xlsx` files.

**formula-evaluator.ts**: Uses HyperFormula to compute formula values. This ensures we work with calculated values, not formula strings.

**header-detector.ts**: Scores each row to find the header row using heuristics:
- Text density (headers are usually strings)
- Type consistency with rows below
- No duplicate column names
- Not starting with numbers

**sheet-classifier.ts**: Determines if a sheet is:
- **Table**: Standard columnar data with headers
- **Matrix**: Report-style with period headers (Q1, Q2, H1 Total, etc.)

**matrix-normalizer.ts**: Converts matrix sheets to long format:
```
Original:                          Normalized:
| Dept | Q1  | Q2  | Total |      | dept | period | amount | is_aggregate |
| Sales| 100 | 200 | 300   |  =>  | Sales| Q1     | 100    | false        |
                                   | Sales| Q2     | 200    | false        |
                                   | Sales| Total  | 300    | true         |
```

### 2. Database Layer (`lib/db/`)

**duckdb.ts**: Manages DuckDB instances. Each session gets its own in-memory database.

**loader.ts**: Creates tables and loads data from processed sheets. Handles type mapping (VARCHAR, INTEGER, DOUBLE, etc.).

**relationships.ts**: Detects foreign key relationships by:
- Finding columns with matching names (e.g., `product_id` ↔ `id`)
- Verifying value overlap
- Checking type compatibility

### 3. LLM Integration (`lib/llm/`)

**groq-client.ts**: Wrapper for Groq API with retry logic and error handling.

**prompts.ts**: System prompts for:
- SQL generation (NLQ → SQL)
- Answer generation (Results → Natural language)

**schema-context.ts**: Builds compact schema representation for LLM context:
```
### Tables
- **sales** (id INTEGER, product_id INTEGER, amount DOUBLE) — 23 rows
- **budgets** (department VARCHAR, period VARCHAR, amount DOUBLE, is_aggregate BOOLEAN) — 39 rows
  ⚠️ IMPORTANT: Filter WHERE is_aggregate = false for accurate sums

### Relationships
- sales.product_id → products.id
```

**matrix-analyzer.ts**: Uses LLM to detect aggregate columns/rows by analyzing numeric patterns (not text labels). This makes it language-agnostic.

### 4. Query Execution (`lib/query/`)

**executor.ts**: Orchestrates the query flow:
1. Build schema context
2. Call LLM for SQL generation
3. Validate SQL (SELECT only, no mutations)
4. Execute against DuckDB
5. Generate natural language answer
6. Return with transparency metadata

**validator.ts**: Ensures SQL safety:
- Only SELECT statements allowed
- No INSERT, UPDATE, DELETE, DROP, etc.
- Table names must exist in schema

### 5. Session Management (`lib/session.ts`)

Uses `globalThis` pattern for persistence across Next.js API calls:
```typescript
const globalForSessions = globalThis as { sessions: Map<string, SessionData> };
```

Each session contains:
- DuckDB instance with loaded data
- Schema information
- Conversation history for context

## Data Flow

### Upload Flow

```
User drops .xlsx file
        │
        ▼
┌───────────────────┐
│ POST /api/upload  │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Parse with SheetJS│──── Extract cells, formulas, sheet names
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Evaluate formulas │──── HyperFormula computes all values
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ For each sheet:   │
│ • Detect headers  │──── Find header row (may not be row 1)
│ • Classify type   │──── Table or Matrix?
│ • If matrix:      │
│   - LLM analyze   │──── Detect aggregate columns
│   - Normalize     │──── Convert to long format
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Load into DuckDB  │──── Create tables, insert data
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Detect relations  │──── Find foreign keys
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Create session    │──── Store DB + schema + conversation
└───────────────────┘
        │
        ▼
Return schema, preview data, aggregate info
```

### Query Flow

```
User asks: "What is the total budget for Engineering?"
        │
        ▼
┌───────────────────┐
│ POST /api/query   │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Build context     │──── Schema + conversation history
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Generate SQL      │──── LLM: Question → SQL
│ (Groq API)        │     "SELECT SUM(amount) FROM budgets
│                   │      WHERE department = 'Engineering'
│                   │      AND is_aggregate = false"
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Validate SQL      │──── Check: SELECT only, tables exist
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Execute (DuckDB)  │──── Run query, get results
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Generate answer   │──── LLM: Results → Natural language
│ (Groq API)        │     "The total budget for Engineering
│                   │      is $500,000."
└───────────────────┘
        │
        ▼
Return: answer, SQL, tables used, result preview
```

## Key Design Patterns

### 1. Two-Phase LLM Usage

**Phase 1 (SQL Generation)**: LLM generates SQL from natural language
- Deterministic execution via DuckDB
- Exact numerical accuracy
- Auditable/transparent

**Phase 2 (Answer Generation)**: LLM converts results to natural language
- Better UX than raw data tables
- Handles formatting, context

### 2. Schema-Driven Prompts

The LLM always receives full schema context:
- Table names and columns with types
- Row counts
- Sample values
- Relationships
- Special notes (e.g., aggregate column warnings)

### 3. Transparency by Default

Every query response includes:
- Generated SQL
- Tables used
- Result preview
- Assumptions made

Users can verify any answer by examining the SQL.

### 4. Graceful Degradation

- Header detection has fallbacks
- Matrix detection is optional (falls back to table)
- Aggregate detection is best-effort (defaults to no aggregates)
- Query failures return helpful error messages

## Security Considerations

1. **SQL Injection**: All user input goes through LLM → SQL generation, then validated for SELECT-only
2. **File Upload**: Only `.xlsx` accepted, size limited to 50MB
3. **No Persistence**: Data exists only in memory during session
4. **No Authentication**: Single-user local-first design

## Performance Characteristics

| Operation | Typical Time | Notes |
|-----------|-------------|-------|
| File parse | 100-500ms | Depends on file size |
| Formula eval | 50-200ms | HyperFormula is fast |
| LLM aggregate analysis | 500-2000ms | One API call per matrix sheet |
| SQL generation | 300-1000ms | Groq API latency |
| DuckDB query | 1-50ms | In-memory, very fast |
| Answer generation | 300-800ms | Groq API latency |

Total upload time: 1-4 seconds for typical files
Total query time: 0.5-2 seconds per question
