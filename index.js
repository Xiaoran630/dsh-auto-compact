import { randomUUID } from "node:crypto";

const name = "dsh-auto-compact";
const inject = ["llm", "sessions", "agents", "webServer"];

/** 触发压缩的上下文压力阈值（0-1）。 */
const DEFAULT_THRESHOLD_RATIO = 0.6;
/** 压缩后保留最近上下文的比例（0-1）。 */
const DEFAULT_RETAIN_RATIO = 0.2;
/** 摘要调用最大输出 token。 */
const SUMMARY_MAX_TOKENS = 8192;

const SUMMARY_OPEN_TAG = "<compacted-summary>";
const SUMMARY_CLOSE_TAG = "</compacted-summary>";
const CHECKPOINT_PREAMBLE =
  "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";

const COMPACTION_INSTRUCTION = [
  "You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
  "",
  "Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write \"(none)\" for an empty section — never drop a section.",
  "",
  "## Primary Request and Intent",
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  "",
  "## Key Technical Concepts",
  "- [technologies, frameworks, patterns, and conventions in play]",
  "",
  "## Files and Code",
  "- [exact path: why it matters, key changes or snippets]",
  "",
  "## Errors and Fixes",
  "- [error: how it was resolved, plus any related user feedback]",
  "",
  "## Pending Jobs",
  "- [explicitly requested work not yet completed]",
  "",
  "## Current Work",
  "- [precisely what was in progress at this checkpoint]",
  "",
  "## Next Step",
  "- [the single next action, directly in line with the most recent request, or \"(none)\"]",
  "",
  "## Critical Context",
  "- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]",
  "",
  "Rules:",
  "- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.",
  "- Capture user feedback and explicit instructions faithfully, especially corrections.",
  "- Do NOT mention this summarization request or that the context was compacted.",
  "- Output only the checkpoint text: do not call any tool or take any other action.",
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`
].join("\n");

/** 校验一个 (0,1] 的比例字段，缺省时用默认值。 */
function ratio(value, fallback, field) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`dsh-auto-compact: ${field} must be a number in (0, 1], got ${String(value)}`);
  }
  return value;
}

/** 解析并校验插件配置。 */
function resolveConfig(config) {
  const c = config || {};
  const enabled = c.enabled === undefined ? true : !!c.enabled;
  const thresholdRatio = ratio(c.thresholdRatio, DEFAULT_THRESHOLD_RATIO, "thresholdRatio");
  const retainRatio = ratio(c.retainRatio, DEFAULT_RETAIN_RATIO, "retainRatio");
  const autoCompact = c.autoCompact === undefined ? true : !!c.autoCompact;
  const preservePrefix = c.preservePrefix === undefined ? true : !!c.preservePrefix;
  if (retainRatio >= thresholdRatio) {
    throw new Error(`dsh-auto-compact: retainRatio (${retainRatio}) must be less than thresholdRatio (${thresholdRatio})`);
  }
  return { enabled, thresholdRatio, retainRatio, autoCompact, preservePrefix };
}

/** 粗略 token 估算：混合文本约 3.5 字符 / token。 */
function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 3.5);
}

/** 估算单条模型可见消息的 token 数。 */
function estimateMessageTokens(message) {
  if (!message) return 0;
  let total = 4; // 每条消息的角色/结构开销
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (typeof block.text === "string") total += estimateTextTokens(block.text);
      else if (block.type === "tool-call") total += estimateTextTokens((block.name || "") + (block.arguments || ""));
    }
  } else if (typeof content === "string") {
    total += estimateTextTokens(content);
  }
  return total;
}

/** 不依赖 tokenMeter 的测量：返回与 compaction-basic 相同形状的结果。 */
function measure(session) {
  const nodes = session.surface.nodes;
  const events = session.events;
  const pricedNodes = [];
  let totalTokens = 0;
  const header = session.requestHeader();
  if (header && typeof header.system === "string") totalTokens += estimateTextTokens(header.system);
  if (header && header.tools !== undefined) totalTokens += estimateTextTokens(JSON.stringify(header.tools));
  for (const seq of nodes) {
    const event = events[seq];
    const msg = event ? session.deriveEventMessage(event) : null;
    const tokens = msg ? estimateMessageTokens(msg) : 0;
    totalTokens += tokens;
    pricedNodes.push({ seq, tokens, heuristicTokens: tokens });
  }
  return { totalTokens, nodes: pricedNodes };
}

/** 一条 surface 事件对「进行中的工具调用数」的增量。 */
function eventDelta(event) {
  if (!event) return 0;
  if (event.type === "assistant/message") {
    const content = event.data?.message?.content;
    return Array.isArray(content) ? content.filter((b) => b && b.type === "tool-call").length : 0;
  }
  if (event.type === "tool/result") return -1;
  return 0;
}

/** 在 seq 之前的切点是否工具配对平衡（没有跨切点的未闭合工具调用）。 */
function toolPairingBalancedBefore(session, seq) {
  const nodes = session.surface.nodes;
  const events = session.events;
  let balance = 0;
  for (const n of nodes) {
    if (n === seq) break;
    balance += eventDelta(events[n]);
  }
  return balance === 0;
}

/** 在 seq 之后的切点是否工具配对平衡。 */
function toolPairingBalancedAfter(session, seq) {
  const nodes = session.surface.nodes;
  const events = session.events;
  let balance = 0;
  for (const n of nodes) {
    balance += eventDelta(events[n]);
    if (n === seq) break;
  }
  return balance === 0;
}

/** 选择头部锚定的可压缩区间，保留最近 retainTokens 的尾部，且不拆散工具调用对。 */
function selectRange(session, measurement, retainTokens) {
  const pricedNodes = measurement.nodes;
  if (pricedNodes.length === 0) return null;
  let accumulated = 0;
  let keepFromIdx = pricedNodes.length;
  for (let i = pricedNodes.length - 1; i >= 0; i -= 1) {
    accumulated += pricedNodes[i].tokens;
    keepFromIdx = i;
    if (accumulated >= retainTokens) break;
  }
  if (keepFromIdx === 0) return null;
  while (keepFromIdx > 0 && !toolPairingBalancedBefore(session, pricedNodes[keepFromIdx].seq)) keepFromIdx -= 1;
  if (keepFromIdx === 0) return null;
  const shadowedSeqs = pricedNodes.slice(0, keepFromIdx).map((n) => n.seq);
  return {
    start: shadowedSeqs[0],
    end: shadowedSeqs[shadowedSeqs.length - 1],
    startIdx: 0,
    endIdx: keepFromIdx - 1,
    shadowedSeqs
  };
}

/** 重建被压缩区域的回放输入（系统提示 + 工具 + 区域消息）。 */
function buildSummarizationInput(session, shadowedSeqs) {
  const header = session.requestHeader();
  const events = session.events;
  const regionMessages = shadowedSeqs
    .map((seq) => session.deriveEventMessage(events[seq]))
    .filter((m) => m !== null);
  return {
    ...(header?.system === undefined ? {} : { system: header.system }),
    ...(header?.tools === undefined ? {} : { tools: header.tools }),
    messages: regionMessages
  };
}

/** 解析摘要调用的目标 provider/model。 */
function resolveTarget(agent, session) {
  const header = session.requestHeader();
  const config = header?.config;
  if (config && typeof config.provider === "string" && config.provider.length > 0 && typeof config.model === "string" && config.model.length > 0) {
    return { provider: config.provider, model: config.model };
  }
  const opts = agent?.options;
  if (opts && typeof opts.provider === "string" && opts.provider.length > 0 && typeof opts.model === "string" && opts.model.length > 0) {
    return { provider: opts.provider, model: opts.model };
  }
  return undefined;
}

/** 当前打开中的 turn 编号；无打开 turn（空闲期）返回 null。 */
function currentOpenTurn(session) {
  const events = session.events;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i].type;
    if (type === "turn/start") return events[i].data.turn;
    if (type === "turn/end") return null;
  }
  return null;
}

/** 通过一次直接 LLM 调用生成摘要文本（不依赖 agent 的工具呈现模式，兼容 PTC）。 */
async function summarize(ctx, target, input, sessionId, signal) {
  const messages = [
    ...input.messages,
    {
      role: "user",
      content: [{ type: "text", text: COMPACTION_INSTRUCTION }],
      source: { kind: "plugin", plugin: name }
    }
  ];
  const options = {
    provider: target.provider,
    model: target.model,
    messages,
    ...(input.system === undefined ? {} : { system: input.system }),
    ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
    maxTokens: SUMMARY_MAX_TOKENS,
    ...(sessionId === undefined ? {} : { sessionId }),
    purpose: "compaction",
    ...(signal === undefined ? {} : { signal })
  };
  let text = "";
  let sawDelta = false;
  let textBlocks = [];
  let finish;
  for await (const chunk of ctx.llm.stream(options)) {
    if (chunk.type === "text-delta") {
      text += chunk.text;
      sawDelta = true;
    } else if (chunk.type === "block-end" && chunk.block && chunk.block.type === "text") {
      textBlocks.push(chunk.block.text);
    } else if (chunk.type === "finish") {
      finish = chunk.reason;
    }
  }
  if (!sawDelta) text = textBlocks.join("");
  if (finish && (finish.kind === "error" || finish.kind === "aborted")) {
    const message = finish.failure?.message || "summarization stream failed";
    throw new Error(`dsh-auto-compact: summarization ${finish.kind}: ${message}`);
  }
  const summaryText = text.trim();
  if (!summaryText) throw new Error("dsh-auto-compact: summarization produced no text");
  // 返回 ContentBlock[]（与 compaction/summary 的 summary 字段契约一致）
  return [{ type: "text", text: summaryText }];
}

/** 校验区间仍是有效的替换目标（表面在摘要期间未变化）。 */
function rangeStillValid(session, start, end, shadowedSeqs) {
  const nodes = session.surface.nodes;
  const startIdx = nodes.indexOf(start);
  const endIdx = nodes.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return false;
  const current = nodes.slice(startIdx, endIdx + 1);
  if (current.length !== shadowedSeqs.length) return false;
  return current.every((seq, i) => seq === shadowedSeqs[i]);
}

/**
 * 执行一次压缩事务：把 [start, end] 区间替换为一枚摘要 checkpoint 节点。
 * 不依赖 ctx.tokenMeter，因此兼容 PTC 等所有工具呈现模式。
 */
async function compactRegion(ctx, session, start, end, agent, signal, sourceCommandId) {
  const nodes = session.surface.nodes;
  const startIdx = nodes.indexOf(start);
  const endIdx = nodes.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error("dsh-auto-compact: invalid surface range");
  }
  if (!toolPairingBalancedBefore(session, nodes[startIdx])) {
    throw new Error("dsh-auto-compact: start seq is not a balanced boundary");
  }
  if (!toolPairingBalancedAfter(session, nodes[endIdx])) {
    throw new Error("dsh-auto-compact: end seq is not a balanced boundary");
  }
  const shadowedSeqs = nodes.slice(startIdx, endIdx + 1);
  const target = resolveTarget(agent, session);
  if (target === undefined) {
    throw new Error("dsh-auto-compact: no provider/model available for summarization");
  }
  const compactionId = randomUUID();
  const lifecycle = {
    compactionId,
    ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
    turn: currentOpenTurn(session)
  };

  const startEvent = session.append("compaction/start", lifecycle);

  try {
    const input = buildSummarizationInput(session, shadowedSeqs);
    const summaryBlocks = await summarize(ctx, target, input, session.id, signal);
    const summaryText = summaryBlocks.map((b) => (b && b.type === "text" ? b.text : "")).join("");

    if (!rangeStillValid(session, start, end, shadowedSeqs)) {
      throw new Error("dsh-auto-compact: surface changed during summarization");
    }

    // 被压缩节点的 token 总数（与 measure 的 heuristicTokens 口径一致）
    let shadowedTokenCount = 0;
    for (const seq of shadowedSeqs) {
      const event = session.events[seq];
      const msg = event ? session.deriveEventMessage(event) : null;
      shadowedTokenCount += msg ? estimateMessageTokens(msg) : 0;
    }

    const checkpointMessage = {
      id: randomUUID(),
      role: "user",
      content: [
        { type: "text", text: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}` },
        ...summaryBlocks,
        { type: "text", text: SUMMARY_CLOSE_TAG }
      ],
      source: {
        kind: "plugin",
        plugin: "compact",
        compactionId,
        ...(sourceCommandId === undefined ? {} : { sourceCommandId })
      }
    };

    const summaryEvent = session.append("compaction/summary", {
      compactionId,
      ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
      summary: summaryBlocks,
      shadowedRange: { start, end },
      shadowedSeqs: [...shadowedSeqs],
      shadowedTokenCount
    });

    session.append("user/message", checkpointMessage, {
      surfaceOp: { op: "replace", start, end },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs]
    });

    session.append("compaction/end", lifecycle);

    return {
      compactionId,
      shadowedRange: { start, end },
      shadowedSeqs,
      shadowedTokenCount,
      summary: summaryText
    };
  } catch (error) {
    try {
      session.append("compaction/end", {
        ...lifecycle,
        error: error instanceof Error ? error.message : String(error)
      });
    } catch {
      // 关闭标记失败时保留原始错误
    }
    throw error;
  }
}

