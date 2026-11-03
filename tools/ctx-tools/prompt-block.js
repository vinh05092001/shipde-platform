/**
 * Generate a concise prompt block listing available agent tools from toolkit.json.
 * Kept under 25 lines so prompts can embed it directly without token bloat.
 */
const fs = require('fs');
const path = require('path');

function summarize(text) {
  if (!text) return '';
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence;
}

function generatePromptBlock() {
  const toolkitPath = path.join(__dirname, 'toolkit.json');
  const raw = fs.readFileSync(toolkitPath, 'utf8');
  const { tools = [] } = JSON.parse(raw);

  const lines = ['CÔNG CỤ CÓ SẴN:'];
  for (const tool of tools) {
    const summary = summarize(tool.when_to_use);
    lines.push(`- ${tool.id} (${tool.version || 'UNKNOWN'}, ${tool.type}): ${summary}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  process.stdout.write(generatePromptBlock() + '\n');
}

module.exports = { generatePromptBlock };
