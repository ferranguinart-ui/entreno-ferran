// Cliente HTTP + cola offline.
// El timer corre sin red; sólo el guardado final necesita conexión.
// Si falla, el entreno / la medida quedan en localStorage y se suben al reconectar.

const PENDING_S = "pendingSessions";
const PENDING_M = "pendingMeasurements";

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.hash = "#/login";
    throw new Error("no auth");
  }
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.status === 204 ? null : res.json();
}

const readQ = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "[]");
  } catch (_) {
    return [];
  }
};
const writeQ = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {}
};
const enqueue = (k, item) => writeQ(k, [...readQ(k), { ...item, ts: Date.now() }]);

// Intentos "crudos" (lanzan si fallan, no encolan).
async function pushWorkout(payload) {
  const { id } = await req("POST", "/api/sessions", payload.session);
  if (payload.patch) await req("PATCH", `/api/sessions/${id}`, payload.patch);
  if (payload.logs?.length)
    await req("POST", `/api/sessions/${id}/logs`, { logs: payload.logs });
  return id;
}
const pushMeasurement = (body) => req("POST", "/api/measurements", body);

export const api = {
  login: (pin) => req("POST", "/api/login", { pin }),
  logout: () => req("POST", "/api/logout"),
  me: () => req("GET", "/api/me"),
  bootstrap: () => req("GET", "/api/bootstrap"),
  prefill: (dayId) => req("GET", `/api/prefill?day_id=${dayId}`),
  sessions: (limit = 30) => req("GET", `/api/sessions?limit=${limit}`),
  measurements: () => req("GET", "/api/measurements"),
  dashboard: () => req("GET", "/api/dashboard"),

  async saveWorkout(payload) {
    try {
      const id = await pushWorkout(payload);
      return { ok: true, queued: false, id };
    } catch (e) {
      if (e.message === "no auth") throw e;
      enqueue(PENDING_S, payload);
      return { ok: true, queued: true };
    }
  },

  async saveMeasurement(body) {
    try {
      const r = await pushMeasurement(body);
      return { ok: true, queued: false, id: r.id };
    } catch (e) {
      if (e.message === "no auth") throw e;
      enqueue(PENDING_M, body);
      return { ok: true, queued: true };
    }
  },

  pendingCount: () => readQ(PENDING_S).length + readQ(PENDING_M).length,

  async flushPending() {
    for (const [k, push] of [
      [PENDING_S, pushWorkout],
      [PENDING_M, pushMeasurement],
    ]) {
      const q = readQ(k);
      if (!q.length) continue;
      const keep = [];
      for (const item of q) {
        try {
          await push(item);
        } catch (_) {
          keep.push(item);
        }
      }
      writeQ(k, keep);
    }
  },
};

window.addEventListener("online", () => api.flushPending());
