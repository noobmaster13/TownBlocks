// Central place for every DOM element the game needs repeated access
// to. Grabbed once, at module load — safe because ES module scripts
// execute after the HTML has finished parsing (same timing the old
// single script had, sitting at the bottom of <body>).

export const boardEl = document.getElementById('board');
export const statusEl = document.getElementById('status');
export const scoreValueEl = document.getElementById('score-value');
export const currentPreviewEl = document.getElementById('current-preview');
export const nextPreview1El = document.getElementById('next-preview-1');
export const nextPreview2El = document.getElementById('next-preview-2');
export const resetBtn = document.getElementById('reset-btn');
