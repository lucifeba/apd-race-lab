// Arranque: acceso con email y contraseña, pestañas y puesta en marcha de los módulos.
"use strict";

(function (root) {
  const U = root.RL_UTIL, API = root.RL_API, STORE = root.RL_STORE;
  const { $ } = U;
  const DEMO_EMAIL = "jurado@apdracelab.demo";
  const DEMO_PASS = "RaceLab-E7-2026";
  const MODULES = { athletes: root.RL_ATHLETES, race: root.RL_RACE, feedback: root.RL_FEEDBACK };
  let started = false;

  function showLogin() {
    $("app-view").classList.add("hidden");
    $("login-view").classList.remove("hidden");
    $("login-email").focus();
  }

  function showTab(name) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + name));
    const m = MODULES[name];
    if (m && m.onShow) m.onShow();
  }

  async function showApp() {
    const user = API.getUser();
    $("user-name").textContent = user ? user.name : "";
    $("login-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    if (!started) {
      started = true;
      root.RL_ATHLETES.init();
      root.RL_IMPORT.init();
      root.RL_RACE.init();
      root.RL_FEEDBACK.init();
    }
    try {
      await STORE.loadAthletes();
    } catch (ex) {
      U.toast(ex.message);
    }
  }

  async function onLogin(e) {
    e.preventDefault();
    const err = $("login-error");
    err.classList.add("hidden");
    const email = $("login-email").value.trim(), password = $("login-pass").value;
    if (!email || !password) { err.textContent = "Escribe el email y la contraseña."; err.classList.remove("hidden"); return; }
    try {
      const r = await U.busy($("login-btn"), "Entrando…", () => API.post("/api/login", { email, password }));
      API.setSession(r.token, r.user);
      $("login-pass").value = "";
      await showApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  }

  async function onLogout() {
    try { await API.post("/api/logout", {}); } catch { /* la sesión local se borra igualmente */ }
    API.setSession(null, null);
    showLogin();
  }

  function init() {
    $("login-form").addEventListener("submit", onLogin);
    $("login-fill").addEventListener("click", () => { $("login-email").value = DEMO_EMAIL; $("login-pass").value = DEMO_PASS; });
    $("logout").addEventListener("click", onLogout);
    document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    API.onUnauthorized(() => { U.toast("La sesión ha caducado: vuelve a entrar."); showLogin(); });
    if (API.getToken()) showApp(); else showLogin();
  }

  init();
})(window);
