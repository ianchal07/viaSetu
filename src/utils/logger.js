const levels = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(levelName = "info") {
  const min = levels[levelName] || levels.info;

  function emit(level, message, meta) {
    if (levels[level] < min) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg: message
    };
    if (meta && Object.keys(meta).length > 0) payload.meta = meta;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    debug: (message, meta = {}) => emit("debug", message, meta),
    info: (message, meta = {}) => emit("info", message, meta),
    warn: (message, meta = {}) => emit("warn", message, meta),
    error: (message, meta = {}) => emit("error", message, meta)
  };
}
