import { NextRequest, NextResponse } from 'next/server';

import { getErrorMessages } from '@/lib/trustlesswork-errors';
import { TrustlessWorkRequestError, trustlessWorkRequest } from '@/lib/server/trustlesswork';

type MilestoneStatusRequestBody = {
  contractId?: string;
  serviceProvider?: string;
  engagementId?: string;
  milestoneIndex?: number;
  newStatus?: string;
  newEvidence?: string;
};

type ChangeMilestoneStatusResponse = {
  unsignedXdr: string;
  txHash: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MilestoneStatusRequestBody;
    const { contractId, serviceProvider, engagementId, milestoneIndex, newStatus, newEvidence } = body;

    if (!contractId || !serviceProvider || !engagementId) {
      return NextResponse.json(
        { error: 'Missing required fields: contractId, serviceProvider, engagementId.' },
        { status: 400 },
      );
    }

    const result = await trustlessWorkRequest<ChangeMilestoneStatusResponse>(
      '/escrow/single-release/v2/change-milestone-status',
      {
        method: 'POST',
        body: {
          contractId,
          serviceProvider,
          updates: [
            {
              index: milestoneIndex ?? 0,
              newStatus: newStatus ?? 'completed',
              ...(newEvidence ? { newEvidence } : {}),
            },
          ],
        },
      },
    );

    return NextResponse.json({
      unsignedXdr: result.unsignedXdr,
      txHash: result.txHash,
      contractId,
      engagementId,
      status: 'milestone_approved',
    });
  } catch (error) {
    if (error instanceof TrustlessWorkRequestError) {
      return NextResponse.json(
        { error: error.message, messages: error.messages, payload: error.payload },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      { error: getErrorMessages(error, 'Failed to build milestone status transaction.') },
      { status: 500 },
    );
  }
}
