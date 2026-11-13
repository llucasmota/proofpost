import type { ILlmService } from '../../services/llmService.ts';
import { prompts } from '../../config.ts';
import { createSpecialistNode } from './specialistNode.ts';

export const createFlutterNode = (llm: ILlmService) => createSpecialistNode(llm, prompts.flutterNode, 'Flutter Specialist');
