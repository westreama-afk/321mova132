"use client";

import { PropsWithChildren, Suspense, useEffect } from "react";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AppProgressProvider as ProgressProvider } from "@bprogress/next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { usePathname, useRouter } from "next/navigation";
import useDiscoverFilters from "@/hooks/useDiscoverFilters";
import { createClient } from "@/utils/supabase/client";

export const queryClient = new QueryClient();

// Single auth listener for the whole app — prevents duplicate Supabase fetches
// when multiple components call useSupabaseUser() simultaneously.
function SupabaseAuthSync() {
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void queryClient.invalidateQueries({ queryKey: ["supabase-user"] });
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}

export default function Providers({ children }: PropsWithChildren) {
  const { push } = useRouter();
  const pathName = usePathname();
  const { content } = useDiscoverFilters();
  const tv = pathName.includes("/tv/") || content === "tv";

  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseAuthSync />
      <HeroUIProvider navigate={push}>
        <ToastProvider
          placement="top-right"
          maxVisibleToasts={1}
          toastOffset={10}
          toastProps={{
            shouldShowTimeoutProgress: true,
            timeout: 5000,
            classNames: {
              content: "mr-7",
              closeButton:
                "opacity-100 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-auto",
            },
          }}
        />
        <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem>
          <Suspense>
            <ProgressProvider
              options={{ showSpinner: false }}
              color={`hsl(var(--heroui-${tv ? "warning" : "primary"}))`}
            >
              {children}
            </ProgressProvider>
          </Suspense>
        </NextThemesProvider>
      </HeroUIProvider>
      <div className="hidden md:block">
        <ReactQueryDevtools initialIsOpen={false} />
      </div>
    </QueryClientProvider>
  );
}
