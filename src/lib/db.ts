/**
 * Database client with graceful fallback for serverless environments.
 *
 * In sandbox/local dev: uses Prisma + SQLite (file:./db/custom.db).
 * In Vercel/production WITHOUT DATABASE_URL: uses in-memory store
 *   (Save/Open Case works during the session but doesn't persist).
 * In Vercel/production WITH DATABASE_URL (Postgres/Neon/Turso): uses Prisma.
 *
 * To enable persistent storage on Vercel:
 *   1. Create a Vercel Postgres database (free hobby tier)
 *   2. Set DATABASE_URL env var in Vercel project settings
 *   3. Switch prisma datasource provider from "sqlite" to "postgresql"
 *   4. Run `prisma db push`
 */

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Check if we have a usable DATABASE_URL
const hasDatabaseUrl = !!process.env.DATABASE_URL

// In Vercel production, SQLite file paths don't work (read-only filesystem).
// We detect this by checking if DATABASE_URL is a file: URL.
const isSqliteFileUrl =
  hasDatabaseUrl && process.env.DATABASE_URL!.startsWith('file:')

const isVercelProduction =
  process.env.VERCEL === '1' && process.env.NODE_ENV === 'production'

// Use Prisma only if DATABASE_URL is set AND it's not a SQLite file path
// (file: paths don't work on Vercel's read-only filesystem).
export const usePrisma = hasDatabaseUrl && (!isSqliteFileUrl || !isVercelProduction)

export const db = usePrisma
  ? (globalForPrisma.prisma ?? new PrismaClient({ log: ['error', 'warn'] }))
  : null

if (usePrisma && process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db as PrismaClient
}

// In-memory fallback store (used when Prisma is not available)
interface InMemoryCase {
  id: string
  title: string
  caseNumber: string | null
  searchObject: string | null
  phase: string
  state: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

const inMemoryStore: InMemoryCase[] = []

export const inMemoryDb = {
  case: {
    findMany: async (opts?: {
      orderBy?: { updatedAt?: 'desc' | 'asc' }
      select?: Record<string, boolean>
    }) => {
      let cases = [...inMemoryStore]
      if (opts?.orderBy?.updatedAt === 'desc') {
        cases.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      }
      // Apply select projection
      if (opts?.select) {
        return cases.map((c) => {
          const projected: Record<string, unknown> = {}
          for (const [key, include] of Object.entries(opts.select!)) {
            if (include) projected[key] = c[key as keyof InMemoryCase]
          }
          return projected
        })
      }
      return cases
    },
    findUnique: async (opts: { where: { id: string } }) => {
      return inMemoryStore.find((c) => c.id === opts.where.id) ?? null
    },
    create: async (opts: { data: Omit<InMemoryCase, 'id' | 'createdAt' | 'updatedAt'> }) => {
      const now = new Date()
      const created: InMemoryCase = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        ...opts.data,
        createdAt: now,
        updatedAt: now,
      }
      inMemoryStore.push(created)
      return created
    },
    update: async (opts: { where: { id: string }; data: Partial<InMemoryCase> }) => {
      const idx = inMemoryStore.findIndex((c) => c.id === opts.where.id)
      if (idx === -1) throw new Error('Case not found')
      inMemoryStore[idx] = {
        ...inMemoryStore[idx],
        ...opts.data,
        updatedAt: new Date(),
      }
      return inMemoryStore[idx]
    },
    delete: async (opts: { where: { id: string } }) => {
      const idx = inMemoryStore.findIndex((c) => c.id === opts.where.id)
      if (idx === -1) throw new Error('Case not found')
      inMemoryStore.splice(idx, 1)
      return { ok: true }
    },
  },
}