/** 解析目标模型的上下文窗口；无法解析时返回 undefined。 */
async function resolveContextWindow(ctx, target, signal) {
  if (target === undefined) return undefined;
  try {
    const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
    return info?.context?.contextWindow;
  } catch {
    return undefined;
  }
}

/** 压力触发或溢出触发的自动压缩；不压缩时返回 null。 */
async function compactIfNeeded(ctx, cfg, agent, signal) {
  const session = agent.session;
  const target = resolveTarget(agent, session);
  if (target === undefined) return null;

  const measurement = measure(session);
  const contextWindow = await resolveContextWindow(ctx, target, signal);
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return null;

  const thresholdTokens = Math.floor(contextWindow * cfg.thresholdRatio);
  if (measurement.totalTokens < thresholdTokens) return null;

  const retainTokens = Math.floor(contextWindow * cfg.retainRatio);
  const range = selectRange(session, measurement, retainTokens);
  if (range === null) return null;

  return compactRegion(ctx, session, range.start, range.end, agent, signal, undefined);
}

/** 手动压缩：空闲时压缩，或通过按钮触发。 */
async function compactNow(ctx, cfg, agent, signal, sourceCommandId) {
  const session = agent.session;
  const target = resolveTarget(agent, session);
  const measurement = measure(session);
  const contextWindow = await resolveContextWindow(ctx, target, signal);
  const effectiveWindow = Number.isInteger(contextWindow) && contextWindow > 0 ? contextWindow : 1048576;
  const retainTokens = Math.floor(effectiveWindow * cfg.retainRatio);
  const range = selectRange(session, measurement, retainTokens);
  if (range === null) return { ok: false, message: "无可压缩的历史（No compactable history）" };
  const result = await compactRegion(ctx, session, range.start, range.end, agent, signal, sourceCommandId);
  try {
    await ctx.sessions.flush(session);
  } catch {
    // 持久化 flush 失败不影响本次压缩结果
  }
  return {
    ok: true,
    shadowed: result.shadowedSeqs.length,
    shadowedTokens: result.shadowedTokenCount,
    summary: result.summary
  };
}

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function apply(ctx, config) {
  const cfg = resolveConfig(config);
  if (!cfg.enabled) return;

  const active = new Set();

  // 自动压缩：轮次之间（agent/pre-step）的压力检测
  if (cfg.autoCompact) {
    ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
      if (signal.aborted) return next();
      try {
        const result = await compactIfNeeded(ctx, cfg, agent, signal);
        if (result !== null) {
          ctx.logger.info(`dsh-auto-compact: compacted ${result.shadowedSeqs.length} nodes (${result.shadowedRange.start}-${result.shadowedRange.end})`);
        }
      } catch (error) {
        ctx.logger.warn(`dsh-auto-compact: step compaction failed: ${error instanceof Error ? error.message : String(error)}; continuing the turn`);
      }
      return next();
    });

    // 溢出恢复：模型确认 CONTEXT_WINDOW_EXCEEDED 时强制压缩并重试
    ctx.on("agent/request-error", async ({ agent, failure, signal }, next) => {
      if (!failure || failure.code !== "CONTEXT_WINDOW_EXCEEDED" || signal.aborted) return next();
      const generation = agent.session.surface.replaceGeneration;
      try {
        const measurement = measure(agent.session);
        const range = selectRange(agent.session, measurement, 0);
        if (range === null) return next();
        await compactRegion(ctx, agent.session, range.start, range.end, agent, signal, undefined);
        if (agent.session.surface.replaceGeneration > generation) {
          return { kind: "retry" };
        }
        return next();
      } catch (error) {
        ctx.logger.warn(`dsh-auto-compact: overflow compaction failed: ${error instanceof Error ? error.message : String(error)}`);
        return next();
      }
    });
  }

  // 手动压缩 HTTP 端点（客户端按钮调用）
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/auto-compact/api",
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? "/", "http://dsh.internal");
            const sub = url.pathname.replace(/^\/auto-compact\/api\/?/, "");

            if (sub === "compact") {
              if (req.method !== "POST") {
                writeJson(res, 405, { ok: false, error: "method not allowed" });
                return;
              }
              const body = await readJsonBody(req);
              const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
              const agent = sessionId ? ctx.agents.get(sessionId) : undefined;
              if (!agent) {
                writeJson(res, 404, { ok: false, error: "session not found or not active" });
                return;
              }
              if (active.has(sessionId)) {
                writeJson(res, 409, { ok: false, error: "compaction already in progress" });
                return;
              }
              active.add(sessionId);
              try {
                const controller = new AbortController();
                const result = await agent.runMaintenance(async (agentSignal) => {
                  const opSignal = AbortSignal.any([agentSignal, controller.signal]);
                  return compactNow(ctx, cfg, agent, opSignal, undefined);
                });
                writeJson(res, 200, result);
              } catch (error) {
                writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
              } finally {
                active.delete(sessionId);
              }
              return;
            }

            writeJson(res, 404, { ok: false, error: "unknown method" });
          } catch (error) {
            writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }),
    "dsh-auto-compact: api"
  );
}

export { apply, inject, name };
