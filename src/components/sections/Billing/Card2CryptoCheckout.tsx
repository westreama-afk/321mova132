"use client";

import { queryClient } from "@/app/providers";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import { getPremiumStatusFromMetadata, PremiumPlan } from "@/utils/billing/premium";
import { addToast, Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

interface PlanConfig {
  id: PremiumPlan;
  title: string;
  subtitle: string;
}

const PLAN_CONFIGS: PlanConfig[] = [
  {
    id: "monthly",
    title: "Monthly Ad-Free",
    subtitle: "Flexible for short-term use",
  },
  {
    id: "yearly",
    title: "Yearly Ad-Free",
    subtitle: "Best value for long-term use",
  },
];

const INVOICE_STORAGE_KEY = "billing:lastInvoice";
const MAX_STORED_INVOICE_AGE_MS = 2 * 60 * 60 * 1000;

const readStoredInvoiceId = (): string => {
  try {
    const raw = window.localStorage.getItem(INVOICE_STORAGE_KEY);
    if (!raw) return "";

    const parsed = JSON.parse(raw) as { invoiceId?: unknown; at?: unknown };
    const invoiceId = typeof parsed.invoiceId === "string" ? parsed.invoiceId : "";
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!invoiceId || !at || Date.now() - at > MAX_STORED_INVOICE_AGE_MS) {
      window.localStorage.removeItem(INVOICE_STORAGE_KEY);
      return "";
    }

    return invoiceId;
  } catch {
    return "";
  }
};

const storeInvoiceId = (invoiceId: string) => {
  try {
    window.localStorage.setItem(
      INVOICE_STORAGE_KEY,
      JSON.stringify({
        invoiceId,
        at: Date.now(),
      }),
    );
  } catch {}
};

const clearStoredInvoiceId = () => {
  try {
    window.localStorage.removeItem(INVOICE_STORAGE_KEY);
  } catch {}
};

