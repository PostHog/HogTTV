// Injected into meet.google.com. Adds a Slack emoji picker button next to the
// chat input and renders :emoji_name: shortcodes in chat messages as images.

const BTN_ID = 'slack-emoji-picker-btn';
const PICKER_ID = 'slack-emoji-picker';
const AUTOCOMPLETE_ID = 'slack-emoji-autocomplete';
const AUTOCOMPLETE_BATCH = 50; // render this many rows at a time; more load on scroll

// Google Meet changes its DOM frequently; try multiple selectors.
const INPUT_SELECTORS = [
  'textarea[aria-label="Send a message"]',
  'textarea[aria-label="Send a message to everyone"]',
  '[contenteditable][aria-label="Send a message"]',
  '[contenteditable][aria-label="Send a message to everyone"]',
  'textarea[data-is-composing]',
];

var emojiMap = {};

async function init() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_CACHED_EMOJIS' });
  emojiMap = res.emojis || {};
  maybeRenderEmojis();
  watchForChatInput();
}

// Keep the in-memory emojiMap in sync with the popup-triggered sync (or any
// other write to chrome.storage.local.emojiCache) so already-open Meet tabs
// pick up newly synced emojis without a page reload.
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.emojiCache) return;
    const next = changes.emojiCache.newValue;
    emojiMap = (next && next.emojis) || {};
    maybeRenderEmojis();
  });
}

// ── DOM observation ──────────────────────────────────────────────────────────

function watchForChatInput() {
  const observer = new MutationObserver(() => {
    maybeInjectButton();
    maybeRenderEmojis();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
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

function findSendButton(input) {
  const labels = ['Send message', 'Send a message', 'Send'];
  let el = input.parentElement;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    for (const label of labels) {
      const btn = el.querySelector(`button[aria-label="${label}"]`);
      if (btn) return btn;
    }
  }
  return null;
}

function maybeInjectButton() {
  if (document.getElementById(BTN_ID)) return;
  const input = findChatInput();
  if (!input) return;

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.title = 'Insert a custom Slack emoji';
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9" r="0.5" fill="currentColor"/><circle cx="15" cy="9" r="0.5" fill="currentColor"/></svg>`;
  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '50%',
    color: 'inherit',
    flexShrink: '0',
    opacity: '0.7',
  });
  btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
  btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.7'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePicker(input, btn);
  });

  // Insert just before the send button so it sits inline in Meet's toolbar.
  const sendBtn = findSendButton(input);
  if (sendBtn) {
    sendBtn.parentElement.insertBefore(btn, sendBtn);
  } else {
    input.parentElement.insertBefore(btn, input.nextSibling);
  }

  if (!input.dataset.hoggtvAutocomplete) {
    input.dataset.hoggtvAutocomplete = '1';
    attachAutocomplete(input);
  }
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

  let cellObserver = null;
  let noResultsMsg = null;

  function buildGrid() {
    if (cellObserver) { cellObserver.disconnect(); cellObserver = null; }
    grid.innerHTML = '';
    noResultsMsg = null;

    if (Object.keys(emojiMap).length === 0) {
      const msg = document.createElement('p');
      Object.assign(msg.style, { gridColumn: '1 / -1', color: '#9aa0ac', fontSize: '13px', textAlign: 'center', margin: '16px 0' });
      msg.textContent = 'No emojis synced yet. Open the extension popup to add your Slack token.';
      grid.appendChild(msg);
      return;
    }

    // Build all cells once. Images are filled in lazily as cells enter the viewport.
    cellObserver = new IntersectionObserver((observations) => {
      for (const obs of observations) {
        if (!obs.isIntersecting || obs.target.dataset.rendered) continue;
        obs.target.dataset.rendered = '1';
        cellObserver.unobserve(obs.target);
        const name = obs.target.dataset.emojiName;
        const img = document.createElement('img');
        img.src = emojiMap[name];
        img.alt = `:${name}:`;
        img.loading = 'lazy';
        Object.assign(img.style, { width: '26px', height: '26px', objectFit: 'contain', display: 'block' });
        obs.target.appendChild(img);
        obs.target.addEventListener('mouseenter', () => (obs.target.style.background = '#4a4f5b'));
        obs.target.addEventListener('mouseleave', () => (obs.target.style.background = 'none'));
        obs.target.addEventListener('click', () => {
          insertIntoInput(input, `:${name}: `);
          picker.remove();
          input.focus();
        });
      }
    }, { root: grid, rootMargin: '200px 0px' });

    for (const [name] of Object.entries(emojiMap)) {
      const cell = document.createElement('button');
      cell.dataset.emojiName = name;
      cell.title = `:${name}:`;
      Object.assign(cell.style, {
        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
        borderRadius: '4px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', width: '34px', height: '34px', flexShrink: '0',
      });
      cellObserver.observe(cell);
      grid.appendChild(cell);
    }
  }

  function filterGrid(filter) {
    const lower = filter.toLowerCase();
    let visible = 0;
    for (const cell of grid.querySelectorAll('[data-emoji-name]')) {
      const matches = !filter || cell.dataset.emojiName.includes(lower);
      cell.style.display = matches ? 'flex' : 'none';
      if (matches) visible++;
    }
    if (noResultsMsg) { noResultsMsg.remove(); noResultsMsg = null; }
    if (visible === 0 && filter) {
      noResultsMsg = document.createElement('p');
      Object.assign(noResultsMsg.style, { gridColumn: '1 / -1', color: '#9aa0ac', fontSize: '13px', textAlign: 'center', margin: '16px 0' });
      noResultsMsg.textContent = 'No matching emojis.';
      grid.appendChild(noResultsMsg);
    }
  }

  buildGrid();
  search.addEventListener('input', () => filterGrid(search.value));

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

