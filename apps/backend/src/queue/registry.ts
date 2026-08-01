import { JobType, JobTypeDefinition, QueueJobHandler } from './types';
import { logger } from '../utils/logger';

class JobRegistry {
  private jobDefinitions: Map<JobType, JobTypeDefinition> = new Map();
  private jobHandlers: Map<JobType, QueueJobHandler> = new Map();

  registerJobType(definition: JobTypeDefinition, handler: QueueJobHandler): void {
    if (this.jobDefinitions.has(definition.name)) {
      throw new Error(`Job type "${definition.name}" is already registered`);
    }

    this.jobDefinitions.set(definition.name, definition);
    this.jobHandlers.set(definition.name, handler);

    logger.debug('[JobRegistry] Registered job type', {
      name: definition.name,
      timeout: definition.timeout,
      concurrency: definition.concurrency,
    });
  }

  getJobDefinition(name: JobType): JobTypeDefinition {
    const definition = this.jobDefinitions.get(name);
    if (!definition) {
      throw new Error(`Job type "${name}" not found in registry`);
    }
    return definition;
  }

  getJobHandler(name: JobType): QueueJobHandler {
    const handler = this.jobHandlers.get(name);
    if (!handler) {
      throw new Error(`Job handler for "${name}" not found in registry`);
    }
    return handler;
  }

  getAllJobDefinitions(): Map<JobType, JobTypeDefinition> {
    return new Map(this.jobDefinitions);
  }

  isJobTypeRegistered(name: JobType): boolean {
    return this.jobDefinitions.has(name);
  }
}

class QueueRegistry {
  private queues: Map<JobType, string> = new Map();

  registerQueue(jobType: JobType, queueName: string): void {
    this.queues.set(jobType, queueName);
    logger.debug('[QueueRegistry] Registered queue', {
      jobType,
      queueName,
    });
  }

  getQueueName(jobType: JobType): string {
    const name = this.queues.get(jobType);
    if (!name) {
      throw new Error(`Queue for job type "${jobType}" not registered`);
    }
    return name;
  }

  getAllQueues(): Map<JobType, string> {
    return new Map(this.queues);
  }
}

let jobRegistry: JobRegistry | null = null;
let queueRegistry: QueueRegistry | null = null;

export function getJobRegistry(): JobRegistry {
  if (!jobRegistry) {
    jobRegistry = new JobRegistry();
  }
  return jobRegistry;
}

export function getQueueRegistry(): QueueRegistry {
  if (!queueRegistry) {
    queueRegistry = new QueueRegistry();
  }
  return queueRegistry;
}

export function initJobRegistry(): JobRegistry {
  jobRegistry = new JobRegistry();
  return jobRegistry;
}

export function initQueueRegistry(): QueueRegistry {
  queueRegistry = new QueueRegistry();
  return queueRegistry;
}

export function resetRegistriesForTests(): void {
  jobRegistry = null;
  queueRegistry = null;
}
