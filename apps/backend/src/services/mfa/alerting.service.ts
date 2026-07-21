import { PrismaClient } from '@prisma/client';

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
  metadata: Record<string, any>;
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
    metadata?: Record<string, any>,
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
        console.error(`[AlertingService] Failed to send alert via ${channel}:`, error);
      }
    }

    alert.sent = true;
    alert.sentAt = new Date();
  }

  private async sendToLog(alert: Alert): Promise<void> {
    const message = `[MFA-ALERT] [${alert.severity}] ${alert.type}: ${alert.message}`;
    if (alert.severity === 'CRITICAL') {
      console.error(message, alert.metadata);
    } else if (alert.severity === 'HIGH') {
      console.warn(message, alert.metadata);
    } else {
      console.log(message, alert.metadata);
    }
  }

  private async sendToEmail(alert: Alert): Promise<void> {
    // Stub for email integration (SendGrid, AWS SES, etc.)
    console.log(`[AlertingService] Email alert would be sent for ${alert.type} to admin`, alert.metadata);
  }

  private async sendToWebhook(alert: Alert): Promise<void> {
    // Stub for webhook integration (Slack, PagerDuty, etc.)
    console.log(`[AlertingService] Webhook notification would be sent for ${alert.type}`, alert.metadata);
  }

  private async sendToSIEM(alert: Alert): Promise<void> {
    // Stub for SIEM integration (Splunk, ELK, CloudWatch, etc.)
    console.log(`[AlertingService] SIEM event would be logged for ${alert.type}`, alert.metadata);
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
