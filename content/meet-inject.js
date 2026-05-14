// Injected into meet.google.com — watches for the chat panel and augments it.

const SHORTCODE_RE = /:([a-zA-Z0-9_\-+]+):/g;
const PICKER_ID = 'hogtv-picker';
const BTN_ID = 'hogtv-btn';

let emojiMap = {}; // name → URL
let pickerVisible = false;

// ── Bootstrap ────────────────────────────────────────────────────────────────

(async () => {
  await loadEmojis();
  observeChat();
})();

async function loadEmojis() {
  try {
    const result = await sendMessage({ type: 'FETCH_EMOJIS' });
    if (result.error) {
      console.warn('[HogTTV] Could not load emojis:', result.error);
    } else {
      emojiMap = result.emojis;
    }
  } catch (e) {
    console.warn('[HogTTV] Background unreachable:', e);
  }
}

// ── Chat panel observer ───────────────────────────────────────────────────────

function observeChat() {
  const observer = new MutationObserver(() => {
    injectPickerButton();
    renderShortcodesInChat();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Also run immediately in case the panel is already open
  injectPickerButton();
}

// ── Picker button injection ───────────────────────────────────────────────────

function injectPickerButton() {
  if (document.getElementById(BTN_ID)) return;

  // Google Meet's send button sits inside the chat footer
  const sendBtn = findSendButton();
  if (!sendBtn) return;

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.className = 'hogtv-emoji-btn';
  btn.title = 'Slack emojis (HogTTV)';
  btn.setAttribute('aria-label', 'Open Slack emoji picker');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePicker(btn);
  });

  sendBtn.parentElement.insertBefore(btn, sendBtn);
}

function findSendButton() {
  // Meet's send button has an aria-label containing "Send" and sits in the chat panel
  return (
    document.querySelector('[data-send-button]') ||
    [...document.querySelectorAll('button[aria-label]')].find(
      (b) => /send message/i.test(b.getAttribute('aria-label'))
    )
  );
}

// ── Emoji picker ─────────────────────────────────────────────────────────────

function togglePicker(anchor) {
  const existing = document.getElementById(PICKER_ID);
  if (existing) {
    existing.remove();
    pickerVisible = false;
    return;
  }
  pickerVisible = true;
  buildPicker(anchor);
}

function buildPicker(anchor) {
  const picker = document.createElement('div');
  picker.id = PICKER_ID;
  picker.className = 'hogtv-picker';

  // Search box
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search emojis…';
  search.className = 'hogtv-picker__search';
  picker.appendChild(search);

  // Emoji grid
  const grid = document.createElement('div');
  grid.className = 'hogtv-picker__grid';
  picker.appendChild(grid);

  const noResults = document.createElement('p');
  noResults.className = 'hogtv-picker__empty';
  noResults.textContent = 'No emojis found';
  noResults.hidden = true;
  picker.appendChild(noResults);

  if (Object.keys(emojiMap).length === 0) {
    noResults.textContent = 'No emojis loaded — check HogTTV options.';
    noResults.hidden = false;
  } else {
    renderGrid(grid, Object.entries(emojiMap));
  }

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    const filtered = Object.entries(emojiMap).filter(([name]) => name.includes(q));
    grid.innerHTML = '';
    renderGrid(grid, filtered);
    noResults.hidden = filtered.length > 0;
  });

  // Position above the anchor button
  document.body.appendChild(picker);
  positionPicker(picker, anchor);

  // Close on outside click
  const closeOnOutside = (e) => {
    if (!picker.contains(e.target) && e.target.id !== BTN_ID) {
      picker.remove();
      pickerVisible = false;
      document.removeEventListener('click', closeOnOutside, true);
    }
  };
  document.addEventListener('click', closeOnOutside, true);

  search.focus();
}

function renderGrid(grid, entries) {
  const fragment = document.createDocumentFragment();
  for (const [name, url] of entries) {
    const btn = document.createElement('button');
    btn.className = 'hogtv-picker__emoji';
    btn.title = `:${name}:`;
    btn.setAttribute('aria-label', name);

    const img = document.createElement('img');
    img.src = url;
    img.alt = `:${name}:`;
    img.loading = 'lazy';
    img.width = 28;
    img.height = 28;

    btn.appendChild(img);
    btn.addEventListener('click', () => insertEmoji(name));
    fragment.appendChild(btn);
  }
  grid.appendChild(fragment);
}

function positionPicker(picker, anchor) {
  const rect = anchor.getBoundingClientRect();
  const ph = picker.offsetHeight || 300;
  picker.style.position = 'fixed';
  picker.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  picker.style.left = `${rect.left}px`;
  picker.style.zIndex = '99999';
}

// ── Insert emoji into Meet chat input ────────────────────────────────────────

function insertEmoji(name) {
  const input = findChatInput();
  if (!input) return;

  const shortcode = `:${name}:`;
  input.focus();

  // contenteditable div — use execCommand for broadest compat
  if (input.isContentEditable) {
    document.execCommand('insertText', false, shortcode);
  } else {
    // Fallback for textarea
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.slice(0, start) + shortcode + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + shortcode.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Close picker after insertion
  const picker = document.getElementById(PICKER_ID);
  if (picker) picker.remove();
  pickerVisible = false;
}

function findChatInput() {
  // Meet's chat input is a contenteditable div
  return (
    document.querySelector('[aria-label="Send a message to everyone"]') ||
    document.querySelector('div[contenteditable="true"][aria-label]') ||
    document.querySelector('textarea[aria-label*="message"]')
  );
}

// ── Shortcode rendering in chat messages ──────────────────────────────────────

const renderedNodes = new WeakSet();

function renderShortcodesInChat() {
  if (Object.keys(emojiMap).length === 0) return;

  // Target chat message text nodes inside Meet's chat panel
  const messageContainer = document.querySelector('[data-message-text]')?.closest('div') ||
    document.querySelector('div[jsname]'); // fallback

  // Walk all text nodes in the chat area
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip script/style/our own picker
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest(`#${PICKER_ID}`)) return NodeFilter.FILTER_REJECT;
        if (p.closest(`#${BTN_ID}`)) return NodeFilter.FILTER_REJECT;
        if (!SHORTCODE_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const toReplace = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!renderedNodes.has(node)) toReplace.push(node);
  }

  for (const textNode of toReplace) {
    replaceShortcodesInNode(textNode);
  }
}

function replaceShortcodesInNode(textNode) {
  SHORTCODE_RE.lastIndex = 0;
  const text = textNode.nodeValue;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = SHORTCODE_RE.exec(text)) !== null) {
    const name = match[1];
    if (!emojiMap[name]) continue;

    if (match.index > lastIndex) {
      parts.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const img = document.createElement('img');
    img.src = emojiMap[name];
    img.alt = match[0];
    img.title = match[0];
    img.className = 'hogtv-inline-emoji';
    img.width = 20;
    img.height = 20;
    parts.push(img);

    lastIndex = SHORTCODE_RE.lastIndex;
  }

  if (parts.length === 0) return; // no emoji found in this node

  if (lastIndex < text.length) {
    parts.push(document.createTextNode(text.slice(lastIndex)));
  }

  const parent = textNode.parentNode;
  if (!parent) return;

  renderedNodes.add(textNode);
  for (const part of parts) {
    parent.insertBefore(part, textNode);
  }
  parent.removeChild(textNode);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
