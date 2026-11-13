import type { ILlmService } from '../../services/llmService.ts';
import { prompts } from '../../config.ts';
import { createSpecialistNode } from './specialistNode.ts';

export const createAiNode = (llm: ILlmService) => createSpecialistNode(llm, prompts.aiEngineer, 'AI Engineering Specialist');
