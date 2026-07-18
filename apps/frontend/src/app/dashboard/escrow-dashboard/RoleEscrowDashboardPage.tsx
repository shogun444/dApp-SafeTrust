"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { RoleEscrowDashboard } from "@/components/dashboard/RoleEscrowDashboard";
import type {
  EscrowData,
  NotificationData,
} from "@/components/dashboard/RoleEscrowDashboard";
import { useGlobalAuthenticationStore } from "@/core/store/data";
import { GET_ESCROWS } from "@/graphql/queries/escrow-queries";
import { getUserRole } from "@/utils/role-utils";

const DASHBOARD_ESCROW_LIMIT = 50;
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

type DashboardEscrowStatus = EscrowData["status"];

type EscrowRow = {
  id: string;
  contract_id?: string | null;
  engagement_id?: string | null;
  amount: number | string;
  status?: string | null;
  created_at: string;
  updated_at?: string | null;
  sender_address?: string | null;
  receiver_address?: string | null;
  apartment?: {
    name?: string | null;
    available_from?: string | null;
    available_until?: string | null;
  } | null;
};

type TrustlessWorkEscrowRow = {
  contract_id?: string | null;
  status?: string | null;
  asset_code?: string | null;
  asset_issuer?: string | null;
  marker?: string | null;
  booking_id?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  updated_at?: string | null;
};

type GetEscrowsDashboardQuery = {
  escrows?: EscrowRow[];
  trustless_work_escrows?: TrustlessWorkEscrowRow[];
};

type EscrowFilter = {
  _or: Array<{
    sender_address?: { _eq: string };
    receiver_address?: { _eq: string };
  }>;
};

type TrustlessWorkEscrowFilter = {
  _or: Array<{
    marker?: { _eq: string };
    approver?: { _eq: string };
    releaser?: { _eq: string };
    resolver?: { _eq: string };
  }>;
};

type GetEscrowsDashboardVariables = {
  limit: number;
  offset: number;
  where: EscrowFilter;
  trustlessWorkWhere: TrustlessWorkEscrowFilter;
};

const getStoredWalletAddress = () => {
  if (typeof window === "undefined") return null;

  const storedWallet =
    localStorage.getItem("walletAddress") ||
    localStorage.getItem("address-wallet");

  if (!storedWallet) return null;

  try {
    const parsed = JSON.parse(storedWallet);
    return typeof parsed === "string" ? parsed : parsed?.address ?? null;
  } catch {
    return storedWallet;
  }
};

const mapEscrowStatus = (status?: string | null): DashboardEscrowStatus => {
  const normalized = status?.toLowerCase();

  switch (normalized) {
    case "funded":
    case "active":
    case "milestone_approved":
      return "funded";
    case "completed":
    case "resolved":
      return "completed";
    case "disputed":
    case "cancelled":
      return "cancelled";
    case "pending_signature":
    case "deploying":
    case "created":
    case "pending_funding":
    default:
      return "pending";
  }
};

const mapEscrows = (
  escrows: EscrowRow[] = [],
  trustlessWorkEscrows: TrustlessWorkEscrowRow[] = [],
): EscrowData[] => {
  const trustlessWorkByContractId = new Map(
    trustlessWorkEscrows
      .filter((escrow) => escrow.contract_id)
      .map((escrow) => [escrow.contract_id, escrow]),
  );

  return escrows.map((escrow) => {
    const trustlessWorkEscrow = escrow.contract_id
      ? trustlessWorkByContractId.get(escrow.contract_id)
      : undefined;

    return {
      id: escrow.id,
      contractId: escrow.contract_id ?? escrow.id,
      status: mapEscrowStatus(escrow.status),
      amount: Number(escrow.amount) || 0,
      asset: {
        code: trustlessWorkEscrow?.asset_code ?? "USDC",
        issuer: trustlessWorkEscrow?.asset_issuer ?? undefined,
      },
      metadata: {
        bookingId:
          escrow.engagement_id ?? trustlessWorkEscrow?.booking_id ?? escrow.id,
        hotelName: escrow.apartment?.name ?? "Unknown apartment",
        checkInDate:
          escrow.apartment?.available_from ??
          trustlessWorkEscrow?.check_in_date ??
          escrow.created_at,
        checkOutDate:
          escrow.apartment?.available_until ??
          trustlessWorkEscrow?.check_out_date ??
          escrow.updated_at ??
          escrow.created_at,
      },
      marker:
        escrow.receiver_address ??
        trustlessWorkEscrow?.marker ??
        escrow.sender_address ??
        "",
      createdAt: escrow.created_at,
      updatedAt:
        escrow.updated_at ??
        trustlessWorkEscrow?.updated_at ??
        escrow.created_at,
    };
  });
};

