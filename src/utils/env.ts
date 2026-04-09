import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().url().optional(),
);

export const env = createEnv({
  server: {
    PROTECTED_PATHS: z.string(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    PLAYER_VAST_URL: optionalUrl,
    PLAYER_VAST_PREROLL_URL: optionalUrl,
    PLAYER_VAST_MIDROLL_URL: optionalUrl,
    CARD2CRYPTO_API_BASE_URL: optionalUrl,
    CARD2CRYPTO_API_KEY: optionalNonEmptyString,
    CARD2CRYPTO_WEBHOOK_SECRET: optionalNonEmptyString,
    CARD2CRYPTO_MONTHLY_PRICE_USD: optionalNonEmptyString,
    CARD2CRYPTO_YEARLY_PRICE_USD: optionalNonEmptyString,
    CARD2CRYPTO_MONTHLY_PAYMENT_URL: optionalUrl,
    CARD2CRYPTO_YEARLY_PAYMENT_URL: optionalUrl,
    SELLAUTH_API_BASE_URL: optionalUrl,
    SELLAUTH_API_KEY: optionalNonEmptyString,
    SELLAUTH_SHOP_ID: optionalNonEmptyString,
    SELLAUTH_CHECKOUT_MODE: optionalNonEmptyString,
    SELLAUTH_MONTHLY_PRICE_USD: optionalNonEmptyString,
    SELLAUTH_YEARLY_PRICE_USD: optionalNonEmptyString,
    SELLAUTH_MONTHLY_PRODUCT_ID: optionalNonEmptyString,
    SELLAUTH_YEARLY_PRODUCT_ID: optionalNonEmptyString,
    SELLAUTH_MONTHLY_VARIANT_ID: optionalNonEmptyString,
    SELLAUTH_YEARLY_VARIANT_ID: optionalNonEmptyString,
    SELLAUTH_MONTHLY_CHECKOUT_URL: optionalUrl,
    SELLAUTH_YEARLY_CHECKOUT_URL: optionalUrl,
  },
  client: {
    NEXT_PUBLIC_TMDB_ACCESS_TOKEN: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.url().min(1),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_AVATAR_PROVIDER_URL: z.string().url().optional(),
    NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
    NEXT_PUBLIC_PLAYER_PROXY_URL: z.string().url().optional(),
    NEXT_PUBLIC_PLAYER_VAST_URL: optionalUrl,
    NEXT_PUBLIC_PLAYER_VAST_PREROLL_URL: optionalUrl,
    NEXT_PUBLIC_PLAYER_VAST_MIDROLL_URL: optionalUrl,
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_TMDB_ACCESS_TOKEN: process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_AVATAR_PROVIDER_URL: process.env.NEXT_PUBLIC_AVATAR_PROVIDER_URL,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
    NEXT_PUBLIC_PLAYER_PROXY_URL: process.env.NEXT_PUBLIC_PLAYER_PROXY_URL,
    NEXT_PUBLIC_PLAYER_VAST_URL: process.env.NEXT_PUBLIC_PLAYER_VAST_URL,
    NEXT_PUBLIC_PLAYER_VAST_PREROLL_URL: process.env.NEXT_PUBLIC_PLAYER_VAST_PREROLL_URL,
    NEXT_PUBLIC_PLAYER_VAST_MIDROLL_URL: process.env.NEXT_PUBLIC_PLAYER_VAST_MIDROLL_URL,
  },
});
