/**
 * GO Transit Card — a Lovelace card for the ha-gotransit integration.
 *
 * Three layouts via `layout:` — "light", "medium" (default), "dense" (adds map).
 * Point it at the integration's Next Departure sensor; the sibling entities are
 * auto-derived from that entity_id and can each be overridden in config.
 *
 * https://github.com/bl0ckkkk/ha-gotransit-card
 */

const VERSION = "0.1.0";

const FIELD_SUFFIX = {
  platform: { domain: "sensor", suffix: "_platform" },
  status: { domain: "sensor", suffix: "_status" },
  delay: { domain: "sensor", suffix: "_delay" },
  upcoming: { domain: "sensor", suffix: "_upcoming_departures" },
  active_trains: { domain: "sensor", suffix: "_active_trains" },
  consist: { domain: "sensor", suffix: "_train_consist" },
  catchable: { domain: "binary_sensor", suffix: "_catchable" },
  tracker: { domain: "device_tracker", suffix: "_train" },
};

function statusColor(state) {
  switch ((state || "").toLowerCase()) {
    case "on time":
      return "var(--success-color, #43a047)";
    case "delayed":
      return "var(--warning-color, #ffa600)";
    case "cancelled":
      return "var(--error-color, #db4437)";
    default:
      return "var(--secondary-text-color)";
  }
}

