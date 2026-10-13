// Cliente de la API: token de sesión (Bearer) en localStorage, respuestas
// {ok, data, error} y caché compartida de deportistas (RL_STORE).
"use strict";

(function (root) {
  const TOKEN_KEY = "rl_token";
  const USER_KEY = "rl_user";
  let unauthorizedHandler = null;

  function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function storageSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ } }

  let memToken = storageGet(TOKEN_KEY);
  const getToken = () => memToken;
  function setSession(token, user) {
    memToken = token || null;
    storageSet(TOKEN_KEY, memToken);
    storageSet(USER_KEY, user ? JSON.stringify(user) : null);
  }
  function getUser() { try { return JSON.parse(storageGet(USER_KEY) || "null"); } catch { return null; } }

  async function request(method, path, body) {
    const headers = { accept: "application/json" };
    if (memToken) headers.authorization = `Bearer ${memToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error("Sin conexión con el servidor.");
    }
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (res.status === 401 && path !== "/api/login") {
      setSession(null, null);
      if (unauthorizedHandler) unauthorizedHandler();
    }
    if (!res.ok || !payload || !payload.ok) throw new Error((payload && payload.error) || `Error ${res.status}`);
    return payload.data;
  }

  const API = {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b ?? {}),
    put: (p, b) => request("PUT", p, b ?? {}),
    del: (p) => request("DELETE", p),
    getToken, setSession, getUser,
    onUnauthorized: (fn) => { unauthorizedHandler = fn; },
  };

  // Caché de deportistas con avisos a los módulos cuando cambia.
  const listeners = new Set();
  const STORE = {
    athletes: [],
    async loadAthletes() {
      STORE.athletes = await API.get("/api/athletes");
      listeners.forEach((fn) => fn(STORE.athletes));
      return STORE.athletes;
    },
    byId: (id) => STORE.athletes.find((a) => String(a.id) === String(id)) || null,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    // Entrenos de un deportista (todo el historial hasta `to`, para la forma).
    workouts: (id, to) => API.get(`/api/athletes/${encodeURIComponent(id)}/workouts${to ? "?to=" + encodeURIComponent(to) : ""}`),
  };

  root.RL_API = API;
  root.RL_STORE = STORE;
})(window);
