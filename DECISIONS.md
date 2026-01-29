# Design Decisions

This document records the key technical decisions made during development, including the reasoning and trade-offs considered.

---

## 1. SQL Generation via LLM + DuckDB Execution

**Decision**: Use LLM to generate SQL queries, then execute them deterministically with DuckDB.

**Alternatives Considered**:
- **Direct LLM computation**: Let the LLM calculate answers from data in context
- **Rule-based NLQ parser**: Build a grammar-based natural language to SQL converter

**Why This Approach**:
- **Numerical accuracy**: DuckDB provides exact arithmetic. LLMs hallucinate numbers.
- **Transparency**: Users can see and verify the SQL. Black-box answers erode trust.
- **Scalability**: SQL works regardless of data size. LLM context is limited.
- **Debuggability**: When wrong, you can see *why* (bad SQL) vs. mysterious LLM errors.

**Trade-offs Accepted**:
- Requires valid SQL generation (LLM can produce invalid SQL)
- Two API calls per query (SQL gen + answer gen)
- Schema must be passed in context each time

---

## 2. DuckDB as Query Engine

**Decision**: Use DuckDB (in-memory) as the SQL execution engine.

**Alternatives Considered**:
- **sql.js (SQLite in WASM)**: Runs in browser or Node, widely used
- **AlaSQL**: Pure JavaScript SQL engine, no native dependencies
- **Custom query engine**: Build filtering/aggregation in TypeScript

**Why DuckDB**:
- **Analytical focus**: Optimized for aggregations, GROUP BY, joins (exactly what we need)
- **Type inference**: Automatically detects column types from data
- **Performance**: Columnar storage is fast for analytical queries
- **Rich SQL**: Supports window functions, CTEs, complex expressions

**Why Not sql.js/SQLite**:
- SQLite is row-oriented (slower for analytics)
- Less sophisticated type inference
- Would work fine, but DuckDB is better fit for analytical workloads

**Why Not AlaSQL**:
- Less mature, fewer SQL features
- Performance concerns with larger datasets
- Limited community/documentation

**Trade-offs Accepted**:
- Native dependency (though WASM version exists)
- Slightly larger bundle size
- Less familiar to some developers than SQLite

---

## 3. LLM-Based Aggregate Detection (Not Regex)

**Decision**: Use LLM to identify aggregate columns/rows by analyzing numeric patterns.

**Alternatives Considered**:
- **Regex on column names**: Match patterns like "Total", "Sum", "Subtotal"
- **Formula detection**: Check if cells contain SUM/SUBTOTAL formulas
- **Position heuristics**: Assume last column/row is always a total

**Why This Approach**:
- **Language agnostic**: Works with Spanish "Total", German "Summe", etc.
- **Pattern-based**: Detects aggregates even with unusual naming
- **Flexible**: Handles partial aggregates (H1 = Q1+Q2, but not full year)

**Trade-offs Accepted**:
- Adds ~500-1500ms to matrix sheet processing
- Costs API tokens
- May miss complex aggregate patterns
- Best-effort (defaults to "no aggregates" on failure)

**Example**: The LLM sees that column E values equal column C + column D for every row, so it identifies E as an aggregate column—regardless of whether E is labeled "Total", "Summe", or "合計".

---

## 4. Matrix Sheet Normalization

**Decision**: Convert matrix/report-style sheets to normalized (long) format for querying.

**Alternatives Considered**:
- **Treat as regular table**: Load Q1, Q2, H1 Total as separate columns, query by column name
- **Transpose the table**: Flip rows↔columns so periods become rows
- **Skip matrix detection**: Only support standard table-format sheets

**Why Normalize (unpivot to long format)**:
- **Simpler queries**: `WHERE period = 'Q1'` instead of `SELECT q1_budget`
- **Period-agnostic**: Same query structure works regardless of how many periods exist
- **Standard pattern**: Long format is best practice for analytical queries

**Why Not "Treat as Regular Table"**:
- Queries like "total budget" would need to know which columns to sum
- Adding new periods (Q3, Q4) would require different SQL each time
- LLM would need to understand column naming conventions

**Why Not Transpose**:
- Loses the hierarchical relationship (department → category)
- Creates one column per category instead of clean `category` column
- Harder to aggregate across categories

**Trade-offs Accepted**:
- Need to show both views in UI (toggle added for transparency)
- Extra processing step during upload
- Normalization heuristics may miss unusual layouts

---

## 5. Header Detection Heuristics

**Decision**: Score each row to find the most likely header row.

**Scoring Factors**:
- High text density (headers are usually strings)
- No empty cells
- Column values below have consistent types
- No duplicate values (headers should be unique)
- Not numeric-looking (headers rarely start with numbers)

**Alternatives Considered**:
- **Always row 1**: Assume first row is header
- **User selection**: Ask user to specify header row
- **LLM detection**: Use AI to identify headers