function fmtCountdown(targetIso) {
  if (!targetIso) return null;
  const target = new Date(targetIso).getTime();
  if (isNaN(target)) return null;
  const diffMin = Math.round((target - Date.now()) / 60000);
  if (diffMin < 0) return `${Math.abs(diffMin)} min ago`;
  if (diffMin === 0) return "now";
  if (diffMin < 60) return `in ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `in ${h}h ${m}m`;
}

function clockFromIso(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

class GoTransitCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "", layout: "medium" };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("You must define an `entity` (the Next Departure sensor).");
    }
    const layout = config.layout || "medium";
    if (!["light", "medium", "dense"].includes(layout)) {
      throw new Error('`layout` must be one of: light, medium, dense.');
    }
    this._config = { ...config, layout };
    this._base = config.entity.replace(/^sensor\./, "").replace(/_next_departure$/, "");
    this._built = false;
    this._lastHash = null;
    if (this.innerHTML) this.innerHTML = "";
    this._mapEl = null;
    this._mapInit = false;
  }

  _eid(field) {
    if (this._config[`${field}_entity`]) return this._config[`${field}_entity`];
    const f = FIELD_SUFFIX[field];
    return `${f.domain}.${this._base}${f.suffix}`;
  }

  _state(field) {
    return this._hass && this._hass.states[this._eid(field)];
  }

  set hass(hass) {
    this._hass = hass;
    const next = hass.states[this._config.entity];
    if (!next) {
      this.innerHTML = `<ha-card><div style="padding:16px;color:var(--error-color)">Entity not found: ${esc(
        this._config.entity
      )}</div></ha-card>`;
      return;
    }
    const hash = this._stateHash();
    if (hash !== this._lastHash) {
      this._lastHash = hash;
      this._render();
    }
    if (this._mapEl) this._mapEl.hass = hass;
    this._startTick();
  }

  _stateHash() {
    const ids = [this._config.entity, ...Object.keys(FIELD_SUFFIX).map((f) => this._eid(f))];
    return ids
      .map((id) => {
        const s = this._hass.states[id];
        return s ? `${id}=${s.state}` : `${id}=∅`;
      })
      .join("|");
  }

  _startTick() {
    if (this._tick) return;
    this._tick = setInterval(() => {
      const next = this._state("entity") || this._hass.states[this._config.entity];
      const span = this.querySelector("#gt-countdown");
      if (span && next) span.textContent = fmtCountdown(next.state) || "";
    }, 30000);
  }

  disconnectedCallback() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  _attr(field, key) {
    const s = this._state(field);
    return s && s.attributes ? s.attributes[key] : undefined;
  }

  _render() {
    const layout = this._config.layout;
    const dep = this._hass.states[this._config.entity];
    const a = dep.attributes || {};
    const name = this._config.name || `${a.from_stop || "GO"} → ${a.to_stop || a.destination || ""}`.trim();
    const line = a.line || a.line_name || "";
    const statusState = this._state("status");
    const statusTxt = statusState ? statusState.state : a.is_cancelled ? "Cancelled" : "";
    const platform = (this._state("platform") || {}).state || a.actual_platform || a.scheduled_platform;
    const delayMin = (this._state("delay") || {}).state;
    const sched = a.scheduled_time;
    const countdown = fmtCountdown(dep.state);
    const clock = clockFromIso(dep.state);
    const sColor = statusColor(statusTxt);

    const head = `
      <div class="gt-head">
        <ha-icon icon="mdi:train" class="gt-headicon"></ha-icon>
        <div class="gt-headtext">
          <div class="gt-route">${esc(name)}</div>
          ${line ? `<div class="gt-line">${esc(line)}</div>` : ""}
        </div>
        ${statusTxt ? `<span class="gt-pill" style="color:${sColor};border-color:${sColor}">${esc(statusTxt)}</span>` : ""}
      </div>`;

    const big = `
      <div class="gt-big">
        <div>
          <div class="gt-label">Next departure</div>
          <div class="gt-time">${esc(clock)}</div>
        </div>
        <div class="gt-cd">
          <div class="gt-cdmain" id="gt-countdown" style="color:${sColor}">${esc(countdown || "")}</div>
          ${
            sched
              ? `<div class="gt-label">sched ${esc(sched)}${
                  delayMin && Number(delayMin) > 0 ? ` · +${esc(delayMin)} min` : ""
                }</div>`
              : ""
          }
        </div>
        ${
          platform
            ? `<div class="gt-platform"><div class="gt-label">Platform</div><div class="gt-platnum">${esc(
                platform
              )}</div></div>`
            : ""
        }
      </div>`;

    if (layout === "light") {
      this.innerHTML = this._wrap(head + big);
      return;
    }

    const cars = (this._state("consist") || {}).state;
    const active = (this._state("active_trains") || {}).state;
    const catch_ = this._state("catchable");
    const canCatch = catch_ ? catch_.state === "on" : null;
    const stats = `
      <div class="gt-stats">
        ${this._stat("Cars", cars != null && cars !== "unknown" ? `<ha-icon icon="mdi:train-car" class="gt-staticon"></ha-icon> ${esc(cars)}` : "—")}
        ${this._stat("Active trains", active != null ? esc(active) : "—")}
        ${this._stat(
          "Catchable",
          canCatch == null
            ? "—"
            : `<span style="color:${canCatch ? "var(--success-color)" : "var(--error-color)"}"><ha-icon icon="mdi:run" class="gt-staticon"></ha-icon> ${
                canCatch ? "Yes" : "No"
              }</span>`
        )}
      </div>`;

    const departures = Array.isArray(a.departures) ? a.departures : (this._attr("upcoming", "departures") || []);
    const list = departures.length
      ? `<div class="gt-list">
          <div class="gt-label" style="margin-bottom:6px">Upcoming departures</div>
          ${departures
            .slice(0, this._config.max_departures || 4)
            .map(
              (d) => `
            <div class="gt-row">
              <span class="gt-rowtime">${esc(d.departure_time || clockFromIso(d.departure_datetime))}</span>
              <span class="gt-rowdest">→ ${esc((d.destination || a.to_stop || "").replace(/^LW - /, ""))}${
                d.transfers ? ` · ${d.transfers} transfer${d.transfers > 1 ? "s" : ""}` : ""
              }</span>
              <span class="gt-rowarr">${esc(d.arrival_time ? "arr " + d.arrival_time : "")}</span>
            </div>`
            )
            .join("")}
        </div>`
      : "";

    let mapBlock = "";
    if (layout === "dense") {
      mapBlock = `<div id="gt-map" class="gt-map"></div>`;
    }

    this.innerHTML = this._wrap(head + big + stats + list + mapBlock);

    if (layout === "dense") this._ensureMap();
  }

  _stat(label, valueHtml) {
    return `<div class="gt-statcell"><div class="gt-label">${esc(label)}</div><div class="gt-statval">${valueHtml}</div></div>`;
  }

  async _ensureMap() {
    const slot = this.querySelector("#gt-map");
    if (!slot) return;
    if (this._mapEl) {
      slot.appendChild(this._mapEl);
      this._mapEl.hass = this._hass;
      return;
    }
    if (this._mapInit) return;
    this._mapInit = true;
    try {
      const helpers = await window.loadCardHelpers();
      const el = helpers.createCardElement({
        type: "map",
        entities: [this._eid("tracker")],
        aspect_ratio: this._config.map_aspect_ratio || "16:9",
      });
      el.hass = this._hass;
      this._mapEl = el;
      const s = this.querySelector("#gt-map");
      if (s) s.appendChild(el);
    } catch (e) {
      const s = this.querySelector("#gt-map");
      if (s) s.innerHTML = `<div style="padding:8px;color:var(--secondary-text-color)">Map unavailable</div>`;
    }
  }

  _wrap(inner) {
    return `
      <ha-card>
        <style>
          ha-card { overflow: hidden; }
          .gt-head { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--divider-color); }
          .gt-headicon { color: var(--secondary-text-color); --mdc-icon-size: 24px; }
          .gt-headtext { flex:1; min-width:0; }
          .gt-route { font-size:15px; font-weight:500; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .gt-line { font-size:12px; color:var(--secondary-text-color); }
          .gt-pill { font-size:12px; padding:2px 10px; border-radius:999px; border:1px solid; white-space:nowrap; }
          .gt-big { display:flex; align-items:flex-end; gap:14px; padding:14px 16px; }
          .gt-label { font-size:12px; color:var(--secondary-text-color); }
          .gt-time { font-size:34px; font-weight:500; line-height:1; color:var(--primary-text-color); }
          .gt-cd { padding-bottom:3px; }
          .gt-cdmain { font-size:20px; font-weight:500; }
          .gt-platform { margin-left:auto; text-align:center; background:var(--secondary-background-color); border-radius:8px; padding:6px 14px; }
          .gt-platnum { font-size:24px; font-weight:500; color:var(--primary-text-color); }
          .gt-stats { display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid var(--divider-color); }
          .gt-statcell { padding:10px; text-align:center; border-right:1px solid var(--divider-color); }
          .gt-statcell:last-child { border-right:none; }
          .gt-statval { font-size:16px; font-weight:500; color:var(--primary-text-color); margin-top:2px; }
          .gt-staticon { --mdc-icon-size:15px; vertical-align:-2px; }
          .gt-list { padding:10px 16px 14px; }
          .gt-row { display:flex; align-items:center; gap:10px; padding:7px 0; border-top:1px solid var(--divider-color); }
          .gt-rowtime { font-size:15px; font-weight:500; width:48px; color:var(--primary-text-color); }
          .gt-rowdest { flex:1; font-size:13px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .gt-rowarr { font-size:12px; color:var(--secondary-text-color); }
          .gt-map { padding:0 0 0; }
          .gt-map > * { display:block; }
        </style>
        ${inner}
      </ha-card>`;
  }

  getCardSize() {
    return this._config.layout === "dense" ? 8 : this._config.layout === "light" ? 2 : 4;
  }
}

if (!customElements.get("go-transit-card")) {
  customElements.define("go-transit-card", GoTransitCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "go-transit-card",
  name: "GO Transit Card",
  description: "Departure board for the GO Transit integration (light / medium / dense layouts).",
  preview: true,
  documentationURL: "https://github.com/bl0ckkkk/ha-gotransit-card",
});

console.info(`%c GO-TRANSIT-CARD %c ${VERSION} `, "color:#fff;background:#0f6e56;font-weight:700", "color:#0f6e56");
