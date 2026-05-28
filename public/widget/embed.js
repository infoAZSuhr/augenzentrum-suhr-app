/*
 * Sekretariat-Chat Embed-Skript für augenzentrum-suhr.ch (WordPress)
 *
 * Einbettung: irgendwo am Ende der Seite (z. B. via WordPress-Plugin
 * "WPCode" oder "Insert Headers and Footers" im Footer-Bereich):
 *
 *   <script src="https://infoazsuhr.github.io/sekretariat-chat/embed.js" defer></script>
 *
 * Das Skript fügt unten rechts einen Chat-Button ein und öffnet bei
 * Klick ein Iframe-Popup mit dem Chat-Widget.
 */
(function () {
  if (window.__azsChatLoaded) return
  window.__azsChatLoaded = true

  var BASE = 'https://infoazsuhr.github.io/sekretariat-chat/'

  var style = document.createElement('style')
  style.textContent =
    '.azs-chat-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;' +
    'width:60px;height:60px;border-radius:50%;background:#2563eb;color:#fff;' +
    'border:none;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
    '.azs-chat-btn:hover{transform:scale(1.05)}' +
    '.azs-chat-btn svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.azs-chat-frame{position:fixed;right:20px;bottom:90px;z-index:2147483647;' +
    'width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 110px);' +
    'border:none;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.24);background:#fff;display:none}' +
    '.azs-chat-frame.open{display:block}' +
    '.azs-chat-close{position:fixed;right:30px;bottom:680px;z-index:2147483648;' +
    'width:28px;height:28px;border-radius:50%;background:#fff;color:#111;border:1px solid #e5e7eb;' +
    'cursor:pointer;display:none;align-items:center;justify-content:center;font-size:16px;line-height:1;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.12)}' +
    '.azs-chat-close.open{display:flex}' +
    '@media(max-width:480px){' +
    '.azs-chat-frame{right:0;bottom:0;width:100vw;height:100vh;max-width:none;max-height:none;border-radius:0}' +
    '.azs-chat-close{right:10px;bottom:auto;top:10px}}'
  document.head.appendChild(style)

  var btn = document.createElement('button')
  btn.className = 'azs-chat-btn'
  btn.setAttribute('aria-label', 'Sekretariat-Chat öffnen')
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'

  var frame = document.createElement('iframe')
  frame.className = 'azs-chat-frame'
  frame.title = 'Sekretariat-Chat'
  frame.setAttribute('allow', 'clipboard-write')

  var closeBtn = document.createElement('button')
  closeBtn.className = 'azs-chat-close'
  closeBtn.setAttribute('aria-label', 'Chat schliessen')
  closeBtn.textContent = '×'

  function open() {
    if (!frame.src) frame.src = BASE
    frame.classList.add('open')
    closeBtn.classList.add('open')
    btn.style.display = 'none'
  }
  function close() {
    frame.classList.remove('open')
    closeBtn.classList.remove('open')
    btn.style.display = ''
  }
  btn.addEventListener('click', open)
  closeBtn.addEventListener('click', close)

  document.body.appendChild(btn)
  document.body.appendChild(frame)
  document.body.appendChild(closeBtn)
})()
