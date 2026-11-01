// The startup watchdog. If an app file fails to load, or the phone is too old for the code, nothing
// else runs and the page would stay on "Opening Off Script…" for ever. So this is a plain script in
// old syntax that any browser can read. If the app starts late it simply draws over this message.
(function () {
  var WAIT = 12000;

  setTimeout(function () {
    if (window.offScript) return; // app.js has started

    var title = document.createElement('h1');
    title.textContent = 'Off Script did not open.';
    var bar = document.createElement('header');
    bar.className = 'bar';
    bar.appendChild(title);

    var words = document.createElement('p');
    words.className = 'lead';
    words.setAttribute('role', 'alert');
    words.textContent = 'Check your signal and try again. If it keeps happening, close Off Script and open it again.';
    var body = document.createElement('main');
    body.className = 'body';
    body.appendChild(words);

    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn primary';
    again.textContent = 'Try again';
    again.addEventListener('click', function () {
      location.reload();
    });
    var foot = document.createElement('footer');
    foot.className = 'foot';
    foot.appendChild(again);

    var screen = document.createElement('div');
    screen.className = 'screen';
    screen.appendChild(bar);
    screen.appendChild(body);
    screen.appendChild(foot);

    var app = document.getElementById('app');
    while (app.firstChild) app.removeChild(app.firstChild);
    app.appendChild(screen);
  }, WAIT);
})();
