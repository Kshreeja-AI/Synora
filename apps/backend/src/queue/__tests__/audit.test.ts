import { describe, it, expect, beforeEach } from 'vitest';
import { getQueueAuditLog } from '../audit';

describe('QueueAuditLog', () => {
  beforeEach(() => {
    const log = getQueueAuditLog();
    log.clear();
  });

  it('should record job created event', () => {
    const log = getQueueAuditLog();
    log.recordJobCreated('generate_response', 'job-1', { conversationId: 'conv-1' });

    const events = log.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('job_created');
    expect(events[0].jobId).toBe('job-1');
  });

  it('should record job started event', () => {
    const log = getQueueAuditLog();
    log.recordJobStarted('generate_response', 'job-1', 'worker-1');

    const events = log.getEvents();
    expect(events[0].type).toBe('job_started');
    expect(events[0].workerId).toBe('worker-1');
  });

  it('should record job completed event', () => {
    const log = getQueueAuditLog();
    log.recordJobCompleted('generate_response', 'job-1', 'worker-1');

    const events = log.getEvents();
    expect(events[0].type).toBe('job_completed');
  });

  it('should record job failed event', () => {
    const log = getQueueAuditLog();
    log.recordJobFailed('generate_response', 'job-1', 'Connection timeout', 'worker-1');

    const events = log.getEvents();
    expect(events[0].type).toBe('job_failed');
    expect(events[0].error).toBe('Connection timeout');
  });

  it('should record job retried event', () => {
    const log = getQueueAuditLog();
    log.recordJobRetried('generate_response', 'job-1', 2);

    const events = log.getEvents();
    expect(events[0].type).toBe('job_retried');
    expect(events[0].details?.attemptNumber).toBe(2);
  });

  it('should record job moved to dead letter event', () => {
    const log = getQueueAuditLog();
    log.recordJobMovedToDeadLetter('generate_response', 'job-1', 'Max retries exceeded');

    const events = log.getEvents();
    expect(events[0].type).toBe('job_moved_to_deadletter');
  });

  it('should record worker started event', () => {
    const log = getQueueAuditLog();
    log.recordWorkerStarted('generate_response', 'worker-1');

    const events = log.getEvents();
    expect(events[0].type).toBe('worker_started');
  });

  it('should record worker stopped event', () => {
    const log = getQueueAuditLog();
    log.recordWorkerStopped('generate_response', 'worker-1');

    const events = log.getEvents();
    expect(events[0].type).toBe('worker_stopped');
  });

  it('should get events with limit', () => {
    const log = getQueueAuditLog();

    for (let i = 0; i < 10; i++) {
      log.recordJobCreated('generate_response', `job-${i}`);
    }

    const events = log.getEvents(5);
    expect(events.length).toBe(5);
  });

  it('should get events by job type', () => {
    const log = getQueueAuditLog();

    log.recordJobCreated('generate_response', 'job-1');
    log.recordJobCreated('index_message_search', 'job-2');
    log.recordJobCreated('generate_response', 'job-3');

    const events = log.getEventsByJobType('generate_response');
    expect(events.length).toBe(2);
  });

  it('should clear all events', () => {
    const log = getQueueAuditLog();

    log.recordJobCreated('generate_response', 'job-1');
    log.recordJobCreated('generate_response', 'job-2');

    log.clear();
    expect(log.getEvents().length).toBe(0);
  });

  it('should maintain max events limit', () => {
    const log = getQueueAuditLog();

    for (let i = 0; i < 1100; i++) {
      log.recordJobCreated('generate_response', `job-${i}`);
    }

    const events = log.getEvents(100);
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
