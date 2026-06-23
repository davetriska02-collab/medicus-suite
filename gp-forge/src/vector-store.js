// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — minimal in-process vector store for local-guidance RAG. JSONL-persisted so the corpus
// survives restarts; brute-force cosine search (ample for a practice-scale guidance corpus, and it
// keeps the appliance dependency-free / air-gap-friendly).

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export class VectorStore {
  constructor({ path } = {}) {
    this.path = path || null;
    this.items = [];
    if (this.path && existsSync(this.path)) {
      for (const line of readFileSync(this.path, 'utf8').split('\n').filter(Boolean)) {
        try {
          this.items.push(JSON.parse(line));
        } catch {
          /* skip corrupt line */
        }
      }
    }
  }

  add({ source, text, embedding }) {
    const item = { id: this.items.length + 1, source: String(source || 'unknown'), text: String(text || ''), embedding };
    this.items.push(item);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, JSON.stringify(item) + '\n');
    }
    return item;
  }

  search(queryVec, k = 5) {
    return this.items
      .map((it) => ({ id: it.id, source: it.source, text: it.text, score: cosine(queryVec, it.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  get size() {
    return this.items.length;
  }
}
