import { AuditEvent, JobType } from './types';
import { logger } from '../utils/logger';

export class QueueAuditLog {
  private events: AuditEvent[] = [];
  private maxEvents = 1000;
  private static instance: QueueAuditLog | null = null;

  private constructor() {}

  static getInstance(): QueueAuditLog {
    if (!QueueAuditLog.instance) {
      QueueAuditLog.instance = new QueueAuditLog();
    }
    return QueueAuditLog.instance;
  }

  recordEvent(event: AuditEvent): void {
    this.events.push(event);

    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    logger.debug('[QueueAudit]', {
      type: event.type,
      jobType: event.jobType,
      jobId: event.jobId,
      error: event.error,
      workerId: event.workerId,
    });
  }

  recordJobCreated(jobType: JobType, jobId: string, details?: Record<string, unknown>): void {
    this.recordEvent({
      type: 'job_created',
      jobType,
      jobId,
      timestamp: new Date(),
      details,
    });
  }

  recordJobStarted(jobType: JobType, jobId: string, workerId?: string): void {
    this.recordEvent({
      type: 'job_started',
      jobType,
      jobId,
      timestamp: new Date(),
      workerId,
    });
  }

  recordJobCompleted(jobType: JobType, jobId: string, workerId?: string, details?: Record<string, unknown>): void {
    this.recordEvent({
      type: 'job_completed',
      jobType,
      jobId,
      timestamp: new Date(),
      details,
      workerId,
    });
  }

  recordJobFailed(jobType: JobType, jobId: string, error: string, workerId?: string): void {
    this.recordEvent({
      type: 'job_failed',
      jobType,
      jobId,
      timestamp: new Date(),
      error,
      workerId,
    });
  }

  recordJobRetried(jobType: JobType, jobId: string, attemptNumber: number): void {
    this.recordEvent({
      type: 'job_retried',
      jobType,
      jobId,
      timestamp: new Date(),
      details: { attemptNumber },
    });
  }

  recordJobMovedToDeadLetter(jobType: JobType, jobId: string, reason: string): void {
    this.recordEvent({
      type: 'job_moved_to_deadletter',
      jobType,
      jobId,
      timestamp: new Date(),
      error: reason,
    });
  }

  recordWorkerStarted(jobType: JobType, workerId: string): void {
    this.recordEvent({
      type: 'worker_started',
      jobType,
      jobId: workerId,
      timestamp: new Date(),
      workerId,
    });
  }

  recordWorkerStopped(jobType: JobType, workerId: string): void {
    this.recordEvent({
      type: 'worker_stopped',
      jobType,
      jobId: workerId,
      timestamp: new Date(),
      workerId,
    });
  }

  getEvents(limit: number = 100): AuditEvent[] {
    return this.events.slice(-limit);
  }

  getEventsByJobType(jobType: JobType, limit: number = 50): AuditEvent[] {
    return this.events.filter(e => e.jobType === jobType).slice(-limit);
  }

  clear(): void {
    this.events = [];
  }
}

export function getQueueAuditLog(): QueueAuditLog {
  return QueueAuditLog.getInstance();
}
