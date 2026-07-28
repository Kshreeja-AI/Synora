// Set up environment for tests
process.env.DATABASE_URL ||= 'postgresql://synora:synora@localhost:5432/synora';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-testing-only';
process.env.STRIPE_API_KEY ||= 'sk_test_fake_key_for_testing';
