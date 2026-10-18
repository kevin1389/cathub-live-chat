/* CatHub! live chat — plain JavaScript, no dependencies */
(function () {
  "use strict";

  var CONFIG = {
    url: "https://uigmxogewcaksotxkhji.supabase.co",
    key: "sb_publishable_rqgnsYMn_Pvus4uS5NmdBA_jJYxdrHM",
    table: "iv_chat",
    pollMs: 3000,
    maxMessages: 60
  };

  if (window.__ivChatTimer) {
    window.clearInterval(window.__ivChatTimer);
    window.__ivChatTimer = null;
  }

  var root = document.getElementById("iv-chat-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "iv-chat-root";
    document.body.appendChild(root);
  }
  root.classList.remove("iv-chat-ready");

  var state = localStorage.getItem("ivChatState");
  if (!state) {
    state = localStorage.getItem("ivChatOpen") === "1" ? "open" : "closed";
  }
  if (["open", "closed", "docked"].indexOf(state) === -1) state = "closed";

  var savedName = (localStorage.getItem("ivChatName") || "").slice(0, 32);
  var messages = [];
  var busy = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setState(next) {
    state = next;
    localStorage.setItem("ivChatState", state);
    localStorage.setItem("ivChatOpen", state === "open" ? "1" : "0");
    root.setAttribute("data-state", state);
    toggle.setAttribute("aria-expanded", state === "open" ? "true" : "false");
    toggle.setAttribute("aria-label", state === "open" ? "Close chat" : "Open chat");
    toggle.textContent = state === "open" ? "×" : "💬";
    panel.hidden = state !== "open";
    dock.hidden = state !== "docked";
  }

  var toggle = el("button", "iv-chat-toggle", "💬");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Open chat");
  toggle.setAttribute("aria-expanded", "false");

  var panel = el("section", "iv-chat-panel");
  panel.setAttribute("aria-label", "CatHub! Chat");
  panel.hidden = true;

  var header = el("header", "iv-chat-header");
  var headingWrap = el("div", "iv-chat-heading-wrap");
  var logo = el("img", "iv-chat-logo");
  logo.src = "./cathub-logo.png";
  logo.alt = "CatHub! logo";
  headingWrap.appendChild(logo);
  var headingText = el("div", "iv-chat-heading-text");
  headingText.appendChild(el("div", "iv-chat-title", "CatHub! Chat"));
  headingText.appendChild(el("div", "iv-chat-subtitle", "Be nice ig"));
  headingWrap.appendChild(headingText);
  var headerActions = el("div", "iv-chat-header-actions");
  var dockButton = el("button", "iv-chat-icon-button", "↙");
  dockButton.type = "button";
  dockButton.title = "Dock chat";
  dockButton.setAttribute("aria-label", "Dock chat");
  var closeButton = el("button", "iv-chat-icon-button", "×");
  closeButton.type = "button";
  closeButton.title = "Close chat";
  closeButton.setAttribute("aria-label", "Close chat");
  headerActions.append(dockButton, closeButton);
  header.append(headingWrap, headerActions);

  var nameArea = el("div", "iv-chat-name-area");
  var nameLabel = el("label", "iv-chat-label", "Your name");
  nameLabel.htmlFor = "iv-chat-name";
  var nameInput = el("input", "iv-chat-name-input");
  nameInput.id = "iv-chat-name";
  nameInput.type = "text";
  nameInput.maxLength = 32;
  nameInput.autocomplete = "nickname";
  nameInput.placeholder = "Choose a name (1–32 chars)";
  nameInput.value = savedName;
  nameArea.append(nameLabel, nameInput);

  var list = el("div", "iv-chat-messages");
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");
  list.setAttribute("aria-label", "Chat messages");

  var hint = el("div", "iv-chat-hint");
  hint.setAttribute("role", "status");

  var composer = el("form", "iv-chat-composer");
  var messageInput = el("textarea", "iv-chat-message-input");
  messageInput.maxLength = 500;
  messageInput.rows = 2;
  messageInput.placeholder = "Write a message…";
  messageInput.setAttribute("aria-label", "Message");
  var sendButton = el("button", "iv-chat-send", "Send");
  sendButton.type = "submit";
  composer.append(messageInput, sendButton);

  panel.append(header, nameArea, list, hint, composer);

  var dock = el("button", "iv-chat-dock", "💬 Chat");
  dock.type = "button";
  dock.setAttribute("aria-label", "Open docked chat");
  dock.hidden = true;

  root.append(toggle, panel, dock);

  function apiHeaders(extra) {
    var h = {
      "apikey": CONFIG.key,
      "Authorization": "Bearer " + CONFIG.key
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function endpoint(query) {
    return CONFIG.url + "/rest/v1/" + CONFIG.table + (query || "");
  }
  function setHint(text, error) {
    hint.textContent = text || "";
    hint.classList.toggle("iv-chat-hint-error", !!error);
  }
  function localTime(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? "" : date.toLocaleString([], {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  }
  function renderMessages(items) {
    var wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      var row = el("article", "iv-chat-message");
      if (String(item.name || "").toLowerCase() === savedName.toLowerCase() && savedName) {
        row.classList.add("iv-chat-own");
      }
      row.title = localTime(item.created_at);
      var meta = el("div", "iv-chat-message-meta");
      meta.append(el("span", "iv-chat-message-name", item.name || "Anonymous"));
      meta.append(el("time", "iv-chat-message-time", localTime(item.created_at)));
      var body = el("div", "iv-chat-message-body", item.message || "");
      row.append(meta, body);
      fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
    if (wasNearBottom) list.scrollTop = list.scrollHeight;
  }
  async function loadMessages() {
    if (document.hidden) return;
    try {
      var response = await fetch(endpoint("?select=id,created_at,name,message&order=id.desc&limit=" + CONFIG.maxMessages), {
        method: "GET",
        headers: apiHeaders()
      });
      if (!response.ok) {
        setHint("Could not load messages (HTTP " + response.status + ").", true);
        return;
      }
      var rows = await response.json();
      messages = rows.reverse();
      renderMessages(messages);
      setHint("");
    } catch (e) {
      setHint("Chat is offline right now.", true);
    }
  }
  async function sendMessage() {
    if (busy) return;
    var name = nameInput.value.trim().slice(0, 32);
    var message = messageInput.value.trim().slice(0, 500);
    if (!name) {
      setHint("Please enter a name first.", true);
      nameInput.focus();
      return;
    }
    if (!message) {
      setHint("Write a message before sending.", true);
      messageInput.focus();
      return;
    }
    if (name.length < 1 || message.length < 1) return;

    busy = true;
    sendButton.disabled = true;
    setHint("");
    try {
      var response = await fetch(endpoint(), {
        method: "POST",
        headers: apiHeaders({
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        }),
        body: JSON.stringify({ name: name, message: message })
      });
      if (!response.ok) {
        setHint("Could not send (HTTP " + response.status + ").", true);
        return;
      }
      savedName = name;
      localStorage.setItem("ivChatName", name);
      messageInput.value = "";
      await loadMessages();
      messageInput.focus();
    } catch (e) {
      setHint("Chat is offline right now.", true);
    } finally {
      busy = false;
      sendButton.disabled = false;
    }
  }

  toggle.addEventListener("click", function () {
    setState(state === "open" ? "closed" : "open");
    if (state === "open") {
      loadMessages();
      messageInput.focus();
    }
  });
  closeButton.addEventListener("click", function () { setState("closed"); });
  dockButton.addEventListener("click", function () { setState("docked"); });
  dock.addEventListener("click", function () {
    setState("open");
    loadMessages();
    messageInput.focus();
  });
  nameInput.addEventListener("input", function () {
    savedName = nameInput.value.slice(0, 32);
    localStorage.setItem("ivChatName", savedName);
    renderMessages(messages);
  });
  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage();
  });
  messageInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  setState("open");
  root.classList.add("iv-chat-ready");
  loadMessages();
  window.__ivChatTimer = window.setInterval(loadMessages, CONFIG.pollMs);
})();
