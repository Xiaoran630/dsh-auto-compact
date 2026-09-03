window.__ModuleLoader__.load({
  id: "dsh-auto-compact",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let React = require("react");

    if (typeof document !== "undefined" && !document.getElementById("dsh-auto-compact-style")) {
      const style = document.createElement("style");
      style.id = "dsh-auto-compact-style";
      style.textContent = [
        ".dac-btn{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;display:grid}",
        ".dac-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
        ".dac-btn:disabled{opacity:.6;cursor:default}",
        ".dac-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-tertiary);border-radius:50%;animation:dac-spin .7s linear infinite;display:inline-block}",
        "@keyframes dac-spin{to{transform:rotate(360deg)}}"
      ].join("\n");
      document.head.appendChild(style);
    }

    const inject = ["slots"];

    function formatTokens(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "0";
      if (value < 1e3) return String(value);
      const scaled = (c) => (c >= 100 ? String(Math.round(c)) : String(Math.round(c * 10) / 10));
      if (value < 1e6) return scaled(value / 1e3) + "K";
      return scaled(value / 1e6) + "M";
    }

    function CompactButton({ session, sessionId }) {
      const sid = (session && session.sessionId) || sessionId;
      const [running, setRunning] = React.useState(false);
      const [tip, setTip] = React.useState("压缩");
      const timerRef = React.useRef(null);

      React.useEffect(() => {
        return () => {
          if (timerRef.current) clearTimeout(timerRef.current);
        };
      }, []);

      const compact = React.useCallback(async () => {
        if (!sid) {
          setTip("无活动会话");
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setTip("压缩"), 2500);
          return;
        }
        if (running) return;
        setRunning(true);
        setTip("压缩中…");
        try {
          const res = await fetch(window.location.origin + "/auto-compact/api/compact", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: sid })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && data.ok) {
            setTip(`已压缩 ${data.shadowed} 条（约 ${formatTokens(data.shadowedTokens)} tokens）`);
          } else {
            setTip((data && (data.error || data.message)) || "压缩失败");
          }
        } catch (e) {
          setTip((e && e.message) || "压缩失败");
        } finally {
          setRunning(false);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setTip("压缩"), 3500);
        }
      }, [sid, running]);

      const content = running
        ? React.createElement("span", { className: "dac-spinner", "aria-hidden": true })
        : React.createElement(
            "svg",
            { viewBox: "0 0 16 16", width: "15", height: "15", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
            React.createElement("path", { d: "M5.5 4V1.5H3" }),
            React.createElement("path", { d: "M10.5 4V1.5H13" }),
            React.createElement("path", { d: "M5.5 12v2.5H3" }),
            React.createElement("path", { d: "M10.5 12v2.5H13" }),
            React.createElement("path", { d: "M2.5 6.5h11" }),
            React.createElement("path", { d: "M2.5 9.5h11" })
          );

      return React.createElement(
        "button",
        {
          type: "button",
          className: "dac-btn",
          disabled: running,
          title: tip,
          "aria-label": tip,
          onClick: compact
        },
        content
      );
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "auto-compact",
            order: 0,
            label: () => "压缩"
          },
          CompactButton
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
