(function () {
  var state = document.getElementById('state');
  var say = function (text, warn) { state.textContent = text; state.classList.toggle('warn', !!warn); };
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (!mac) say('NoteFish is a Mac app for now. Open this page on a Mac to install it.', true);

  // The build itself is configured on the server, so this page never guesses a URL.
  fetch('/api/mac-build', { headers: { Accept: 'application/json' } })
    .then(function (response) { return response.ok ? response.json() : { url: null }; })
    .then(function (build) {
      if (!build.url) { if (mac) say('The Mac build is not published yet. Your desk works in the browser meanwhile.', true); return; }
      if (build.file) document.getElementById('file').textContent = build.file;
      if (!mac) return;
      say('Downloading' + (build.version ? ' ' + build.version : '') + '… it lands in your Downloads folder.');
      // A link click, not a frame: the page stays put and the browser takes the file.
      var link = document.createElement('a');
      link.href = build.url; link.download = ''; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () {
        state.innerHTML = 'Nothing happened? <a href="' + build.url.replace(/"/g, '&quot;') + '">Download again</a>.';
      }, 6000);
    })
    .catch(function () { say('Could not reach the download just now. Reload the page to try again.', true); });
})();
