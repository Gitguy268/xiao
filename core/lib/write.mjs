// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The sticky note's rewrite tools. The tools and their wording are textarea's
// (lib/writing-tools.js, MIT), so a note rewrites the same in either app.
const NOTE_LIMIT = 24_000;

export const WRITE_TOOLS = [
  { id: 'improve', label: 'Improve wording', instruction: 'Rewrite the text so it reads better: smoother phrasing, clearer sentences, the same meaning, and the same language as the original.' },
  { id: 'shorten', label: 'Shorten', instruction: 'Shorten the text, keeping every fact and dropping only what is redundant. Keep the same language as the original.' },
  { id: 'summarize', label: 'Summarize', instruction: 'Summarize the text in a few sentences that make sense on their own. Use the same language as the original.' },
  { id: 'fix', label: 'Fix spelling & grammar', instruction: 'Fix every spelling and grammar mistake. Change nothing else: the wording is the author’s.' },
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
