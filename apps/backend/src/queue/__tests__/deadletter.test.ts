import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeadLetterQueue, initDeadLetterQueue, resetDeadLetterQueueForTests } from '../deadletter';

describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = initDeadLetterQueue(86400000);
  });

  afterEach(() => {
    resetDeadLetterQueueForTests();
  });

  it('should move job to dead letter queue', () => {
    const jobId = 'job-1';
    const jobType = 'generate_response' as const;
    const data = { conversationId: 'conv-1' };
    const reason = 'Max retries exceeded';

    dlq.moveToDeadLetter(jobId, jobType, data, reason, 3);

    const entry = dlq.getEntry(jobId);
    expect(entry).toBeDefined();
    expect(entry?.jobId).toBe(jobId);
    expect(entry?.failureReason).toBe(reason);
    expect(entry?.failureCount).toBe(3);
  });

  it('should retrieve dead letter entry', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', {}, 'Failed', 3);

    const entry = dlq.getEntry('job-1');
    expect(entry).not.toBeNull();
    expect(entry?.jobId).toBe('job-1');
  });

  it('should return null for non-existent entry', () => {
    const entry = dlq.getEntry('non-existent');
    expect(entry).toBeNull();
  });

  it('should get entries by job type', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', {}, 'Failed', 3);
    dlq.moveToDeadLetter('job-2', 'index_message_search', {}, 'Failed', 3);
    dlq.moveToDeadLetter('job-3', 'generate_response', {}, 'Failed', 3);

    const entries = dlq.getEntriesByJobType('generate_response');
    expect(entries.length).toBe(2);
  });

  it('should get all entries', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', {}, 'Failed', 3);
    dlq.moveToDeadLetter('job-2', 'index_message_search', {}, 'Failed', 3);

    const all = dlq.getAllEntries();
    expect(all.length).toBe(2);
  });

  it('should remove entry from dead letter queue', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', {}, 'Failed', 3);
    const removed = dlq.removeEntry('job-1');

    expect(removed).toBe(true);
    expect(dlq.getEntry('job-1')).toBeNull();
  });

  it('should retry job from dead letter queue', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', { data: 'test' }, 'Failed', 3);

    const entry = dlq.retryJob('job-1');
    expect(entry).not.toBeNull();
    expect(dlq.getEntry('job-1')).toBeNull();
  });

  it('should get queue size', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', {}, 'Failed', 3);
    dlq.moveToDeadLetter('job-2', 'generate_response', {}, 'Failed', 3);

    expect(dlq.getSize()).toBe(2);
  });

  it('should clear all entries', () => {
    dlq.moveToDeadLetter('job-1', 'generate_response', {}, 'Failed', 3);
    dlq.moveToDeadLetter('job-2', 'generate_response', {}, 'Failed', 3);

    dlq.clear();
    expect(dlq.getSize()).toBe(0);
  });

  it('should start and stop cleanup interval', () => {
    dlq.start();
    expect(dlq.getSize()).toBe(0);

    dlq.stop();
    expect(dlq.getSize()).toBe(0);
  });
});
