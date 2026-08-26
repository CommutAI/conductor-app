/**
 * Observability Service
 * Structured logging and metrics collection for system monitoring
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  userId?: string;
  sessionId?: string;
}

export interface Metric {
  name: string;
  value: number;
  timestamp: string;
  tags?: Record<string, string>;
}

class ObservabilityService {
  private logs: LogEntry[] = [];
  private metrics: Metric[] = [];
  private maxLogs = 100; // Keep last 100 logs in memory
  private maxMetrics = 50; // Keep last 50 metrics in memory
  private sessionId: string;

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Structured logging with context
   */
  log(level: LogLevel, message: string, context?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      sessionId: this.sessionId,
    };

    // Add to in-memory logs
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console output for development
    const consoleMethod = level === LogLevel.ERROR ? 'error' : 
                         level === LogLevel.WARN ? 'warn' : 
                         level === LogLevel.DEBUG ? 'debug' : 'log';
    
    console[consoleMethod](`[${level}] ${message}`, context || '');

    // In production, you would send this to a logging service
    // this.sendToLoggingService(entry);
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  /**
   * Record a metric
   */
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    const metric: Metric = {
      name,
      value,
      timestamp: new Date().toISOString(),
      tags,
    };

    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    console.log(`[Metric] ${name}: ${value}`, tags || '');

    // In production, you would send this to a metrics service
    // this.sendToMetricsService(metric);
  }

  /**
   * Timer helper for measuring operation duration
   */
  startTimer(operationName: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.recordMetric(`${operationName}_duration_ms`, duration);
      this.info(`Operation completed: ${operationName}`, { duration_ms: duration });
    };
  }

  /**
   * Performance monitoring wrapper
   */
  async monitorPerformance<T>(
    operationName: string,
    fn: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<T> {
    const endTimer = this.startTimer(operationName);
    try {
      const result = await fn();
      this.recordMetric(`${operationName}_success`, 1);
      this.info(`Operation success: ${operationName}`, context);
      return result;
    } catch (error) {
      this.recordMetric(`${operationName}_error`, 1);
      this.error(`Operation failed: ${operationName}`, {
        ...context,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      endTimer();
    }
  }

  /**
   * Get recent logs
   */
  getLogs(level?: LogLevel, limit?: number): LogEntry[] {
    let filtered = this.logs;
    if (level) {
      filtered = filtered.filter(log => log.level === level);
    }
    if (limit) {
      filtered = filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * Get recent metrics
   */
  getMetrics(metricName?: string, limit?: number): Metric[] {
    let filtered = this.metrics;
    if (metricName) {
      filtered = filtered.filter(metric => metric.name === metricName);
    }
    if (limit) {
      filtered = filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(operationName: string): {
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    successRate: number;
    totalOperations: number;
  } {
    const durationMetrics = this.metrics.filter(m => 
      m.name === `${operationName}_duration_ms`
    );
    const successMetrics = this.metrics.filter(m => 
      m.name === `${operationName}_success`
    );
    const errorMetrics = this.metrics.filter(m => 
      m.name === `${operationName}_error`
    );

    const durations = durationMetrics.map(m => m.value);
    const successCount = successMetrics.length;
    const errorCount = errorMetrics.length;
    const totalOperations = successCount + errorCount;

    if (durations.length === 0) {
      return {
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        successRate: totalOperations > 0 ? (successCount / totalOperations) * 100 : 0,
        totalOperations,
      };
    }

    return {
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      successRate: totalOperations > 0 ? (successCount / totalOperations) * 100 : 0,
      totalOperations,
    };
  }

  /**
   * Clear logs and metrics
   */
  clear(): void {
    this.logs = [];
    this.metrics = [];
    console.log('[Observability] Cleared logs and metrics');
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Export singleton instance
export const observability = new ObservabilityService();

// Convenience functions for common logging patterns
export const logScanOperation = (operation: string, success: boolean, context?: Record<string, any>) => {
  if (success) {
    observability.info(`Scan operation success: ${operation}`, context);
    observability.recordMetric(`scan_${operation}_success`, 1);
  } else {
    observability.error(`Scan operation failed: ${operation}`, context);
    observability.recordMetric(`scan_${operation}_error`, 1);
  }
};

export const logApiCall = (endpoint: string, duration: number, success: boolean) => {
  observability.recordMetric(`api_${endpoint}_duration_ms`, duration);
  if (success) {
    observability.recordMetric(`api_${endpoint}_success`, 1);
  } else {
    observability.recordMetric(`api_${endpoint}_error`, 1);
  }
};

export const logCacheOperation = (operation: 'hit' | 'miss' | 'set' | 'delete', key: string) => {
  observability.recordMetric(`cache_${operation}`, 1, { key_pattern: key.split(':')[0] });
  observability.debug(`Cache ${operation}`, { key });
};