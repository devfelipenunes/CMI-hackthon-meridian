# User Journey — Confidential Quota Auction

This document describes how the platform works from the point of view of the people using it: a company selling fractional quotas of a tokenized asset, and the investors bidding on them. It intentionally leaves out how anything is built — no cryptography, no contract names, no technical terms — this is only about what each person sees and does, in order.

## Who's involved

- **Company (Seller)** — the business that owns an asset (for example, a building) and wants to sell it in fractional pieces ("quotas") to many investors at once. Creates an account in "Enterprise" mode.
- **Bidder (Investor)** — anyone who wants to buy some quotas. Connects a wallet and places a bid.
- **Operator (the platform itself)** — our backend. It is the only party that can look at the bids' prices. In this first version it can see them from the moment a bid's funds are locked, not only at closing — an accepted trust choice for the MVP. The operator also can't cheat: whatever it decides about who won, and how much each person pays, has to come with a mathematical proof that the platform checks automatically, so it can't invent a winner, hide a real bidder, or charge anyone the wrong amount.

This first version runs on the Stellar **test network** only, and all payments are in **XLM**. **No identity verification (KYC) is required** to create a company account or to place a bid. That's a deliberate choice for now — it can be added later as an extra step in front of the flow described below, without changing anything about how the auction itself works.

## The journey, step by step

To make this concrete, imagine "Aurora Capital," a company tokenizing a building into **1,000 quotas**, and four investors — Ana, Bruno, Carla, and Diego — bidding on them.

### 1. The company signs up and opens an auction

Aurora Capital creates an account and switches to **Enterprise mode**. From there, it lists the asset it wants to auction — in this case, the 1,000 quotas of the tokenized building — and fills in three things:

- **Minimum price per quota** — this is public, visible to everyone browsing the platform. Aurora sets it at **500 XLM**. No bid below this will ever be accepted.
- **Closing date** — the exact moment the auction stops accepting bids, at most 30 days out. Aurora picks a date five days out.
- A small **XLM fee reserve**, which pays the network fees for closing and settling the auction. Whatever is not used comes back to Aurora at the end.

Aurora also sees, before confirming, that the platform keeps a **10% fee** on every quota sold: out of each winner's payment, 90% goes to Aurora and 10% to the platform.
- Confirms the listing.

(The quotas must be a token the company cannot pull back from the platform by itself — tokens with a "clawback" feature are not accepted.)

The moment the auction goes live, the 1,000 quotas are locked on the platform automatically — Aurora can't pull them back on a whim while the auction is running. The auction is now **Open**, and a countdown to the closing date is visible to everyone.

### 2. Investors find the auction and place a sealed bid

Ana, Bruno, Carla, and Diego each browse to the open auction. Anyone with a wallet can bid — again, no sign-up verification required — as long as their wallet has **enabled the quota token** (a one-time step so it can receive the quotas later) and holds enough XLM in its private balance. An auction takes **at most 8 bids**. Each bidder fills in:

- **The price per quota they're willing to pay** (must be at least the 500 XLM minimum).
- **How many quotas they want.**

If someone tries to submit a price below the 500 XLM minimum, the submission is rejected immediately, on the spot — it's as if it never happened. Nothing gets recorded, no funds get locked (the app checks the bid before it locks any funds), and they're free to try again right away with a corrected price. This isn't a case of "the bid gets accepted and then loses later for being too low" — a below-minimum bid can't be submitted at all, full stop.

The moment someone submits a bid that *does* meet the minimum, the platform automatically **locks exactly enough of their funds** to cover that price times that quantity — so nobody can promise more than they actually have. That locked amount sits aside, untouched, until the auction resolves.

Here's the important part: **the price each person typed in is sealed.** It is hidden from other bidders, from Aurora and from the public the instant it's submitted. The only one who can see it is the platform's operator, which is needed to run the auction. Only the *quantity* requested is visible (so anyone watching the auction can see total demand building up, just never at what price). Each person can only place **one bid** per auction; there's no changing your mind with a second, different bid later.

In our example:

| Investor | Quotas requested | Price per quota (sealed — hidden from everyone but the operator) |
|---|---|---|
| Ana | 200 | 650 XLM |
| Bruno | 500 | 600 XLM |
| Carla | 400 | 580 XLM |
| Diego | 300 | 520 XLM |

### 3. The waiting period

Between submitting a bid and the closing date, nobody except the operator can see anyone's price. The countdown keeps ticking. Bidders can come back and check that their bid was accepted and that their funds are correctly locked, but they can't see anyone else's price — and neither can Aurora.

