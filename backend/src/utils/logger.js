const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(level = LogLevel.INFO) {
    this.level = level;
  }

  setLevel(level) {
    this.level = level;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const levelStr = Object.keys(LogLevel).find(key => LogLevel[key] === level);
    return `[${timestamp}] [${levelStr}] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}`;
  }

  debug(message, ...args) {
    if (this.level <= LogLevel.DEBUG) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, ...args));
    }
  }

  info(message, ...args) {
    if (this.level <= LogLevel.INFO) {
      console.log(this.formatMessage(LogLevel.INFO, message, ...args));
    }
  }

  warn(message, ...args) {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.formatMessage(LogLevel.WARN, message, ...args));
    }
  }

  error(message, ...args) {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.formatMessage(LogLevel.ERROR, message, ...args));
    }
  }
}

// Create singleton instance
export const logger = new Logger(
  process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG
);

export { LogLevel };