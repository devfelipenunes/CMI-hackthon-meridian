import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, KeyRound, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfig } from "@/config/ConfigProvider";
import { formatXlm, formatXlmWithUnit, parseXlm } from "@/domain/amount";
import { errorTextFrom } from "@/domain/errors";
import { useAccountStatus, useCmi } from "@/sdk/CmiProvider";
import {
  useBalance,
  useDeposit,
  useExportBackup,
  useForgetKey,
  useImportBackup,
  useMarkBackedUp,
  useMerge,
  useSetupAccount,
  useSyncAccount,
} from "@/sdk/useAccount";
import { Address, shortAddress } from "@/ui/Address";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { Field, Input, Textarea } from "@/ui/Field";
import { DefinitionList, DefinitionRow, InlineNote, PageHeader, Section } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";
import { fetchPublicAccount, fundWithFriendbot } from "@/wallet/public";

export function WalletPage() {
  const { address, connecting, kind, disconnect } = useWallet();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Wallet"
        title="Your confidential account"
        description="The wallet signs. The confidential account holds balance and openings in this browser — none of it goes to a server."
        actions={
          address !== null ? (
            <div className="flex items-center gap-2">
              <Address value={address} size={6} copy />
              <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : undefined
        }
      />
      {address === null ? <ConnectPanel connecting={connecting} /> : <ConnectedPanels kind={kind} />}
    </div>
  );
}

const DEV_WALLET_ENABLED = typeof __DEV_WALLET_BUILD__ === "boolean" && __DEV_WALLET_BUILD__;

function ConnectPanel({ connecting }: { connecting: boolean }) {
  const config = useConfig();
  const { connect } = useWallet();
  const [devOpen, setDevOpen] = useState(false);
  const [devSecret, setDevSecret] = useState("");
  const [error, setError] = useState<unknown>(null);

  const onConnect = async (): Promise<void> => {
    setError(null);
    try {
      await connect("freighter");
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <div className="mt-2">
      <div className="rounded-sheet border border-line bg-surface px-6 py-7">
        <div className="flex items-start gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
            <WalletCards className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold">Connect a Stellar wallet</h2>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-2">
              Use Freighter on <strong className="font-semibold text-ink">Testnet</strong>. The app asks for your signature
              on every transaction; the Stellar key never leaves the extension.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => void onConnect()} loading={connecting}>
            Connect Freighter
          </Button>
          {DEV_WALLET_ENABLED && (
            <Button variant="ghost" onClick={() => setDevOpen(true)}>
              Development wallet
            </Button>
          )}
        </div>
        {error !== null && <ErrorNotice error={error} className="mt-5" />}
      </div>

      <dl className="mt-8 grid gap-6 sm:grid-cols-3">
        {[
          ["1 · Wallet", "Signs deposits, bids and withdrawals."],
          ["2 · Confidential account", "Holds the encrypted balance and this browser's openings."],
          ["3 · Backup", "Without the key and the backup, the confidential balance cannot be recovered."],
        ].map(([term, detail]) => (
          <div key={term}>
            <dt className="text-[13px] font-semibold">{term}</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-ink-3">{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-8 text-[12px] text-ink-3">
        Network: {config.passphrase.replace(" ; ", " · ")}. No backend: every read goes straight to the RPC.
      </p>

      <Dialog
        open={devOpen}
        onClose={() => setDevOpen(false)}
        title="Development wallet"
        description="The secret key lives only in this tab's memory. Use it on testnet only, with a throwaway account."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDevOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={devSecret.trim() === ""}
              onClick={() => {
                setDevOpen(false);
                setError(null);
                void connect("dev", devSecret).catch((cause: unknown) => setError(cause));
                setDevSecret("");
              }}
            >
              Use this key
            </Button>
          </>
        }
      >
        <Field
          id="dev-secret"
          label="Stellar secret key"
          hint="Starts with S. It is not saved anywhere; reloading the page forgets it."
        >
          <Input
            id="dev-secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={devSecret}
            onChange={(event) => setDevSecret(event.target.value)}
            placeholder="S…"
            className="font-mono text-xs"
          />
        </Field>
      </Dialog>
    </div>
  );
}

function ConnectedPanels({ kind }: { kind: "freighter" | "dev" | null }) {
  const status = useAccountStatus();
  const config = useConfig();
  const { address } = useWallet();

  const publicAccount = useQuery({
    queryKey: ["public-account", address],
    queryFn: () => fetchPublicAccount(address ?? "", config),
    enabled: address !== null,
    refetchInterval: 15_000,
  });

  return (
    <div className="mt-2">
      {kind === "dev" && (
        <div className="mb-6">
          <InlineNote tone="accent">
            Development wallet active. The secret key exists only in this tab's memory.
          </InlineNote>
        </div>
      )}

      {publicAccount.data !== undefined && !publicAccount.data.exists && (
        <FriendbotBanner address={address ?? ""} />
      )}

      {status.isPending ? (
        <LoadingRows rows={2} />
      ) : status.isError ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : status.data === undefined ? null : (
        <AccountBody
          onChain={status.data.onChain}
          hasKey={status.data.hasKey}
          backupRequired={status.data.backupRequired}
        />
      )}

      <BackupSection />
      <ImportSection />
      <DangerSection />
    </div>
  );
}

function FriendbotBanner({ address }: { address: string }) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const fund = useMutation({
    mutationFn: () => fundWithFriendbot(address, config),
    onSuccess: () => {
      toast.success("Account funded with 10,000 test XLM.");
      void queryClient.invalidateQueries({ queryKey: ["public-account"] });
    },
  });
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning bg-warning/[0.05] px-4 py-3">
      <p className="text-[13px] text-ink-2">
        This wallet does not exist on Testnet yet. Fund it with the friendbot to get started.
      </p>
      <Button variant="secondary" size="sm" loading={fund.isPending} onClick={() => fund.mutate()}>
        Fund with friendbot
      </Button>
      {fund.error !== null && <ErrorNotice error={fund.error} className="w-full" />}
    </div>
  );
}

