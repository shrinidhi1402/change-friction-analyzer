# Change Friction Analyzer

> Understand which parts of your codebase are hardest and riskiest to change.

Change Friction Analyzer is a developer-intelligence platform that analyzes source-code structure and Git history to identify modules that are difficult, risky, or expensive to modify.

Instead of only measuring code complexity, it studies how the codebase has actually evolved over time.

## Why?

Large repositories contain hidden architectural problems that aren't obvious from reading the source code.

A file may look simple but still be extremely risky to modify because:

- many modules depend on it
- it changes frequently
- it frequently changes with other modules
- many developers modify it
- it has historically been involved in bug fixes or reversions

Change Friction Analyzer turns these signals into a single, explainable Change Friction Score.

## Core Question

> "If I change this module, how difficult or risky is that change likely to be?"

## How It Works

Repository
→ AST Analysis
→ Dependency Analysis
→ Git History Analysis
→ Co-change Analysis
→ Risk Calculation
→ Change Friction Score
→ Dashboard

## Change Friction Score

Each file receives a score from 0 to 100.

| Metric | Weight |
|---|---:|
| Dependency Impact | 30% |
| Change Frequency | 25% |
| Co-change Coupling | 20% |
| Contributor Complexity | 10% |
| Historical Risk | 15% |

## Example

paymentService.ts

Change Friction Score: 87/100

Why?

- Changed 47 times in the last 6 months
- 18 modules depend on it
- Frequently changes with orderService.ts
- Modified by 7 contributors
- Involved in 5 historical bug-fix commits

The score is therefore not an arbitrary AI prediction. It is based on measurable repository evidence.

## Key Features

### Repository Analysis

- Git history analysis
- JavaScript/TypeScript AST analysis
- Dependency graph construction
- File-level metrics

### Historical Analysis

- Change frequency
- Contributor statistics
- Co-change relationships
- Historical risk indicators

### Developer Intelligence

- Change Friction Score
- High-risk module detection
- Explainable score breakdown
- Dependency visualization
- Change-coupling visualization

## Privacy

A core design goal is preventing proprietary source code from unnecessarily leaving a company's infrastructure.

The long-term architecture supports a local analyzer.

Company Repository
→ Local Analyzer
→ Sanitized Metrics
→ Change Friction Platform

The analyzer can extract metrics without uploading the complete source code.

The analyzer itself does not require an LLM.

An optional local LLM can later be used to generate natural-language explanations.

## Architecture

Frontend:
Next.js + React + TypeScript

Backend:
Node.js + Express + TypeScript

Analyzer:
TypeScript + AST + Git analysis

Database:
PostgreSQL + Prisma

Visualization:
Recharts + React Flow

Deployment:
Docker / Vercel / Railway / self-hosted infrastructure

## Project Structure

apps/
├── web/
└── api/

packages/
├── analyzer/
├── database/
├── shared/
└── config/

## Development

Clone the repository.

Install dependencies.

Configure environment variables using `.env.example`.

Start PostgreSQL.

Run Prisma migrations.

Start the API.

Start the web application.

## Roadmap

### V1

- Repository analysis
- JavaScript/TypeScript support
- Git history analysis
- Dependency analysis
- Co-change analysis
- Change Friction Score
- Dashboard

### V2

- Local analyzer
- Private repository support
- CI/CD integration
- Pull-request risk analysis
- Historical trends

### V3

- Python/Java/Go/C++ support
- AI-generated explanations
- Local LLM support
- Self-hosted enterprise deployment

## Important

Change Friction Analyzer is designed to provide engineering intelligence, not to predict bugs with certainty.

The score represents historical and structural risk signals and should be used as a decision-support tool.

## License

MIT