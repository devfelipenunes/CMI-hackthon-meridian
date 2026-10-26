# Monorepo scripts

CMI Auctions brings together four projects that were born separate (`contracts`, `sdk`,
`operator`, and `web`) and still use paths relative to one another. The versioned symlinks solve
that without turning each project into a submodule.

## `link-subprojects.sh`

Re-creates the links between the projects:

```text
web/sdk         -> ../sdk
web/specs       -> ../specs
sdk/contracts   -> ../contracts
sdk/specs       -> ../specs
contracts/specs -> ../specs
```

```bash
./scripts/link-subprojects.sh
```

The script is idempotent and safe to run again:

- if the path is already a link, it is re-created;
- if it is an empty directory, it is removed and replaced by the link;
- if it is a directory with content, the script **does not touch it** and prints `skip:`.

A fresh clone already contains the links (they are versioned). The script exists to repair the
tree after an import, a partial checkout, or a copy that lost the links.

After it, the setup is each project's own: `cd sdk && pnpm install`, `cd web && pnpm install`,
`cd operator && ./scripts/setup-sdk.sh`.

> Do not edit `specs/` from `sdk/`, `web/`, or `contracts/`: the link points to the single copy at
> the top of the repository, so an edit made from one side applies to all of them.
