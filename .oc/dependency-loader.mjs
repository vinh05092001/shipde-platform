import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const thirdParty = createRequire(
  'C:/Users/gumac/AI/shipde-platform/.worktrees/p-task-ai-161/package.json'
);
const dependencies = new Map(
  ['@typescript-eslint/parser', 'prettier'].map((specifier) => [
    specifier,
    pathToFileURL(thirdParty.resolve(specifier)).href,
  ])
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (dependencies.has(specifier))
      return { url: dependencies.get(specifier), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