### 4. The auction closes

The instant the closing date/time arrives, bidding stops — no more bids are accepted, no exceptions. The operator now works out the result, and it must do so within **2 days**.

### 5. Winners are chosen — and everyone pays their own price

The operator works out who gets quotas using one simple rule: **highest price first, until the quotas run out.**

Walking through our example: sorted from highest to lowest price, that's Ana (650 XLM) → Bruno (600 XLM) → Carla (580 XLM) → Diego (520 XLM).

- Ana's 200 quotas are allocated first. 800 remain.
- Bruno's 500 quotas are allocated next. 300 remain.
- Carla asked for 400, but only 300 are left — so she gets **300**, a partial fill, and the platform will hand back the part of her locked funds she didn't end up using.
- Diego asked for 300, but nothing is left — he gets **none**, and gets his entire locked amount back.

(If two people happened to bid the exact same price right at the cutoff point, whoever bid first gets priority for the quotas that are left.)

This is a **"pay-as-bid"** auction: there is no single shared price everyone pays. Each winner pays *exactly the price they themselves typed in* — Ana pays 650 × 200, Bruno pays 600 × 500, Carla pays 580 × 300 XLM. Other bidders and the public never find out what anyone else bid, including after the auction ends. Aurora receives each winner's payment separately, so after settlement it knows what each *winner* paid per quota. It never learns the prices of bids that lost.

Critically, the operator doesn't just announce this result and ask everyone to trust it. It has to produce a mathematical proof that the platform's own system checks automatically before accepting the outcome — a guarantee that the operator picked the real winners from the real sealed bids, without adding, removing, or changing anything. If the operator ever tried to fake a result, the platform itself would reject it.

### 6. Settlement happens automatically

As soon as that proof checks out, the platform automatically, without anyone clicking anything (each winner's payment, refund and quotas move together in one step — all or nothing):

- sends each winner their quotas (Ana gets 200, Bruno gets 500, Carla gets 300);
- sends each winner's payment through to Aurora Capital, minus the platform's 10% fee (for Ana's 130,000 XLM, Aurora receives 117,000 and the platform 13,000);
- returns Carla's unused locked funds (the part covering the 100 quotas she asked for but didn't get);
- returns Diego's entire locked amount, since he won nothing.

Aurora Capital sees each winner's payment land in its private balance. Returned funds land in each bidder's private balance, where one click makes them spendable again.

If a winner pulled their locked funds back before settlement, their quotas can't be delivered: those quotas simply go back to Aurora, and nobody else's settlement is affected.

### 7. If not all the quotas find a buyer

Suppose total demand across all bidders only adds up to 600 quotas instead of the full 1,000. That's fine: Aurora still receives payment for the 600 quotas that were genuinely bid on and sold. The remaining 400 are simply returned to Aurora as soon as the result is final — nothing forces the company to give away quotas nobody offered to pay for, and nothing forces a re-run of the whole auction.

### 8. The safety net: what if the operator doesn't act?

If, for whatever reason, the operator fails to produce a result within 2 days after the closing date, the auction can be cancelled by anyone. Aurora gets its quotas back, and every bidder gets a full refund of their locked funds — automatically while the platform is running. In the unlikely case the platform itself is offline, each bidder can still take their own funds back with one action from their wallet. Nobody's money or asset can ever be left stuck waiting on the platform indefinitely.

## Who can see what, at each stage

| Stage | Company | Other bidders | Operator (platform) | General public |
|---|---|---|---|---|
| While auction is open | Nothing about any bid's price | Nothing about any bid's price | Every bid's price, from the moment its funds are locked | Nothing about any bid's price |
| Quantity requested per bid | Visible | Visible | Visible | Visible |
| Minimum price per quota | Visible (they set it) | Visible | Visible | Visible |
| Individual bid prices, ever | Winners' prices, after settlement; never losers' | Never | Yes, from lock time | Never |
| Final list of winners and quantities | Visible | Visible | Visible | Visible |
| Individual winning payment amounts | Sees each payment it receives | Never | Yes | Never |

## Deliberately out of scope for this version

- **Identity verification / KYC** — not required to open an auction or to bid, for now. Can be layered on top later as a separate step.
- **Reselling quotas after purchase** — this journey ends at settlement; what a winner does with their quotas afterward isn't covered here.
- **Multiple simultaneous auctions per company, or bidding across several auctions at once** — not described here, but nothing above assumes only one auction can exist at a time.