const notificationTypeByStatus: Record<DashboardEscrowStatus, NotificationData["type"]> = {
  pending: "alert",
  funded: "payment",
  check_in_approved: "milestone",
  check_out_approved: "milestone",
  completed: "milestone",
  cancelled: "alert",
};

const notificationMessageByStatus: Record<DashboardEscrowStatus, string> = {
  pending: "is pending signature",
  funded: "has been funded",
  check_in_approved: "has check-in approved",
  check_out_approved: "has check-out approved",
  completed: "has been completed",
  cancelled: "was cancelled",
};

const deriveNotifications = (escrows: EscrowData[]): NotificationData[] => {
  const now = Date.now();

  return escrows
    .filter((escrow) => {
      const updatedAt = new Date(escrow.updatedAt).getTime();
      return !Number.isNaN(updatedAt) && now - updatedAt <= ONE_DAY_IN_MS;
    })
    .map((escrow) => ({
      id: `${escrow.id}-${escrow.status}-${escrow.updatedAt}`,
      type: notificationTypeByStatus[escrow.status],
      message: `Escrow ${escrow.metadata?.bookingId ?? escrow.id} ${
        notificationMessageByStatus[escrow.status]
      }`,
      timestamp: escrow.updatedAt,
      read: false,
      escrowId: escrow.id,
    }));
};

export function RoleEscrowDashboardPage() {
  const [userRole, setUserRole] = useState<"guest" | "hotel" | "admin">("guest");
  const storeAddress = useGlobalAuthenticationStore((state) => state.address);
  const [storedAddress, setStoredAddress] = useState<string | null>(null);

  const walletAddress = storeAddress ?? storedAddress;

  const variables = useMemo<GetEscrowsDashboardVariables | undefined>(() => {
    if (!walletAddress) return undefined;

    return {
      limit: DASHBOARD_ESCROW_LIMIT,
      offset: 0,
      where: {
        _or: [
          { sender_address: { _eq: walletAddress } },
          { receiver_address: { _eq: walletAddress } },
        ],
      },
      trustlessWorkWhere: {
        _or: [
          { marker: { _eq: walletAddress } },
          { approver: { _eq: walletAddress } },
          { releaser: { _eq: walletAddress } },
          { resolver: { _eq: walletAddress } },
        ],
      },
    };
  }, [walletAddress]);

  const { data, loading, error, refetch } = useQuery<
    GetEscrowsDashboardQuery,
    GetEscrowsDashboardVariables
  >(GET_ESCROWS, {
    variables,
    skip: !variables,
    fetchPolicy: "cache-and-network",
  });

  useEffect(() => {
    setUserRole(getUserRole() ?? "guest");
    setStoredAddress(getStoredWalletAddress());
  }, []);

  const escrows = useMemo(
    () => mapEscrows(data?.escrows, data?.trustless_work_escrows),
    [data?.escrows, data?.trustless_work_escrows],
  );

  const notifications = useMemo(
    () => deriveNotifications(escrows),
    [escrows],
  );

  const handleRefresh = useCallback(() => {
    setUserRole(getUserRole() ?? "guest");
    setStoredAddress(getStoredWalletAddress());

    if (variables) {
      void refetch(variables);
    }
  }, [refetch, variables]);

  return (
    <RoleEscrowDashboard
      userRole={userRole}
      escrows={escrows}
      notifications={notifications}
      isLoading={loading}
      error={error ? "Failed to load escrow dashboard data." : null}
      onRefresh={handleRefresh}
    />
  );
}
