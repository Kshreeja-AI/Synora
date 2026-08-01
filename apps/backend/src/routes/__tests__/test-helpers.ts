import { prisma as db } from '@synora/database'

/**
 * Cleans up test data
 */
export async function cleanupTestDatabase() {
  try {
    await db.memory.deleteMany({})
    await db.memoryAuditLog.deleteMany({})
    await db.workspaceMember.deleteMany({})
    await db.workspace.deleteMany({})
    await db.user.deleteMany({})
  } catch (error) {
    console.error('Error cleaning up test database:', error)
  }
}

/**
 * Creates a test user in the database
 */
export async function createTestUser(overrides: {
  email?: string
  name?: string
  role?: 'USER' | 'ADMIN' | 'MODERATOR'
} = {}) {
  const { email = `test-${Date.now()}@example.com`, name = 'Test User', role = 'USER' } = overrides

  return db.user.create({
    data: {
      email,
      name,
      role,
      password: 'hashed-password',
      emailVerified: new Date(),
    },
  })
}

/**
 * Creates a test workspace in the database
 */
export async function createTestWorkspace(
  userId: string,
  overrides: {
    name?: string
    slug?: string
  } = {},
) {
  const { name = `Test Workspace ${Date.now()}`, slug = `test-${Date.now()}` } = overrides

  return db.workspace.create({
    data: {
      name,
      slug,
      members: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
    },
    include: {
      members: true,
    },
  })
}

/**
 * Generates a JWT token for testing (simple mock)
 */
export function generateTestToken(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url')

  const signature = Buffer.from('mock-signature').toString('base64url')
  return `${header}.${payload}.${signature}`
}
