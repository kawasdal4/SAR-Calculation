import { NextResponse } from 'next/server';
import { SAR_CAPABILITY_REGISTRY, summarizeRegistry } from '@/lib/sar/capabilityRegistry';

/**
 * GET /api/capabilities — metadata SAR Capability Registry (JSON murni:
 * fungsi validateInput/execute dibuang saat serialisasi).
 * Dipakai audit, test, dan nanti oleh AI tool routing (PHASE 3+).
 */
export async function GET() {
  const capabilities = SAR_CAPABILITY_REGISTRY.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    version: c.version,
    status: c.status,
    executionMode: c.executionMode,
    implementation: c.implementation,
    inputSchema: c.inputSchema,
    outputSchema: c.outputSchema,
    requiresConfirmation: c.requiresConfirmation,
    dependencies: c.dependencies ?? [],
    notes: c.notes ?? null,
    // execute/validateInput sengaja tidak diekspos lewat HTTP.
    executable: typeof c.execute === 'function',
  }));
  return NextResponse.json({ ok: true, summary: summarizeRegistry(), capabilities });
}