function AccountBody({ onChain, hasKey, backupRequired }: { onChain: boolean; hasKey: boolean; backupRequired: boolean }) {
  const setup = useSetupAccount();
  const [error, setError] = useState<unknown>(null);

  if (!onChain && !hasKey) {
    return (
      <div className="rounded-sheet border border-line bg-surface px-6 py-7">
        <div className="flex items-start gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent/[0.08] text-accent">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Create the confidential account</h2>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-2">
              A key is generated and encrypted in this browser, and a proof registers the account in the token. The
              circuit is downloaded now — the first proof usually takes a few seconds.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            loading={setup.isPending}
            onClick={() => {
              setError(null);
              setup.mutate(undefined, {
                onSuccess: ({ backupRequired: created }) => {
                  toast.success(created ? "Account created. Download the backup before depositing." : "Account registered.");
                },
                onError: (cause) => setError(cause),
              });
            }}
          >
            Create confidential account
          </Button>
          <InlineNote>Keep the backup. It is the only way to reopen the balance in another browser.</InlineNote>
        </div>
        {error !== null && <ErrorNotice error={error} className="mt-5" />}
      </div>
    );
  }

  if (!onChain && hasKey) {
    return (
      <div className="rounded-sheet border border-line bg-surface px-6 py-7">
        <h2 className="text-base font-semibold">Registration pending</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-2">
          This browser's key exists, but the account has not been registered on the network yet. Finish the
          registration with the same key — do not create another.
        </p>
        <div className="mt-5">
          <Button
            loading={setup.isPending}
            onClick={() => {
              setError(null);
              setup.mutate(undefined, { onError: (cause) => setError(cause) });
            }}
          >
            Finish registration
          </Button>
        </div>
        {error !== null && <ErrorNotice error={error} className="mt-5" />}
      </div>
    );
  }

  if (onChain && !hasKey) {
    return (
      <div className="rounded-sheet border border-line bg-surface px-6 py-7">
        <div className="flex items-start gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-warning/[0.08] text-warning">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold">Account registered, key missing</h2>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-2">
              This account already exists on the network, but the confidential key is not in this browser. Import the
              backup below. Creating a new account here would not replace it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <ReadyAccount backupRequired={backupRequired} />;
}

function ReadyAccount({ backupRequired }: { backupRequired: boolean }) {
  const balance = useBalance();
  const merge = useMerge();
  const sync = useSyncAccount();
  const [depositOpen, setDepositOpen] = useState(false);

  return (
    <>
      {backupRequired && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning bg-warning/[0.05] px-4 py-3">
          <p className="text-[13px] text-ink-2">This key has no backup yet. Download a copy before moving value.</p>
          <Badge tone="danger">backup pending</Badge>
        </div>
      )}
      <div className="rounded-sheet border border-line bg-surface px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label">Confidential balance</p>
            {balance.isPending ? (
              <div className="mt-2 h-9 w-44 animate-pulse rounded bg-sunken" />
            ) : balance.isError ? (
              <p className="mt-2 text-sm text-ink-2">The balance could not be read right now.</p>
            ) : (
              <p className="numeric mt-1 text-[30px] font-semibold tracking-tight">
                {formatXlmWithUnit(balance.data.spendable)}
              </p>
            )}
            {balance.data !== undefined && balance.data.receiving > 0n && (
              <p className="mt-1 text-[13px] text-ink-2">
                + {formatXlm(balance.data.receiving)} XLM incoming —{" "}
                <button
                  type="button"
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                  disabled={merge.isPending}
                  onClick={() => merge.mutate(undefined, { onError: (cause) => toast.error(errorTextFrom(cause).title) })}
                >
                  make spendable
                </button>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              loading={sync.isPending}
              onClick={() =>
                sync.mutate(undefined, {
                  onSuccess: () => toast.success("Balance checked against the network."),
                  onError: (cause) => toast.error(errorTextFrom(cause).title),
                })
              }
            >
              Sync
            </Button>
            <Button size="sm" onClick={() => setDepositOpen(true)}>
              Deposit XLM
            </Button>
          </div>
        </div>
        {balance.isError && <ErrorNotice error={balance.error} className="mt-4" onRetry={() => void balance.refetch()} />}
        {merge.error !== null && <ErrorNotice error={merge.error} className="mt-4" />}
        {sync.error !== null && <ErrorNotice error={sync.error} className="mt-4" />}
        <div className="mt-5">
          <InlineNote>
            The deposit is public. To place a bid, deposit a rounded amount — never exactly price × quantity.
          </InlineNote>
        </div>
      </div>
      <DepositDialog open={depositOpen} onClose={() => setDepositOpen(false)} />
    </>
  );
}

function DepositDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const deposit = useDeposit();
  const id = "deposit-amount";

  const submit = (): void => {
    setError(null);
    setValidation(null);
    let value: bigint;
    try {
      value = parseXlm(amount);
      if (value <= 0n) throw new Error("zero");
    } catch {
      setValidation("Enter a value greater than zero, with up to 7 decimal places.");
      return;
    }
    deposit.mutate(value, {
      onSuccess: () => {
        toast.success(`${formatXlm(value)} XLM deposited.`);
        setAmount("");
        onClose();
      },
      onError: (cause) => setError(cause),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!deposit.isPending) onClose();
      }}
      dismissible={!deposit.isPending}
      title="Deposit XLM"
      description="The amount leaves the public wallet and enters the confidential account. The wallet signs two transactions: deposit and merge."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deposit.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={deposit.isPending}>
            Deposit
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field id={id} label="Amount" hint="Seven decimal places. The deposit is visible on-chain.">
          <Input
            id={id}
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            suffix="XLM"
          />
        </Field>
      </form>
      {validation !== null && <p role="alert" className="mt-3 text-[13px] text-danger">{validation}</p>}
      {error !== null && <ErrorNotice error={error} className="mt-4" />}
    </Dialog>
  );
}

function BackupSection() {
  const exportBackup = useExportBackup();
  const mark = useMarkBackedUp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<unknown>(null);
  const valid = password.length >= 12 && password === confirmation;

  const generate = (): void => {
    setError(null);
    exportBackup.mutate(password, {
      onSuccess: (text) => {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "cmi-backup.txt";
        link.click();
        URL.revokeObjectURL(url);
        mark.mutate(undefined, {
          onSuccess: () => {
            toast.success("Backup created. Keep the file outside this browser.");
            setOpen(false);
            setPassword("");
            setConfirmation("");
          },
        });
      },
      onError: (cause) => setError(cause),
    });
  };

  return (
    <Section title="Backup" id="backup">
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-4">
        <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
          Exports the key and balance openings, encrypted with a password of at least 12 characters. The password is
          not stored: without it, the file cannot be opened.
        </p>
        <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" aria-hidden />} onClick={() => setOpen(true)}>
          Download backup
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => {
          if (!exportBackup.isPending) setOpen(false);
        }}
        dismissible={!exportBackup.isPending}
        title="Protect the backup"
        description="Use a long password, different from any other. It cannot be recovered."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={exportBackup.isPending}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={!valid} loading={exportBackup.isPending}>
              Generate file
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field id="backup-password" label="Backup password" hint="At least 12 characters.">
            <Input
              id="backup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field id="backup-confirm" label="Repeat the password" error={confirmation !== "" && password !== confirmation ? "The passwords do not match." : undefined}>
            <Input
              id="backup-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          {error !== null && <ErrorNotice error={error} />}
        </div>
      </Dialog>
    </Section>
  );
}

