import { parseUnifiedDiff } from "./parseUnifiedDiff";
import type { ExtractedPatch } from "./patchTypes";

const FENCED_DIFF = /```(?:diff|patch)\s*\n([\s\S]*?)```/gi;

function extracted(raw: string): ExtractedPatch {
  const normalized = raw.trim();
  try {
    return { raw: normalized, parsed: parseUnifiedDiff(normalized) };
  } catch (reason) {
    return { raw: normalized, error: String(reason) };
  }
}

export function extractPatchesFromText(text: string): ExtractedPatch[] {
  const patches: ExtractedPatch[] = [];
  const fencedRanges: Array<[number, number]> = [];
  for (const match of text.matchAll(FENCED_DIFF)) {
    if (match.index === undefined) {
      continue;
    }
    fencedRanges.push([match.index, match.index + match[0].length]);
    patches.push(extracted(match[1]));
  }

  const outsideFences = [...text]
    .map((character, index) =>
      fencedRanges.some(([start, end]) => index >= start && index < end)
        ? " "
        : character,
    )
    .join("");
  const rawStart = outsideFences.search(
    /(?:^|\n)(?:diff --git |\-\-\- [^\n]+\n\+\+\+ [^\n]+\n@@ )/,
  );
  if (rawStart >= 0) {
    const raw = outsideFences.slice(rawStart).trim();
    if (raw) {
      patches.push(extracted(raw));
    }
  }
  return patches;
}
