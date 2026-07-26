import { prisma } from '@synora/database';
import { NotFoundException } from '@synora/shared';

export async function listInvoices(
  actorId: string,
  workspaceId: string,
  options?: { before?: Date }
) {
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId,
      ...(options?.before && { createdAt: { lt: options.before } }),
    },
    orderBy: { issuedAt: 'desc' },
    take: 50,
  });

  return invoices;
}

export async function getInvoice(actorId: string, workspaceId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice || invoice.workspaceId !== workspaceId) {
    throw new NotFoundException('Invoice');
  }

  return invoice;
}
