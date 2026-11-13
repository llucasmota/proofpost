import type { Idea } from '../discovery/rankIdeas.ts';
import type { PostType } from '../cli/parseArgs.ts';
import { slugify } from '../graph/nodes/imageExtractorNode.ts';
import type { PostRunInput } from './runPost.ts';

const MAX_SLUG = 20;

export function ideaToRunInput(idea: Idea, postTypeOverride?: PostType): PostRunInput {
  const postType = postTypeOverride ?? idea.postType;
  // Ideas are displayed in pt-BR, but posts are written in English: research and write from topicEn.
  const topic = idea.topicEn?.trim() || idea.title;
  return {
    instruction: `Write ${postType === 'quick' ? 'a short' : 'an in-depth'} LinkedIn post about: ${topic}. Angle: ${idea.angle}. Write the post in US English.`,
    userContext: [],
    urls: idea.studyLinks.map((l) => l.url),
    postType,
    niche: idea.niche,
    slug: slugify(idea.title).slice(0, MAX_SLUG).replace(/-+$/, ''),
    searchQuery: topic,
  };
}
