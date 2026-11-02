// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The sticky note's rewrite tools, after textarea's (lib/writing-tools.js, MIT).
// "fix" is reworded: told to change nothing else, MiniCPM5 hands the text back.
const NOTE_LIMIT = 24_000;

export const WRITE_TOOLS = [
  { id: 'improve', label: 'Improve wording', instruction: 'Rewrite the text so it reads better: smoother phrasing, clearer sentences, the same meaning, and the same language as the original.' },
  { id: 'shorten', label: 'Shorten', instruction: 'Shorten the text, keeping every fact and dropping only what is redundant. Keep the same language as the original.' },
  { id: 'summarize', label: 'Summarize', instruction: 'Summarize the text in a few sentences that make sense on their own. Use the same language as the original.' },
  { id: 'fix', label: 'Fix spelling & grammar', instruction: 'Rewrite the text with correct spelling and grammar. Keep the same meaning, the same language and as many of the same words as you can.' },
  { id: 'casual', label: 'Make more casual', instruction: 'Rewrite the text in a casual, conversational tone, keeping its meaning. Use the same language as the original.' },
];

export function rewriteMessages(toolId, text) {
  const tool = WRITE_TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error(`unknown writing tool: ${toolId}`);
  return [
    { role: 'system', content: `${tool.instruction}\n\nReply with the finished text only: no preamble, no explanation, and no quotation marks around it.` },
    { role: 'user', content: `Text:\n\n${String(text ?? '').slice(0, NOTE_LIMIT)}` },
  ];
}
