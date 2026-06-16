/**
 * Content fingerprinting and diversity sorting.
 * Pure algorithm — no filesystem access, no external dependencies.
 */

function contentFingerprint(text: string): Map<string, number> {
  const stopWords = new Set([
    "the", "a", "an", "is", "was", "are", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off", "over",
    "under", "again", "further", "then", "once", "this", "that", "these",
    "those", "not", "no", "nor", "but", "or", "and", "if", "while",
    "because", "until", "so", "about", "up", "it", "its", "just", "also",
    "very", "too", "here", "there", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "only", "own",
    "same", "than", "too", "very", "well", "back", "still", "yet",
    "one", "two", "new", "like", "use", "way", "get", "make", "know",
    "take", "see", "come", "think", "look", "want", "give", "tell",
    "work", "call", "try", "ask", "need", "feel", "become", "leave",
    "put", "mean", "keep", "let", "begin", "seem", "help", "turn",
  ]);
  const fp = new Map<string, number>();
  const words = text.toLowerCase().split(/[^a-zA-Z0-9一-鿿]+/g);
  for (const w of words) {
    if (w.length > 2 && !stopWords.has(w)) {
      fp.set(w, (fp.get(w) || 0) + 1);
    }
  }
  return fp;
}

function fingerprintSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  const allKeys = new Set([...a.keys(), ...b.keys()]);
  if (allKeys.size === 0) return 1;

  let intersection = 0;
  let union = 0;
  for (const key of allKeys) {
    const va = a.get(key) || 0;
    const vb = b.get(key) || 0;
    intersection += Math.min(va, vb);
    union += Math.max(va, vb);
  }
  return intersection / union;
}

/**
 * Diversity sort: reorder items so the most unique ones come first.
 * Greedy algorithm — pick the item most different from all already-selected.
 * Keeps ALL items, just changes order. Designed for recall results
 * where the LLM can only see the first few but shouldn't miss variety.
 */
export function diversitySort<T>(
  items: T[],
  extractor: (item: T) => string,
): T[] {
  if (items.length <= 1) return items;

  const fingerprints = items.map((item) => contentFingerprint(extractor(item)));
  const selected = new Set<number>();
  const result: T[] = [];

  // Pick the first one: most unique (lowest average similarity to all others)
  let firstIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < items.length; i++) {
    let avgSim = 0;
    for (let j = 0; j < items.length; j++) {
      if (i !== j) avgSim += fingerprintSimilarity(fingerprints[i], fingerprints[j]);
    }
    avgSim /= items.length - 1;
    if (avgSim < bestScore) {
      bestScore = avgSim;
      firstIdx = i;
    }
  }
  selected.add(firstIdx);
  result.push(items[firstIdx]);

  // Greedy pick: next = item with lowest max similarity to any selected
  while (result.length < items.length) {
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < items.length; i++) {
      if (selected.has(i)) continue;
      // max similarity to any already-selected item
      let maxSim = 0;
      for (const s of selected) {
        const sim = fingerprintSimilarity(fingerprints[i], fingerprints[s]);
        if (sim > maxSim) maxSim = sim;
      }
      if (maxSim < bestScore) {
        bestScore = maxSim;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    selected.add(bestIdx);
    result.push(items[bestIdx]);
  }

  // Append any remaining (theoretically unreachable)
  for (let i = 0; i < items.length; i++) {
    if (!selected.has(i)) result.push(items[i]);
  }

  return result;
}
