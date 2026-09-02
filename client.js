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
        ".dac-btn{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#555);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-accent,#5a5f8a);color:var(--dsw-alias-label-primary,#fff);cursor:pointer;font-size:12px;font-weight:500;line-height:26px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}",
        ".dac-btn:hover{border-color:var(--dsw-alias-border-l3,#888)}",
        ".dac-btn:active{transform:translateY(1px)}",
        ".dac-btn:disabled{opacity:.55;cursor:default;transform:none}",
        ".dac-btn.dac-ok{background:#1f7a3d;border-color:#2ea44f}",
        ".dac-btn.dac-err{background:var(--dsw-alias-state-error-primary,#e5484d);border-color:var(--dsw-alias-state-error-primary,#e5484d);color:#fff}",
        ".dac-ico{display:inline-flex;flex:none}"
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

    function CompactButton({ sessionId }) {
      const [state, setState] = React.useState("idle"); // idle | running | ok | err
      const [result, setResult] = React.useState(null);
      const timerRef = React.useRef(null);

      React.useEffect(() => {
        return () => {
          if (timerRef.current) clearTimeout(timerRef.current);
        };
      }, []);

      const compact = React.useCallback(async () => {
        if (!sessionId || state === "running") return;
        setState("running");
        setResult(null);
        try {
          const res = await fetch(window.location.origin + "/auto-compact/api/compact", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && data.ok) {
            setResult(data);
            setState("ok");
          } else {
            setResult({ ok: false, message: (data && (data.error || data.message)) || "压缩失败" });
            setState("err");
          }
        } catch (e) {
          setResult({ ok: false, message: (e && e.message) || String(e) });
          setState("err");
        } finally {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setState("idle"), 3500);
        }
      }, [sessionId, state]);

      let label = "压缩";
      let title = "压缩上下文，释放 token";
      let cls = "dac-btn";
      if (state === "running") {
        label = "压缩中…";
        title = "正在压缩…";
      } else if (state === "ok" && result) {
        label = `已压缩 ${result.shadowed} 条`;
        title = `已压缩 ${result.shadowed} 条历史记录（约 ${formatTokens(result.shadowedTokens)} tokens）`;
        cls = "dac-btn dac-ok";
      } else if (state === "err" && result) {
        label = "压缩失败";
        title = result.message || "压缩失败";
        cls = "dac-btn dac-err";
      }

      const icon = React.createElement(
        "span",
        { className: "dac-ico", "aria-hidden": true },
        React.createElement(
          "svg",
          { viewBox: "0 0 16 16", width: "13", height: "13", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
          React.createElement("path", { d: "M3 6.5 8 2l5 4.5" }),
          React.createElement("path", { d: "M8 2v9" }),
          React.createElement("path", { d: "M3.5 11.5h9" })
        )
      );

      return React.createElement(
        "button",
        {
          type: "button",
          className: cls,
          disabled: state === "running",
          title,
          onClick: compact
        },
        icon,
        label
      );
    }

    function apply(ctx) {
      // 模型选择（conversation.input.model）左侧的紧凑控件区
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
