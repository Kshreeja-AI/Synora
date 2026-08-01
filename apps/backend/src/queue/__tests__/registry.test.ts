import { describe, it, expect, beforeEach } from 'vitest';
import { initJobRegistry, initQueueRegistry, resetRegistriesForTests } from '../registry';
import { JobTypeDefinition, JobType } from '../types';

describe('JobRegistry', () => {
  beforeEach(() => {
    resetRegistriesForTests();
  });

  it('should register a job type', () => {
    const registry = initJobRegistry();
    const definition: JobTypeDefinition = {
      name: 'generate_response',
      timeout: 30000,
      concurrency: 5,
    };

    registry.registerJobType(definition, async () => {});
    expect(registry.isJobTypeRegistered('generate_response')).toBe(true);
  });

  it('should throw error when registering duplicate job type', () => {
    const registry = initJobRegistry();
    const definition: JobTypeDefinition = {
      name: 'generate_response',
    };

    registry.registerJobType(definition, async () => {});

    expect(() => {
      registry.registerJobType(definition, async () => {});
    }).toThrow();
  });

  it('should retrieve registered job definition', () => {
    const registry = initJobRegistry();
    const definition: JobTypeDefinition = {
      name: 'generate_response',
      timeout: 30000,
    };

    registry.registerJobType(definition, async () => {});
    const retrieved = registry.getJobDefinition('generate_response');

    expect(retrieved.name).toBe('generate_response');
    expect(retrieved.timeout).toBe(30000);
  });

  it('should throw error when retrieving unregistered job type', () => {
    const registry = initJobRegistry();

    expect(() => {
      registry.getJobDefinition('cleanup' as JobType);
    }).toThrow();
  });

  it('should get all job definitions', () => {
    const registry = initJobRegistry();

    registry.registerJobType({ name: 'generate_response' }, async () => {});
    registry.registerJobType({ name: 'index_message_search' }, async () => {});

    const all = registry.getAllJobDefinitions();
    expect(all.size).toBe(2);
  });
});

describe('QueueRegistry', () => {
  beforeEach(() => {
    resetRegistriesForTests();
  });

  it('should register a queue', () => {
    const registry = initQueueRegistry();
    registry.registerQueue('generate_response', 'generate_response_queue');

    const name = registry.getQueueName('generate_response');
    expect(name).toBe('generate_response_queue');
  });

  it('should throw error when retrieving unregistered queue', () => {
    const registry = initQueueRegistry();

    expect(() => {
      registry.getQueueName('cleanup' as JobType);
    }).toThrow();
  });

  it('should get all registered queues', () => {
    const registry = initQueueRegistry();

    registry.registerQueue('generate_response', 'gen_queue');
    registry.registerQueue('index_message_search', 'index_queue');

    const all = registry.getAllQueues();
    expect(all.size).toBe(2);
  });
});
