export type PostNiche = 'flutter_dart' | 'node_react' | 'ai_engineering';

/** Preferred domains for the short complementary search that confirms versions/dates. */
export const OFFICIAL_DOMAINS: Record<PostNiche, string[]> = {
  flutter_dart: ['flutter.dev', 'docs.flutter.dev', 'dart.dev', 'pub.dev', 'firebase.google.com', 'github.com', 'medium.com/flutter'],
  node_react: ['nodejs.org', 'react.dev', 'nextjs.org', 'typescriptlang.org', 'devblogs.microsoft.com', 'vite.dev', 'github.com'],
  ai_engineering: [
    'langchain.com', 'docs.langchain.com', 'ai.google.dev', 'platform.openai.com', 'docs.anthropic.com',
    'openrouter.ai', 'modelcontextprotocol.io', 'google.github.io', 'github.com',
  ],
};

/** Social networks and video sites: posts there are opinions, not sources. Excluded from every web search. */
export const SOCIAL_DOMAINS: string[] = [
  'linkedin.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'threads.net', 'tiktok.com',
  'youtube.com', 'reddit.com', 'pinterest.com', 'bsky.app',
];
