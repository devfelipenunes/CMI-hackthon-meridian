import { Toaster as SonnerToaster } from "sonner";

import { useTheme } from "@/lib/theme";

export function Toaster() {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      offset={16}
      mobileOffset={16}
      visibleToasts={3}
      closeButton
      toastOptions={{
        duration: 5_000,
        classNames: {
          toast:
            "!rounded-control !border !border-line !bg-surface !text-ink !shadow-sheet !font-sans !text-[13px] !gap-2",
          title: "!font-semibold",
          description: "!text-ink-2",
          actionButton: "!bg-primary !text-white !rounded-control",
          cancelButton: "!bg-sunken !text-ink",
          closeButton: "!bg-surface !border-line !text-ink-3",
        },
      }}
    />
  );
}
