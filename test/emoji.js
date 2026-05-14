'use strict';
// Tests for expandEmojiShortcodes in content.js.
// Exit 0 = all pass, non-zero = failure.
// Use with bisect: git bisect run node test/emoji.js

const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');

const { window } = new JSDOM('<!DOCTYPE html><body></body>');
const { document, MutationObserver, NodeFilter } = window;

// Stub the chrome extension API so content.js loads without errors.
const chrome = {
  runtime: { sendMessage: () => Promise.resolve({ emojis: {} }) },
};

const sandbox = vm.createContext({
  document,
  MutationObserver,
  NodeFilter,
  chrome,
  console,
  setTimeout: () => {},
});

vm.runInContext(fs.readFileSync('./content.js', 'utf8'), sandbox);

// Override emojiMap with test fixtures.
// Requires `var emojiMap` (not let/const) in content.js so the vm sandbox exposes it.
sandbox.emojiMap = { thumbsup: 'https://example.com/thumbsup.png' };

function expand(text) {
  const container = document.createElement('div');
  const node = document.createTextNode(text);
  container.appendChild(node);
  sandbox.expandEmojiShortcodes(node);
  return Array.from(container.childNodes)
    .map(n => (n.nodeName === 'IMG' ? '[img]' : n.textContent))
    .join('');
}

let failed = false;
function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}: got "${actual}", expected "${expected}"`);
    failed = true;
  }
}

// Lone emoji — the regression introduced by the fragments.length < 2 guard.
check('lone emoji renders',          expand(':thumbsup:'),          '[img]');
// Mixed messages must still work.
check('leading text renders',        expand('hi :thumbsup:'),       'hi [img]');
check('trailing text renders',       expand(':thumbsup: nice'),     '[img] nice');
check('surrounded text renders',     expand('a :thumbsup: b'),      'a [img] b');
// Unknown emoji must pass through unchanged.
check('unknown emoji unchanged',     expand(':unknown:'),            ':unknown:');

process.exit(failed ? 1 : 0);
