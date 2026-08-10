import { loadEnv } from './config/loadEnv';

/**
 * Side-effect module: importing this loads the environment.
 *
 * WHY A MODULE AND NOT JUST A FUNCTION CALL. ESM evaluates every `import`
 * in a file BEFORE any statement in that file's body. So an entrypoint
 * written as
 *
 *     import { loadEnv } from './config/loadEnv';
 *     import { prisma } from '@synora/database';
 *     loadEnv();
 *
 * loads the environment far too late: `@synora/database` has already been
 * evaluated, and its Prisma client was constructed against a `DATABASE_URL`
 * that did not exist yet. Booting the server that way produced a live
 * process whose `/health` returned 200 and whose `/ready` returned 503 with
 * "You must provide a nonempty URL" — the application up, and unable to
 * reach a database that was running fine.
 *
 * That is the failure mode a function call cannot fix and an import can:
 * imports are evaluated in source order, so making this the FIRST import of
 * an entrypoint guarantees the environment exists before anything reads it.
 * `import 'dotenv/config'` worked for exactly this reason, and replacing it
 * with a call was the regression.
 *
 * Keep this as the first import in every entrypoint.
 */
loadEnv();
