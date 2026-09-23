import { WRAPPER_MARKER } from './opencode-types.js';

/** Generate the exact project-local OpenCode V2 plugin loader. */
export function generateWrapperContent(fileUrl: string): string {
  return `${WRAPPER_MARKER}\nexport { default } from "${fileUrl}";\n`;
}
