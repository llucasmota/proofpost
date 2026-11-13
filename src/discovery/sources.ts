import type { PostNiche } from '../research/officialDomains.ts';

const gh = (repo: string) => `https://github.com/${repo}/releases.atom`;

/**
 * Technologies the author follows (confirmed 2026-11-13), grouped by niche, and the official
 * feeds read without any LLM. Every feed below was checked to answer 200 with XML.
 */
export const WATCHED: Record<PostNiche, { techs: string[]; feeds: string[] }> = {
  flutter_dart: {
    techs: ['Flutter', 'Dart', 'Firebase FlutterFire', 'Riverpod', 'Bloc'],
    feeds: [
      'https://medium.com/feed/flutter',
      'https://medium.com/feed/dartlang',
      gh('flutter/flutter'), gh('dart-lang/sdk'), gh('firebase/flutterfire'), gh('rrousselGit/riverpod'), gh('felangel/bloc'),
    ],
  },
  node_react: {
    techs: ['Node.js', 'React', 'Next.js', 'TypeScript', 'Vite'],
    feeds: [
      'https://nodejs.org/en/feed/blog.xml',
      'https://react.dev/rss.xml',
      'https://nextjs.org/feed.xml',
      'https://devblogs.microsoft.com/typescript/feed/',
      gh('vitejs/vite'),
    ],
  },
  ai_engineering: {
    techs: ['LangGraph JS', 'LangChain', 'Gemini API', 'OpenAI API', 'Anthropic API', 'OpenRouter', 'Model Context Protocol', 'Google ADK', 'LiteRT'],
    feeds: [
      gh('langchain-ai/langgraphjs'), gh('langchain-ai/langchainjs'), gh('modelcontextprotocol/modelcontextprotocol'),
      gh('google/adk-python'), gh('google-ai-edge/LiteRT'),
    ],
  },
};
