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
        ".dac-inject{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}",
        ".dac-inject-btn{width:100%;height:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;line-height:26px}",
        ".dac-inject-btn:hover{border-color:var(--dsw-alias-border-l2)}",
        ".dac-inject-btn:disabled{opacity:.5;cursor:default}",
        ".dac-inject-result{margin-top:8px;font-size:12px;line-height:18px}",
        ".dac-inject-ok{color:#2ea44f}",
        ".dac-inject-err{color:var(--dsw-alias-state-error-primary,#e5484d)}",
        ".dac-inject-toggle{border:none;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;padding:2px 0;text-decoration:underline}",
        ".dac-inject-summary{margin-top:6px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary)}"
      ].join("\n");
      document.head.appendChild(style);
    }

    const inject = ["slots"];

    // 内置 ContextMeter 面板的定位选择器（role=dialog + aria-label），中英文都覆盖
    const PANEL_SELECTOR = '[role="dialog"][aria-label="上下文已用"], [role="dialog"][aria-label="of context used"]';

    let currentSessionId = null;

    function formatTokens(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "0";
      if (value < 1e3) return String(value);
      const scaled = (c) => (c >= 100 ? String(Math.round(c)) : String(Math.round(c * 10) / 10));
      if (value < 1e6) return scaled(value / 1e3) + "K";
      return scaled(value / 1e6) + "M";
    }

    /** 构造「压缩」控件（原生 DOM，注入到 ContextMeter 面板）。 */
    function createCompactControl(sessionId) {
      const root = document.createElement("div");
      root.className = "dac-inject";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dac-inject-btn";
      btn.textContent = "压缩";
      root.appendChild(btn);

      const resultArea = document.createElement("div");
      resultArea.className = "dac-inject-result";
      resultArea.style.display = "none";
      root.appendChild(resultArea);

      const clearResult = () => {
        resultArea.style.display = "none";
        resultArea.innerHTML = "";
      };

      const showOk = (data) => {
        clearResult();
        resultArea.style.display = "block";
        const line = document.createElement("div");
        line.className = "dac-inject-ok";
        line.textContent = `已压缩 ${data.shadowed} 条历史记录（约 ${formatTokens(data.shadowedTokens)} tokens）`;
        resultArea.appendChild(line);
        if (typeof data.summary === "string" && data.summary.trim() !== "") {
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "dac-inject-toggle";
          toggle.textContent = "查看摘要";
          resultArea.appendChild(toggle);
          const summary = document.createElement("div");
          summary.className = "dac-inject-summary";
          summary.style.display = "none";
          summary.textContent = data.summary;
          resultArea.appendChild(summary);
          toggle.addEventListener("click", () => {
            const hidden = summary.style.display === "none";
            summary.style.display = hidden ? "block" : "none";
            toggle.textContent = hidden ? "收起摘要" : "查看摘要";
          });
        }
      };

      const showErr = (message) => {
        clearResult();
        resultArea.style.display = "block";
        const line = document.createElement("div");
        line.className = "dac-inject-err";
        line.textContent = message;
        resultArea.appendChild(line);
      };

      btn.addEventListener("click", async () => {
        if (!sessionId) {
          showErr("会话未就绪");
          return;
        }
        btn.disabled = true;
        btn.textContent = "压缩中…";
        clearResult();
        try {
          const res = await fetch(window.location.origin + "/auto-compact/api/compact", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && data.ok) {
            showOk(data);
          } else {
            showErr((data && (data.error || data.message)) || "压缩失败");
          }
        } catch (e) {
          showErr((e && e.message) || String(e));
        } finally {
          btn.disabled = false;
          btn.textContent = "压缩";
        }
      });

      return root;
    }

    function tryInject() {
      const panel = document.querySelector(PANEL_SELECTOR);
      if (panel && !panel.querySelector(".dac-inject")) {
        panel.appendChild(createCompactControl(currentSessionId));
      }
    }

    /** 隐藏组件：从 slot 拿当前 sessionId，供注入逻辑使用，不渲染任何 UI。 */
    function SessionIdCapture({ sessionId }) {
      React.useEffect(() => {
        currentSessionId = sessionId;
        tryInject();
      }, [sessionId]);
      return null;
    }

    function apply(ctx) {
      // 捕获当前会话 id（该组件本身不渲染任何内容）
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "auto-compact-session",
            order: 999,
            label: () => ""
          },
          SessionIdCapture
        )
      );

      // 监听内置 ContextMeter 面板的出现，注入压缩按钮
      const observer = new MutationObserver(tryInject);
      observer.observe(document.body, { childList: true, subtree: true });
      tryInject();
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
