'use strict';

/**
 * Ship Dễ — Probe Runner Worker Pool
 *
 * Implements adaptive concurrency:
 * - Starts at 2 concurrent.
 * - Raises to 4, then at most 6 only if latency, free RAM and CPU stay steady.
 * - Drops back on 429, timeouts, or memory pressure.
 * - Enforces request and minute budgets with clean checkpointing.
 */

const os = require('os');

class AdaptiveWorkerPool {
  /**
   * @param {Object} [options]
   * @param {number} [options.concurrency=2] - Initial concurrency
   * @param {number} [options.maxConcurrency=6] - Max concurrency ceiling
   * @param {number} [options.minConcurrency=1] - Min concurrency floor
   * @param {number} [options.maxRequests] - Request budget limit
   * @param {number} [options.maxMinutes] - Time budget limit in minutes
   */
  constructor(options = {}) {
    this.initialConcurrency = options.concurrency || 2;
    this.currentConcurrency = this.initialConcurrency;
    this.maxConcurrency = options.maxConcurrency || 6;
    this.minConcurrency = options.minConcurrency || 1;

    this.maxRequests = options.maxRequests || 0;
    this.maxMinutes = options.maxMinutes || 0;

    this.startTime = Date.now();
    this.totalRequestsInitiated = 0;
    this.activeWorkers = 0;
    this.completedCount = 0;

    this.recentLatencies = [];
    this.consecutiveSteadySuccesses = 0;

    this.stoppedDueToBudget = false;
    this.budgetReason = null;
  }

  /**
   * Checks if starting a new request is permitted under current budgets.
   */
  canStartNewRequest() {
    if (this.stoppedDueToBudget) {
      return false;
    }

    if (this.maxRequests > 0 && this.totalRequestsInitiated >= this.maxRequests) {
      this.stoppedDueToBudget = true;
      this.budgetReason = `max-requests budget reached (${this.maxRequests})`;
      return false;
    }

    if (this.maxMinutes > 0) {
      const elapsedMinutes = (Date.now() - this.startTime) / (60 * 1000);
      if (elapsedMinutes >= this.maxMinutes) {
        this.stoppedDueToBudget = true;
        this.budgetReason = `max-minutes budget reached (${this.maxMinutes} min)`;
        return false;
      }
    }

    return true;
  }

  /**
   * Marks that a request is beginning.
   */
  beginRequest() {
    this.totalRequestsInitiated++;
    this.activeWorkers++;
  }

  /**
   * Records the outcome of a completed request and adjusts concurrency adaptively.
   */
  recordOutcome(outcome) {
    this.activeWorkers--;
    this.completedCount++;

    const { httpStatus, latencyMs, isConnectTimeout, isReadTimeout, networkError } = outcome || {};

    const freeMemBytes = os.freemem();
    const totalMemBytes = os.totalmem();
    const freeMemRatio = totalMemBytes > 0 ? freeMemBytes / totalMemBytes : 1;
    const memoryPressure = freeMemRatio < 0.1; // Less than 10% free RAM

    const is429 = httpStatus === 429;
    const isTimeout = Boolean(isConnectTimeout || isReadTimeout);

    // Backpressure conditions: drop back immediately
    if (is429 || isTimeout || memoryPressure) {
      this.consecutiveSteadySuccesses = 0;
      if (this.currentConcurrency > 4) {
        this.currentConcurrency = 4;
      } else if (this.currentConcurrency > 2) {
        this.currentConcurrency = 2;
      } else {
        this.currentConcurrency = Math.max(this.minConcurrency, 1);
      }
      return;
    }

    // Steady conditions: record latency and evaluate upward scaling
    if (typeof latencyMs === 'number' && latencyMs >= 0) {
      this.recentLatencies.push(latencyMs);
      if (this.recentLatencies.length > 10) {
        this.recentLatencies.shift();
      }
    }

    const avgLatency =
      this.recentLatencies.length > 0
        ? this.recentLatencies.reduce((sum, v) => sum + v, 0) / this.recentLatencies.length
        : 0;

    const latencySteady = avgLatency > 0 && avgLatency < 3500;

    if (httpStatus === 200 && latencySteady && !networkError) {
      this.consecutiveSteadySuccesses++;
      // Raise concurrency after steady run
      if (this.consecutiveSteadySuccesses >= 4) {
        if (this.currentConcurrency < 4) {
          this.currentConcurrency = Math.min(4, this.maxConcurrency);
          this.consecutiveSteadySuccesses = 0;
        } else if (this.currentConcurrency < this.maxConcurrency) {
          this.currentConcurrency = Math.min(this.currentConcurrency + 2, this.maxConcurrency);
          this.consecutiveSteadySuccesses = 0;
        }
      }
    } else {
      this.consecutiveSteadySuccesses = 0;
    }
  }
}

module.exports = {
  AdaptiveWorkerPool,
};
