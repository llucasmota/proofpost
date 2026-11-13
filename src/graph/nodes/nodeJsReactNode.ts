import type { ILlmService } from '../../services/llmService.ts';
import { prompts } from '../../config.ts';
import { createSpecialistNode } from './specialistNode.ts';

export const createNodeReactNode = (llm: ILlmService) => createSpecialistNode(llm, prompts.nodeJsReact, 'Node/React Specialist');
