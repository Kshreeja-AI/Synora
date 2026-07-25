export type { MailMessage, MailTransport, MailContent } from './types';
export { MailTransportError } from './types';
export { TRANSPORT_REGISTRY, getTransportDescriptor } from './registry';
export type { MailTransportDescriptor } from './registry';
export { resolveMailTransport } from './resolver';
export {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendAccountDeletedEmail,
} from './mailer';
