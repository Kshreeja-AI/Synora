import { loadConfig } from '@synora/config';
import { buildPlatformContainer, createServer } from '@synora/gateway';
import { buildKshreejaAgents } from './agents/index.js';
import { calculatorTool } from './tools/calculator.tool.js';
import { currentTimeTool } from './tools/current-time.tool.js';
import { researchAndWriteWorkflow } from './workflows/research-and-write.workflow.js';

const config = loadConfig();
const container = buildPlatformContainer(config);

// Everything below is Kshreeja AI's product-specific wiring on top of the
// shared platform container — no platform code changes to add a product.
container.toolRegistry.register(calculatorTool);
container.toolRegistry.register(currentTimeTool);

for (const agent of buildKshreejaAgents(config, container.toolRegistry)) {
  container.agentRegistry.register(agent);
}

container.workflows.set(researchAndWriteWorkflow.id, researchAndWriteWorkflow);

const app = createServer(container);

app
  .listen({ port: config.GATEWAY_PORT, host: '0.0.0.0' })
  .then((address) => {
    container.logger.info(`Kshreeja AI listening at ${address}`, {
      agents: container.agentRegistry.list().map((a) => a.id),
      workflows: Array.from(container.workflows.keys()),
    });
  })
  .catch((error) => {
    container.logger.fatal('Kshreeja AI failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    container.logger.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  });
}