const Card2CryptoCheckout: React.FC = () => {
  const { data: user } = useSupabaseUser();
  const [loadingPlan, setLoadingPlan] = useState<PremiumPlan | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [isRedeemingCode, setIsRedeemingCode] = useState(false);
  const [lastInvoiceId, setLastInvoiceId] = useState("");
  const searchParams = useSearchParams();

  const premiumStatus = useMemo(
    () => getPremiumStatusFromMetadata(user?.user_metadata),
    [user?.user_metadata],
  );

  useEffect(() => {
    const fromQuery =
      searchParams.get("invoiceId") || searchParams.get("invoice_id") || searchParams.get("invoice");
    if (fromQuery) {
      setLastInvoiceId(fromQuery);
      storeInvoiceId(fromQuery);
      return;
    }
    setLastInvoiceId(readStoredInvoiceId());
  }, [searchParams]);

  const handleCheckout = async (plan: PremiumPlan) => {
    if (loadingPlan) return;
    setLoadingPlan(plan);

    try {
      const response = await fetch("/api/billing/sellauth/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            checkoutUrl?: string;
            invoiceId?: string | null;
            mode?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.checkoutUrl) {
        throw new Error(payload?.error || "Failed to create checkout session");
      }

      if (payload.invoiceId) {
        setLastInvoiceId(payload.invoiceId);
        storeInvoiceId(payload.invoiceId);
      } else if (payload.mode === "sellauth-hosted") {
        setLastInvoiceId("");
        clearStoredInvoiceId();
      }

      window.location.href = payload.checkoutUrl;
    } catch (error) {
      addToast({
        title: "Checkout failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        color: "danger",
      });
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleCheckStatus = async () => {
    if (!lastInvoiceId || isCheckingStatus) return;
    setIsCheckingStatus(true);

    try {
      const response = await fetch(
        `/api/billing/sellauth/status?invoiceId=${encodeURIComponent(lastInvoiceId)}`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { isPaid?: boolean; status?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to check payment status");
      }

      if (payload?.isPaid) {
        await queryClient.invalidateQueries({ queryKey: ["supabase-user"] });
      }

      addToast({
        title: payload?.isPaid ? "Payment confirmed" : "Payment pending",
        description: payload?.isPaid
          ? "Your ad-free access should activate shortly."
          : `Current status: ${payload?.status || "unknown"}`,
        color: payload?.isPaid ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "Status check failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        color: "danger",
      });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleRedeemCode = async () => {
    if (isRedeemingCode) return;

    const code = redeemCode.trim().toUpperCase();
    if (!code) {
      addToast({
        title: "Enter a code",
        description: "Paste your premium code first.",
        color: "warning",
      });
      return;
    }

    setIsRedeemingCode(true);
    try {
      const response = await fetch("/api/billing/codes/redeem", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; plan?: PremiumPlan; expiresAt?: string; error?: string }
        | null;

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Failed to redeem premium code");
      }

      setRedeemCode("");
      await queryClient.invalidateQueries({ queryKey: ["supabase-user"] });

      addToast({
        title: "Premium activated",
        description: payload.expiresAt
          ? `Your ad-free access is active until ${new Date(payload.expiresAt).toLocaleDateString()}.`
          : "Your ad-free access is now active.",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "Redeem failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        color: "danger",
      });
    } finally {
      setIsRedeemingCode(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:gap-6">
      <Card className="border border-default-100/50 bg-content1/70 backdrop-blur">
        <CardHeader className="flex flex-col items-start gap-2">
          <h1 className="text-2xl font-bold sm:text-3xl">Ad-Free Access</h1>
          <p className="text-sm text-default-500 sm:text-base">
            Redeem a premium code instantly, or purchase through SellAuth.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip color={premiumStatus.isPremium ? "success" : "default"} variant="flat">
              {premiumStatus.isPremium ? "Premium active" : "Premium inactive"}
            </Chip>
            {premiumStatus.plan && (
              <Chip color="primary" variant="bordered">
                {premiumStatus.plan === "yearly" ? "Yearly plan" : "Monthly plan"}
              </Chip>
            )}
            {premiumStatus.expiresAt && (
              <Chip color="secondary" variant="bordered">
                Expires {new Date(premiumStatus.expiresAt).toLocaleDateString()}
              </Chip>
            )}
          </div>

          {lastInvoiceId && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                color="primary"
                variant="flat"
                onPress={handleCheckStatus}
                isLoading={isCheckingStatus}
              >
                Check recent checkout
              </Button>
              <span className="text-xs text-default-500 sm:text-sm">
                Use this after paying in SellAuth if access has not updated yet.
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="border border-default-100/50 bg-content1/70 backdrop-blur">
        <CardHeader className="flex flex-col items-start gap-1">
          <h3 className="text-lg font-semibold sm:text-xl">Redeem Premium Code</h3>
          <p className="text-xs text-default-500 sm:text-sm">
            Enter your code to activate ad-free access immediately.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            value={redeemCode}
            onValueChange={setRedeemCode}
            label="Premium code"
            placeholder="EXAMPLE-CODE-123"
            className="w-full"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleRedeemCode();
              }
            }}
          />
          <Button
            color="success"
            className="w-full sm:w-auto"
            onPress={handleRedeemCode}
            isLoading={isRedeemingCode}
          >
            Redeem code
          </Button>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {PLAN_CONFIGS.map((plan) => (
          <Card
            key={plan.id}
            className="border border-default-100/50 bg-content1/70 backdrop-blur"
          >
            <CardHeader className="flex flex-col items-start gap-1">
              <h3 className="text-lg font-semibold sm:text-xl">{plan.title}</h3>
              <p className="text-xs text-default-500 sm:text-sm">{plan.subtitle}</p>
            </CardHeader>
            <CardBody>
              <Button
                color={plan.id === "yearly" ? "secondary" : "primary"}
                onPress={() => handleCheckout(plan.id)}
                isLoading={loadingPlan === plan.id}
                fullWidth
              >
                Continue with SellAuth
              </Button>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Card2CryptoCheckout;
