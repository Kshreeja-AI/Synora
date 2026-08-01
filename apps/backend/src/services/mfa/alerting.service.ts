import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

export enum AlertChannel {
  EMAIL = 'EMAIL',
  WEBHOOK = 'WEBHOOK',
  LOG = 'LOG',
  SIEM = 'SIEM',
}

export interface Alert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  userId?: string;
  message: string;
  metadata: Record<string, unknown>;
  channels: AlertChannel[];
  sent: boolean;
  sentAt?: Date;
  createdAt: Date;
}

export class AlertingService {
  private alerts: Map<string, Alert> = new Map();
  private alertId = 0;

  constructor(private prisma: PrismaClient) {}

  async createAlert(
    type: string,
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
    message: string,
    userId?: string,
    metadata?: Record<string, unknown>,
    channels: AlertChannel[] = [AlertChannel.LOG]
  ): Promise<Alert> {
    const alert: Alert = {
      id: `alert-${++this.alertId}`,
      type,
      severity,
      userId,
      message,
      metadata: metadata || {},
      channels,
      sent: false,
      createdAt: new Date(),
    };

    this.alerts.set(alert.id, alert);
    await this.sendAlert(alert);

    return alert;
  }

  private async sendAlert(alert: Alert): Promise<void> {
    const channels = alert.channels || [AlertChannel.LOG];

    for (const channel of channels) {
      try {
        switch (channel) {
          case AlertChannel.LOG:
            await this.sendToLog(alert);
            break;
          case AlertChannel.EMAIL:
            await this.sendToEmail(alert);
            break;
          case AlertChannel.WEBHOOK:
            await this.sendToWebhook(alert);
            break;
          case AlertChannel.SIEM:
            await this.sendToSIEM(alert);
            break;
        }
      } catch (error) {
        logger.error(`Failed to send alert via ${channel}`, {
          alertType: alert.type,
          channel,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    alert.sent = true;
    alert.sentAt = new Date();
  }

  private async sendToLog(alert: Alert): Promise<void> {
    const logData = {
      alertType: alert.type,
      severity: alert.severity,
      message: alert.message,
      userId: alert.userId,
      metadata: alert.metadata,
    };

    switch (alert.severity) {
      case 'CRITICAL':
      case 'HIGH':
        logger.warn(alert.message, logData);
        break;
      default:
        logger.info(alert.message, logData);
    }
  }

  private async sendToEmail(alert: Alert): Promise<void> {
    logger.debug('Email alert would be sent', {
      alertType: alert.type,
      severity: alert.severity,
      recipient: 'admin',
    });
  }

  private async sendToWebhook(alert: Alert): Promise<void> {
    logger.debug('Webhook notification would be sent', {
      alertType: alert.type,
      severity: alert.severity,
    });
  }

  private async sendToSIEM(alert: Alert): Promise<void> {
    logger.debug('SIEM event would be logged', {
      alertType: alert.type,
      severity: alert.severity,
    });
  }

  async acknowledgeAlert(alertId: string): Promise<Alert | null> {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;

    alert.metadata.acknowledgedAt = new Date();
    alert.metadata.acknowledged = true;

    return alert;
  }

  async getAlertsByUserId(userId: string): Promise<Alert[]> {
    return Array.from(this.alerts.values()).filter((a) => a.userId === userId);
  }

  async getAlertsBySeverity(severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'): Promise<Alert[]> {
    return Array.from(this.alerts.values()).filter((a) => a.severity === severity);
  }

  async getRecentAlerts(minutesLookback: number = 60): Promise<Alert[]> {
    const cutoffTime = new Date(Date.now() - minutesLookback * 60 * 1000);
    return Array.from(this.alerts.values()).filter((a) => a.createdAt >= cutoffTime);
  }

  async getUnacknowledgedAlerts(): Promise<Alert[]> {
    return Array.from(this.alerts.values()).filter((a) => !a.metadata.acknowledged);
  }

  async getAlertSummary(): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    unacknowledged: number;
  }> {
    const allAlerts = Array.from(this.alerts.values());

    const bySeverity = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };

    const byType: Record<string, number> = {};
    let unacknowledged = 0;

    allAlerts.forEach((alert) => {
      bySeverity[alert.severity]++;
      byType[alert.type] = (byType[alert.type] || 0) + 1;
      if (!alert.metadata.acknowledged) unacknowledged++;
    });

    return {
      total: allAlerts.length,
      bySeverity,
      byType,
      unacknowledged,
    };
  }

  async clearOldAlerts(daysOld: number = 7): Promise<number> {
    const cutoffTime = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const [id, alert] of this.alerts.entries()) {
      if (alert.createdAt < cutoffTime) {
        this.alerts.delete(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }
}

export function createAlertingService(prisma: PrismaClient): AlertingService {
  return new AlertingService(prisma);
}
