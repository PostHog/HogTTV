// Injected into meet.google.com. Adds a Slack emoji picker button next to the
// chat input and renders :emoji_name: shortcodes in chat messages as images.

const BTN_ID = 'slack-emoji-picker-btn';
const PICKER_ID = 'slack-emoji-picker';
const PROCESSED_ATTR = 'data-slack-emoji-rendered';

// Google Meet changes its DOM frequently; try multiple selectors.
const INPUT_SELECTORS = [
  'textarea[aria-label="Send a message"]',
  'textarea[aria-label="Send a message to everyone"]',
  '[contenteditable][aria-label="Send a message"]',
  '[contenteditable][aria-label="Send a message to everyone"]',
  'textarea[data-is-composing]',
];

let emojiMap = {};

async function init() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_CACHED_EMOJIS' });
  emojiMap = res.emojis || {};
  watchForChatInput();
}

// ── DOM observation ──────────────────────────────────────────────────────────

function watchForChatInput() {
  const observer = new MutationObserver(() => {
    maybeInjectButton();
    maybeRenderEmojis();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Run once immediately in case chat is already open.
  maybeInjectButton();
}

function findChatInput() {
  for (const sel of INPUT_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// ── Button injection ─────────────────────────────────────────────────────────

function maybeInjectButton() {
  if (document.getElementById(BTN_ID)) return;
  const input = findChatInput();
  if (!input) return;

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.title = 'Slack custom emojis';
  btn.textContent = '🏷';
  Object.assign(btn.style, {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    padding: '4px 6px',
    borderRadius: '4px',
    opacity: '0.65',
    lineHeight: '1',
    verticalAlign: 'middle',
    flexShrink: '0',
  });
  btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
  btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.65'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePicker(input, btn);
  });

  // Insert immediately after the input inside its parent flex row.
  input.parentElement.insertBefore(btn, input.nextSibling);
}

// ── Picker overlay ───────────────────────────────────────────────────────────

function togglePicker(input, anchor) {
  const existing = document.getElementById(PICKER_ID);
  if (existing) {
    existing.remove();
    return;
  }
  showPicker(input, anchor);
}

function showPicker(input, anchor) {
  const picker = document.createElement('div');
  picker.id = PICKER_ID;

  // Position above the anchor button.
  const rect = anchor.getBoundingClientRect();
  Object.assign(picker.style, {
    position: 'fixed',
    bottom: `${window.innerHeight - rect.top + 8}px`,
    right: `${window.innerWidth - rect.right - 4}px`,
    width: '320px',
    maxHeight: '380px',
    display: 'flex',
    flexDirection: 'column',
    background: '#1a1d21',
    border: '1px solid #4a4f5b',
    borderRadius: '8px',
    padding: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    zIndex: '2147483647',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  });

  // Search box
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search emojis…';
  Object.assign(search.style, {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 10px',
    marginBottom: '8px',
    background: '#222529',
    border: '1px solid #4a4f5b',
    borderRadius: '6px',
    color: '#d1d2d3',
    fontSize: '13px',
    outline: 'none',
    flexShrink: '0',
  });

  // Emoji grid
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: '2px',
    overflowY: 'auto',
    flex: '1',
  });

  function renderGrid(filter) {
    grid.innerHTML = '';
    const entries = Object.entries(emojiMap).filter(
      ([name]) => !filter || name.includes(filter.toLowerCase())
    );

    if (entries.length === 0) {
      const msg = document.createElement('p');
      Object.assign(msg.style, {
        gridColumn: '1 / -1',
        color: '#9aa0ac',
        fontSize: '13px',
        textAlign: 'center',
        margin: '16px 0',
      });
      msg.textContent =
        Object.keys(emojiMap).length === 0
          ? 'No emojis synced yet. Open the extension popup to add your Slack token.'
          : 'No matching emojis.';
      grid.appendChild(msg);
      return;
    }

    // Render up to 300 results to avoid DOM bloat.
    for (const [name, url] of entries.slice(0, 300)) {
      const cell = document.createElement('button');
      cell.title = `:${name}:`;
      Object.assign(cell.style, {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      });
      cell.addEventListener('mouseenter', () => (cell.style.background = '#4a4f5b'));
      cell.addEventListener('mouseleave', () => (cell.style.background = 'none'));

      const img = document.createElement('img');
      img.src = url;
      img.alt = `:${name}:`;
      img.loading = 'lazy';
      Object.assign(img.style, {
        width: '26px',
        height: '26px',
        objectFit: 'contain',
        display: 'block',
      });

      cell.appendChild(img);
      cell.addEventListener('click', () => {
        insertIntoInput(input, `:${name}: `);
        picker.remove();
        input.focus();
      });
      grid.appendChild(cell);
    }
  }

  renderGrid('');
  search.addEventListener('input', () => renderGrid(search.value));

  picker.appendChild(search);
  picker.appendChild(grid);
  document.body.appendChild(picker);
  search.focus();

  // Close when clicking outside.
  function onOutsideClick(e) {
    if (!picker.contains(e.target) && e.target.id !== BTN_ID) {
      picker.remove();
      document.removeEventListener('click', onOutsideClick, true);
    }
  }
  // Delay to avoid the button's own click immediately closing the picker.
  setTimeout(() => document.addEventListener('click', onOutsideClick, true), 0);
}