// ── Inline autocomplete ──────────────────────────────────────────────────────

function attachAutocomplete(input) {
  input.addEventListener('input', () => handleAutocompleteInput(input));
  // Capture phase so we intercept Enter before Meet's send handler.
  input.addEventListener('keydown', (e) => handleAutocompleteKeydown(e, input), true);
  input.addEventListener('blur', () => setTimeout(hideAutocomplete, 150));
}

function getPartialShortcode(input) {
  let textBefore;
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    textBefore = input.value.slice(0, input.selectionStart);
  } else {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const pre = range.cloneRange();
    pre.selectNodeContents(input);
    pre.setEnd(range.startContainer, range.startOffset);
    textBefore = pre.toString();
  }
  const match = textBefore.match(/:([a-z0-9_-]{1,})$/);
  if (!match) return null;
  return { partial: match[1], colonIndex: textBefore.length - match[0].length };
}

function handleAutocompleteInput(input) {
  const result = getPartialShortcode(input);
  if (!result) { hideAutocomplete(); return; }

  const matches = Object.keys(emojiMap)
    .filter(name => name.startsWith(result.partial))
    .sort();

  if (matches.length === 0) { hideAutocomplete(); return; }
  showAutocomplete(input, result.partial, matches);
}

function handleAutocompleteKeydown(e, input) {
  const ac = document.getElementById(AUTOCOMPLETE_ID);
  if (!ac) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hideAutocomplete();
    return;
  }

  const items = ac.querySelectorAll('[data-emoji-name]');
  const activeIdx = Array.from(items).findIndex(el => el.dataset.active === '1');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    if (activeIdx >= items.length - 1 && ac._loadMore && ac._loadMore()) {
      // At the bottom of the rendered rows but more matches exist — reveal them.
      setActiveItem(ac.querySelectorAll('[data-emoji-name]'), activeIdx + 1);
    } else {
      setActiveItem(items, activeIdx < items.length - 1 ? activeIdx + 1 : 0);
    }
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    setActiveItem(items, activeIdx > 0 ? activeIdx - 1 : items.length - 1);
    return;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    const active = ac.querySelector('[data-active="1"]');
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    completeShortcode(input, active.dataset.emojiName);
  }
}

function setActiveItem(items, idx) {
  items.forEach((el, i) => {
    el.dataset.active = i === idx ? '1' : '0';
    el.style.background = i === idx ? '#4a4f5b' : 'none';
    if (i === idx) el.scrollIntoView({ block: 'nearest' });
  });
}