**Why This Approach**:
- **Handles real-world files**: Corporate reports often have title rows, logos, etc.
- **No user intervention**: Fully automatic
- **Fast**: Pure heuristics, no API calls
- **Fallback-safe**: If uncertain, defaults to row 0

**Trade-offs Accepted**:
- May misdetect unusual formats
- Multi-row headers not fully supported
- Confidence threshold is somewhat arbitrary

---

## 6. Groq as LLM Provider

**Decision**: Use Groq Cloud with the `openai/gpt-oss-120b` model.

**Alternatives Considered**:
- **OpenAI GPT-4o-mini**: Good balance of cost/capability, widely used
- **Anthropic Claude Haiku**: Fast and cheap, good for structured output
- **Together.ai**: Good pricing, multiple model options

**Why Groq Works Well**:
- **Speed**: Groq's LPU inference is extremely fast (sub-second)
- **Cost-effective**: Good pricing for the capability level
- **OpenAI-compatible API**: Easy to swap if needed
- **Sufficient for SQL generation**: Doesn't need GPT-4 level reasoning

**Trade-offs Accepted**:
- Single provider dependency
- Requires internet connection
- Model may struggle with very complex analytical queries

---

## 7. Two-Step Answer Generation

**Decision**: Generate SQL first, then convert results to natural language in a separate call.

**Alternatives Considered**:
- **Single prompt**: Ask for SQL + answer in one call
- **No natural language**: Just show tables/numbers
- **Client-side formatting**: Template-based answer generation

**Why This Approach**:
- **Cleaner separation**: SQL generation prompt is focused
- **Better answers**: Second prompt has actual results to work with
- **Reliability**: If SQL fails, we don't waste tokens on answer generation
- **User experience**: Natural language is more accessible than raw data

**Trade-offs Accepted**:
- Two API calls per query (latency + cost)
- Answer generation can sometimes be verbose
- Markdown parsing needed in frontend

---

## 8. Session Storage via globalThis

**Decision**: Store sessions in a global Map attached to `globalThis`.

**Alternatives Considered**:
- **Module-level Map**: `const sessions = new Map()` at module top
- **WeakMap with request context**: Garbage-collected automatically
- **Next.js cache**: Use `unstable_cache` or similar

**Why This Approach**:
- **Survives hot reload**: `globalThis` persists across Next.js module reloads in dev
- **Simple**: Just a Map with get/set operations
- **No external deps**: Works out of the box

**Why Not Module-level Map**:
- Next.js re-imports modules during development, losing the Map
- Discovered this bug during testing (sessions disappeared)

**Why Not WeakMap**:
- Need to access sessions by uploadId string, not object reference
- WeakMap only accepts objects as keys

**Trade-offs Accepted**:
- Lost on server restart (acceptable for local-first app)
- Memory grows with sessions (no auto-cleanup implemented)
- Single-server only (sufficient for single-user usage)

---

## 9. Frontend View Toggle for Matrix Sheets

**Decision**: Provide a toggle between "Original View" and "Normalized View" for matrix sheets.

**Alternatives Considered**:
- **Show only normalized**: Simpler UI, but loses context
- **Show only original**: Users don't see query format
- **Side-by-side**: Both views at once
- **Tabs**: Separate tabs for each view

**Why This Approach**:
- **Transparency**: Users see both their data AND how it's queried
- **Trust**: Can verify normalization is correct
- **Space efficient**: Only one grid visible at a time
- **Clear UX**: Toggle makes the relationship obvious

**Trade-offs Accepted**:
- Extra UI complexity
- Users must understand normalization concept
- Toggle state adds to app state management

---

## 10. Aggregate Highlighting in UI

**Decision**: Highlight aggregate columns in amber in the data grid.

**Alternatives Considered**:
- **No highlighting**: Rely on banner text only
- **Hide aggregates**: Remove from display entirely
- **Strikethrough**: Show as deprecated/excluded
- **Separate section**: Group aggregates separately

**Why This Approach**:
- **Visual clarity**: Immediately obvious which data is aggregate
- **Non-destructive**: Data still visible for verification
- **Consistent**: Same highlight in both views (column in original, rows in normalized)
- **Informative banner**: Explains WHY highlighting exists

**Trade-offs Accepted**:
- Amber color must be accessible (contrast checked)
- Additional props passed through component tree
- Only column highlighting in original view (row indices complex)

---

## Summary Table

| Decision | Key Benefit | Main Trade-off |
|----------|-------------|----------------|
| LLM→SQL→DuckDB | Numerical accuracy + transparency | Two API calls needed |
| DuckDB (vs sql.js) | Optimized for analytics | Native dependency |
| LLM aggregate detection | Language agnostic | Adds latency |
| Matrix normalization | Simpler queries | Shows transformed data |
| Header heuristics | Automatic, fast | May misdetect |
| Groq provider | Fast inference | Per assignment spec |
| Two-step answers | Better UX | Extra API call |
| globalThis sessions | Survives hot reload | Lost on restart |
| View toggle | Transparency | UI complexity |
| Aggregate highlighting | Visual clarity | Extra state |
