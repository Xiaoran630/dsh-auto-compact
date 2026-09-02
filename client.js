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
        ".dac-root{position:relative;display:inline-flex}",
        ".dac-trigger{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;display:grid}",
        ".dac-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
        ".dac-trigger:disabled{opacity:.5;cursor:default}",
        ".dac-panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:264px;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:absolute;bottom:calc(100% + 8px);right:0}",
        ".dac-header{align-items:center;gap:6px;display:flex}",
        ".dac-headline{color:var(--dsw-alias-label-tertiary)}",
        ".dac-percent{color:var(--dsw-alias-label-primary);font-weight:500}",
        ".dac-figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}",
        ".dac-bar{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;gap:1px;height:4px;margin:10px 0 12px;display:flex;overflow:hidden}",
        ".dac-segment{border-radius:1px;flex:none;min-width:2px;height:100%}",
        ".dac-seg-system{background:var(--dsw-static-neutral-bluish-400)}",
        ".dac-seg-tools{background:#a78bfa}",
        ".dac-seg-messages{background:var(--dsw-static-blue-450)}",
        ".dac-rows{margin:0}",
        ".dac-row{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}",
        ".dac-row dt{color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center}",
        ".dac-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);margin:0}",
        ".dac-swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block}",
        ".dac-swatch-system{background:var(--dsw-static-neutral-bluish-400)}",
        ".dac-swatch-tools{background:#a78bfa}",
        ".dac-swatch-messages{background:var(--dsw-static-blue-450)}",
        ".dac-actions{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}",
        ".dac-compact-btn{width:100%;height:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-accent,#5a5f8a);color:var(--dsw-alias-label-primary,#fff);cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center;gap:6px}",
        ".dac-compact-btn:hover{border-color:var(--dsw-alias-border-l2)}",
        ".dac-compact-btn:disabled{opacity:.6;cursor:default}",
        ".dac-result{margin-top:8px;font-size:12px;line-height:18px}",
        ".dac-result-ok{color:#2ea44f}",
        ".dac-result-err{color:var(--dsw-alias-state-error-primary,#e5484d)}",
        ".dac-toggle{border:none;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;padding:2px 0;text-decoration:underline}",
        ".dac-summary{margin-top:6px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#1e1f22);max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary)}",
        ".dac-spinner{width:13px;height:13px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:dac-spin .7s linear infinite;display:inline-block}",
        "@keyframes dac-spin{to{transform:rotate(360deg)}}"
      ].join("\n");
      document.head.appendChild(style);
    }

    const inject = ["slots"];

    const ROWS = [
      { key: "systemTokens", label: "系统提示词", color: "system" },
      { key: "toolsTokens", label: "工具", color: "tools" },
      { key: "messageTokens", label: "对话消息", color: "messages" }
    ];

    function formatTokens(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "0";
      if (value < 1e3) return String(value);
      const scaled = (c) => (c >= 100 ? String(Math.round(c)) : String(Math.round(c * 10) / 10));
      if (value < 1e6) return scaled(value / 1e3) + "K";
      return scaled(value / 1e6) + "M";
    }

    function contextOccupancy(pressure) {
      const used = pressure && (pressure.projectedTokens !== undefined ? pressure.projectedTokens : pressure.pressureTokens);
      if (used === undefined || !pressure || pressure.contextWindow === undefined) return null;
      return {
        percent: Math.min(100, Math.round((used / pressure.contextWindow) * 100)),
        usedTokens: used,
        contextWindow: pressure.contextWindow
      };
    }

    function CompactControl({ sessionId, useProjection }) {
      const pressure = useProjection("contextPressure");
      const breakdown = useProjection("contextBreakdown");
      const [open, setOpen] = React.useState(false);
      const [running, setRunning] = React.useState(false);
      const [result, setResult] = React.useState(null);
      const [showSummary, setShowSummary] = React.useState(false);
      const rootRef = React.useRef(null);

      const occupancy = contextOccupancy(pressure);

      React.useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
          if (e.target instanceof Node && rootRef.current && rootRef.current.contains(e.target)) return;
          setOpen(false);
        };
        const onKey = (e) => {
          if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("pointerdown", onDown);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);

      const compact = React.useCallback(async () => {
        if (!sessionId || running) return;
        setRunning(true);
        setShowSummary(false);
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
          } else {
            setResult({ ok: false, message: (data && (data.error || data.message)) || "压缩失败" });
          }
        } catch (e) {
          setResult({ ok: false, message: (e && e.message) || String(e) });
        } finally {
          setRunning(false);
        }
      }, [sessionId, running]);

      // 触发图标按钮（纯图标，无文字）
      const trigger = React.createElement(
        "button",
        {
          type: "button",
          className: "dac-trigger",
          "aria-label": "上下文用量与压缩",
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          title: "上下文用量与压缩",
          onClick: () => setOpen(!open)
        },
        React.createElement(
          "svg",
          { viewBox: "0 0 16 16", width: "15", height: "15", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          React.createElement("path", { d: "M5.5 4V1.5H3" }),
          React.createElement("path", { d: "M10.5 4V1.5H13" }),
          React.createElement("path", { d: "M5.5 12v2.5H3" }),
          React.createElement("path", { d: "M10.5 12v2.5H13" }),
          React.createElement("path", { d: "M2.5 6.5h11" }),
          React.createElement("path", { d: "M2.5 9.5h11" })
        )
      );

      const breakdownTotal = breakdown ? breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens : 0;
      const segments = (breakdown && breakdownTotal > 0 && occupancy
        ? ROWS.map((row) => ({
            key: row.key,
            color: row.color,
            width: (occupancy.percent * breakdown[row.key]) / breakdownTotal
          }))
        : [{ key: "total", color: null, width: occupancy ? occupancy.percent : 0 }]
      ).filter((s) => s.width > 0);

      const panel = open
        ? React.createElement(
            "div",
            { className: "dac-panel", role: "dialog", "aria-label": "上下文用量与压缩" },
            React.createElement(
              "div",
              { className: "dac-header" },
              React.createElement("span", { className: "dac-headline" }, "上下文已用"),
              React.createElement("span", { className: "dac-percent" }, occupancy ? occupancy.percent + "%" : "—"),
              React.createElement(
                "span",
                { className: "dac-figures" },
                occupancy ? `~${formatTokens(occupancy.usedTokens)} / ${formatTokens(occupancy.contextWindow)}` : "—"
              )
            ),
            React.createElement(
              "div",
              { className: "dac-bar" },
              segments.map((s) =>
                React.createElement("div", {
                  key: s.key,
                  className: "dac-segment" + (s.color ? ` dac-seg-${s.color}` : ""),
                  style: { width: `${s.width}%` }
                })
              )
            ),
            breakdown
              ? React.createElement(
                  "dl",
                  { className: "dac-rows" },
                  ROWS.map((row) =>
                    React.createElement(
                      "div",
                      { className: "dac-row", key: row.key },
                      React.createElement(
                        "dt",
                        null,
                        React.createElement("span", { className: `dac-swatch dac-swatch-${row.color}`, "aria-hidden": true }),
                        row.label
                      ),
                      React.createElement("dd", null, `~${formatTokens(breakdown[row.key])}`)
                    )
                  )
                )
              : null,
            React.createElement(
              "div",
              { className: "dac-actions" },
              React.createElement(
                "button",
                { type: "button", className: "dac-compact-btn", disabled: running, onClick: compact },
                running ? React.createElement("span", { className: "dac-spinner", "aria-hidden": true }) : "压缩"
              )
            ),
            result
              ? React.createElement(
                  "div",
                  { className: "dac-result" },
                  result.ok
                    ? React.createElement(
                        React.Fragment,
                        null,
                        React.createElement(
                          "div",
                          { className: "dac-result-ok" },
                          `已压缩 ${result.shadowed} 条历史记录（约 ${formatTokens(result.shadowedTokens)} tokens）`
                        ),
                        result.summary
                          ? React.createElement(
                              React.Fragment,
                              null,
                              React.createElement(
                                "button",
                                { type: "button", className: "dac-toggle", onClick: () => setShowSummary((s) => !s) },
                                showSummary ? "收起摘要" : "查看摘要"
                              ),
                              showSummary ? React.createElement("div", { className: "dac-summary" }, result.summary) : null
                            )
                          : null
                      )
                    : React.createElement("div", { className: "dac-result-err" }, result.message || "压缩失败")
                )
              : null
          )
        : null;

      return React.createElement("span", { ref: rootRef, className: "dac-root" }, trigger, panel);
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
          CompactControl
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
