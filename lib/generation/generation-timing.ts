const STORAGE_KEY = 'openmaic:generation-page-timings:v2';
const MAX_SAMPLES = 40;

export interface GenerationTimingSignature {
  llmModel: string;
  ttsProvider: string;
  ttsModel: string;
}

function signatureKey(signature: GenerationTimingSignature): string {
  return [signature.llmModel, signature.ttsProvider, signature.ttsModel]
    .map((part) => part || 'unknown')
    .join('|');
}

function readProfiles(): Record<string, number[]> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, values]) => [
        key,
        Array.isArray(values)
          ? values.filter((value): value is number => typeof value === 'number' && value > 0)
          : [],
      ]),
    );
  } catch {
    return {};
  }
}

/** Store only aggregate page duration, never document text or course metadata. */
export function recordPageGenerationDuration(
  durationMs: number,
  signature: GenerationTimingSignature,
): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || typeof window === 'undefined') return;
  const profiles = readProfiles();
  const key = signatureKey(signature);
  profiles[key] = [...(profiles[key] || []), Math.round(durationMs)].slice(-MAX_SAMPLES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Storage may be disabled or full; timing is best-effort.
  }
}

export function getHistoricalAveragePageDuration(
  signature: GenerationTimingSignature,
): number | null {
  const samples = readProfiles()[signatureKey(signature)] || [];
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
}
