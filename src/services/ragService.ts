import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

/**
 * Best-effort retrieval from Pinecone.
 *
 * RAG is supplementary context: if it is disabled, misconfigured, or fails (e.g. embedding
 * dimension does not match the index), the post is still generated without it. After the
 * first failure RAG is disabled for the rest of the process so every node does not repeat
 * the same failing call.
 *
 * Set RAG_ENABLED=false in .env to skip it entirely.
 */
export class RagService {
  private static disabledReason: string | null = null;
  private vectorStore: PineconeStore | null = null;

  /** Test/diagnostic hook. */
  static reset() {
    RagService.disabledReason = null;
  }

  private static disable(reason: string) {
    if (!RagService.disabledReason) {
      console.warn(`[RAG] ⚠️ Disabled for this run: ${reason}. Continuing without RAG context.`);
    }
    RagService.disabledReason = reason;
  }

  private async init() {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!);
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY!,
      model: "models/gemini-embedding-001",
    });

    this.vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      namespace: "posts-content",
    });
  }

  async retrieveContext(query: string, filterNiche?: string): Promise<string> {
    if (process.env.RAG_ENABLED === 'false') {
      RagService.disable('RAG_ENABLED=false');
    } else if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
      RagService.disable('PINECONE_API_KEY / PINECONE_INDEX_NAME not set');
    }
    if (RagService.disabledReason) return "";

    try {
      if (!this.vectorStore) await this.init();

      console.log(`[RAG] Searching Pinecone context for: "${query}"...`);
      const filter = filterNiche ? { niche: filterNiche } : undefined;
      const results = await this.vectorStore!.similaritySearch(query, 4, filter);

      if (results.length === 0) return "";
      return results.map(doc => `[Source: ${doc.metadata?.source || 'Unknown'}]\n${doc.pageContent}`).join('\n\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      RagService.disable(message);
      return "";
    }
  }
}
