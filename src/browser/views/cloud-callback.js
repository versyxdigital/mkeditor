/* Authorization codes are relayed only to the same-origin opener, then removed. */
(() => {
  const url = location.href;
  history.replaceState(null, '', location.pathname);
  if (window.opener && window.opener !== window) {
    window.opener.postMessage(
      { type: 'mkeditor-cloud-oauth', url },
      location.origin,
    );
    // The opener closes this window after validating the queued response.
    // Closing here could race its popup-closure cancellation check.
  }
})();