function ImportSection() {
  const [open, setOpen] = useState(false);
  const [backup, setBackup] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const importBackup = useImportBackup();
  const cmi = useCmi();

  const submit = (): void => {
    setError(null);
    importBackup.mutate(
      { backup, password },
      {
        onSuccess: () => {
          toast.success("Backup restored and balance synced.");
          setOpen(false);
          setBackup("");
          setPassword("");
        },
        onError: (cause) => setError(cause),
      },
    );
  };

  return (
    <Section title="Import backup" id="import">
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-4">
        <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
          Reopen the account in another browser. The backup must come from the same network and this wallet's address.
        </p>
        <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />} onClick={() => setOpen(true)} disabled={cmi === null}>
          Import
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Restore backup"
        description="A wrong password, or a file from another network or account, changes nothing."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={backup.trim() === "" || password === ""} loading={importBackup.isPending}>
              Restore
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field id="import-backup" label="File contents" hint="Paste the full text (it starts with cmi-key-backup:v1:).">
            <Textarea
              id="import-backup"
              value={backup}
              onChange={(event) => setBackup(event.target.value)}
              spellCheck={false}
              className="font-mono text-[11px]"
              placeholder="cmi-key-backup:v1:…"
            />
          </Field>
          <Field id="import-password" label="Backup password">
            <Input
              id="import-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error !== null && <ErrorNotice error={error} />}
        </div>
      </Dialog>
    </Section>
  );
}

function DangerSection() {
  const [open, setOpen] = useState(false);
  const forget = useForgetKey();
  const { address } = useWallet();
  return (
    <Section title="This browser" id="forget">
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-4">
        <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
          Forgets the key and openings stored on this machine. The account stays on-chain; without a backup, the
          confidential balance becomes unreachable.
        </p>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          Forget key
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Forget this browser's key?"
        description="This cannot be undone. If you do not have the backup, the confidential balance is lost."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={forget.isPending}
              onClick={() =>
                forget.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Key forgotten in this browser.");
                    setOpen(false);
                  },
                  onError: (cause) => toast.error(errorTextFrom(cause).title),
                })
              }
            >
              Forget permanently
            </Button>
          </>
        }
      >
        <DefinitionList>
          <DefinitionRow term="Confidential account">{shortAddress(address ?? "", 6)}</DefinitionRow>
          <DefinitionRow term="Network">Testnet</DefinitionRow>
        </DefinitionList>
        {forget.error !== null && <ErrorNotice error={forget.error} className="mt-4" />}
      </Dialog>
    </Section>
  );
}
