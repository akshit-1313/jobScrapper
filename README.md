# AI Job Discovery Platform

A private, AI-powered job discovery and matching platform designed to automate the process of finding highly relevant jobs without a mock user experience.

## Phase 1 Architecture
This repository represents the Phase 1 implementation (Foundation).

### Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4, Lucide Icons
- **Database**: Supabase PostgreSQL with `pgvector`
- **Auth**: Supabase Auth (SSR configured)

---

## Local Development Setup

### 1. Environment Variables
Create a `.env.local` file in the root based on `.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### 2. Database Schema
Ensure all local or remote Supabase instances are updated with the migrations in `supabase/migrations/`:
1. `001_enable_extensions.sql` - Enables vectors and triggers
2. `002_profiles_and_resumes.sql` - Core candidate entities
3. `003_jobs_and_sources.sql` - Core job entities
4. `004_matching_and_applications.sql` - App pipeline tracking
5. `005_search_and_crawl_tracking.sql` - Sourcing telemetry
6. `006_rls_policies.sql` - Secure row-level access rules
7. `007_indexes.sql` - Optimization
8. `008_seed_shared_data.sql` - 25 mock jobs for dashboard dev

> **Note**: These files must be run strictly in this order to establish the necessary dependencies (extensions -> tables -> FKs -> RLS -> indexes).

### 3. Run the App
```bash
npm install
npm run dev
```

Navigate to `http://localhost:3000` to access the login page. Since real users don't exist yet, simply enter any email and click "Sign In / Register". A user will be securely provisioned out of the box.

---

## Deployment (Vercel)
This project is configured out of the box for immediate deployment to Vercel:

1. Push this repository to GitHub.
2. Import the project into Vercel.
3. Supply the Production environment variables in `Settings -> Environment Variables`.
4. Deploy.

The middleware protects `/dashboard/*` endpoints by ensuring active session cookies via Supabase SSR, ensuring zero unauthenticated leaks of any private data on the edge.
