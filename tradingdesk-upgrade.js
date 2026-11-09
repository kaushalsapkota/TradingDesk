(() => {
"use strict";
if (window.__TD_UPGRADE__) return;
window.__TD_UPGRADE__ = true;
const css = [
"#td-live-launch{position:fixed;right:22px;bottom:22px;z-index:99980;border:1px solid #8e784e;background:linear-gradient(135deg,#1d211f,#0b0e11);color:#f3eee3;border-radius:999px;padding:12px 17px;display:flex;align-items:center;gap:10px;font:700 12px Inter,system-ui;letter-spacing:.08em;box-shadow:0 14px 42px #0009;cursor:pointer;transition:transform .2s}",
"#td-live-launch:hover{transform:translateY(-3px)}.td-pulse{width:8px;height:8px;border-radius:50%;background:#42d49a;box-shadow:0 0 0 0 #42d49a88;animation:tdPulse 1.8s infinite}",
"@keyframes tdPulse{70%{box-shadow:0 0 0 8px #42d49a00}100%{box-shadow:0 0 0 0 #42d49a00}}",
"#td-live-panel{position:fixed;z-index:99981;right:20px;bottom:82px;width:min(480px,calc(100vw - 28px));height:min(740px,calc(100vh - 120px));display:none;flex-direction:column;background:#0b0f13;border:1px solid #303944;border-radius:20px;box-shadow:0 24px 90px #000c;color:#e8edf2;overflow:hidden;font-family:Inter,system-ui}",
"#td-live-panel.open{display:flex;animation:tdPanelIn .24s ease-out}@keyframes tdPanelIn{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}",
".td-head{padding:18px;background:linear-gradient(135deg,#1b211f,#10151b);border-bottom:1px solid #28313b;display:flex;align-items:center;justify-content:space-between}.td-kicker{font-size:9px;letter-spacing:.2em;color:#c7a66a;font-weight:800}.td-head h3{fo¶»§q«^