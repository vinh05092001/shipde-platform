'use strict';

// Shared protocol check only. Transport budgets and failure policy stay with
// each producer; no response content escapes this function.
function completionSummary(response, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {}
  const choice = parsed?.choices?.[0];
  const message = choice?.message;
  const eventStream = /text\/event-stream/i.test(response.headers?.get('content-type') || '');
  const unexpectedTool =
    choice?.finish_reason === 'tool_calls' || message?.tool_calls !== undefined;
  const valid = Boolean(
    response.ok &&
    !eventStream &&
    parsed &&
    !Object.prototype.hasOwnProperty.call(parsed, 'error') &&
    Array.isArray(parsed.choices) &&
    choice &&
    typeof choice === 'object' &&
    message?.role === 'assistant' &&
    typeof message.content === 'string' &&
    !unexpectedTool &&
    (choice.finish_reason === 'length' ||
      (choice.finish_reason === 'stop' && message.content.trim().length > 0))
  );
  return {
    valid,
    unexpectedTool,
    ...(valid
      ? {
          finishReason: choice.finish_reason,
          ...(typeof parsed.model === 'string' && /^[\w./:-]{1,200}$/.test(parsed.model)
            ? { model: parsed.model }
            : {}),
        }
      : {}),
  };
}

module.exports = { completionSummary };
