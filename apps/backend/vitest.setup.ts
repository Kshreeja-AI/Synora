// Set up environment for tests
process.env.DATABASE_URL ||= 'postgresql://synora:synora@localhost:5432/synora';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-testing-only';
process.env.STRIPE_API_KEY ||= 'sk_test_fake_key_for_testing';
process.env.TOOL_SECRET_MASTER_KEY ||= 'test-only-not-a-real-secret-tool-master-key-000000';

// Production defaults to REGISTRATION_MODE=invite (closed beta). The many suites
// that create users through /api/auth/register are testing something else, so
// they run in open mode; the gate itself is tested in registrationPolicy.test.ts
// and registrationGate.test.ts, which set the mode explicitly.
process.env.REGISTRATION_MODE ||= 'open';

// Hermeticity: a developer's ambient endpoint env must never flip the
// command layer's availability answers mid-suite. Tests that WANT a
// configured model set these explicitly and reset config themselves.
delete process.env.OLLAMA_BASE_URL;
delete process.env.OLLAMA_API_KEY;
delete process.env.OLLAMA_MODELS;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.SELF_HOSTED_TEXT_BASE_URL;
delete process.env.SELF_HOSTED_TEXT_API_KEY;
delete process.env.SELF_HOSTED_TEXT_MODEL;
delete process.env.SELF_HOSTED_TEXT_MODELS;
