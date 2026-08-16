# Change Friction Analyzer

> A full-stack developer intelligence platform that analyzes a GitHub repository and identifies which parts of the codebase are difficult, risky, and expensive to change.

## Overview

Change Friction Analyzer is a developer-focused codebase intelligence platform.

The system connects to a GitHub repository, analyzes its source code and Git history, builds a dependency and change-coupling graph, and calculates a **Change Friction Score** for files/modules.

The goal is not to find syntax errors or replace AI coding assistants.

The goal is to answer a different question:

> **"Which parts of this codebase are hardest to change, and why?"**

A developer should be able to provide a GitHub repository and receive an interactive analysis showing:

* high-friction files/modules
* dependency impact
* number of dependents
* change frequency
* contributor concentration
* files that frequently change together
* historical change patterns
* overall repository friction
* visual dependency graphs
* evidence explaining why a module received its score

---

## Problem

As software projects grow, some parts of the codebase become tightly connected to many other parts.

A small change in one file may require changes across many modules and may introduce regressions.

Developers usually discover this manually by:

* searching through the repository
* reading imports
* inspecting Git history
* looking at previous pull requests
* checking which developers modified a file
* remembering previous problems

This information exists, but it is fragmented.

Change Friction Analyzer combines these signals into one system.

---

## Core Concept

The central concept is **Change Friction**.

Change Friction represents how difficult or risky it may be to modify a particular part of a codebase.

A high-friction module may:

* have many dependents
* be highly connected to other modules
* change frequently
* frequently change together with other files
* be modified by many developers
* have a history of problematic changes

A low-friction module may be:

* relatively isolated
* rarely changed
* weakly coupled
* easy to modify without affecting other parts of the system

The score is an engineering heuristic, not a guarantee that a change will fail.

---

# MVP Scope

The first version must be completed within approximately one week.

The MVP should support:

1. GitHub repository input
2. Repository retrieval
3. JavaScript and TypeScript source analysis
4. Git history analysis
5. File-level dependency analysis
6. Change frequency analysis
7. File co-change/coupling analysis
8. Contributor analysis
9. Historical risk indicators
10. Change Friction Score calculation
11. Repository-level dashboard
12. Module/file-level detail pages
13. Interactive dependency graph
14. Historical activity visualization
15. Explanation of the score
16. GitHub OAuth authentication if time permits
17. Production deployment

The MVP should prioritize correctness, clarity, and a strong demo over feature quantity.

---

# Supported Languages

For V1:

* JavaScript
* TypeScript

Do not attempt to support every programming language during the first week.

Future versions may support:

* Python
* Java
* C++
* Go
* Rust

---

# Main User Flow

## Step 1 — Authentication

The user logs in using GitHub OAuth.

## Step 2 — Repository Selection

The user provides or selects a GitHub repository.

Example:

`https://github.com/facebook/react`

## Step 3 — Analysis

The backend retrieves the repository and analyzes:

* source files
* imports
* dependencies
* Git commits
* changed files
* contributors
* co-change patterns

## Step 4 — Processing

The analysis engine calculates:

* dependency impact
* change frequency
* coupling
* contributor distribution
* historical risk
* final Change Friction Score

## Step 5 — Dashboard

The user receives an interactive dashboard.

Example:

```text
Repository: example-project

Overall Change Friction
72 / 100
HIGH

High Friction Modules
1. authentication       91
2. payment              84
3. user service         76
4. orders               64
5. notifications        31
```

## Step 6 — Investigation

The user clicks a module.

The application displays:

* friction score
* score breakdown
* direct dependencies
* dependents
* coupled files
* contributors
* change history
* relevant commits
* historical risk indicators
* dependency graph

---

# Change Friction Score

The score should initially be calculated using a transparent weighted heuristic.

Suggested initial formula:

```text
Friction Score =
    30% Dependency Impact
  + 25% Change Frequency
  + 20% Change Coupling
  + 10% Contributor Complexity
  + 15% Historical Risk
```

All component scores should be normalized to 0–100.

The weights should be configurable in code rather than hardcoded throughout the application.

These weights are initial heuristics and should be documented as such.

---

# Score Components

## 1. Dependency Impact

Measures how much of the codebase may be affected by changing a file/module.

Signals include:

* number of direct dependents
* number of direct dependencies
* number of transitive dependents
* graph centrality

A module with many dependents should have a higher dependency-impact score.

---

## 2. Change Frequency

Measures how often a file/module changes.

Possible signals:

* number of commits touching the file
* number of changes in the last 30/90/180 days
* recency of changes

Frequently modified files should generally have higher friction.

---

## 3. Change Coupling

Measures how often files change together.

Example:

```text
auth.ts
session.ts
user.ts
```

If these files repeatedly appear in the same commits, the system should identify them as strongly coupled.

Example:

```text
auth.ts <-> session.ts
Coupling: 82%
```

The initial implementation may use a simple co-change frequency metric.

---

## 4. Contributor Complexity

Measures how many developers have historically modified a file/module.

Possible signals:

* unique contributors
* contributor concentration
* number of recent contributors

This is not intended to determine individual ownership or employee performance.

It is simply another signal indicating coordination complexity.

---

## 5. Historical Risk

The MVP should derive simple indicators from Git history.

Examples:

* change followed shortly by another corrective change
* revert commits
* repeated modifications to the same area
* high-frequency modifications following previous changes

Do not attempt to build a sophisticated ML prediction model for V1.

---

# AST Analysis

The application should use AST-based parsing for JavaScript and TypeScript.

The parser should identify imports/requires and construct file-level dependency relationships.

Example:

```typescript
import { authenticate } from "./auth";
```

should produce approximately:

```text
profile.ts
    |
    v
auth.ts
```

The system should not execute arbitrary repository code during analysis.

Repositories must be treated as untrusted input.

Do not run:

```text
npm install
npm run build
npm run scripts
```

on arbitrary repositories in the MVP.

Only read source files and Git metadata.

---

# Dependency Graph

The system should construct a graph where:

* nodes = files/modules
* edges = dependencies

Example:

```text
                auth.ts
                   |
        +----------+----------+
        |          |          |
        v          v          v
     user.ts    order.ts   payment.ts
```

The graph should support:

* direct dependencies
* dependents
* transitive relationships
* graph visualization
* highlighting high-friction nodes

---

# Git Analysis

The system should analyze Git history.

For each commit, collect:

* commit SHA
* author
* timestamp
* message
* changed files
* additions
* deletions

Example:

```text
Commit abc123

Author: Alice
Date: 2026-08-15

Message:
Fix OAuth callback

Changed:
auth.ts
session.ts
middleware.ts
```

This information should be stored in PostgreSQL.

---

# Co-Change Analysis

For every commit containing multiple files, record which files changed together.

Example:

```text
Commit A:
auth.ts
session.ts

Commit B:
auth.ts
session.ts

Commit C:
auth.ts
user.ts
```

Then:

```text
auth.ts <-> session.ts
Co-change count: 2
Coupling: high

auth.ts <-> user.ts
Co-change count: 1
Coupling: medium
```

The exact coupling formula can be refined later.

---

# Repository-Level Metrics

The dashboard should display:

* total files
* total analyzed files
* total commits
* contributors
* average friction
* highest friction
* high-friction modules
* dependency count
* strongly coupled file pairs

---

# Module Detail

When a user selects a module/file, show:

```text
Authentication

Friction Score
91 / 100
CRITICAL
```

Score breakdown:

```text
Dependency Impact       94
Change Frequency        81
Coupling                89
Contributor Complexity  62
Historical Risk         91
```

Then show:

### Dependencies

```text
auth.ts
  -> session.ts
  -> user.ts
```

### Dependents

```text
login.ts
profile.ts
payment.ts
orders.ts
admin.ts
```

### Coupled Files

```text
session.ts      82%
middleware.ts   74%
user.ts         69%
```

### Recent History

```text
Aug 15
Fix OAuth callback

Aug 12
Update token validation

Aug 10
Refactor middleware
```

---

# Frontend

Recommended stack:

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* Recharts
* React Flow

The UI should be clean and developer-oriented.

Avoid unnecessary animations and decorative UI.

Important visualizations:

* friction score cards
* ranked module table
* bar charts
* activity timeline
* dependency graph
* coupling matrix
* module detail panel

---

# Backend

Recommended stack:

* Node.js
* Express
* TypeScript
* Prisma
* PostgreSQL

Backend responsibilities:

* authentication
* GitHub integration
* repository retrieval
* analysis orchestration
* AST parsing
* Git analysis
* graph construction
* friction calculation
* database persistence
* API responses

---

# Database

Use PostgreSQL.

Initial entities:

## User

```text
id
githubId
username
email
createdAt
```

## Repository

```text
id
githubId
name
owner
url
defaultBranch
analyzedAt
```

## File

```text
id
repositoryId
path
language
lines
frictionScore
```

