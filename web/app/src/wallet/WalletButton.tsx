import { Link } from "react-router-dom";

import { Address } from "@/ui/Address";
import { ButtonLink } from "@/ui/Button";
import { useWallet } from "./WalletProvider";

export function WalletButton() {
  const { address } = useWallet();
  if (address === null) {
    return (
      <ButtonLink to="/wallet" variant="secondary" size="sm">
        Connect wallet
      </ButtonLink>
    );
  }
  return (
    <Link
      to="/wallet"
      className="flex h-8 items-center gap-2 rounded-control border border-line px-2.5 transition-colors hover:bg-sunken"
      aria-label="Open wallet"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
      <Address value={address} size={4} />
    </Link>
  );
}
