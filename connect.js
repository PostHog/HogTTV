// Shared by popup.js and welcome.js. The background reports the outcome
// through session storage instead of a message reply, because the browser may
// suspend and wake it again while the user signs in to Slack.
function connectSlack() {
  return new Promise((resolve) => {
    const onChanged = (changes, area) => {
      const result = changes.connectResult?.newValue;
      if (area !== 'session' || !result) return;
      chrome.storage.onChanged.removeListener(onChanged);
      resolve(result);
    };
    chrome.storage.onChanged.addListener(onChanged);
    chrome.runtime.sendMessage({ type: 'CONNECT_SLACK' });
  });
}
