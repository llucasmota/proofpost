import test from 'node:test';
import assert from 'node:assert/strict';
import { RagService } from '../src/services/ragService.ts';

test('RagService is best-effort', async (t) => {
  await t.test('returns empty context when RAG_ENABLED=false', async () => {
    RagService.reset();
    const prev = process.env.RAG_ENABLED;
    process.env.RAG_ENABLED = 'false';
    try {
      assert.equal(await new RagService().retrieveContext('anything', 'flutter_dart'), '');
    } finally {
      process.env.RAG_ENABLED = prev;
      RagService.reset();
    }
  });

  await t.test('returns empty context instead of throwing when Pinecone is not configured', async () => {
    RagService.reset();
    const prevKey = process.env.PINECONE_API_KEY;
    delete process.env.PINECONE_API_KEY;
    try {
      assert.equal(await new RagService().retrieveContext('anything'), '');
    } finally {
      if (prevKey !== undefined) process.env.PINECONE_API_KEY = prevKey;
      RagService.reset();
    }
  });
});
