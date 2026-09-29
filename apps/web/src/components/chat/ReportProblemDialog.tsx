/**
 * Modal that lets a user submit a Correction or a HallucinationReport
 * against a single assistant message. Delegates the actual form UI to
 * the design-system `FeedbackCorrection` / `FeedbackHallucination`
 * components — this file's job is just the tab switch, the dialog
 * shell, and the submit wiring against the feedback API.
 */

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  FeedbackCorrection,
  FeedbackHallucination,
} from '@synora/design-system';
import { feedbackApi } from '@/lib/api/feedback';
import type {
  CorrectionInput,
  HallucinationReportInput,
} from '@/lib/api/feedback';

type Mode = 'correction' | 'hallucination';

interface ReportProblemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  messageContent: string;
}

export function ReportProblemDialog({
  open,
  onOpenChange,
  workspaceId,
  conversationId,
  messageId,
  messageContent,
}: ReportProblemDialogProps) {
  const [mode, setMode] = useState<Mode>('correction');
  const [submitting, setSubmitting] = useState(false);

  const submitCorrection = async (data: {
    correctedContent: string;
    correctionType: string;
    reason?: string;
    confidence?: number;
  }) => {
    setSubmitting(true);
    try {
      const input: CorrectionInput = {
        messageId,
        conversationId,
        originalContent: messageContent,
        correctedContent: data.correctedContent,
        correctionType: data.correctionType as CorrectionInput['correctionType'],
        reason: data.reason,
        confidence: data.confidence,
      };
      await feedbackApi.createCorrection(workspaceId, input);
      toast.success('Correction submitted — thank you');
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to submit correction'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitHallucination = async (data: {
    hallucinatedText: string;
    factualCorrection: string;
    severity: string;
    category: string;
    evidence?: string;
    sourceUrl?: string;
  }) => {
    setSubmitting(true);
    try {
      const input: HallucinationReportInput = {
        messageId,
        conversationId,
        hallucinatedText: data.hallucinatedText,
        factualCorrection: data.factualCorrection,
        severity: data.severity as HallucinationReportInput['severity'],
        category: data.category as HallucinationReportInput['category'],
        evidence: data.evidence,
        sourceUrl: data.sourceUrl,
      };
      await feedbackApi.reportHallucination(workspaceId, input);
      toast.success('Report submitted — thank you');
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to submit hallucination report'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Help us improve. Corrections and hallucination reports are
            reviewed and used to refine the model responses.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Report type" className="flex gap-1 border-b border-border">
          <button
            role="tab"
            type="button"
            aria-selected={mode === 'correction'}
            onClick={() => setMode('correction')}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition ${
              mode === 'correction'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Correction
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={mode === 'hallucination'}
            onClick={() => setMode('hallucination')}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition ${
              mode === 'hallucination'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Hallucination
          </button>
        </div>

        {mode === 'correction' ? (
          <FeedbackCorrection
            originalContent={messageContent}
            isLoading={submitting}
            onSubmit={submitCorrection}
            onCancel={handleClose}
          />
        ) : (
          <FeedbackHallucination
            messageContent={messageContent}
            isLoading={submitting}
            onSubmit={submitHallucination}
            onCancel={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