## Dependency

```text
id
repositoryId
sourceFileId
targetFileId
dependencyType
```

## Commit

```text
id
repositoryId
sha
message
author
timestamp
```

## FileChange

```text
id
commitId
fileId
additions
deletions
```

## FileCoupling

```text
id
repositoryId
fileAId
fileBId
coChangeCount
couplingScore
```

The schema can be refined during implementation.

---

# API

Initial endpoints:

```text
POST /api/repositories/analyze

GET /api/analyses/:id

GET /api/repositories/:id

GET /api/repositories/:id/modules

GET /api/modules/:id

GET /api/modules/:id/dependencies

GET /api/modules/:id/history

GET /api/modules/:id/coupling
```

API responses should use consistent JSON structures and proper HTTP status codes.

---

# Infrastructure

For the MVP:

Frontend:

```text
Vercel
```

Backend:

```text
Railway or Render
```

Database:

```text
Neon PostgreSQL
```

Source:

```text
GitHub
```

Do not introduce Kubernetes or microservices for V1.

---

# Background Processing

If repository analysis becomes slow, analysis should be separated from the request-response cycle.

Desired future architecture:

```text
API
 |
 v
Create Analysis Job
 |
 v
Worker
 |
 +-- Git analysis
 +-- AST analysis
 +-- Graph analysis
 +-- Friction calculation
 |
 v
PostgreSQL
```

For the first implementation, a synchronous or simple background implementation is acceptable if it is reliable.

Redis/BullMQ should only be introduced if needed.

---

# Security Requirements

Repositories are untrusted input.

Never execute arbitrary repository code.

Do not run package installation scripts.

Do not run build scripts.

Do not execute arbitrary shell commands originating from a repository.

GitHub tokens must never be exposed to the frontend.

Secrets must be stored in environment variables.

Validate repository URLs.

Prevent path traversal when processing repository files.

Limit repository size/file count for the MVP.

---

# AI Feature

AI is optional and must not be responsible for the actual Change Friction calculation.

The core score must be deterministic and explainable.

AI may be used to explain an already calculated result.

Example:

Input:

```text
Friction Score: 91

Dependency Impact: 94
Change Frequency: 81
Coupling: 89
Contributor Complexity: 62
Historical Risk: 91
```

AI output:

```text
Authentication has very high change friction primarily because
many parts of the application depend on it and it frequently
changes together with session and user modules. Its history also
contains several corrective changes.
```

The AI should never invent evidence.

---

# Future Features

These are explicitly OUTSIDE the one-week MVP:

* Python/Java/C++/Go support
* VS Code extension
* Pull request impact prediction
* Architecture rule checking
* Architecture drift detection
* Regression prediction
* ML-based friction prediction
* Slack/Jira integrations
* Team analytics
* enterprise RBAC
* organization-wide repositories
* distributed worker infrastructure
* real-time collaboration

---

# One-Week Development Plan

## Day 1

Project setup:

* frontend
* backend
* PostgreSQL
* Prisma
* GitHub integration
* repository input

## Day 2

Git analysis:

* clone/retrieve repository
* parse Git history
* commits
* changed files
* contributors
* change frequency

## Day 3

Code analysis:

* JavaScript/TypeScript AST
* imports
* dependencies
* dependency graph
* co-change analysis

## Day 4

Friction engine:

* dependency score
* change frequency score
* coupling score
* contributor score
* historical score
* final score

## Day 5

Dashboard:

* repository overview
* friction ranking
* charts
* dependency graph
* module detail page

## Day 6

Polish:

* GitHub OAuth
* error handling
* loading states
* AI explanations
* performance improvements
* security checks

## Day 7

Deployment:

* frontend deployment
* backend deployment
* database deployment
* testing
* README
* architecture diagram
* demo preparation

---

# Important Engineering Principle

The project should never claim:

> "This file will definitely break if you change it."

Instead it should say:

> **"This file has high change friction based on measurable signals from the repository."**

The system is an analytical tool, not a perfect predictor.

---

# Future Product Vision

The long-term product can eventually become a full software-engineering intelligence platform.

Example:

```text
GitHub Repository
        |
        v
Code Understanding
        |
        v
Dependency Graph
        |
        v
Git History
        |
        v
Change Friction
        |
        +------------------+
        |                  |
        v                  v
Architecture         PR Impact
Analysis             Prediction
        |                  |
        +--------+---------+
                 |
                 v
          Engineering
          Intelligence
```

The one-week MVP should focus only on the first part of this vision.
