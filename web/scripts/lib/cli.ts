/** Argumentos de linha de comando dos scripts, sem dependência externa. */

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface Args {
  /** Opções que recebem valor (`--to G...`, `--amount=10`). */
  values: Map<string, string>;
  /** Opções booleanas (`--resume`, `--force`). */
  flags: Set<string>;
  /** Argumentos soltos, quando o script aceita. */
  positional: string[];
}

/**
 * `valueOptions` são as únicas opções que consomem o próximo argumento. Qualquer outra opção
 * `--x` é booleana; uma opção desconhecida com valor (`--x=1`) é erro de uso.
 */
export function parseArgs(argv: string[], valueOptions: readonly string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  const takesValue = new Set(valueOptions);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (name.length === 0) throw new UsageError("opção vazia: use --nome ou --nome=valor");

    if (eq !== -1) {
      if (!takesValue.has(name)) throw new UsageError(`--${name} não recebe valor`);
      const value = arg.slice(eq + 1);
      if (value.length === 0) throw new UsageError(`--${name} precisa de um valor`);
      values.set(name, value);
      continue;
    }

    if (takesValue.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`--${name} precisa de um valor`);
      values.set(name, next);
      i++;
      continue;
    }

    flags.add(name);
  }

  return { values, flags, positional };
}

export function required(args: Args, name: string): string {
  const value = args.values.get(name);
  if (value === undefined || value.trim().length === 0) throw new UsageError(`falta --${name}`);
  return value;
}

/** Saída de progresso dos scripts; sem cores para funcionar igual em CI e no terminal. */
export function step(message: string): void {
  console.log(`· ${message}`);
}

export function done(message: string): void {
  console.log(`✓ ${message}`);
}

export function warn(message: string): void {
  console.warn(`! ${message}`);
}

/** Erro de script, com a mensagem que o usuário precisa ver (nunca um segredo). */
export function fail(message: string): never {
  throw new Error(message);
}