// ── Inserting emoji text into Meet's chat input ──────────────────────────────

function insertIntoInput(el, text) {
  el.focus();
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const { selectionStart: s, selectionEnd: e } = el;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    el.selectionStart = el.selectionEnd = s + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
  }
}

// ── Rendering :emoji_name: shortcodes in received messages ───────────────────

function maybeRenderEmojis() {
  if (Object.keys(emojiMap).length === 0) return;

  // Find message text nodes anywhere below the chat panel.
  const panel = findChatPanel();
  if (!panel) return;

  // Walk all text nodes that contain a colon (fast pre-filter).
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip our own picker and already-processed parents.
      if (node.parentElement.closest(`#${PICKER_ID}`)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement.closest(`[${PROCESSED_ATTR}]`)) return NodeFilter.FILTER_REJECT;
      if (/:[\w-]+:/.test(node.textContent)) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    expandEmojiShortcodes(node);
  }
}

function findChatPanel() {
  return (
    document.querySelector('[aria-label*="Chat with everyone"]') ||
    document.querySelector('[aria-label="Chat"]') ||
    document.querySelector('[data-panel-type="chat"]') ||
    // Fallback: any scrollable aside that contains a chat input sibling.
    (() => {
      const input = findChatInput();
      return input ? input.closest('[role="complementary"]') : null;
    })()
  );
}

function expandEmojiShortcodes(textNode) {
  const text = textNode.textContent;
  const pattern = /:([a-z0-9_-]+):/g;
  let match;
  let lastIndex = 0;
  const fragments = [];

  while ((match = pattern.exec(text)) !== null) {
    const url = emojiMap[match[1]];
    if (!url) continue;

    if (match.index > lastIndex) {
      fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const img = document.createElement('img');
    img.src = url;
    img.alt = match[0];
    img.title = match[0];
    Object.assign(img.style, {
      width: '20px',
      height: '20px',
      objectFit: 'contain',
      verticalAlign: 'middle',
      margin: '0 1px',
    });
    fragments.push(img);
    lastIndex = match.index + match[0].length;
  }

  if (fragments.length === 0) return;
  if (lastIndex < text.length) {
    fragments.push(document.createTextNode(text.slice(lastIndex)));
  }

  const parent = textNode.parentElement;
  // Mark the parent so the MutationObserver doesn't reprocess it.
  parent.setAttribute(PROCESSED_ATTR, '');
  for (const frag of fragments) parent.insertBefore(frag, textNode);
  parent.removeChild(textNode);
}

init();