function showAutocomplete(input, partial, matches) {
  hideAutocomplete();
  const ac = document.createElement('div');
  ac.id = AUTOCOMPLETE_ID;
  const rect = input.getBoundingClientRect();
  Object.assign(ac.style, {
    position: 'fixed',
    bottom: `${window.innerHeight - rect.top + 4}px`,
    left: `${rect.left}px`,
    background: '#1a1d21',
    border: '1px solid #4a4f5b',
    borderRadius: '8px',
    padding: '4px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    zIndex: '2147483647',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    minWidth: '220px',
    maxHeight: '300px',
    overflowY: 'auto',
  });

  const createItem = (name) => {
    const item = document.createElement('div');
    item.dataset.emojiName = name;
    item.dataset.active = '0';
    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '5px 8px',
      borderRadius: '5px',
      cursor: 'pointer',
      color: '#d1d2d3',
      fontSize: '13px',
      background: 'none',
    });

    const img = document.createElement('img');
    img.src = emojiMap[name];
    img.alt = `:${name}:`;
    img.loading = 'lazy';
    Object.assign(img.style, { width: '20px', height: '20px', objectFit: 'contain', flexShrink: '0' });

    const label = document.createElement('span');
    label.textContent = `:${name}:`;

    item.appendChild(img);
    item.appendChild(label);
    item.addEventListener('mouseenter', () => {
      const items = ac.querySelectorAll('[data-emoji-name]');
      setActiveItem(items, Array.from(items).indexOf(item));
    });
    item.addEventListener('mousedown', (e) => { e.preventDefault(); completeShortcode(input, name); });
    return item;
  };

  // Render in batches so a prefix matching hundreds of emojis (e.g. ":bufo")
  // doesn't build the whole list up front. More rows append as the user
  // scrolls — off-screen <img>s stay unfetched thanks to loading="lazy".
  let rendered = 0;
  const renderMore = () => {
    if (rendered >= matches.length) return false;
    const end = Math.min(rendered + AUTOCOMPLETE_BATCH, matches.length);
    for (; rendered < end; rendered++) ac.appendChild(createItem(matches[rendered]));
    return true;
  };
  ac._loadMore = renderMore;

  renderMore();
  setActiveItem(ac.querySelectorAll('[data-emoji-name]'), 0);

  ac.addEventListener('scroll', () => {
    if (ac.scrollTop + ac.clientHeight >= ac.scrollHeight - 40) renderMore();
  });

  document.body.appendChild(ac);
}

function hideAutocomplete() {
  document.getElementById(AUTOCOMPLETE_ID)?.remove();
}

function completeShortcode(input, name) {
  const result = getPartialShortcode(input);
  if (!result) { hideAutocomplete(); return; }

  const completion = `:${name}: `;
  const replaceLen = result.partial.length + 1; // +1 for the leading ':'

  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    const before = input.value.slice(0, result.colonIndex);
    const after = input.value.slice(result.colonIndex + replaceLen);
    input.value = before + completion + after;
    input.selectionStart = input.selectionEnd = result.colonIndex + completion.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const sel = window.getSelection();
    if (!sel.rangeCount) { hideAutocomplete(); return; }
    const range = sel.getRangeAt(0);
    range.setStart(range.startContainer, range.startOffset - replaceLen);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, completion);
  }

  hideAutocomplete();
  input.focus();
}



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
      // Skip our own picker.
      if (node.parentElement.closest(`#${PICKER_ID}`)) return NodeFilter.FILTER_REJECT;
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
    document.querySelector('[jsname="xySENc"]') ||
    document.querySelector('[data-panel-type="chat"]') ||
    document.querySelector(':not(button)[aria-label*="Chat with everyone"]') ||
    document.querySelector('[aria-label="Chat"]:not(button)') ||
    (() => {
      const input = findChatInput();
      return input ? input.closest('[role="complementary"]') ?? input.closest('aside') ?? document.body : null;
    })() ||
    document.body
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
  for (const frag of fragments) parent.insertBefore(frag, textNode);
  parent.removeChild(textNode);
}

init();
