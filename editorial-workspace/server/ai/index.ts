// AI provider registry. The MVP ships with no provider: the workspace is a complete
// manuscript editor without one. To add a provider, implement EditorialAssistant
// (see ./types.ts) and return it from getAssistant(); route its AISuggestions through
// createComment() with role "ai" so they are stored as suggestions, never applied.

import type { EditorialAssistant } from './types.ts';

const notConfigured = async (): Promise<never> => {
  throw new Error('No AI editor is configured. The workspace works fully without one.');
};

export const noAssistant: EditorialAssistant = {
  name: 'none',
  available: false,
  reviewPassage: notConfigured,
  suggestRewrite: notConfigured,
  checkContinuity: notConfigured,
  compareScenes: notConfigured,
};

export function getAssistant(): EditorialAssistant {
  return noAssistant;
}
