/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures when external services are unavailable
 * Includes observability integration for monitoring circuit state
 */

import { observability } from './observability';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  resetTimeout: number;          // Time in ms before attempting to close circuit
  monitoringPeriod: number;     // Time window to count failures
}

export enum CircuitState {
  CLOSED = 'CLOSED',           // Normal operation
  OPEN = 'OPEN',               // Circuit is open, calls fail fast
  HALF_OPEN = 'HALF_OPEN'      // Testing if service has recovered
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      resetTimeout: config.resetTimeout || 60000, // 1 minute default
      monitoringPeriod: config.monitoringPeriod || 10000 // 10 seconds default
    };
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    // Check if circuit should transition to HALF_OPEN
    if (this.state === CircuitState.OPEN && 
        Date.now() - this.lastFailureTime > this.config.resetTimeout) {
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
      console.log('[CircuitBreaker] Circuit transitioning to HALF_OPEN');
    }

    // Fail fast if circuit is OPEN
    if (this.state === CircuitState.OPEN) {
      const error = new Error('Circuit breaker is OPEN - service unavailable');
      if (fallback) {
        console.log('[CircuitBreaker] Using fallback due to OPEN circuit');
        return fallback();
      }
      throw error;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) {
        console.log('[CircuitBreaker] Using fallback after failure');
        return fallback();
      }
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    observability.recordMetric('circuit_breaker_success', 1, {
      state: this.state
    });
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 2) { // Need 2 consecutive successes to close
        this.state = CircuitState.CLOSED;
        console.log('[CircuitBreaker] Circuit CLOSED - service recovered');
        observability.info('Circuit breaker closed - service recovered');
        observability.recordMetric('circuit_breaker_state_change', 1, { from: 'HALF_OPEN', to: 'CLOSED' });
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    observability.recordMetric('circuit_breaker_failure', 1, {
      state: this.state,
      failure_count: this.failureCount.toString()
    });
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.error('[CircuitBreaker] Circuit OPEN due to failure threshold');
      observability.error('Circuit breaker opened', {
        failure_count: this.failureCount,
        threshold: this.config.failureThreshold
      });
      observability.recordMetric('circuit_breaker_state_change', 1, { from: 'CLOSED', to: 'OPEN' });
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
    console.log('[CircuitBreaker] Circuit manually reset');
  }
}

// Pre-configured circuit breakers for different services
export const circuitBreakers = {
  supabase: new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 30000,    // 30 seconds
    monitoringPeriod: 10000
  }),
  gps: new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 60000,    // 1 minute  
    monitoringPeriod: 15000
  }),
  storage: new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 45000,    // 45 seconds
    monitoringPeriod: 10000
  })
};

// Helper function to execute with circuit breaker
export async function withCircuitBreaker<T>(
  service: keyof typeof circuitBreakers,
  fn: () => Promise<T>,
  fallback?: () => T
): Promise<T> {
  return circuitBreakers[service].execute(fn, fallback);
}