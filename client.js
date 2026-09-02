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
        ".dac-btn{height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#8a8f98);cursor:pointer;font-size:12px;line-height:22px;white-space:nowrap}",
        ".dac-btn:hover{color:var(--dsw-alias-label-primary,#fff);border-color:var(--dsw-alias-border-l2,#555)}",
        ".dac-btn:disabled{opacity:.5;cursor:default}",
        ".dac-btn.dac-running{color:var(--dsw-alias-state-info-primary,#4da3ff)}",
        ".dac-btn.dac-ok{color:#2ea44f;border-color:#2ea44f}",
        ".dac-btn.dac-err{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:var(--dsw-alias-state-error-primary,#e5484d)}"
      ].join("\n");
      document.head.appendChild(style);
    }

    const inject = ["slots"];

    function CompactButton({ sessionId }) {
      const [state, setState] = React.useState("idle"); // idle | running | ok | err
      const timerRef = React.useRef(null);

      React.useEffect(() => {
        return () => {
          if (timerRef.current) clearTimeout(timerRef.current);
        };
      }, []);

      const compact = React.useCallback(async () => {
        if (!sessionId) return;
        setState("running");
        try {
          const res = await fetch(window.location.origin + "/auto-compact/api/compact", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && data.ok) {
            setState("ok");
          } else {
            setState("err");
          }
        } catch (e) {
          setState("err");
        } finally {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setState("idle"), 2500);
        }
      }, [sessionId]);

      const label = state === "running" ? "压缩中…" : state === "ok" ? "已压缩" : state === "err" ? "压缩失败" : "压缩";
      const cls = "dac-btn" + (state === "running" ? " dac-running" : state === "ok" ? " dac-ok" : state === "err" ? " dac-err" : "");

      return React.createElement(
        "button",
        {
          type: "button",
          className: cls,
          disabled: state === "running",
          title: "压缩上下文，释放 token（适用于所有模式）",
          onClick: compact
        },
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
