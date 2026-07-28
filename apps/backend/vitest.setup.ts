// Set up environment for tests
process.env.DATABASE_URL ||= 'postgresql://synora:synora@localhost:5432/synora';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-testing-only';
process.env.STRIPE_API_KEY ||= 'sk_test_fake_key_for_testing';

// Database health check with retry logic
// This ensures the database service is ready before any tests attempt to run
const checkDatabaseReady = async (): Promise<void> => {
  const { prisma } = await import('@synora/database');
  const maxAttempts = 30;
  const delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        ),
      ]);
      if (attempt > 1) {
        console.log(`✓ Database ready after ${attempt} attempts`);
      }
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.error(`✗ Database unavailable after ${maxAttempts} attempts`);
        throw error;
      }
      if (attempt % 5 === 0) {
        console.log(`⏳ Database not ready, retrying... (${attempt}/${maxAttempts})`);
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};

// Execute database health check before tests
await checkDatabaseReady();
